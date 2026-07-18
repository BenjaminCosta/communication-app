# SVC Outlook — AI capture handoff (voice + parse)

Última actualización: 2026-07-18

> Handoff **específico de la capa de IA** del 3-Week Outlook. El documento
> hermano `svc-3-week-outlook-handoff.md` describe el dominio determinístico
> (fechas, scheduling, versiones, PDF, persistencia) y trata la IA como trabajo
> futuro — **ese "futuro" ya está implementado**, en modo mock. Este doc cubre
> qué existe, cómo funciona y **qué hace falta para pasar a live con una API key**.

---

## 0. TL;DR — estado y cómo retomar

- La captura por IA (voz → transcript → parse → **review** → confirmar) está
  **implementada de punta a punta y funcionando en MODO MOCK** (sin API key).
- Todo el flujo es testeable offline: rutas server devuelven transcript/
  suggestions mock deterministas.
- **Pasar a LIVE = setear `OPENAI_API_KEY` en el server. No hay cambios de
  código.** El dispatch mock↔live ya está cableado (`lib/ai/config.ts` +
  `canCallProvider`). Ver §2.
- Nada se persiste sin confirmación del usuario. El core determinístico
  (`scheduleOutlookTasks` + `persist`) sigue siendo la única autoridad de
  fechas/issues. La IA **solo propone**.

---

## 1. Cómo se decide mock vs live

Fuente de verdad: [`lib/ai/config.ts`](../lib/ai/config.ts) →
`getOutlookAiConfig()` (server-only; tira error si se importa en el browser).

```
mode = OUTLOOK_AI_MODE  si es "mock" | "live"
     = "live"  si hay OPENAI_API_KEY presente
     = "mock"  en cualquier otro caso
```

`canCallProvider(config)` = `mode === "live" && apiKey`. Los servicios
(`parse-service.ts`, `transcription-service.ts`) llaman al provider **solo** si
eso es true; si no, devuelven el mock. La clave se lee **por request** (rotarla
no requiere redeploy más allá de lo que ya hace la plataforma).

## 2. Para pasar a LIVE (pasos para el agente con la key)

1. **Setear el secreto server-side** (Vercel env o `.env.local` para dev):
   ```bash
   OPENAI_API_KEY=sk-...            # habilita live automáticamente
   # opcionales:
   OUTLOOK_AI_MODE=live             # forzar (o "mock" para desactivar con key presente)
   OUTLOOK_AI_PARSE_MODEL=gpt-5-mini
   OUTLOOK_AI_TRANSCRIBE_MODEL=gpt-4o-mini-transcribe
   OPENAI_BASE_URL=https://api.openai.com/v1
   ```
2. **Revelar la UI** (si aún no está): flags client
   `NEXT_PUBLIC_OUTLOOK_AI_ENABLED=true` y `NEXT_PUBLIC_OUTLOOK_VOICE_ENABLED=true`
   (se inlinean en el bundle en build; requieren rebuild).
3. **Verificar la identidad del token** en prod: setear
   `FIREBASE_SERVICE_ACCOUNT_KEY` (JSON stringificado) **o**
   `GOOGLE_APPLICATION_CREDENTIALS` para que el auth-guard **verifique** el
   Firebase ID token (sin esto, live falla de forma segura; el decode sin
   verificar existe sólo para dev/mock). Ver
   [`lib/ai/server/auth-guard.ts`](../lib/ai/server/auth-guard.ts).
4. **Verificar modelos con la key real** (⚠️ importante): los defaults
   `gpt-5-mini` (parse) y `gpt-4o-mini-transcribe` (transcribe) son placeholders
   razonables pero **hay que confirmar que existen y son accesibles con la key**.
   Si no, override con las env de arriba. El client usa:
   - parse → `POST /chat/completions` con `response_format: json_schema` (strict)
     + `max_completion_tokens` (la familia gpt-5 rechaza `temperature` custom, ya
     contemplado en [`lib/ai/openai/client.ts`](../lib/ai/openai/client.ts));
   - transcribe → `POST /audio/transcriptions` (`response_format: json`).
5. **Probar el flujo real**: abrir un job → tab Outlook → Quick Update →
   escribir/dictar una nota → Generate Outlook → verificar que el badge deja de
   decir `Mock`, que las suggestions llegan, y que la provenance (§4) es correcta.
6. **Costos/límites**: revisar timeouts y caps en
   [`lib/ai/config-public.ts`](../lib/ai/config-public.ts)
   (`OUTLOOK_AI_LIMITS`: `maxAudioSeconds`, `maxTextChars`, `maxSuggestions`,
   `providerTimeoutMs`). Ya se aplica server-side una ventana móvil de 10 minutos
   (10 generations / 5 transcriptions por usuario), un único request activo,
   idempotencia/deduplicación y backoff selectivo para `429`. El texto está
   limitado a 2.000 caracteres y el audio a 3 minutos / 8 MiB con validación del
   media real. Sólo queda definir/monitorear el presupuesto mensual operativo.

**No hay más cambios de código requeridos para live.** Todo lo demás ya está.

---

## 3. Arquitectura y file map

```
[compose card]  outlook-natural-language-input.tsx  (textarea + voz + chips)
   │                └─ outlook-voice-control.tsx  → features/outlooks/voice/use-outlook-recorder.ts (MediaRecorder)
   │                └─ outlook-context-chips.tsx  (chips de contexto opcional, §4)
   ▼ useOutlookAiCapture (client hook: text/transcribe/parse/review state)
   │   features/outlooks/ai/client/use-outlook-ai-capture.ts
   │   features/outlooks/ai/client/outlook-ai-client.ts  (fetch a las rutas)
   ▼ POST /api/outlooks/transcribe        POST /api/outlooks/parse
   │   app/api/outlooks/*/route.ts  (runtime nodejs; auth-guard verifica token)
   ▼ services (server): elige mock vs live y VALIDA con zod
   │   features/outlooks/ai/server/transcription-service.ts
   │   features/outlooks/ai/server/parse-service.ts
   │      ├─ mock:  features/outlooks/ai/server/mock-parser.ts  (heurístico, determinista)
   │      └─ live:  lib/ai/openai/client.ts  (fetch OpenAI, sin SDK)
   ▼ contrato zod (boundary texto↔dominio)
   │   features/outlooks/ai/outlook-parser-contract.ts
   ▼ normalización determinística (NO IA) + provenance + chip defaults
   │   features/outlooks/ai/normalize-outlook-suggestions.ts
   ▼ review modal editable
   │   components/directory/outlooks/outlook-ai-review.tsx
   ▼ confirmar → createOutlookTask → scheduleOutlookTasks → persist (core existente)
```

Config IA: `lib/ai/config.ts` (server, modo/models/key), `lib/ai/config-public.ts`
(límites client-safe), `lib/ai/flags.ts` (flags UI), `lib/ai/errors.ts`,
`lib/ai/server/{auth-guard,route-helpers}.ts`.

---

## 4. Contrato, normalización y provenance (lo determinístico)

- **Contrato** (`outlook-parser-contract.ts`, zod): el modelo devuelve
  **suggestions only** — sin `endDate`, sin ids Firestore, sin campos derivados.
  Campos: `title, description, trade, companyName, startDate, durationDays,
  dependencyReference, status, completionPercent, confidence{por-campo}, warnings[]`.
  La respuesta se valida con `parseOutlookResultSchema` en mock **y** live (defensa
  en profundidad — nunca se confía en la forma del output).
- **El modelo no inventa**: el prompt (`server/prompt.ts`) y el mock dejan en
  `null` lo que no está claro y agregan `warnings`. Esto ya está implementado.
- **Normalización** (`normalize-outlook-suggestions.ts`, puro y determinístico):
  mint de ids reales, match de company contra la lista (solo match confirmado),
  resolución de dependency a task id, y ensamblado de `notes[]`.
- **Contexto opcional de chips (agregado 2026-07-18):** el usuario puede fijar
  defaults antes de generar (start date, trade, company · y bajo "More context":
  duration, dependency). Se aplican **solo como fallback** de los campos que la
  nota dejó vacíos (**el texto explícito siempre gana**). Company/dependency
  reusan registros reales del Directory (`companies` / `existingTasks`).
- **Provenance (agregado 2026-07-18):** cada campo lleva un `FieldSource` =
  `text` (de la nota) · `chip` (del contexto) · `review` (vacío, a revisar). Se
  muestra en el review modal como tags `note / chips / review`. El flujo de
  datos es: chips → `contextDefaults` → `runParse(defaults)` →
  `normalizeOutlookSuggestions(..., defaults)`.

---

## 5. Qué se agregó/ajustó recientemente (2026-07-18)

- **Chips de contexto opcional** + selectores en bottom-sheet
  (`outlook-context-chips.tsx`, nuevo) + wiring en el hook/parent.
- **Provenance por campo** en el review (`outlook-ai-review.tsx`).
- **Botón "Edit details"** del review: ya no navega a la outlook screen; expande
  + scrollea inline a los detalles flagueados por la IA.
- **Portales**: el review modal y el capture sheet se portalizan a `document.body`
  para escapar el `transform` persistente (`animate-*` con `fill-mode both`) de
  ancestros y quedar por arriba de la profile screen.
- **UI de voz "Listening…"** (`outlook-voice-control.tsx`) — panel con waveform
  decorativo (no reactivo al audio; un waveform reactivo requeriría sumar
  `AnalyserNode`/`AudioContext` al recorder — pendiente opcional).

> ⚠️ Al momento de este handoff, `outlook-natural-language-input.tsx`,
> `outlook-ai-review.tsx` y `outlook-voice-control.tsx` estaban siendo editados
> en paralelo por otra sesión. Confirmar el estado actual antes de tocarlos.

---

## 6. Seguridad (invariantes que no romper)

- La `OPENAI_API_KEY` es **server-only**; `getOutlookAiConfig()` tira error si se
  ejecuta en el browser. Nunca ponerla en un `NEXT_PUBLIC_*`.
- Las rutas verifican el Firebase ID token (`authenticateOutlookRequest`) — en
  prod, setear Admin credentials para verificación real (§2.3).
- El servidor **nunca escribe Firestore** como efecto de una respuesta del
  modelo. Solo produce un draft para review.
- No se persiste audio; el transcript vuelve como texto **editable**; el mic se
  libera en stop/cancel/unmount (`use-outlook-recorder.ts`).
- Todo output del modelo se valida con zod antes de mostrarse.

---

## 7. Pendientes / decisiones abiertas para live

- Confirmar ids de modelo reales con la key (`gpt-5-mini` / `gpt-4o-mini-transcribe`).
- Rate limiting por usuario + presupuesto + telemetría (parse rate, correction
  rate, confirm/cancel) sin loggear contenido sensible.
- Verificación de Firebase Admin en prod (credenciales).
- Idiomas (mezcla ES/EN), retención, consentimiento de voz.
- (Opcional) waveform reactivo al audio real.
- Las preguntas de producto/fechas/entidades del doc hermano siguen vigentes.

---

## 8. Comandos

```bash
pnpm typecheck
pnpm test:outlooks           # dominio + PDF (determinístico)
pnpm exec tsx scripts/outlook-core.test.ts    # si aplica
pnpm dev                     # probar el flujo (mock por defecto, sin key)
```

Para probar **live** localmente: agregar `OPENAI_API_KEY` a `.env.local` y
reiniciar `pnpm dev`. Ver `.env.example` (documenta cada variable).

---

## 9. Fuente de verdad

Si este doc contradice el código, mandan (en orden): `lib/ai/config.ts` (modo),
`features/outlooks/ai/outlook-parser-contract.ts` (contrato),
`features/outlooks/ai/normalize-outlook-suggestions.ts` (normalización/provenance),
las rutas `app/api/outlooks/*`. Para el dominio determinístico y el resto del
flujo Outlook, ver `docs/svc-3-week-outlook-handoff.md`.
