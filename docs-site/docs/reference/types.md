---
title: "Types"
description: "Every exported type: the wire types re-exported (import type) from @padosoft/laravel-iam-node — Subject, Resource, DecisionContext, DecisionQuery, DecisionMatch, Decision, Claims, CacheOptions, VerifyOptions — plus the RN-specific IamClientConfig and PermissionState."
---

# Types

All public types are exported from the package root:

```ts
import type {
  // wire types (re-exported import-type from @padosoft/laravel-iam-node — erased at build)
  Subject, Resource, DecisionContext, DecisionQuery, DecisionMatch, Decision,
  Claims, CacheOptions, VerifyOptions,
  // RN-specific
  IamClientConfig, PermissionState,
} from '@padosoft/laravel-iam-react-native';
```

::: callout info "Wire types are shared, runtime is not" icon:file-code
`Subject … VerifyOptions` are the **same** declarations as the Node SDK, re-exported with `import type` so they're erased at build time — no Node SDK runtime ships to the device. `IamClientConfig` and `PermissionState` are defined in this package. See [RN-safe](/concepts/rn-safe).
:::

## Wire types

### `Subject`

Whoever the decision is about (user, service account, group, agent…).

```ts
interface Subject {
  type?: string; // kind; defaults to "user" server-side when omitted
  id: string;    // stable id (e.g. "usr_123"). Required.
}
```

### `Resource`

The object an action targets.

```ts
interface Resource {
  type: string;
  id: string;
}
```

### `DecisionContext`

Free-form ABAC facts evaluated by policy conditions (amount, time, ip, …).

```ts
type DecisionContext = Record<string, unknown>;
```

### `DecisionQuery`

Input to a check (`useCan`, `client.check`, `client.can`).

```ts
interface DecisionQuery {
  subject: Subject;
  permission: string;
  organization?: string | null;
  application?: string | null;
  resource?: Resource | string | null;
  context?: DecisionContext;
  currentAal?: string;  // caller's session AAL; default "aal1"
  explain?: boolean;    // ask for step-by-step reasoning; never cached
}
```

| Field | Required | Notes |
|---|---|---|
| `subject` | yes | `{ type?, id }`. |
| `permission` | yes | e.g. `"stock.adjust"`. |
| `organization` / `application` | no | Sent as explicit `null` when absent. |
| `resource` | no | Object, string, or `null`. |
| `context` | no | Defaults to `{}` on the wire. |
| `currentAal` | no | Serialised as `current_aal`; default `"aal1"`. |
| `explain` | no | `true` bypasses the cache end-to-end. |

### `DecisionMatch`

One policy element the PDP matched while reaching its verdict (diagnostics).

```ts
interface DecisionMatch {
  type?: string;
  key?: string;
  [k: string]: unknown;
}
```

### `Decision`

The normalised verdict (see [The decision model](/concepts/decision-model)).

```ts
interface Decision {
  allowed: boolean;            // raw verdict — NOT sufficient alone
  decisionId: string;          // audit correlation id
  policyVersion: number;       // monotonic policy generation
  requiresStepUp: boolean;     // allowed-but-needs-higher-AAL
  requiredAal: string | null;  // required AAL, e.g. "aal2"
  matched: DecisionMatch[];
  explanation: string[];
}
```

::: callout warning "`allowed` is not `granted`" icon:shield-alert
`granted = allowed && !requiresStepUp`. Use `client.can()` or the hooks' `allowed` (which already apply it), never raw `decision.allowed`. See [Step-up & AAL](/concepts/step-up-aal).
:::

### `Claims`

Verified JWT claims returned by `verifyToken`.

```ts
interface Claims {
  iss?: string; sub?: string; aud?: string | string[];
  exp?: number; nbf?: number; iat?: number;
  scope?: string; org?: string; client_id?: string; sid?: string;
  [k: string]: unknown;
}
```

### `CacheOptions`

```ts
interface CacheOptions {
  ttlMs: number;       // <= 0 disables caching
  maxEntries?: number; // default 1000, FIFO eviction
}
```

### `VerifyOptions`

```ts
interface VerifyOptions {
  issuer?: string;                 // expected iss; defaults to baseUrl origin
  audience?: string | string[];    // expected aud — MANDATORY (here or per call)
  jwksUri?: string;                // override JWKS URL
}
```

## RN-specific types

### `IamClientConfig`

Constructor configuration for [`IamClient`](/reference/client). Identical in spirit to the Node SDK's, defined here so the RN package is self-contained.

```ts
interface IamClientConfig {
  baseUrl: string;                 // required, absolute, incl. route prefix
  token?: string;                  // Bearer service token
  timeoutMs?: number;              // default 2000
  retries?: number;                // default 0 (idempotent network errors only)
  cache?: CacheOptions;            // off by default
  verify?: VerifyOptions;          // verifyToken defaults
  fetch?: typeof globalThis.fetch; // default globalThis.fetch (RN polyfill)
  checkPath?: string;              // default "decisions/check"
  listResourcesPath?: string;      // default "decisions/list-resources"
}
```

### `PermissionState`

The return shape of `usePermission` / `useCan` (see [Provider & Hooks API](/reference/hooks)).

```ts
interface PermissionState {
  allowed: boolean;        // true only when granted AND not loading
  loading: boolean;        // true while in flight
  requiresStepUp: boolean; // true when allowed-but-needs-higher-AAL
}
```

## Decision helpers (also exported)

The pure helpers from `decision.ts` are exported for advanced/imperative use:

```ts
import { deny, decisionFromBody, isGranted } from '@padosoft/laravel-iam-react-native';

deny('transport');            // → a fully-safe deny Decision
decisionFromBody(jsonBody);   // → normalised Decision (envelope unwrap + safe defaults)
isGranted(decision);          // → decision.allowed && !decision.requiresStepUp
```

## Next steps

- [IamClient API](/reference/client) — methods that consume/produce these types.
- [Provider & Hooks API](/reference/hooks) — `PermissionState` and `IamContextValue`.
- [Errors](/reference/errors) — `TokenVerificationError`.
