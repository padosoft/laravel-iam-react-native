# LESSON.md — @padosoft/laravel-iam-react-native

Lezioni apprese durante lo sviluppo dell'SDK React Native.

## 1. Hermes non ha Node built-ins

React Native usa il runtime Hermes che non espone `node:crypto`, `node:fs` o
qualsiasi modulo `node:*`. Importare `node:crypto` (anche indirettamente tramite
il Node SDK) causa un crash a runtime. Soluzione: solo `import type` dal Node SDK
e cache key con JSON canonico invece di SHA-256.

## 2. `import type` e' la frontiera tra tipi e runtime

Con `verbatimModuleSyntax: true`, TypeScript garantisce che `import type`
venga completamente eliminato dal bundle. Questo permette di condividere le
interfacce wire con il Node SDK senza includerne il codice a runtime.

## 3. Cache key senza crypto

Il Node SDK usa `createHash('sha256')` per la cache key. In RN usiamo
serializzazione JSON canonica (chiavi ordinate, ricorsiva). La chiave e' piu'
lunga ma funzionalmente equivalente per una `Map` in-memory con entry limitate.

## 4. `jose` e' sicuro in RN

`jose` usa `globalThis.crypto.subtle` (Web Crypto API), disponibile in React
Native >= 0.71 con Hermes. Per la verifica ES256 + JWKS e' l'unica dipendenza
necessaria.

## 5. Hook fail-closed durante il loading

`useState(DENIED_LOADING)` garantisce che il componente parta in stato negato.
L'effect setta `loading: true` prima della chiamata, e solo dopo risposta positiva
del PDP (con `isGranted()`) setta `allowed: true`. Un flag `cancelled` previene
race condition tra render successivi.

## 6. `usePermission` senza subject -> deny immediato senza network call

Quando il contesto non ha un `subject`, l'hook nega immediatamente senza toccare
la rete. Fail-closed anche per utente non autenticato.

## 7. CI su Node 18/20/22

Il workflow GitHub Actions esegue typecheck, lint, test e build su tutte e tre le
versioni LTS per catturare incompatibilita' di API.