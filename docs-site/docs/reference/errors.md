---
title: "Errors"
description: "TokenVerificationError — the only error this SDK throws: when it's raised, its shape (name, message, reason, cause), and how to handle it fail-closed. Why check/can/listResources never throw."
---

# Errors

This SDK throws **exactly one** error type, and only from one method. Everything else fails closed by **value**, not by exception.

## `TokenVerificationError`

Thrown (rejected) by [`IamClient.verifyToken`](/reference/client#verifytoken-jwt-options-promise-claims) when a token cannot be trusted.

```ts
import { TokenVerificationError } from '@padosoft/laravel-iam-react-native';

class TokenVerificationError extends Error {
  readonly name = 'TokenVerificationError';
  readonly reason: string;   // short machine-ish cause, also embedded in message
  // message: `token verification failed: ${reason}`
  // constructed with { cause } where available (Error cause chaining)
}
```

| Member | Type | Description |
|---|---|---|
| `name` | `'TokenVerificationError'` | Stable discriminator for `instanceof` / name checks. |
| `message` | `string` | `"token verification failed: <reason>"`. |
| `reason` | `string` | The short cause (see below). |
| `cause` | `unknown` | The underlying error (jose / fetch / JWKS), when present. |

### When it's raised

| Cause | Typical `reason` |
|---|---|
| No audience configured or passed | `audience is required: set verify.audience …` |
| Empty / non-string token | `empty token` |
| Bad signature, wrong `iss`/`aud`, expired/not-yet-valid | the underlying `jose` message |
| JWKS unreachable / non-2xx / malformed document | `jwks: <detail>` |
| Web Crypto unavailable on the runtime | the underlying crypto failure (see [Hermes & Web Crypto](/best-practices/hermes-web-crypto)) |

After a no-matching-key error, `verifyToken` first **refetches the JWKS once** (key rotation) and retries; it only rejects if the retry also fails.

### Handling it — fail-closed

A rejection is the **deny** signal for authentication. The catch must lead to an unauthenticated/denied path — never to trusting the token.

```ts
import { TokenVerificationError } from '@padosoft/laravel-iam-react-native';

try {
  const claims = await client.verifyToken(jwt);
  return authenticate(claims);
} catch (e) {
  if (e instanceof TokenVerificationError) {
    console.warn('token rejected:', e.reason);
    return signOut();        // fail-closed
  }
  throw e;                   // genuinely unexpected — rethrow
}
```

::: callout danger "Never fall back to an unverified token in the catch" icon:shield-alert
`catch { use(decodeJwt(jwt)) }` trusts a token you just failed to verify — a complete fail-open. The only correct catch leads to "unauthenticated". See [Fail-closed discipline](/best-practices/fail-closed-discipline).
:::

## Why the other methods don't throw

`check`, `can`, and `listResources` **never throw** — every failure folds into a fail-closed **value**:

| Method | Failure value |
|---|---|
| `check` | a `deny(reason)` `Decision` (`allowed: false`) |
| `can` | `false` |
| `listResources` | `[]` |

::: collapsible "ADR — why tokens reject but decisions don't"
**Problem.** Consistency would suggest all methods behave the same. Why does only `verifyToken` throw?

**Decision.** A decision has a **safe value** to return on failure (a deny), so returning it removes any exception a caller could mishandle into a fail-open. A token has **no safe value** — there are no trustworthy claims to hand back — so rejection is the unambiguous deny signal, and there's nothing permissive to leak.

**Consequences.** You wrap `verifyToken` in `try/catch`; you never need to wrap `check`/`can`/`listResources`. Both shapes are fail-closed — by value where a safe value exists, by rejection where it doesn't. See [Fail-closed by design](/concepts/fail-closed).
:::

## Construction errors (not `TokenVerificationError`)

The `IamClient` **constructor** throws plain `Error`s for misconfiguration — these are programmer errors surfaced loudly at startup, not runtime auth failures:

- `baseUrl` missing → `IamClient: \`baseUrl\` is required`
- `baseUrl` not absolute → `IamClient: \`baseUrl\` must be an absolute URL …`
- no `fetch` available → `IamClient: no \`fetch\` available …`

Catch these in tests/config validation; in production they should never fire past first run.

## Next steps

- [IamClient API](/reference/client) — `verifyToken` and the construction guards.
- [Verifying tokens (JWKS)](/guides/verifying-tokens) — the full verification flow.
- [Hermes & Web Crypto](/best-practices/hermes-web-crypto) — a common cause of rejections.
