# Ask SVC Directory — AI assistant handoff

Última actualización: 2026-07-20

> Handoff de la capa de IA **"Ask SVC Directory"** (preguntas en lenguaje natural
> sobre people/companies/jobs). Reutiliza la arquitectura ya endurecida del
> 3-Week Outlook (`docs/svc-outlook-ai-handoff.md`). Ship **dark, mock-first**:
> con los flags apagados el Directory funciona exactamente igual que antes
> (solo búsqueda por keyword).

---

## 0. TL;DR — estado y cómo retomar

- Flujo completo implementado: entry "Ask AI" → pantalla dedicada → pregunta
  escrita **o por voz** → recuperación **en el cliente** → respuesta concisa
  fundamentada solo en los registros recuperados → tarjetas de soporte
  (People/Companies/Jobs) + source chips → **Refine** (1–2) / **New question**.
- **Read-only**: nunca escribe/edita datos del Directory. La única escritura es
  el doc de uso `directoryAiUsage` (Admin SDK, saltea rules — sin cambio de rules).
- Mock automático sin `OPENAI_API_KEY`. Live usa `gpt-5-mini` (ask) y
  `gpt-4o-mini-transcribe` (voz), configurables por env.
- Reusa **la misma** `OPENAI_API_KEY` y credencial Firebase Admin del Outlook;
  solo el modo/modelo son propios, y el **presupuesto de rate limit es separado**.

## 0b. V2 — razonamiento sobre todo el Directory (2026-07-20)

V1 resolvía **una** entidad en el cliente y hacía **una** llamada a GPT. V2 le da al
asistente acceso lógico a **todo** el Directory (people/companies/jobs/relaciones/
notas) sin mandar la base a OpenAI, vía **tools server-side read-only**.

**Pipeline:** `extractEntities` (resuelve TODAS las entidades mencionadas, varias del
mismo tipo; ambigüedad → `needsDisambiguation`, de a una) → `buildQueryPlan`
(clasifica intent y decide qué datos hacen falta) → **prefetch determinístico** de
tools (sin llamada al modelo) → `runToolConversation` (el modelo responde ya, o pide
más tools; **máx. 3 rondas**) → respuesta estructurada validada con zod.

Como el prefetch suele alcanzar, **el caso común cuesta UNA sola llamada** al modelo.

**Tools** (`features/directory/ai/server/tools/`): `searchPeople`, `searchCompanies`,
`searchJobs`, `getEntityDetails`, `getCompanyRelationships`, `getJobRelationships`,
`getPersonRelationships`, `findSharedContacts`, `findSharedJobs`,
`findConnectingPaths` (BFS ≤3 hops, devuelve **el camino**), `searchRelevantNotes`
(vector si hay embeddings, léxico si no). Cada tool valida sus args con zod
(nunca se confía en el modelo), devuelve ≤12 registros compactos y consume un
**budget compartido** (`maxTotalRecords`).

**Datos server-side** (`lib/ai/server/directory-data.ts`): **queries acotadas, nunca
el shard catalog** (corrección del audit de Firestore). Resuelve nombres por
`normalizedName` (igualdad → prefijo anclado en el primer token, comparación
insensible a puntuación en memoria), relaciones por `/directoryRelations`, y los
arrays derivados `askContext.{personIds,companyIds,jobIds}` con UN solo filtro de
array por query (sin índices compuestos). Multi-filtro → ≤30 candidatos de la query
más selectiva, `intersectRecords` en memoria, 5–15 finales. Toda query lleva `limit`.

**Contexto fundamentado** (`server/answer-context.ts`): `confirmedFacts`,
`relationships` (+ paths), `relevantNotes`, `missingInformation`,
`possibleInferences`, `supportingRecordIds`, `questionIntent`. Detecta **registros
contradictorios** (job "In Progress" cuyo texto dice cancelado) y lo reporta como
limitación en vez de elegir un lado.

**Respuesta**: `answer`, `confirmedFacts`, `inferredInsights`, `limitations`,
`supportingRecords`, `sourcesUsed`, `confidence`, `notFound`, `questionIntent`
(+`paths`). La UI muestra cards + source chips + "Good to know" + confianza. El
chain-of-thought **nunca** sale del servidor.

**Contexto de IA**: proyección versionada `askContext` dentro de los `directoryIndex`
context-backed (`lib/directory-ask-context.ts`, compartida con functions). **Nunca** se
usa el `searchText` amplio. Elegibilidad = ≥80 chars de texto útil **deduplicado medido
antes de sanitizar** (242 registros); se guarda/embebe la versión sanitizada.

**Embeddings**: `embedDirectoryAskContextOnWrite` sobre `directoryIndex` + backfill
`scripts/backfill-directory-ask-context.ts`. **Desplegado y operativo** (ver §8b).

**Tests**: `pnpm test:directory-ai` (37) + `pnpm test:directory-ai-eval` (29 casos
reales sobre un Directory sintético, offline) — cobertura de entidades, plan,
sin claims inventados, hedging, ambigüedad, datos faltantes y conflictos.

## 1. Decisiones clave

- **Retrieval en el cliente.** La búsqueda usa el MiniSearch index ya cargado
  (`lib/directory-search.ts`) + `/directoryRelations` (`lib/directory-relations.ts`),
  todo lo cual el usuario ya puede leer (`/directoryIndex` es auth-read). Se envían
  al servidor **solo** ≤10 registros ya truncados — nunca el Directory completo.
  No hay escalada de privilegios: el modelo resume registros que el usuario ya ve.
- **GPT solo cuando aporta.** Un lookup exacto de un único registro se responde
  localmente sin llamar al modelo (`buildLookupAnswer`).
- **Ambigüedad primero.** Si un nombre matchea varios registros fuertes, la UI
  pide elegir el correcto **antes** de llamar a GPT.
- **Sugerencias locales, context-aware.** Motor en `directory-suggestions.ts`
  (`buildDirectorySuggestions`): lee solo actividad reciente (records abiertos +
  contexto de página) y **los campos que cada record realmente tiene**; cada
  plantilla se gatea por campo/tipo (sin `{location}` si no hay location, sin
  cross company↔job si no existen ambos). Combina records recientes
  ("contactos compartidos entre {company} y {job}", "trabajos activos de {company}
  en {location}", "quién está más relacionado con {job}", "supervisores conectados
  a {trade}"), rankea por recencia · relevancia (scope) · completitud, deduplica
  por familia + cap de 2 por entidad, rota con un `seed` (cambia por visita /
  New question), máximo 4, y usa fallback seguro solo si falta contexto. **Nunca**
  llama a OpenAI. Tocar una sugerencia **solo rellena el input** (no dispara la IA).

## 2. Cómo se decide mock vs live

`lib/ai/config.ts` → `getDirectoryAiConfig()` (server-only; tira error en browser).

```
mode = DIRECTORY_AI_MODE  si es "mock" | "live"
     = "live"  si hay OPENAI_API_KEY presente
     = "mock"  en cualquier otro caso
```

`canCallProvider(config)` (genérico) = `mode === "live" && apiKey`. El
`ask-service` / `transcription-service` llaman al provider solo si eso es true.

## 3. Go-live (con key)

1. `OPENAI_API_KEY` (server, compartida) + credencial Admin
   (`FIREBASE_SERVICE_ACCOUNT_KEY` o `GOOGLE_APPLICATION_CREDENTIALS`) — sin Admin,
   live falla cerrado.
2. Flags de UI: `NEXT_PUBLIC_DIRECTORY_AI_ENABLED=true`
   (+ `NEXT_PUBLIC_DIRECTORY_VOICE_ENABLED=true`) — se inlinean en build.
3. Opcionales: `DIRECTORY_AI_MODE`, `DIRECTORY_AI_ASK_MODEL`,
   `DIRECTORY_AI_TRANSCRIBE_MODEL`, `OPENAI_BASE_URL`. Ver `.env.example`.
4. Smoke test autenticado: Directory → **Ask AI** → preguntar → la respuesta deja
   de decir `Mock`, aparecen tarjetas + source chips, **New question** limpia,
   **Refine** funciona (≤2), un nombre común muestra el selector de ambigüedad.

## 4. Límites y protecciones (server-side)

`lib/ai/config-public.ts` → `DIRECTORY_AI_LIMITS`:

- `maxQuestionChars` 400 · `maxRecords` 10 · `maxRecordChars` 600 ·
  `maxAnswerTokens` 500 · `maxRefinements` 2.
- `askRequestsPerWindow` 30 · `transcriptionRequestsPerWindow` 15 · ventana 10 min.
- Voz: `maxAudioSeconds` 60 · `maxAudioBytes` 8 MiB.

El guard (`lib/ai/server/directory-request-guard.ts`) reutiliza el core
transaccional del Outlook (`request-guard*.ts`) pero sobre la colección
**`directoryAiUsage`** y con estos límites: 1 request activo por usuario,
idempotencia (`X-Idempotency-Key` 12–32), deduplicación de payload 2 min, y
backoff selectivo de 429 en el cliente OpenAI. La operación `ask` usa el bucket
"generation"; la voz el bucket "transcription".

## 5. File map

```
[home search]  directory-ask-entry.tsx  (pill "Ask AI", flag-gated)
   ▼ directory-ask-screen.tsx  (empty/loading/answer/ambiguous/error)
   │   ├─ directory-ask-voice.tsx        (panel "Listening…", reusa useOutlookRecorder)
   │   ├─ directory-ask-context-chips.tsx (pin person/company/job)
   │   ├─ directory-ask-suggestions.tsx   (Try asking — local)
   │   └─ directory-ask-answer.tsx        (respuesta + source chips + tarjetas)
   ▼ use-directory-ask.ts  (orquesta: retrieval → answer, refine≤2, cooldowns)
   │   directory-retrieval.ts + directory-retrieval-core.ts (intent/entidad/records)
   │   directory-suggestions.ts (motor de sugerencias context-aware, firebase-free)
   ▼ directory-ai-client.ts  (fetch a las rutas, bearer token)
   ▼ POST /api/directory/ask        POST /api/directory/transcribe  (runtime nodejs)
   ▼ ask-service.ts / transcription-service.ts  (mock vs live + zod out)
   │   ├─ answer-brief.ts (analyzeForAnswer → confirmed/inferred/missing/intent+style)
   │   ├─ mock: mock-answerer.ts (mockAnswerFromBrief — natural, style-adaptive, grounded)
   │   └─ live: lib/ai/openai/client.ts (createStructuredJson / transcribeAudio)
   ▼ contrato: directory-ask-contract.ts (zod in/out)
   ▼ prompt: server/prompt.ts (human-teammate voice + brief sections + JSON schema)
```

Config/guard compartidos: `lib/ai/config.ts`, `lib/ai/config-public.ts`,
`lib/ai/flags.ts`, `lib/ai/server/{auth-guard,request-guard,request-guard-core,
safe-log,route-helpers}.ts`, `lib/ai/openai/client.ts`,
`features/outlooks/ai/server/audio-validation.ts` (generalizado con `maxSeconds`).

## 5b. Estilo de respuesta (answer quality)

Objetivo: que suene a un compañero de SVC que conoce el negocio, no a una base de
datos. `answer-brief.ts::analyzeForAnswer` pre-digiere los registros en un **brief
estructurado** que consumen TANTO el prompt live como el mock:

- **confirmed** (hechos presentes → se afirman: "is listed as"),
- **inferred** (patrones → se matizan: "appears to be" / "looks like"),
- **missing** (lo que el Directory no tiene → se dice claro y se pivotea a lo que sí),
- **relatedIds** (para `usedRecordIds` + las cards),
- **intent → style**: `lookup · summary · relationships · comparison · recommendation · missing`.

El grupo de conexiones **excluye al primary** (para no contar un job como su propio
"linked job"). El system prompt (`DIRECTORY_ASK_SYSTEM_PROMPT`) exige: responder
directo en la 1ª oración, inglés natural, sin muletillas robóticas ("the system
found", "there are N records", volcado de campos), 2–5 oraciones, no repetir las
cards (apuntar a ellas), nunca inventar, y adaptar el tono por style. El mock
(`mockAnswerFromBrief`) replica el mismo tono de forma determinista.

## 6. Seguridad y privacidad

- Key server-only; `getDirectoryAiConfig()` falla en browser. Nunca `NEXT_PUBLIC_*`.
- Solo usuarios autenticados; live verifica el ID token con Firebase Admin.
- Logs `[directory-ai]` metadata-only (op, requestId, uid hasheado, latencia,
  #chars, #records, error code) — **nunca** la pregunta, transcript, ni contenido
  de registros.
- Read-only; el audio no se persiste; el transcript vuelve editable antes de enviar.

## 7. Verificación y comandos

```bash
pnpm test:directory-ai   # contrato, mock-answerer, ask-service, retrieval, guard
pnpm typecheck
pnpm verify:fast         # suite completa + build de functions
pnpm build
pnpm dev                 # mock si no hay key; live si está configurada + flags on
```

## 8. Pendientes / futuro

- Métricas agregadas (answer rate, refine rate, not-found rate) sin contenido.
- Location como chip de contexto de primera clase (hoy solo entity pin).
- Cachear respuestas idénticas por sesión en el cliente (hoy cada pregunta es limpia).
- Presupuesto mensual de OpenAI compartido con Outlook — monitorear.

## 8b. Estado de producción (2026-07-20) — TODO LIVE

Ejecutado contra `svc-comms` con aprobación del usuario. Secuencia del audit completa:

1. **Secreto**: `OPENAI_API_KEY` en **Secret Manager** (primer secreto del proyecto).
   Las functions lo declaran con `.runWith({ secrets: [...] })`; nunca en un `.env` del repo.
2. **Proyección `askContext`**: backfill de **2.644** docs de `directoryIndex`
   (`pnpm backfill:ask-context`). **0 escrituras a `contexts`.** Idempotente:
   re-correr el dry-run reporta `would write: 0 / already current: 2644`.
3. **Embeddings**: **242** registros AI-eligible embebidos desde `askContext.aiText`
   sanitizado (~9.2k tokens, ~$0.0002).
4. **Índice vectorial**: `directoryIndex.askContext.embedding` (1536, flat) agregado a
   `firestore.indexes.json` y desplegado. Antes se verificó el diff contra prod
   (solo crea, no borra). Tarda unos minutos en construirse; hasta entonces
   `findNearest` devuelve FAILED_PRECONDITION y el tool cae a búsqueda léxica.
5. **Trigger de contexts** (`syncDirectoryOnContextWrite`) **extendido**: ahora incluye
   `askContext` + `source` en el write. **Esto era crítico** — el trigger usa `set()` sin
   merge, así que sin este cambio cada edición de un context habría borrado la proyección.
6. **Trigger de embeddings** re-apuntado: `embedDirectoryNoteOnWrite` (borrada) →
   **`embedDirectoryAskContextOnWrite`** sobre `directoryIndex`. Loop-safe: solo escribe
   campos de embedding, que no cambian `aiTextHash`, y el guard
   `embeddingHash === aiTextHash` corta la reentrada. Los no-elegibles salen antes de
   cualquier llamada de red.

**8 Cloud Functions activas.** El módulo `lib/directory-ask-context.ts` se comparte con
functions vía `copy-shared-core.mjs`, así que app, trigger y backfill producen
proyecciones idénticas.

**Verificación live contra prod:**
- resolución de entidades, incluyendo multi-entidad y nombres con puntuación;
- respuestas reales de gpt-5-mini (~4,5 s, **una sola llamada** gracias al prefetch);
- datos faltantes reportados honestamente ("the Directory has the company record but no linked people");
- `findNearest` devolviendo vecinos semánticos correctos.

## 9. Fuente de verdad

Si este doc contradice el código, manda el código: límites/modelos en
`lib/ai/config*.ts`; contrato en `directory-ask-contract.ts`; retrieval en
`directory-retrieval*.ts`; guard en `directory-request-guard.ts`; endpoints en
`app/api/directory/*`.
