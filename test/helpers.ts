import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import type { JWTPayload, JWK } from 'jose';

export interface FetchCall {
  url: string;
  init: RequestInit | undefined;
  body: unknown;
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

type FetchHandler =
  | Response
  | Error
  | ((call: FetchCall) => Response | Promise<Response> | Error);

export function mockFetch(
  handler: FetchHandler,
): { fetch: typeof globalThis.fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const fn = (async (input: string | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();
    let body: unknown;
    if (init?.body) {
      try {
        body = JSON.parse(init.body as string);
      } catch {
        body = init.body;
      }
    }
    const call: FetchCall = { url, init, body };
    calls.push(call);

    const result =
      typeof handler === 'function' ? await handler(call) : handler;
    if (result instanceof Error) throw result;
    return result;
  }) as unknown as typeof globalThis.fetch;

  return { fetch: fn, calls };
}

export function sequenceFetch(
  items: Array<Response | Error>,
): { fetch: typeof globalThis.fetch; calls: FetchCall[] } {
  let i = 0;
  return mockFetch(() => {
    const item = items[Math.min(i, items.length - 1)];
    i++;
    return item ?? new Response(null, { status: 500 });
  });
}

export interface SigningKit {
  jwksUri: string;
  sign(
    payload: JWTPayload,
    opts?: { aud?: string | string[]; iss?: string; expSec?: number },
  ): Promise<string>;
  fetch: typeof globalThis.fetch;
}

export async function makeSigningKit(options?: {
  iss?: string;
  jwksUri?: string;
}): Promise<SigningKit> {
  const iss = options?.iss ?? 'https://iam.example.com';
  const jwksUri = options?.jwksUri ?? `${iss}/.well-known/jwks.json`;
  const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true });
  const jwk: JWK = await exportJWK(publicKey);
  jwk.kid = 'test-key-1';
  jwk.alg = 'ES256';
  jwk.use = 'sig';
  const jwks = { keys: [jwk] };

  const fetchImpl = mockFetch(() => jsonResponse(jwks)).fetch;

  async function sign(
    payload: JWTPayload,
    opts?: { aud?: string | string[]; iss?: string; expSec?: number },
  ): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const builder = new SignJWT(payload)
      .setProtectedHeader({ alg: 'ES256', kid: 'test-key-1' })
      .setIssuedAt(now)
      .setIssuer(opts?.iss ?? iss);
    if (opts?.aud !== undefined) builder.setAudience(opts.aud);
    builder.setExpirationTime(now + (opts?.expSec ?? 3600));
    return builder.sign(privateKey);
  }

  return { jwksUri, sign, fetch: fetchImpl };
}