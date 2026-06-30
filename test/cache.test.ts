import { describe, it, expect, vi } from 'vitest';
import { IamClient } from '../src/index.js';
import { jsonResponse, mockFetch } from './helpers.js';

const BASE = 'https://iam.example.com/api/iam/v1';

const QUERY = {
  subject: { type: 'user', id: 'usr_123' },
  permission: 'doc.read',
} as const;

function allowResponse(policyVersion = 1): Response {
  return jsonResponse({ data: { allowed: true, policy_version: policyVersion } });
}

function denyResponse(policyVersion = 1): Response {
  return jsonResponse({ data: { allowed: false, policy_version: policyVersion } });
}

describe('cache — opt-in TTL cache', () => {
  it('is disabled by default (every call hits the network)', async () => {
    const { fetch, calls } = mockFetch(allowResponse());
    const c = new IamClient({ baseUrl: BASE, fetch });
    await c.check(QUERY);
    await c.check(QUERY);
    expect(calls).toHaveLength(2);
  });

  it('returns a cached decision on a second identical call within TTL', async () => {
    const { fetch, calls } = mockFetch(allowResponse());
    const c = new IamClient({ baseUrl: BASE, fetch, cache: { ttlMs: 5000 } });
    await c.check(QUERY);
    await c.check(QUERY);
    expect(calls).toHaveLength(1);
  });

  it('re-fetches after TTL expires', async () => {
    vi.useFakeTimers();
    const { fetch, calls } = mockFetch(allowResponse());
    const c = new IamClient({ baseUrl: BASE, fetch, cache: { ttlMs: 100 } });
    await c.check(QUERY);
    expect(calls).toHaveLength(1);

    vi.advanceTimersByTime(200);
    await c.check(QUERY);
    expect(calls).toHaveLength(2);
    vi.useRealTimers();
  });

  it('NEVER turns a deny into an allow: deny is stored and returned from cache', async () => {
    const { fetch, calls } = mockFetch(denyResponse());
    const c = new IamClient({ baseUrl: BASE, fetch, cache: { ttlMs: 5000 } });
    const d1 = await c.check(QUERY);
    const d2 = await c.check(QUERY);
    expect(d1.allowed).toBe(false);
    expect(d2.allowed).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it('transport errors are never cached (a fresh request always follows a failure)', async () => {
    const { fetch, calls } = mockFetch(new Error('ECONNREFUSED'));
    const c = new IamClient({ baseUrl: BASE, fetch, cache: { ttlMs: 5000 } });
    await c.check(QUERY);
    await c.check(QUERY);
    expect(calls).toHaveLength(2);
  });

  it('flushes the whole cache when policy_version bumps', async () => {
    let callCount = 0;
    const fetchImpl = mockFetch(() => {
      callCount++;
      if (callCount === 1) return allowResponse(1);
      if (callCount === 2) return allowResponse(2);
      return allowResponse(2);
    }).fetch;

    const c = new IamClient({ baseUrl: BASE, fetch: fetchImpl, cache: { ttlMs: 5000 } });

    await c.check(QUERY);

    const q2 = { subject: { id: 'usr_456' }, permission: 'doc.write' };
    await c.check(q2);

    await c.check(QUERY);
    expect(callCount).toBe(3);
  });

  it('does not cache explain queries', async () => {
    const { fetch, calls } = mockFetch(allowResponse());
    const c = new IamClient({ baseUrl: BASE, fetch, cache: { ttlMs: 5000 } });
    await c.check({ ...QUERY, explain: true });
    await c.check({ ...QUERY, explain: true });
    expect(calls).toHaveLength(2);
  });
});