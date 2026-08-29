/**
 * Delegated access (RFC 8693) — the React Native half.
 *
 * A delegated token carries TWO identities: `sub` is the user, `act` is the agent
 * acting for them (nested outermost-first, RFC 8693 §4.1). This module parses that
 * chain and nothing more.
 *
 * Parity note: the parsing rules are byte-identical to `@padosoft/laravel-iam-node`
 * and the PHP SDK, but the base64url decoding is done by hand — React Native has no
 * `Buffer`, and this package must not reach for a `node:` builtin.
 */

/** Header `typ` carried by tokens minted through the token-exchange grant. */
export const TYP_DELEGATED = 'delegated+jwt';

const AGENT_PREFIX = 'agent:';
/** A cyclic or absurdly deep `act` claim must not spin the parser. */
const MAX_CHAIN_DEPTH = 16;

/** One actor, as it appears in the `act` claim: `agent:<id>`. */
export type ActorId = string;

/**
 * What a delegated token says about who is acting for whom.
 *
 * There is no `verified` flag here, unlike the server-side SDKs, and that absence is
 * the point: a mobile client is not a token verifier (see {@link inspectDelegatedBearer}).
 * Treat this as display and routing information only.
 */
export interface DelegatedBearer {
  /** The delegating user — never the agent. */
  sub: string;
  /** The act chain, CURRENT actor first; the last element is the root. */
  actors: ActorId[];
  /** `pds_dgr` — the grant this delegation descends from. */
  grantId: string | null;
  scopes: string[];
}

/**
 * Thrown when a token IS delegated but cannot be read. Distinct from "not delegated":
 * the caller must refuse, never fall back to the plain-user path.
 */
export class MalformedDelegationError extends Error {
  override readonly name = 'MalformedDelegationError';

  constructor(reason: string) {
    super(`malformed delegated token: ${reason}`);
  }
}

interface ActLevel {
  sub?: unknown;
  act?: unknown;
}

/**
 * Read the act chain out of an `act` claim. Returns `null` when the claim is absent
 * (the token is simply not delegated), and THROWS when it is present but malformed.
 *
 * The asymmetry is deliberate: a token with an unreadable `act` must not silently
 * degrade into a full-authority user token. Absent means "not delegated"; unreadable
 * means "refuse".
 */
export function actorChainFromClaims(claims: Record<string, unknown>): ActorId[] | null {
  const act = claims['act'];
  if (act === undefined || act === null) return null;

  const actors: ActorId[] = [];
  let level: unknown = act;
  for (let depth = 0; depth < MAX_CHAIN_DEPTH; depth += 1) {
    if (typeof level !== 'object' || level === null || Array.isArray(level)) {
      throw new MalformedDelegationError('act level is not an object');
    }
    const sub = (level as ActLevel).sub;
    if (typeof sub !== 'string' || !sub.startsWith(AGENT_PREFIX) || sub.length <= AGENT_PREFIX.length) {
      throw new MalformedDelegationError('act level without a valid `agent:<id>` sub');
    }
    actors.push(sub);

    const next = (level as ActLevel).act;
    if (next === undefined || next === null) return actors;
    level = next;
  }
  throw new MalformedDelegationError(`chain deeper than ${MAX_CHAIN_DEPTH} hops`);
}

/** True when these claims describe a delegated token. */
export function isDelegated(claims: Record<string, unknown>): boolean {
  return claims['act'] !== undefined && claims['act'] !== null;
}

/** Split an OAuth `scope` string into a list, tolerating extra whitespace. */
export function parseScopes(scope: unknown): string[] {
  if (typeof scope !== 'string' || scope === '') return [];
  return scope.split(' ').filter((s) => s !== '');
}

/**
 * Build the delegation view from a claim set. Returns `null` when not delegated.
 *
 * @throws MalformedDelegationError when the claims are delegated but unreadable
 */
export function delegatedBearerFromClaims(
  claims: Record<string, unknown>,
): DelegatedBearer | null {
  const actors = actorChainFromClaims(claims);
  if (actors === null) return null;

  const sub = claims['sub'];
  if (typeof sub !== 'string' || sub === '') {
    throw new MalformedDelegationError('delegated token without sub');
  }
  const grantId = claims['pds_dgr'];

  return {
    sub,
    actors,
    grantId: typeof grantId === 'string' && grantId !== '' ? grantId : null,
    scopes: parseScopes(claims['scope']),
  };
}

/**
 * Read a bearer JWT locally to see whether it is delegated, and for whom.
 *
 * **This is display and routing information, never authorization.** No signature is
 * checked, and on a mobile client none could usefully be: a delegated token is only
 * authorized through server-side introspection, which requires credentials this app
 * must never hold. Use it to render "Agent X, acting for you" — then let the PDP
 * decide, via {@link IamClient.checkDelegated}.
 *
 * Returns `null` when the token is not delegated.
 *
 * @throws MalformedDelegationError when it looks delegated but is unreadable
 */
export function inspectDelegatedBearer(jwt: string): DelegatedBearer | null {
  const parts = jwt.split('.');
  if (parts.length !== 3) return null; // not even a JWT: not delegated

  const header = decodeSegment(parts[0]);
  const claims = decodeSegment(parts[1]);
  if (header === null || claims === null) return null;

  const typDelegated = header['typ'] === TYP_DELEGATED;
  const hasAct = Object.prototype.hasOwnProperty.call(claims, 'act');
  if (!typDelegated && !hasAct) return null;

  const bearer = delegatedBearerFromClaims(claims);
  if (bearer === null) {
    // `typ` said delegated but there is no `act` to act on — refuse rather than hand
    // back a token that would then be read as full user authority.
    throw new MalformedDelegationError('typ is delegated+jwt but the act claim is absent');
  }
  return bearer;
}

/**
 * Decode a base64url JWT segment without `Buffer` (absent in React Native) and
 * without `node:` builtins. `atob` is available in the RN runtime (Hermes) and in
 * every browser; a hand-rolled fallback keeps this working in bare JS environments
 * that lack it.
 */
function decodeSegment(segment: string | undefined): Record<string, unknown> | null {
  if (segment === undefined || segment === '') return null;
  try {
    const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const parsed: unknown = JSON.parse(utf8FromBase64(padded));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function utf8FromBase64(base64: string): string {
  const binary = globalThis.atob(base64);
  // `atob` yields one char per BYTE; JWT claims are UTF-8, so re-decode the bytes or
  // any non-ASCII agent name / scope description comes back mangled.
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
