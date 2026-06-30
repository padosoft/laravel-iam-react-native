---
title: "IamClient API"
description: "Complete reference for IamClient: the constructor and every IamClientConfig option, and the check / can / listResources / verifyToken methods with exact signatures, defaults, and fail-closed behaviour."
---

# IamClient API

`IamClient` is the framework-agnostic transport core. It does HTTP + ES256 verification, fails closed, and touches no React. Construct one per app and hand it to [`IamProvider`](/reference/hooks), or use it imperatively.

```ts
import { IamClient } from '@padosoft/laravel-iam-react-native';
```

## Constructor

```ts
new IamClient(config: IamClientConfig)
```

Validates eagerly: throws if `baseUrl` is missing, **not an absolute URL**, or if no `fetch` is available. Trailing slashes on `baseUrl` are trimmed.

### `IamClientConfig`

| Option | Type | Default | Description |
|---|---|---|---|
| `baseUrl` | `string` | **required** | Full API base incl. route prefix, e.g. `https://iam.example.com/api/iam/v1`. Must be absolute. |
| `token` | `string` | — | Service token (OAuth2 Client Credentials); sent as `Authorization: Bearer`. |
| `timeoutMs` | `number` | `2000` | Per-request timeout (via `AbortController`). |
| `retries` | `number` | `0` | Retries for **idempotent network errors only** (never on 4xx/5xx). Clamped to `≥ 0`. |
| `cache` | `CacheOptions` | off | `{ ttlMs, maxEntries? }` in-memory decision cache. `ttlMs > 0` enables it. |
| `verify` | `VerifyOptions` | `{}` | Defaults for `verifyToken`: `{ issuer?, audience?, jwksUri? }`. |
| `fetch` | `typeof fetch` | `globalThis.fetch` | Inject a custom `fetch` (tests, proxies). |
| `checkPath` | `string` | `decisions/check` | Path appended to `baseUrl` for the PDP check. |
| `listResourcesPath` | `string` | `decisions/list-resources` | Path for ReBAC list-resources. |

::: callout danger "baseUrl must be absolute" icon:triangle-alert
A relative `baseUrl` is rejected at construction. Otherwise the issuer derivation for `verifyToken` would silently become `undefined` and JWKS resolution would throw outside the fail-closed path. Fail loud, once, at construction.
:::

```ts
const iam = new IamClient({
  baseUrl: 'https://iam.example.com/api/iam/v1',
  token: process.env.IAM_SERVICE_TOKEN,
  timeoutMs: 2000,
  retries: 1,
  cache: { ttlMs: 5000, maxEntries: 1000 },
  verify: { audience: 'warehouse-app' },
});
```

## `check(query): Promise<Decision>`

Asks the PDP `POST {baseUrl}/decisions/check`. **Never throws** — returns a normalised [`Decision`](/concepts/decision-model). Fails closed to `deny(...)` on a missing subject, transport failure, non-2xx, or malformed body.

```ts
const decision = await iam.check({
  subject: { type: 'user', id: 'usr_123' },
  application: 'warehouse',
  permission: 'stock.adjust',
  resource: { type: 'warehouse', id: 'wh_milan' },
  context: { amount: 300 },
  // organization?, currentAal?, explain?
});
```

- **Cache:** used only when enabled and `explain !== true`; a fresh hit short-circuits the network.
- **`explain: true`:** bypasses the cache entirely (read and write) for live reasoning.
- See the [DecisionQuery](/reference/types) fields and the [wire payload](/architecture/wire-contract).

## `can(query): Promise<boolean>`

`check()` reduced to the fail-safe boolean: `isGranted(decision) = allowed && !requiresStepUp`. Use this — not raw `decision.allowed` — when you only need yes/no imperatively.

```ts
if (await iam.can({ subject, permission: 'doc.publish', resource })) {
  // permitted (and not pending step-up)
}
```

## `listResources(subject, relation): Promise<Resource[]>`

ReBAC reverse lookup: `POST {baseUrl}/decisions/list-resources`. Returns the well-formed `{ type, id }` entries the subject has the given `relation` to. **Never throws**; returns `[]` on a missing subject/relation, transport failure, or malformed body.

```ts
const warehouses = await iam.listResources({ type: 'user', id: 'usr_123' }, 'manager');
// → Resource[]
```

::: callout warning "[] is deny, not 'no filter'" icon:shield-alert
Treat an empty array as "show nothing". See [ReBAC list-resources](/guides/list-resources).
:::

## `verifyToken(jwt, options?): Promise<Claims>`

Verifies an **ES256** JWT against the server JWKS. **Rejects** with [`TokenVerificationError`](/reference/errors) on any failure — this is the only method that throws, because a token has no safe fallback value.

```ts
const claims = await iam.verifyToken(jwt, {
  // all optional; fall back to client `verify` defaults
  audience: 'warehouse-app', // MANDATORY (here or in client `verify`)
  issuer: 'https://iam.example.com',
  jwksUri: 'https://iam.example.com/.well-known/jwks.json',
});
```

Behaviour:

- **Audience is mandatory** — rejects if neither `options.audience` nor `verify.audience` is set (prevents `aud`-skip).
- **Algorithm pinned** to `['ES256']`.
- **Issuer** defaults to the origin of `baseUrl`; **JWKS URI** defaults to `{origin}/.well-known/jwks.json`.
- **JWKS cache:** 10 minutes per URI, with **one** automatic refetch on a key-id miss (rotation).
- Empty/non-string `jwt` rejects immediately.

### `VerifyOptions`

| Field | Type | Description |
|---|---|---|
| `audience` | `string \| string[]` | Required (here or as a client default). Expected `aud`. |
| `issuer` | `string` | Expected `iss`. Defaults to `baseUrl` origin. |
| `jwksUri` | `string` | Override the JWKS URL. |

See [Verifying tokens](/guides/verifying-tokens) and the [Hermes/Web Crypto](/best-practices/hermes-web-crypto) runtime note.

## Behaviour summary

| Method | Throws? | Fail-closed result |
|---|---|---|
| `check` | no | `deny(reason)` `Decision` |
| `can` | no | `false` |
| `listResources` | no | `[]` |
| `verifyToken` | **yes** | rejects `TokenVerificationError` |

## Next steps

- [Provider & Hooks API](/reference/hooks) — the React surface over this client.
- [Types](/reference/types) — `DecisionQuery`, `Decision`, `Subject`, `Resource`, …
- [Errors](/reference/errors) — `TokenVerificationError`.
