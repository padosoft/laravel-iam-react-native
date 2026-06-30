---
title: "Installation"
description: "Install @padosoft/laravel-iam-react-native: peer dependencies, the runtime floor (React 18+, React Native 0.71+ for verifyToken), Expo, Hermes Web Crypto, and what does (and does not) ship in your bundle."
---

# Installation

```bash
npm install @padosoft/laravel-iam-react-native
# yarn add @padosoft/laravel-iam-react-native
# pnpm add @padosoft/laravel-iam-react-native
# expo install @padosoft/laravel-iam-react-native
```

## Requirements

| Requirement | Why |
|---|---|
| **React `>=18`** | Peer dependency. The hooks use `useState` / `useEffect` / `useContext`. |
| **React Native `>=0.71`** (optional) | Only needed for `verifyToken` — Hermes exposes `globalThis.crypto.subtle` (Web Crypto) from 0.71. `check()` and the hooks work on any RN with `fetch`. |
| **A `fetch` implementation** | `globalThis.fetch` by default (built into RN ≥ 0.61 and modern React web). Inject your own via the `fetch` config option if needed. |

`react-native` is an **optional** peer dependency — this package runs unchanged in a plain React web app, which is why the test suite runs under jsdom. The package ships **ESM + CommonJS + TypeScript declarations**.

## Dependencies — what actually ships

::: callout success "A tiny, auditable dependency tree" icon:feather
The only runtime dependencies are **`jose`** (JWKS fetch + ES256 verification over Web Crypto) and a **type-only** import of `@padosoft/laravel-iam-node`. Because the Node SDK is imported with `import type`, it is **completely erased at build time** — none of its runtime code (and none of its `node:crypto` usage) ends up in your app.
:::

```jsonc
// package.json (excerpt)
"dependencies": {
  "@padosoft/laravel-iam-node": "^1.0.0", // wire types only (import type) — erased at build
  "jose": "^5.9.6"                         // JWKS / ES256 via Web Crypto
},
"peerDependencies": {
  "react": ">=18",
  "react-native": ">=0.71"                 // optional
}
```

## Hermes & Web Crypto (read before using `verifyToken`)

React Native's JS engine, **Hermes**, has **no `node:*` modules**. This package never touches them — but `verifyToken` does need the **Web Crypto API** (`globalThis.crypto.subtle`) that `jose` uses for ES256.

::: callout warning "verifyToken needs Web Crypto — check your runtime" icon:shield-alert
- **Expo / RN ≥ 0.71 (Hermes):** `globalThis.crypto.subtle` is available — `verifyToken` works out of the box.
- **RN "bare" / older Hermes / some custom builds:** `crypto.subtle` may be missing. Then either install a Web Crypto polyfill (e.g. `react-native-quick-crypto` / a `SubtleCrypto` shim) **before** the first `verifyToken` call, or verify tokens **server-side** (token introspection) and only use `check()` on the device.
:::

See [Hermes & Web Crypto](/best-practices/hermes-web-crypto) for the full decision tree. `check()`, `can()`, `listResources()` and all the hooks use only `fetch` and have **no** crypto requirement.

## Expo

Works with Expo (managed or dev client) on SDK versions using Hermes. Install with `expo install` so the resolver picks compatible versions, and confirm `global.crypto?.subtle` is defined if you intend to call `verifyToken`.

## Verify it installed

```ts
import { IamClient } from '@padosoft/laravel-iam-react-native';

const iam = new IamClient({ baseUrl: 'https://iam.example.com/api/iam/v1' });
console.log(typeof iam.check); // "function"
```

## Next steps

- [Quickstart](/quickstart) — wire it into a screen in four steps.
- [Core concepts](/core-concepts) — the model behind the API.
- [RN-safe: no node:crypto](/concepts/rn-safe) — why this is a separate package from the Node SDK.
