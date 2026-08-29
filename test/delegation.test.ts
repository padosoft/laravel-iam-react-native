import { describe, it, expect } from 'vitest';
import {
  actorChainFromClaims,
  delegatedBearerFromClaims,
  inspectDelegatedBearer,
  isDelegated,
  MalformedDelegationError,
  parseScopes,
  TYP_DELEGATED,
} from '../src/index.js';

/** Build an unsigned JWT-shaped string: local inspection never checks signatures. */
function jwtOf(header: Record<string, unknown>, claims: Record<string, unknown>): string {
  const b64 = (o: unknown): string =>
    Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64(header)}.${b64(claims)}.sig`;
}

describe('actorChainFromClaims', () => {
  it('returns null when the token is not delegated', () => {
    expect(actorChainFromClaims({ sub: 'user:42' })).toBeNull();
    expect(actorChainFromClaims({ sub: 'user:42', act: null })).toBeNull();
  });

  it('reads a nested chain CURRENT actor first, root last (RFC 8693 §4.1)', () => {
    // Outermost = the actor holding the token now; innermost = the root the user
    // consented to. Backwards, this silently names the wrong agent in the UI.
    expect(
      actorChainFromClaims({ act: { sub: 'agent:hop2', act: { sub: 'agent:hop1' } } }),
    ).toEqual(['agent:hop2', 'agent:hop1']);
  });

  it.each([
    ['act is a scalar', { act: 'agent:a1' }],
    ['act is an array', { act: ['agent:a1'] }],
    ['level without sub', { act: {} }],
    ['sub is not an agent', { act: { sub: 'user:42' } }],
    ['sub is the bare prefix', { act: { sub: 'agent:' } }],
    ['nested level is a scalar', { act: { sub: 'agent:a1', act: 'x' } }],
  ])('throws rather than degrading when %s', (_label, claims) => {
    expect(() => actorChainFromClaims(claims as Record<string, unknown>)).toThrow(
      MalformedDelegationError,
    );
  });

  it('refuses a chain deeper than 16 hops instead of spinning', () => {
    let act: Record<string, unknown> = { sub: 'agent:leaf' };
    for (let i = 0; i < 40; i += 1) act = { sub: `agent:h${i}`, act };
    expect(() => actorChainFromClaims({ act })).toThrow(/deeper than 16/);
  });
});

describe('isDelegated / parseScopes', () => {
  it('flags only claims that carry act', () => {
    expect(isDelegated({ act: { sub: 'agent:a1' } })).toBe(true);
    expect(isDelegated({ sub: 'user:42' })).toBe(false);
    expect(isDelegated({ act: null })).toBe(false);
  });

  it('splits scopes and drops blanks', () => {
    expect(parseScopes('a  b')).toEqual(['a', 'b']);
    expect(parseScopes('')).toEqual([]);
    expect(parseScopes(undefined)).toEqual([]);
  });
});

describe('delegatedBearerFromClaims', () => {
  it('keeps sub as the USER, never the agent', () => {
    expect(
      delegatedBearerFromClaims({
        sub: 'user:42',
        act: { sub: 'agent:a1' },
        pds_dgr: 'dgr_1',
        scope: 'orders:read orders:draft',
      }),
    ).toEqual({
      sub: 'user:42',
      actors: ['agent:a1'],
      grantId: 'dgr_1',
      scopes: ['orders:read', 'orders:draft'],
    });
  });

  it('throws when a delegated token has no sub', () => {
    expect(() => delegatedBearerFromClaims({ act: { sub: 'agent:a1' } })).toThrow(/without sub/);
  });
});

describe('inspectDelegatedBearer — RN-safe decoding, routing only', () => {
  it('reads a delegated token without Buffer or node:crypto', () => {
    const jwt = jwtOf(
      { alg: 'ES256', typ: TYP_DELEGATED },
      { sub: 'user:42', act: { sub: 'agent:a1' }, pds_dgr: 'dgr_1', scope: 'orders:read' },
    );
    expect(inspectDelegatedBearer(jwt)).toEqual({
      sub: 'user:42',
      actors: ['agent:a1'],
      grantId: 'dgr_1',
      scopes: ['orders:read'],
    });
  });

  it('decodes non-ASCII claims correctly (atob is byte-wise, claims are UTF-8)', () => {
    // An agent named in Italian/Japanese must not come back mangled in the consent UI.
    const jwt = jwtOf(
      { alg: 'ES256' },
      { sub: 'user:42', act: { sub: 'agent:città-アシスタント' } },
    );
    expect(inspectDelegatedBearer(jwt)?.actors).toEqual(['agent:città-アシスタント']);
  });

  it('detects delegation from act alone, without the typ header', () => {
    const jwt = jwtOf({ alg: 'ES256' }, { sub: 'user:42', act: { sub: 'agent:a1' } });
    expect(inspectDelegatedBearer(jwt)?.actors).toEqual(['agent:a1']);
  });

  it('returns null for a plain token and for a non-JWT', () => {
    expect(inspectDelegatedBearer(jwtOf({ alg: 'ES256' }, { sub: 'user:42' }))).toBeNull();
    expect(inspectDelegatedBearer('not-a-jwt')).toBeNull();
    expect(inspectDelegatedBearer('')).toBeNull();
  });

  it('throws when typ says delegated but there is no act to act on', () => {
    const jwt = jwtOf({ alg: 'ES256', typ: TYP_DELEGATED }, { sub: 'user:42' });
    expect(() => inspectDelegatedBearer(jwt)).toThrow(MalformedDelegationError);
  });
});
