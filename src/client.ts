import {
  createLocalJWKSet,
  jwtVerify,
  type JSONWebKeySet,
  type JWTVerifyGetKey,
} from 'jose';
import { DecisionCache, cacheKey } from './cache.js';
import { decisionFromBody, deny, isGranted } from './decision.js';
import { actorChainFromClaims, MalformedDelegationError } from './delegation.js';
import { TokenVerificationError } from './errors.js';
import type { DelegatedDecisionQuery, IamClientConfig } from './types.js';
import type { Claims, Decision, DecisionQuery, Resource, Subject, VerifyOptions } from '@padosoft/laravel-iam-node';

const DEFAULT_TIMEOUT_MS = 2000;
const DEFAULT_CHECK_PATH = 'decisions/check';
const DEFAULT_LIST_RESOURCES_PATH = 'decisions/list-resources';
const DEFAULT_CHECK_DELEGATED_PATH = 'decisions/check-delegated';
const JWKS_MAX_AGE_MS = 10 * 60 * 1000;

/**
 * Thin, fail-closed client for the Laravel IAM control plane — React Native edition.
 *
 * Wire contract identical to IamClient from @padosoft/laravel-iam-node:
 * same endpoint, same payload, same response parsing. RN-safe cache (no node:crypto).
 *
 * Fail-closed: network error, timeout, non-2xx, malformed body, or unverifiable token
 * always resolves to deny — never throws and never returns allow on uncertainty.
 */
export class IamClient {
  private readonly baseUrl: string;
  private readonly token: string | undefined;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly cache: DecisionCache;
  private readonly checkPath: string;
  private readonly listResourcesPath: string;
  private readonly checkDelegatedPath: string;
  private readonly verifyDefaults: VerifyOptions;
  private readonly jwks = new Map<string, { keySet: JWTVerifyGetKey; fetchedAt: number }>();

  constructor(config: IamClientConfig) {
    if (!config.baseUrl) {
      throw new Error('IamClient: `baseUrl` is required');
    }
    // Require an absolute URL up front. Otherwise `new URL(baseUrl)` later silently
    // drops the issuer check (defaultIssuer → undefined) and `defaultJwksUri()` —
    // called outside verifyToken's try/catch — throws a raw error instead of a
    // TokenVerificationError. Validate once, fail loud at construction.
    try {
      // eslint-disable-next-line no-new
      new URL(config.baseUrl);
    } catch {
      throw new Error('IamClient: `baseUrl` must be an absolute URL (e.g. https://iam.example.com/api/iam/v1)');
    }
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.token = config.token;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.retries = Math.max(0, config.retries ?? 0);
    this.fetchImpl = config.fetch ?? globalThis.fetch;
    this.cache = new DecisionCache(config.cache?.ttlMs ?? 0, config.cache?.maxEntries);
    this.checkPath = trimPath(config.checkPath ?? DEFAULT_CHECK_PATH);
    this.listResourcesPath = trimPath(config.listResourcesPath ?? DEFAULT_LIST_RESOURCES_PATH);
    this.checkDelegatedPath = trimPath(
      config.checkDelegatedPath ?? DEFAULT_CHECK_DELEGATED_PATH,
    );
    this.verifyDefaults = config.verify ?? {};

    if (typeof this.fetchImpl !== 'function') {
      throw new Error(
        'IamClient: no `fetch` available. Pass `fetch` in config or use React Native >= 0.61.',
      );
    }
  }

  async check(query: DelegatedDecisionQuery): Promise<Decision> {
    if (!query.subject || !query.subject.id) {
      return deny('no-subject');
    }

    const payload = toPayload(query);
    const explain = query.explain === true;
    const delegated = payload['actors'] !== undefined;

    // Explain queries are never cached, and neither are DELEGATED ones: a grant can be
    // revoked at any moment, and a cached delegated allow would outlive the revocation
    // that was supposed to stop it.
    const key = !explain && !delegated && this.cache.enabled ? cacheKey(payload) : undefined;
    if (key !== undefined) {
      const cached = this.cache.get(key);
      if (cached) return cached;
    }

    const body = await this.requestJson(
      delegated ? this.checkDelegatedPath : this.checkPath,
      payload,
    );
    if (body === undefined) {
      return deny('transport');
    }

    const decision = decisionFromBody(body);
    if (key !== undefined) {
      this.cache.set(key, decision);
    }
    return decision;
  }

  async can(query: DecisionQuery): Promise<boolean> {
    return isGranted(await this.check(query));
  }

  /**
   * Ask the PDP whether an AGENT may do something ON BEHALF OF the user.
   *
   * The verdict is the strict intersection — the user's authority AND every actor's
   * authority AND the grant's scope — never the union. Adding a hop can only narrow
   * what is permitted.
   *
   * Use it to drive UI: a consent screen showing what an agent would be able to do,
   * or a "your agents" view. The PDP decides; this app only asks.
   *
   * An empty chain is a deny, not a fall-back to the plain user check.
   *
   * @param actors act chain, `agent:<id>`, CURRENT actor first
   */
  async checkDelegated(
    subject: { type?: string | undefined; id: string },
    actors: string[],
    permission: string,
    options: Omit<DelegatedDecisionQuery, 'subject' | 'permission' | 'actors'> = {},
  ): Promise<Decision> {
    if (!subject || !subject.id) return deny('no-subject');

    const chain = (actors ?? []).filter((a): a is string => typeof a === 'string' && a !== '');
    if (chain.length === 0) return deny('no-actor');

    const normalized: Subject = subject.type === undefined
      ? { id: subject.id }
      : { type: subject.type, id: subject.id };

    return this.check({ ...options, subject: normalized, permission, actors: chain });
  }

  /** Fail-safe wrapper around {@link checkDelegated}. */
  async canDelegated(
    subject: { type?: string | undefined; id: string },
    actors: string[],
    permission: string,
    options: Omit<DelegatedDecisionQuery, 'subject' | 'permission' | 'actors'> = {},
  ): Promise<boolean> {
    return isGranted(await this.checkDelegated(subject, actors, permission, options));
  }

  async listResources(
    subject: { type?: string | undefined; id: string },
    relation: string,
  ): Promise<Resource[]> {
    if (!subject || !subject.id || !relation) return [];

    const body = await this.requestJson(this.listResourcesPath, {
      subject: { type: subject.type ?? 'user', id: subject.id },
      relation,
    });
    if (body === undefined) return [];

    const data = unwrap(body);
    const resources =
      data && typeof data === 'object'
        ? (data as Record<string, unknown>)['resources']
        : undefined;
    if (!Array.isArray(resources)) return [];

    return resources.filter(
      (r): r is Resource =>
        typeof r === 'object' &&
        r !== null &&
        typeof (r as Resource).type === 'string' &&
        typeof (r as Resource).id === 'string',
    );
  }

  async verifyToken(jwt: string, options?: VerifyOptions): Promise<Claims> {
    if (typeof jwt !== 'string' || jwt === '') {
      throw new TokenVerificationError('empty token');
    }

    const opts = { ...this.verifyDefaults, ...options };

    // Fail-closed on audience: jose silently SKIPS the `aud` check when no
    // audience is supplied, so a token minted for another service in the same
    // cluster (right issuer, right signing key) would verify. Require an explicit
    // audience (client `verify.audience` or per-call `options.audience`).
    if (opts.audience === undefined) {
      throw new TokenVerificationError(
        'audience is required: set `verify.audience` on the client or pass `options.audience` to verifyToken',
      );
    }

    const uri = opts.jwksUri ?? this.defaultJwksUri();
    const issuer = opts.issuer ?? this.defaultIssuer();
    const verifyOptions = {
      algorithms: ['ES256'] as string[],
      ...(issuer !== undefined ? { issuer } : {}),
      audience: opts.audience,
    };

    let refetched = false;
    for (;;) {
      let keySet: JWTVerifyGetKey;
      try {
        keySet = await this.resolveJwks(uri, refetched);
      } catch (err) {
        throw new TokenVerificationError(jwksFailureReason(err), { cause: err });
      }

      try {
        const { payload } = await jwtVerify(jwt, keySet, verifyOptions);
        // A DELEGATED token has a valid signature and a `sub` naming the user — so it
        // verifies here perfectly, and returning it would hand the caller the user's
        // FULL authority while silently discarding the bound scope of the agent that
        // actually holds it. That is the confused deputy delegation exists to prevent,
        // so this method refuses delegated tokens outright.
        //
        // A mobile client cannot authorize one either way: that needs server-side
        // introspection, which needs credentials this app must never hold. Send the
        // token to your backend, and use `checkDelegated` for UI decisions.
        assertNotDelegated(payload as Record<string, unknown>);
        return payload as Claims;
      } catch (err) {
        if (!refetched && isKeyResolutionError(err)) {
          refetched = true;
          continue;
        }
        const reason = err instanceof Error ? err.message : 'unknown';
        throw new TokenVerificationError(reason, { cause: err });
      }
    }
  }

  private async requestJson(
    path: string,
    payload: Record<string, unknown>,
  ): Promise<unknown> {
    const url = `${this.baseUrl}/${path}`;
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
    if (this.token !== undefined) headers['Authorization'] = `Bearer ${this.token}`;
    const serialized = JSON.stringify(payload);

    for (let attempt = 0; attempt <= this.retries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.fetchImpl(url, {
          method: 'POST',
          headers,
          body: serialized,
          signal: controller.signal,
        });

        if (response.status < 200 || response.status >= 300) {
          return undefined;
        }
        try {
          return await response.json() as unknown;
        } catch {
          return undefined;
        }
      } catch {
        if (attempt >= this.retries) return undefined;
      } finally {
        clearTimeout(timer);
      }
    }
    return undefined;
  }

  private async resolveJwks(uri: string, force = false): Promise<JWTVerifyGetKey> {
    const cached = this.jwks.get(uri);
    if (!force && cached && Date.now() - cached.fetchedAt < JWKS_MAX_AGE_MS) {
      return cached.keySet;
    }

    const document = await this.fetchJwks(uri);
    const keySet = createLocalJWKSet(document);
    this.jwks.set(uri, { keySet, fetchedAt: Date.now() });
    return keySet;
  }

  private async fetchJwks(uri: string): Promise<JSONWebKeySet> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(uri, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      if (response.status < 200 || response.status >= 300) {
        throw new Error(`jwks http ${response.status}`);
      }
      const body: unknown = await response.json();
      if (
        typeof body !== 'object' ||
        body === null ||
        !Array.isArray((body as { keys?: unknown }).keys)
      ) {
        throw new Error('malformed jwks document');
      }
      return body as JSONWebKeySet;
    } finally {
      clearTimeout(timer);
    }
  }

  private defaultJwksUri(): string {
    return new URL('/.well-known/jwks.json', this.baseUrl).href;
  }

  private defaultIssuer(): string | undefined {
    try {
      return new URL(this.baseUrl).origin;
    } catch {
      return undefined;
    }
  }
}

/**
 * Refuse a delegated token on the plain-user verification path.
 *
 * A malformed `act` is refused just as firmly as a well-formed one: "unreadable" must
 * never degrade into "not delegated", which would be the escalation itself.
 */
function assertNotDelegated(payload: Record<string, unknown>): void {
  let actors: string[] | null;
  try {
    actors = actorChainFromClaims(payload);
  } catch (err) {
    const reason = err instanceof MalformedDelegationError ? err.message : 'unreadable act claim';
    throw new TokenVerificationError(reason);
  }
  if (actors !== null) {
    throw new TokenVerificationError(
      'delegated token: verifyToken is the plain-user path. A delegated token must be ' +
        'authorized server-side (introspection + a delegated decision), never from its ' +
        'claims on a client. See `checkDelegated`.',
    );
  }
}

function trimPath(path: string): string {
  return path.replace(/^\/+|\/+$/g, '');
}

function isKeyResolutionError(err: unknown): boolean {
  const code = (err as { code?: string } | undefined)?.code;
  return code === 'ERR_JWKS_NO_MATCHING_KEY' || code === 'ERR_JWKS_MULTIPLE_MATCHING_KEYS';
}

function jwksFailureReason(err: unknown): string {
  return err instanceof Error ? `jwks: ${err.message}` : 'jwks: unknown';
}

function unwrap(body: unknown): unknown {
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const data = (body as Record<string, unknown>)['data'];
    if (data && typeof data === 'object') return data;
  }
  return body;
}

function toPayload(query: DelegatedDecisionQuery): Record<string, unknown> {
  const body: Record<string, unknown> = {
    subject: { type: query.subject.type ?? 'user', id: query.subject.id },
    permission: query.permission,
    organization: query.organization ?? null,
    application: query.application ?? null,
    resource: query.resource ?? null,
    context: query.context ?? {},
    current_aal: query.currentAal ?? 'aal1',
    explain: query.explain === true,
  };

  // Delegation keys appear ONLY on delegated queries, so the plain-check body stays
  // byte-identical and an older server is unaffected.
  const actors = (query.actors ?? []).filter((a): a is string => typeof a === 'string' && a !== '');
  if (actors.length > 0) {
    body['actors'] = actors;
    if (typeof query.delegationGrantId === 'string' && query.delegationGrantId !== '') {
      body['delegation_grant_id'] = query.delegationGrantId;
    }
  }

  return body;
}