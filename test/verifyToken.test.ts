import { describe, it, expect } from 'vitest';
import { IamClient, TokenVerificationError } from '../src/index.js';
import { makeSigningKit } from './helpers.js';

const BASE = 'https://iam.example.com/api/iam/v1';
const ISS = 'https://iam.example.com';

describe('verifyToken', () => {
  it('returns claims for a valid ES256 token (correct iss/aud, not expired)', async () => {
    const kit = await makeSigningKit({ iss: ISS });
    const client = new IamClient({
      baseUrl: BASE,
      fetch: kit.fetch,
      verify: { issuer: ISS, audience: 'warehouse', jwksUri: kit.jwksUri },
    });
    const token = await kit.sign({ sub: 'usr_123', org: 'org_1' }, { aud: 'warehouse' });

    const claims = await client.verifyToken(token);
    expect(claims.sub).toBe('usr_123');
    expect(claims.iss).toBe(ISS);
  });

  it('fail-closed: rejects when no audience is configured (never accept-any-aud)', async () => {
    const kit = await makeSigningKit({ iss: ISS });
    const token = await kit.sign({ sub: 'usr_123' }, { aud: 'warehouse' });
    // No `audience` in client defaults nor in the call options → must throw,
    // not silently skip the `aud` check (jose's default when audience is absent).
    const client = new IamClient({
      baseUrl: BASE,
      fetch: kit.fetch,
      verify: { issuer: ISS, jwksUri: kit.jwksUri },
    });

    await expect(client.verifyToken(token)).rejects.toBeInstanceOf(TokenVerificationError);
    // A per-call audience satisfies the requirement.
    const claims = await client.verifyToken(token, { audience: 'warehouse' });
    expect(claims.sub).toBe('usr_123');
  });

  it('rejects a token with the wrong audience', async () => {
    const kit = await makeSigningKit({ iss: ISS });
    const client = new IamClient({
      baseUrl: BASE,
      fetch: kit.fetch,
      verify: { issuer: ISS, audience: 'warehouse', jwksUri: kit.jwksUri },
    });
    const token = await kit.sign({ sub: 'usr_123' }, { aud: 'someone-else' });

    await expect(client.verifyToken(token)).rejects.toBeInstanceOf(TokenVerificationError);
  });

  it('rejects a malformed token string', async () => {
    const kit = await makeSigningKit({ iss: ISS });
    const client = new IamClient({
      baseUrl: BASE,
      fetch: kit.fetch,
      verify: { issuer: ISS, audience: 'warehouse', jwksUri: kit.jwksUri },
    });
    await expect(client.verifyToken('not-a-jwt')).rejects.toBeInstanceOf(TokenVerificationError);
  });

  it('throws on a non-absolute baseUrl (constructor validation)', () => {
    expect(
      () => new IamClient({ baseUrl: 'not-a-url', verify: { audience: 'x' } }),
    ).toThrow();
  });
});
