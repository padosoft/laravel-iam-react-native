# CLAUDE.md — @padosoft/laravel-iam-react-native

Client React Native per il control plane Laravel IAM (PDP). Parte della famiglia
SDK poliglotta (`-node`, `-react-native`, `-rust`).

## La regola: fail-closed

Ogni incertezza risolve in **deny**, mai allow. Errore di rete, timeout, 5xx,
4xx, body malformato, token non verificabile, loading => deny.
**Non esiste un'opzione fail-open.**

## Vincoli critici

- **NO `node:crypto`** ovunque — Hermes/React Native non ha Node built-ins.
- **`@padosoft/laravel-iam-node`** e' una dipendenza per soli tipi (`import type`),
  mai runtime. Il codice Node SDK non viene mai incluso nel bundle.
- **`jose`** e' sicuro in RN: usa Web Crypto (`globalThis.crypto.subtle`).
- **Cache key**: JSON canonico diretto (no SHA-256 hash, no node:crypto).

## Contratto wire (non modificare)

- Decision: `POST {baseUrl}/decisions/check`, `Authorization: Bearer`, body
  `{ subject:{type,id}, permission, organization, application, resource, context,
  current_aal, explain }`. Specchio di `DecisionRequest::toArray()` del client PHP.
  Il server wrappa in `{ "data": { ... } }` — noi la unwrappiamo.
- Cache: opt-in, off by default, mai deny->allow, flush su `policy_version` bump,
  mai cacheata errori di trasporto, mai cacheata `explain`.
- `verifyToken` = ES256 + `iss`/`aud`/`exp`/`nbf` via JWKS (`/.well-known/jwks.json`).

## Layout

- `src/client.ts` — `IamClient` (HTTP, cache, JWKS/verifyToken, RN-safe).
- `src/decision.ts` — `deny()`, `decisionFromBody()`, `isGranted()`.
- `src/cache.ts` — `DecisionCache` + `cacheKey` (canonical JSON, no crypto).
- `src/provider.ts` — `IamProvider`, `IamContext`, `IamContextValue`.
- `src/hooks.ts` — `useIam()`, `useCan()`, `usePermission()`.
- `src/types.ts` — re-export tipi wire da node SDK (type-only) + config RN.
- `src/errors.ts` — `TokenVerificationError`.
- `src/index.ts` — barrel export.
- `test/` — vitest; `helpers.ts` fornisce `mockFetch` e signing kit ES256.

## Comandi

```bash
npm run typecheck   # tsc --noEmit, strict
npm run lint        # eslint
npm test            # vitest run
npm run build       # tsup -> ESM + CJS + d.ts
```

## Convenzioni

- TS strict, `verbatimModuleSyntax`, `exactOptionalPropertyTypes`. No `any`.
- Import locali con estensione `.js`.
- `import type { ... }` per tutti i tipi, mai value import da `@padosoft/laravel-iam-node`.
- Non pubblicare su npm o creare tag/release da automazione.