# AGENTS.md — @padosoft/laravel-iam-react-native

Guida per agenti AI. Vedi [CLAUDE.md](CLAUDE.md) per il brief completo.

## Non negoziabile

**Fail-closed.** Qualsiasi errore/ambiguita' => deny, mai allow. Nessun fail-open.
Mantieni un test dedicato per ogni path di errore quando modifichi `check()`,
`listResources()`, `verifyToken()` o gli hook.

## Prima di committare

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

Tutti e quattro devono passare.

## Vietato

- Non aggiungere `import` (value, non type) da `@padosoft/laravel-iam-node`.
  Solo `import type { ... }` — mai runtime.
- Non importare da `node:crypto`, `node:fs`, `node:path` o qualsiasi modulo
  `node:*` — non esistono in React Native/Hermes.
- Non aggiungere logica PDP client-side.
- Non permettere alla cache di trasformare un deny in allow, cacheara errori
  di trasporto, o cacheara query `explain`.
- Non pubblicare su npm o creare tag/release da automazione.
- Non aggiungere dipendenze pesanti; solo `jose` per la crypto.