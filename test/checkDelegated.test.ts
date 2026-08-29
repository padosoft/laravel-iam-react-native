import { describe, it, expect } from 'vitest';
import { IamClient, TokenVerificationError } from '../src/index.js';
import { jsonResponse, mockFetch, makeSigningKit } from './helpers.js';

const BASE = 'https://iam.example.com/api/iam/v1';
const ISS = 'https://iam.example.com';

function allow(overrides: Record<string, unknown> = {}): Response {
  return jsonResponse({
    data: { allowed: true, decision_id: 'dec_1', policy_version: 3, ...overrides },
  });
}

describe('checkDelegated — wire contract', () => {
  it('routes to decisions/check-delegated and sends the chain', async () => {
    const { fetch, calls } = mockFetch(allow());
    const client = new IamClient({ baseUrl: BASE, token: 'tok', fetch });

    const decision = await client.checkDelegated(
      { type: 'user', id: 'usr_123' },
      ['agent:hop2', 'agent:hop1'],
      'orders.draft',
      { resource: { type: 'order', id: 'ord_1' }, delegationGrantId: 'dgr_9' },
    );

    expect(decision.allowed).toBe(true);
    expect(calls[0]?.url).toBe(`${BASE}/decisions/check-delegated`);
    expect(calls[0]?.body).toMatchObject({
      subject: { type: 'user', id: 'usr_123' },
      permission: 'orders.draft',
      actors: ['agent:hop2', 'agent:hop1'],
      delegation_grant_id: 'dgr_9',
    });
  });

  it('leaves the PLAIN check body byte-identical', async () => {
    const { fetch, calls } = mockFetch(allow());
    const client = new IamClient({ baseUrl: BASE, token: 'tok', fetch });

    await client.check({ subject: { id: 'usr_1' }, permission: 'stock.adjust' });

    expect(calls[0]?.url).toBe(`${BASE}/decisions/check`);
    const body = calls[0]?.body as Record<string, unknown>;
    expect(body).not.toHaveProperty('actors');
    expect(body).not.toHaveProperty('delegation_grant_id');
  });
});

describe('checkDelegated — fail-closed', () => {
  it('denies an EMPTY actor chain without calling the server', async () => {
    // Not "fall back to the user check": that would answer a question about the user
    // when the caller asked about an agent, granting more than the delegation allows.
    const { fetch, calls } = mockFetch(allow());
    const decision = await new IamClient({ baseUrl: BASE, fetch }).checkDelegated(
      { id: 'usr_1' },
      [],
      'orders.read',
    );

    expect(decision.allowed).toBe(false);
    expect(decision.explanation).toEqual(['no-actor']);
    expect(calls).toHaveLength(0);
  });

  it('denies a chain of blanks, and a missing subject', async () => {
    const { fetch, calls } = mockFetch(allow());
    const client = new IamClient({ baseUrl: BASE, fetch });

    expect((await client.checkDelegated({ id: 'usr_1' }, ['', ''], 'x')).allowed).toBe(false);
    expect((await client.checkDelegated({ id: '' }, ['agent:a1'], 'x')).explanation).toEqual([
      'no-subject',
    ]);
    expect(calls).toHaveLength(0);
  });

  it('denies on transport failure', async () => {
    const { fetch } = mockFetch(new Error('offline'));
    const decision = await new IamClient({ baseUrl: BASE, fetch }).checkDelegated(
      { id: 'usr_1' },
      ['agent:a1'],
      'orders.read',
    );
    expect(decision.explanation).toEqual(['transport']);
  });

  it('canDelegated is false when a step-up is pending', async () => {
    const { fetch } = mockFetch(allow({ requires_step_up: true, required_aal: 'aal2' }));
    const client = new IamClient({ baseUrl: BASE, fetch });
    expect(await client.canDelegated({ id: 'usr_1' }, ['agent:a1'], 'orders.pay')).toBe(false);
  });
});

describe('the cache must never outlive a revocation', () => {
  it('NEVER caches a delegated verdict, even with the cache enabled', async () => {
    const { fetch, calls } = mockFetch(() => allow());
    const client = new IamClient({ baseUrl: BASE, fetch, cache: { ttlMs: 60_000 } });

    await client.checkDelegated({ id: 'usr_1' }, ['agent:a1'], 'orders.read');
    await client.checkDelegated({ id: 'usr_1' }, ['agent:a1'], 'orders.read');

    expect(calls).toHaveLength(2);
  });

  it('still caches plain checks', async () => {
    const { fetch, calls } = mockFetch(() => allow());
    const client = new IamClient({ baseUrl: BASE, fetch, cache: { ttlMs: 60_000 } });

    await client.check({ subject: { id: 'usr_1' }, permission: 'stock.adjust' });
    await client.check({ subject: { id: 'usr_1' }, permission: 'stock.adjust' });

    expect(calls).toHaveLength(1);
  });
});

describe('verifyToken REFUSES a delegated token', () => {
  it('rejects a perfectly-signed delegated token instead of returning user authority', async () => {
    // The load-bearing case for a mobile client. This token verifies: real signature,
    // right issuer, right audience, `sub` naming the user. Returning its claims would
    // hand the caller the USER's full authority while silently discarding the bound
    // scope of the agent that actually holds it — the confused deputy, on-device.
    const kit = await makeSigningKit({ iss: ISS });
    const client = new IamClient({
      baseUrl: BASE,
      fetch: kit.fetch,
      verify: { issuer: ISS, audience: 'warehouse', jwksUri: kit.jwksUri },
    });
    const token = await kit.sign(
      { sub: 'user:42', act: { sub: 'agent:a1' }, scope: 'orders:read' },
      { aud: 'warehouse' },
    );

    await expect(client.verifyToken(token)).rejects.toThrow(TokenVerificationError);
    await expect(client.verifyToken(token)).rejects.toThrow(/delegated token/);
  });

  it('rejects a token whose act is malformed — unreadable never means "not delegated"', async () => {
    const kit = await makeSigningKit({ iss: ISS });
    const client = new IamClient({
      baseUrl: BASE,
      fetch: kit.fetch,
      verify: { issuer: ISS, audience: 'warehouse', jwksUri: kit.jwksUri },
    });
    const token = await kit.sign({ sub: 'user:42', act: { sub: 'nope' } }, { aud: 'warehouse' });

    await expect(client.verifyToken(token)).rejects.toThrow(TokenVerificationError);
  });

  it('still accepts an ordinary user token (no regression)', async () => {
    const kit = await makeSigningKit({ iss: ISS });
    const client = new IamClient({
      baseUrl: BASE,
      fetch: kit.fetch,
      verify: { issuer: ISS, audience: 'warehouse', jwksUri: kit.jwksUri },
    });
    const token = await kit.sign({ sub: 'usr_123', org: 'org_1' }, { aud: 'warehouse' });

    await expect(client.verifyToken(token)).resolves.toMatchObject({ sub: 'usr_123' });
  });
});
