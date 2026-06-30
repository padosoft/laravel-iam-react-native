---
title: "Architecture decisions (ADR)"
description: "The load-bearing decisions behind the React Native SDK and their trade-offs: thin client, never-throw, fail-closed sink, loading-is-deny hooks, mandatory audience, ES256 pinning, RN-safe canonical-JSON cache, import-type-only coupling, provider-holds-instance, and PHP/Node parity."
---

These are the choices that shape everything else. Each is stated as _Problem → Decision → Consequences_, so you can see not just what the SDK does but the trade-off it accepted. The deep pages link back here.

## ADR-1 — A thin client with no PDP logic

::: collapsible open "Problem → Decision → Consequences"
**Problem.** A client SDK could cache policies, evaluate conditions locally, or short-circuit obvious cases to save round-trips. Each duplicates the PDP and creates a second place where authorization can drift or be wrong — on a device you don't control.

**Decision.** The SDK contains **zero** authorization logic. Every verdict comes from the server's `decisions/check`. The client only serialises, calls, normalises, reduces, and fails closed.

**Consequences.** One source of truth for policy; the SDK can never disagree with the server. The cost is a network round-trip per uncached check — mitigated by the opt-in cache and a tight default timeout, never by moving policy into the app.
:::

## ADR-2 — `check()` never throws; failures are values

::: collapsible "Problem → Decision → Consequences"
**Problem.** If an authorization call throws on transport failure, callers write `try/catch` blocks that, under pressure, swallow the error and continue — silently failing open.

**Decision.** `check`, `can`, and `listResources` never throw. Failures fold into the return value (deny `Decision`, `false`, `[]`). Only `verifyToken` rejects, because a token has no safe fallback value.

**Consequences.** You cannot fail open by mishandling an exception — there isn't one. "Denied" and "couldn't reach the PDP" look identical at the call site (read `explanation` for observability, never for branching). See [Fail-closed by design](/concepts/fail-closed).
:::

## ADR-3 — Hooks treat loading as deny

::: collapsible "Problem → Decision → Consequences"
**Problem.** A permission check is async. If a hook reported anything but deny before the answer arrived, the UI would render the privileged control during the round-trip — a tappable fail-open flash on screen.

**Decision.** `usePermission` / `useCan` seed `{ allowed:false, loading:true }`, re-assert it before each fetch, and set `allowed:true` only on a granted decision. A `cancelled` flag drops stale resolutions so a slow allow can't overwrite a newer state.

**Consequences.** A component that renders positively on `allowed` is fail-closed for free; the worst case is briefly hiding a control the user may use. See [The hook lifecycle](/concepts/hook-lifecycle).
:::

## ADR-4 — A single fail-closed sink

::: collapsible "Problem → Decision → Consequences"
**Problem.** Error handling scattered across call sites tends to be inconsistent — some paths deny, some leak a permissive default.

**Decision.** Every error path funnels through one `deny(reason)` constructor producing a fully-safe `Decision` (`allowed: false`, empty fields, a reason breadcrumb). Normalisation degrades missing/wrong-typed fields to their safe defaults; a non-object body is `deny('invalid body')`.

**Consequences.** There is exactly one way to be denied and it is always safe; adding a new error branch means calling `deny()`, not inventing a new shape. The reason strings (`no-subject`, `transport`, `invalid body`) aid debugging without weakening the verdict.
:::

## ADR-5 — Mandatory audience + ES256 pinning on `verifyToken`

::: collapsible "Problem → Decision → Consequences"
**Problem.** `jose` skips the `aud` check when no audience is given, letting a token minted for a sibling service verify (confused-deputy) in a shared-issuer cluster. Accepting arbitrary algorithms invites `alg`-confusion.

**Decision.** `verifyToken` rejects unless an audience is configured (`verify.audience`) or passed (`options.audience`), and pins the algorithm to `['ES256']`.

**Consequences.** The library's most dangerous default is unreachable; every caller declares who a token is for, and only the server's signing algorithm is accepted. The cost is a slightly louder API. See [Verifying tokens](/guides/verifying-tokens).
:::

## ADR-6 — RN-safe internals: canonical JSON, not `node:crypto`

::: collapsible "Problem → Decision → Consequences"
**Problem.** The Node SDK keys its cache with `node:crypto` SHA-256. Hermes has no `node:*`; importing that runtime would crash the app.

**Decision.** Re-implement the cache key (and the hook effect key) as a **canonical JSON** serialisation — recursive, keys sorted, order-independent — and verify tokens via **Web Crypto** (`jose`). No Node built-ins anywhere.

**Consequences.** Functionally identical cache semantics with a hard guarantee of RN-safety; the only runtime floor is Web Crypto for `verifyToken` (RN 0.71+). See [RN-safe: no node:crypto](/concepts/rn-safe).
:::

## ADR-7 — Share types with the Node SDK via `import type` only

::: collapsible "Problem → Decision → Consequences"
**Problem.** A polyglot fleet needs one wire vocabulary, but pulling the Node SDK's **runtime** into an RN bundle would drag `node:crypto` onto the device.

**Decision.** Re-export the Node SDK's wire types with `import type` (erased under `verbatimModuleSyntax`) and re-implement all runtime here. No value crosses the package boundary.

**Consequences.** One contract, zero runtime coupling, a provably `node:*`-free bundle. The cost is some duplicated internal logic (cache, normalisation) — a fair price for the guarantee. See [RN-safe](/concepts/rn-safe).
:::

## ADR-8 — The provider holds an instance, not config

::: collapsible "Problem → Decision → Consequences"
**Problem.** A provider that took raw config would rebuild the client (losing its JWKS and decision caches) whenever a prop changed, and couple the React tree to construction/validation.

**Decision.** `IamProvider` takes an already-constructed `IamClient`. Construction (and the absolute-URL validation) happens once at the call site; the provider only distributes the instance and the `subject`.

**Consequences.** One client and one set of caches for the app's lifetime; tests inject a client with a mock `fetch`. The cost is one extra line (`new IamClient(...)`). See [The IamProvider](/guides/provider).
:::

## ADR-9 — An opt-in cache that cannot turn deny into allow

::: collapsible "Problem → Decision → Consequences"
**Problem.** A naive decision cache can serve a stale **allow** after a revocation, or cache a transport-error deny and later be mistaken for a real verdict.

**Decision.** The cache is off by default. When on, it stores only real verdicts (never transport errors), skips `explain` queries, keys on the canonical-JSON of the full query, bounds size with FIFO eviction, and flushes wholesale on a newer `policyVersion`.

**Consequences.** The cache can only shorten the life of a stale allow (bounded by `ttlMs`, zeroed by a policy bump) and can never manufacture one. See [Caching safely](/best-practices/caching-safely).
:::

## ADR-10 — Byte-for-byte PHP/Node parity

::: collapsible "Problem → Decision → Consequences"
**Problem.** A polyglot fleet talking to one PDP must present an identical contract or the server's view of "a caller" fragments per language.

**Decision.** The wire serialisation mirrors the PHP/Node clients exactly — slash endpoint, snake-case `current_aal`, explicit nulls, `{ data }` envelope unwrap, Bearer auth, deny-on-error.

**Consequences.** One policy engine and one audit trail serve every language; the server can't distinguish callers. The cost is tracking the contract as it evolves — the point, not a burden. See [Wire contract](/architecture/wire-contract).
:::

## Next steps

- [Architecture overview](/architecture/overview) — where these decisions live in the source.
- [Fail-closed by design](/concepts/fail-closed) — the invariant ADR-2/3/4/5/9 protect.
- [Fail-closed discipline](/best-practices/fail-closed-discipline) — keeping it true in your code.
