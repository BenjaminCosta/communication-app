# SVC Outlook — AI capture handoff (voice + parse)

Última actualización: 2026-07-20

> Handoff **específico de la capa de IA** del 3-Week Outlook. El documento
> hermano `svc-3-week-outlook-handoff.md` describe el dominio determinístico
> (fechas, scheduling, versiones, PDF, persistencia) y trata la IA como trabajo
> futuro — **ese "futuro" ya está implementado y está live**. Este doc cubre
> qué existe, las protecciones agregadas y las prácticas que deben reutilizarse
> en próximas integraciones de IA dentro del mismo proyecto.

---

## 0. TL;DR — estado y cómo retomar

- La captura por IA (voz → transcript → parse → **review** → confirmar) está
  implementada de punta a punta y **funcionando live en local y Vercel**.
- Se usa `gpt-4o-mini-transcribe` para voz y `gpt-5-mini` para extracción
  estructurada de tareas. Ambos modelos son configurables por environment.
- El modo mock sigue disponible para desarrollo offline y pruebas deterministas.
- Las rutas live requieren usuario autenticado, aplican rate limiting,
  idempotencia, deduplicación, límite de concurrencia, validación de payloads,
  retries selectivos y logging sin contenido sensible.
- La grabación mobile funciona en iOS y Android: WebM/OGG/MP4 fragmentados
  pueden no incluir duración interna, por lo que existe un fallback seguro
  basado en la duración medida por `MediaRecorder` y la firma binaria del archivo.
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

## 2. Configuración live actual y reutilización de la key

La configuración live ya está instalada. El valor real de la key no se copia en
este documento, en Git ni en logs. Las variables relevantes son:

1. **Secreto server-side** (Vercel env o `.env.local` para dev):
   ```bash
   OPENAI_API_KEY=sk-...            # una sola key por environment/proyecto
   # opcionales:
   OUTLOOK_AI_MODE=live             # forzar (o "mock" para desactivar con key presente)
   OUTLOOK_AI_PARSE_MODEL=gpt-5-mini
   OUTLOOK_AI_TRANSCRIBE_MODEL=gpt-4o-mini-transcribe
   OPENAI_BASE_URL=https://api.openai.com/v1
   ```
   Una integración nueva dentro del mismo proyecto puede reutilizar
   `OPENAI_API_KEY`; no debe duplicar el secreto ni crear una variable
   `NEXT_PUBLIC_*`. Conviene mantener una variable de modelo separada por caso
   de uso para poder cambiar modelos sin tocar código.
2. **Flags de UI**:
   `NEXT_PUBLIC_OUTLOOK_AI_ENABLED=true` y `NEXT_PUBLIC_OUTLOOK_VOICE_ENABLED=true`
   (se inlinean en el bundle en build; requieren rebuild).
3. **Identidad verificada en prod**:
   `FIREBASE_SERVICE_ACCOUNT_KEY` (JSON stringificado) **o**
   `GOOGLE_APPLICATION_CREDENTIALS` para que el auth-guard **verifique** el
   Firebase ID token (sin esto, live falla de forma segura; el decode sin
   verificar existe sólo para dev/mock). Ver
   [`lib/ai/server/auth-guard.ts`](../lib/ai/server/auth-guard.ts).
4. **Modelos probados**: los defaults son `gpt-5-mini` (parse) y
   `gpt-4o-mini-transcribe` (transcribe). Se pueden reemplazar con las env de
   arriba. La capa server-side usa:
   - parse → `POST /chat/completions` con `response_format: json_schema` (strict)
     + `max_completion_tokens` (la familia gpt-5 rechaza `temperature` custom, ya
     contemplado en [`lib/ai/openai/client.ts`](../lib/ai/openai/client.ts));
   - transcribe → `POST /audio/transcriptions` (`response_format: json`).
5. **Smoke test del flujo real**: abrir un job → tab Outlook → Quick Update →
   escribir/dictar una nota → Generate Outlook → verificar que el badge deja de
   decir `Mock`, que las suggestions llegan, y que la provenance (§4) es correcta.
6. **Costos/límites**: revisar timeouts y caps en
   [`lib/ai/config-public.ts`](../lib/ai/config-public.ts)
   (`OUTLOOK_AI_LIMITS`: `maxAudioSeconds`, `maxTextChars`, `maxSuggestions`,
   `providerTimeoutMs`). Ya se aplica server-side una ventana móvil de 10 minutos
   (20 generations / 10 transcriptions por usuario), un único request activo,
   idempotencia/deduplicación y backoff selectivo para `429`. El texto está
   limitado a 2.000 caracteres y el audio a 3 minutos / 8 MiB con validación del
   media real. Para WebM/OGG/MP4 fragmentado de navegadores mobile, el servidor
   comprueba la firma binaria correspondiente y usa como fallback la duración
   medida por `MediaRecorder`. Sólo queda definir/monitorear el presupuesto
   mensual operativo.

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

## 5. Cambios implementados y aprendizajes

### Flujo y UX

- Chips de contexto opcional y provenance por campo (`text`, `chip`, `review`).
- Review obligatorio: la IA genera suggestions, nunca tareas persistidas.
- Botones de generar/grabar deshabilitados mientras hay una operación activa.
- `busyRef` evita doble click desde el cliente, pero la protección real también
  existe en servidor para que no pueda saltearse llamando directo a la API.
- Cuando se alcanza un límite, la UI usa `retryAfterSeconds` para mostrar un
  countdown y vuelve a habilitar la acción al terminar el cooldown.
- El transcript siempre vuelve como texto editable antes de generar tareas.

### Performance y costo

- `gpt-5-mini` se usa como extracción estructurada, no como agente abierto:
  `reasoning_effort: minimal`, `verbosity: low`, JSON Schema estricto y un máximo
  de 20 suggestions por request. Esto redujo la latencia de Generate Outlook sin
  perder la validación de salida.
- `gpt-4o-mini-transcribe` se reserva para transcripción en vez de usar el modelo
  generalista; el audio se envía una sola vez y nunca se persiste.
- El contexto enviado al modelo incluye sólo los campos necesarios del job,
  companies y tasks; no se envía el workspace completo.
- Hay timeout de proveedor de 30 segundos, límites de input, deduplicación y
  rate limiting para evitar llamadas/costos accidentales.

### Mobile voice: lo que finalmente funcionó

El primer validador intentaba obtener siempre la duración desde metadata del
archivo con `music-metadata`. Eso funciona con WAV y archivos finalizados de
desktop, pero falló en mobile con el mensaje `The recording duration could not
be verified.`. La causa es que `MediaRecorder` puede producir contenedores
streamed/fragmented sin duración global:

- iOS suele producir MP4/M4A fragmentado y también puede elegir WebM en versiones
  que lo soportan;
- Android normalmente produce WebM/Opus;
- ambos pueden ser audio válido para OpenAI aunque la duración del contenedor no
  sea legible por el parser.

La solución aplicada fue:

1. medir el tiempo real desde `recorder.start()` hasta `onstop` con
   `performance.now()`;
2. enviar ese `durationMs` junto con el `FormData` autenticado;
3. validar primero la duración real del contenedor cuando está disponible;
4. si falta, aceptar la duración del recorder sólo para WebM, OGG o MP4/M4A y
   sólo después de comprobar la firma binaria real (EBML, `OggS` o `ftyp`);
5. validar siempre server-side el máximo de 3 minutos, MIME permitido y 8 MiB;
6. mantener auto-stop, liberación del micrófono y botones bloqueados durante el
   procesamiento.

**Regla reutilizable:** no depender únicamente de metadata de duración para
blobs creados por `MediaRecorder` mobile. Tampoco confiar sólo en `file.type`:
combinar tipo declarado, firma binaria, tamaño y duración medida.

---

## 6. Protecciones de producción actuales

### Autenticación y secretos

- `OPENAI_API_KEY` es **server-only**. `getOutlookAiConfig()` falla si se importa
  en browser. Nunca usar `NEXT_PUBLIC_OPENAI_API_KEY` ni enviar la key al cliente.
- Las dos rutas autentican primero el Firebase bearer token. En live se exige
  verificación criptográfica con Firebase Admin antes de cualquier llamada
  facturable a OpenAI.
- La misma key puede compartirse entre features server-side dentro del proyecto,
  pero cada feature debe tener su propio contrato, modelo configurable y límites.

### Rate limiting, concurrencia e idempotencia

- Generación: **20 requests por usuario cada 10 minutos**.
- Transcripción: **10 requests por usuario cada 10 minutos**.
- Sólo se permite **una operación de IA activa por usuario**, compartida entre
  generación y transcripción. La lease expira a los 2 minutos para recuperarse
  de una función interrumpida.
- El estado se aplica transaccionalmente en Firestore, colección
  `outlookAiUsage`, usando un hash del UID como document id.
- Cada request requiere `X-Idempotency-Key` de 12–32 caracteres seguros. La key
  y el payload se hashean antes de guardarse.
- Un payload completado idéntico se bloquea durante 2 minutos. Reutilizar la
  misma idempotency key con otro payload también se rechaza.
- Una falla del proveedor libera la huella para permitir un retry intencional,
  aunque el intento sigue contando en la ventana de rate limit.

### Validación de requests

- Texto Quick Update: máximo 2.000 caracteres; request JSON máximo 128 KiB.
- Audio: máximo 3 minutos, 8 MiB y tipos WebM, OGG, MP4, MP3, M4A o WAV.
- El servidor valida content type, tamaño, schema, idioma, audio y duración; los
  límites del frontend son sólo UX y nunca la única defensa.
- El output estructurado se valida con JSON Schema en OpenAI y luego otra vez
  con zod en el servidor. El modelo no genera ids persistidos ni `endDate`.

### Retries y errores

- Sólo los `429` retryables de OpenAI se reintentan automáticamente: hasta 2
  retries con backoff exponencial desde 500 ms, jitter, tope de 5 segundos y
  respeto por `Retry-After`.
- **Nunca** se reintentan errores de validación, autenticación, permisos,
  payload, output inválido ni crédito insuficiente (`insufficient_quota` /
  billing hard limit).
- El cliente recibe errores estables y amigables (`code`, `error` y, cuando
  aplica, `retryAfterSeconds`). Nunca recibe el body/error crudo del proveedor.

### Logging y privacidad

- Los logs `[outlook-ai]` contienen sólo metadata segura: operación, event,
  request id, UID hasheado, latencia, cantidad de caracteres, bytes/duración de
  audio, fuente de duración, código de error, intento y provider request id.
- Nunca se registran API keys, bearer tokens, texto de prompts, nombres de
  archivo, audio, transcripciones, contenido de tareas ni responses completas.
- El audio no se guarda. El servidor sólo devuelve el transcript y las
  suggestions; persistir tareas requiere confirmación explícita del usuario.

---

## 7. Playbook para la próxima integración con la misma OpenAI key

Usar este orden; evita repetir los problemas ya resueltos:

1. Crear una ruta server-side Node (`app/api/.../route.ts`). Autenticar con
   Firebase antes de parsear contenido grande o llamar al proveedor.
2. Reutilizar `OPENAI_API_KEY` desde `getOutlookAiConfig()` o extraer una config
   AI común, pero conservar una env de modelo específica para el nuevo caso.
3. Definir un contrato zod de input/output y, si el modelo produce estructura,
   usar JSON Schema strict + validación zod posterior.
4. Mantener a la IA como generadora de drafts. Aplicar reglas de negocio, ids,
   relaciones y persistencia en código determinístico después del review.
5. Extender el guard server-side con una operación/límite propio. No depender de
   debounce ni disabled buttons como control de seguridad.
6. Generar un idempotency key corto por acción, hashear el payload y decidir una
   ventana explícita de deduplicación.
7. Agregar retries sólo para fallas transitorias seguras. Separar 429 real de
   OpenAI de falta de crédito y no reintentar 4xx de aplicación.
8. Diseñar logs por allowlist de metadata; si un campo no está explícitamente en
   el tipo de log seguro, no debe registrarse.
9. Limitar input, output, timeout, contexto y concurrencia antes de habilitar la
   UI. Elegir el modelo más pequeño que mantenga la calidad requerida.
10. Probar unitariamente auth fail-closed, schema, límite exacto, request N+1,
    concurrencia, payload duplicado, idempotency key reutilizada, 429 retryable,
    crédito insuficiente y errores amigables.
11. Si hay captura de media, probar archivos reales de desktop, iOS y Android;
    no asumir que los contenedores generados por browser traen metadata completa.
12. Configurar las mismas env por separado en Development/Preview/Production,
    hacer rebuild cuando cambian flags `NEXT_PUBLIC_*` y ejecutar un smoke test
    autenticado después de desplegar.

---

## 8. Pendientes operativos

- Definir y alertar un presupuesto mensual de OpenAI.
- Agregar métricas agregadas de parse success, correction rate y confirm/cancel
  sin capturar contenido sensible.
- Definir formalmente idiomas soportados, aviso/consentimiento de voz y política
  de retención de transcripts en el producto.
- Opcional: waveform reactivo con `AnalyserNode`/`AudioContext`.
- Las preguntas de producto/fechas/entidades del doc hermano siguen vigentes.

---

## 9. Verificación y comandos

```bash
pnpm test:outlooks-ai       # contratos, auth, guards, audio mobile y retries
pnpm test:outlooks          # dominio + PDF determinístico
pnpm typecheck
pnpm verify:fast            # suite completa + build de Cloud Functions
pnpm build                  # bundle de producción Next.js
pnpm dev                    # mock si no hay key; live si la key está configurada
```

Casos cubiertos en `scripts/outlook-ai.test.ts`:

- contrato y outputs inválidos;
- límite server-side de 2.000 caracteres;
- auth live fail-closed sin Firebase Admin;
- requests 20/10 y request N+1 rechazado;
- una sola operación activa, deduplicación e idempotencia;
- duración real WAV y fallbacks de firma/duración para MP4 y WebM mobile;
- rechazo de MIME/firma falsos y audio demasiado largo;
- retry de 429 y no-retry de crédito insuficiente.

Para probar live localmente, usar `.env.local` sin commitearlo y reiniciar
`pnpm dev`. `.env.example` documenta nombres de variables, nunca valores.

---

## 10. Fuente de verdad

Si este doc contradice el código, mandan:

- config/modelos/límites: `lib/ai/config.ts` y `lib/ai/config-public.ts`;
- auth: `lib/ai/server/auth-guard.ts`;
- rate limit/idempotencia: `lib/ai/server/request-guard*.ts`;
- retries/provider: `lib/ai/openai/client.ts`;
- logs seguros: `lib/ai/server/safe-log.ts`;
- audio mobile: `features/outlooks/voice/use-outlook-recorder.ts` y
  `features/outlooks/ai/server/audio-validation.ts`;
- contrato: `features/outlooks/ai/outlook-parser-contract.ts`;
- normalización/provenance:
  `features/outlooks/ai/normalize-outlook-suggestions.ts`;
- endpoints: `app/api/outlooks/parse/route.ts` y
  `app/api/outlooks/transcribe/route.ts`.

Para el dominio determinístico y el resto del flujo Outlook, ver
`docs/svc-3-week-outlook-handoff.md`.
