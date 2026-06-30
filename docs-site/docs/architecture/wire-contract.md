---
title: "Wire contract"
description: "The exact HTTP contract shared with the PHP and Node clients: the slash endpoints, the decisions/check request payload (snake-case current_aal, explicit nulls), the { data } envelope, the list-resources shape, Bearer auth, and the JWKS endpoint."
---

This SDK speaks the **same wire protocol** as the PHP and Node clients, byte for byte. Parity is the point: one PDP, one audit trail, callers it can't tell apart. This page is the reference for what actually crosses the network.

## Endpoints

| Purpose | Method & path |
|---|---|
| Authorization decision | `POST {baseUrl}/decisions/check` |
| ReBAC resource listing | `POST {baseUrl}/decisions/list-resources` |
| JWKS (token verification) | `GET {origin}/.well-known/jwks.json` |

`baseUrl` is the **full API base including the route prefix**, e.g. `https://iam.example.com/api/iam/v1`. Trailing slashes are trimmed; the check/list paths default to `decisions/check` / `decisions/list-resources` and are overridable via `checkPath` / `listResourcesPath`.

::: callout danger "It's the SLASH endpoint — not a colon" icon:milestone
The contract is `POST .../decisions/check` (a path segment). Any older `decisions:check` colon form is **not** what this SDK or the server use. All SDKs and the PHP client are aligned on the slash.
:::

## Authentication

If a `token` is configured, every request carries it as a Bearer credential:

```http
POST /api/iam/v1/decisions/check HTTP/1.1
Authorization: Bearer <service-token>
Accept: application/json
Content-Type: application/json
```

The token is an OAuth2 **Client Credentials** service token for your application.

## `decisions/check` — request

`toPayload` serialises a `DecisionQuery` to this exact shape:

```json
{
  "subject":      { "type": "user", "id": "usr_123" },
  "permission":   "stock.adjust",
  "organization": null,
  "application":  "warehouse",
  "resource":     { "type": "warehouse", "id": "wh_milan" },
  "context":      { "amount": 300 },
  "current_aal":  "aal1",
  "explain":      false
}
```

Field rules — these are load-bearing for parity:

| Field | Rule |
|---|---|
| `subject.type` | defaults to `"user"` when omitted |
| `organization`, `application`, `resource` | sent as explicit **`null`** when absent (never dropped) |
| `context` | defaults to `{}` |
| `current_aal` | **snake_case**, defaults to `"aal1"` (camelCase `currentAal` on the query) |
| `explain` | boolean; `true` bypasses the cache end-to-end |

::: callout warning "Explicit nulls and snake_case are part of the contract" icon:file-json
Dropping a `null` field or sending `currentAal` instead of `current_aal` would diverge from the PHP/Node payload and could change how the server parses the request. The SDK emits the canonical shape so the server sees identical bytes from every language.
:::

## `decisions/check` — response envelope

The server wraps the decision in a `data` envelope:

```json
{
  "data": {
    "allowed": true,
    "decision_id": "dec_01H...",
    "policy_version": 7,
    "requires_step_up": false,
    "required_aal": null,
    "matched": [ { "type": "rbac", "rule": "warehouse.manager" } ],
    "explanation": []
  }
}
```

`decisionFromBody` unwraps `data` (it also tolerates a top-level decision if `allowed` is present at the root) and maps snake_case → camelCase with safe defaults. See [The decision model](/concepts/decision-model). The wire→model mapping:

| Wire (snake) | Model (camel) |
|---|---|
| `allowed` | `allowed` |
| `decision_id` | `decisionId` |
| `policy_version` | `policyVersion` |
| `requires_step_up` | `requiresStepUp` |
| `required_aal` | `requiredAal` |
| `matched` | `matched` |
| `explanation` | `explanation` |

## `decisions/list-resources`

**Request:**

```json
{ "subject": { "type": "user", "id": "usr_123" }, "relation": "manager" }
```

**Response:**

```json
{ "data": { "resources": [
  { "type": "warehouse", "id": "wh_milan" },
  { "type": "warehouse", "id": "wh_rome" }
] } }
```

The SDK unwraps `data.resources`, keeps only well-formed `{ type: string, id: string }` entries, and returns `[]` on anything else. See [ReBAC list-resources](/guides/list-resources).

## JWKS — token verification

`verifyToken` GETs the JWKS document and verifies an **ES256** JWT against it:

```json
{ "keys": [ { "kty": "EC", "crv": "P-256", "kid": "2026-06", "x": "…", "y": "…", "alg": "ES256" } ] }
```

- **Endpoint:** `jwksUri` if configured, else `{origin}/.well-known/jwks.json` (origin derived from `baseUrl`).
- **Issuer:** `verify.issuer` / `options.issuer`, else the `baseUrl` origin.
- **Audience:** **mandatory** (`verify.audience` or `options.audience`) — no audience, no verification.
- **Caching:** the JWKS is cached in memory for 10 minutes per URI, with a one-shot refetch on a key-id miss (rotation).

A malformed document (no `keys` array) or a non-2xx fetch raises `TokenVerificationError`. See [Verifying tokens](/guides/verifying-tokens).

## ADR: byte-for-byte parity with PHP & Node

::: collapsible "Problem → Decision → Consequences"
**Problem.** A polyglot fleet (PHP, Node, React Native, Rust) talking to one PDP must present an identical contract, or the server's view of "a caller" fragments per language and the audit trail splinters.

**Decision.** The wire types and serialisation mirror the PHP client's `HttpDecider` / `DecisionRequest` / `IamDecision` exactly — slash endpoint, snake-case `current_aal`, explicit nulls, `{ data }` envelope unwrap, Bearer auth, deny-on-error. The wire types are literally the Node SDK's, imported `import type`.

**Consequences.** One policy engine and one audit trail serve every language; the server can't distinguish callers. The cost is that this SDK must track the PHP/Node contract as it evolves — which is the intent, not a burden.
:::

## Next steps

- [The decision model](/concepts/decision-model) — how the response becomes a `Decision`.
- [Hook → client → server flow](/architecture/decision-flow) — where serialisation/normalisation run.
- [Types](/reference/types) — the TypeScript shapes for every field above.
