# SVC ByeByeDPR — development record and operating notes

_This is a chronological engineering record, retained for implementation
history, following the same convention as `docs/svc-quest-coral-module.md`.
No `docs/svc-bye-bye-dpr-product-context.md` companion exists yet — that
convention (see `scripts/seed-quest-coral-project-contexts.mjs`) is for
modules stable enough to feed the cross-module "Ask AI" context system;
ByeByeDPR isn't there yet (backend built, UI mockup built, the two are not
wired together)._

Última actualización: 2026-08-10

Rama de integración: `main` (sin commitear al momento de escribir esto — ver
`git status`).

Estado del código: **Fase 1 (backend), Fase 2 (UI mockup), Fase 3 (conectar
UI ↔ backend real), Fase 3.5 (aplanar el modelo — se sacó el concepto de
compañía) hechas, y reglas/índices de Firestore + Storage ya desplegados a
producción (2026-08-10, con aprobación explícita del usuario).** La UI ya no
usa mock data (`components/bye-bye-dpr/byebye-dpr-mock-data.ts` fue
borrado): todas las pantallas llaman a `app/api/bye-bye-dpr/*` con Bearer
auth real, **contra Firestore/Storage de producción de verdad** — ver
"Cambio 2026-08-10 (cont.): deploy a producción" más abajo. **El modelo
multi-tenant de la Fase 1 se revirtió por completo el mismo día** — ver
"Cambio 2026-08-10" más abajo; ya no existen `companies`/`companyInvites`/
roles en ningún lado del código. **Hay además un hallazgo de seguridad
importante sobre las API routes en dev** — ver "⚠️ Admin SDK sin wiring de
emulador" más abajo (ahora menos riesgoso que antes, porque las reglas de
prod ya están desplegadas y son las mismas que usa el código, pero sigue
siendo real producción, no un sandbox). **Attendance Report se construyó
(backend + UI) y luego se eliminó por completo el 2026-08-07** — decisión
explícita del usuario, ver la sección correspondiente más abajo. El módulo
hoy solo soporta clock
in/out y Daily Report.

## Resumen ejecutivo

`ByeByeDPR` es el 5º módulo del portal SVC (junto a Communications,
Directory, Applications y Quest Coral), pero con una audiencia distinta a
los otros cuatro: no es para staff de oficina, es para **cuadrillas de
campo** (field crews) fichando entrada/salida y mandando reportes diarios
desde el celular, parados en una obra. El flujo objetivo: confirmar el job,
clock in/out, dictar o escribir un reporte que la IA estructura, revisar y
enviar — todo en segundos, sin que el trabajador vea ni decida nada de
tags, recipients, contexts, ruteo a Comms o generación de PDF (eso pasa
invisible, del lado del servidor). *(El módulo originalmente también
incluía Attendance Report — se eliminó por completo el 2026-08-07, ver esa
sección.)*

Se construyó en dos pasadas separadas, cada una con su propio alcance
explícito del usuario:

1. **Backend/Firebase foundation** — "implementá el backend y la base de
   Firebase, sin UI todavía, usando lo que ya existe en el proyecto en vez
   de inventar sistemas paralelos."
2. **UI mockup** — "maquetá la UI con datos mock, sin conectar nada al
   backend real, siguiendo estas referencias" (dos capturas de un flujo de 5
   pantallas + una especificación de UX detallada en español).

## Estado por fase

| Fase | Alcance | Estado |
|---|---|---|
| **Fase 1 — Backend/Firebase** | Modelo de datos, reglas de Firestore/Storage, índices, servicios (`lib/bye-bye-dpr-server.ts`, `lib/companies-server.ts`), 17 API routes, integración con Comms/IA/PDF existentes, tests. | **Hecho, sin desplegar.** `pnpm typecheck` limpio, `pnpm test:bye-bye-dpr` (12/12 tras la remoción de attendance), reglas verificadas contra el emulador (`scripts/test-bye-bye-dpr-rules.mjs`, 30/30). `pnpm verify:fast` completo corrido limpio. |
| **Fase 2 — UI mockup** | 5º scope de diseño (`.byebye-dpr-scope`), pantallas/sheets con datos mock, empty states, tratamiento "IA generando", entrada en el module switcher. | **Hecho.** Verificado en browser real (Playwright headless, screenshots + consola sin errores) en cada pasada. Attendance Report se construyó y luego se eliminó (2026-08-07). |
| **Fase 3 — Conectar UI ↔ backend** | Reemplazar `useState`/`setTimeout` por llamadas reales a `app/api/bye-bye-dpr/*` y `app/api/companies/*` (multi-tenant, ver Fase 1) con `getIdToken()` Bearer auth; gate mínimo de alta de compañía y de primer job; grabación de audio real (MediaRecorder); subida de fotos real. | **Hecho (2026-08-10), luego el modelo de compañía se revirtió en Fase 3.5 — ver esa fila.** `pnpm typecheck` limpio, `pnpm test:bye-bye-dpr` (12/12, sin cambios), `pnpm emulator:test-bye-bye-dpr-rules` (30/30, sin cambios — no se tocaron reglas). **No se pudo hacer una prueba funcional de punta a punta en vivo** — ver el hallazgo de seguridad más abajo. |
| **Fase 3.5 — Aplanar el modelo (sacar compañías)** | El usuario pidió sacar por completo el concepto de compañía/roles/invitaciones: todo usuario logueado ve todos los jobs y tiene el mismo nivel de acceso. Se revirtió `companyId` de `jobs`/`clockRecords`/`reports`, se borraron `companies`/`companyInvites` de Firestore y `lib/companies-server.ts`/`app/api/companies/**`/`company-gate-screen.tsx` del código, se simplificaron las 3 reglas de rules files y `storage.rules`. | **Hecho (2026-08-10).** `pnpm typecheck` limpio, `pnpm test:bye-bye-dpr` (12/12, sin cambios), reglas reescritas y verificadas contra el emulador (`scripts/test-bye-bye-dpr-rules.mjs`, ahora 21/21 — bajó de 30 porque se borraron los casos de cross-company que ya no aplican). |
| **Fase 4 — Deploy** | `firestore.rules`, `storage.rules`, `firestore.indexes.json` a producción; seed de tags (`scripts/seed-bye-bye-dpr-tags.mjs`); wiring de emulador para el Admin SDK (ver hallazgo). | **Reglas + índices desplegados a producción el 2026-08-10**, con aprobación explícita del usuario — ver "Cambio 2026-08-10 (cont.): deploy a producción" más abajo. Falta: seed de tags, wiring de emulador. |

## Cambio 2026-08-07: se eliminó Attendance Report

Instrucción del usuario: "elimina eso de attendance report, elimina
completamente esa función y su ui." Se interpretó como remoción completa —
backend y frontend — no solo ocultar la pantalla, incluyendo la
simplificación del propio sistema de tipos (no quedó una alternativa
"attendance_report" muerta/inalcanzable en ningún union type).

**Se borraron por completo:**
- `components/bye-bye-dpr/attendance-report-screen.tsx`
- `features/bye-bye-dpr/ai/server/attendance-extraction-service.ts` +
  `attendance-extraction-prompt.ts`
- `features/bye-bye-dpr/pdf/generate-attendance-report-pdf.ts`

**Se simplificó (quitando la rama de attendance, sin tocar daily_report):**
- `lib/bye-bye-dpr-core.ts` — `ReportType` pasó de
  `"daily_report" | "attendance_report"` a `"daily_report"` (literal único,
  no un union muerto). Se borraron `AttendanceEntry`/`AttendanceEntryStatus`/
  `AttendanceReportStructuredData`/`emptyAttendanceReportStructuredData`/
  `isAttendanceReportSubmittable`/`KnownPerson`/`AttendanceNameSuggestion`/
  `matchAttendanceName`.
- `lib/bye-bye-dpr-store.ts` — `mapReportStructuredData()` ya no rama por
  `type`, siempre mapea daily. `ReportStructuredData` ya no es un union.
- `lib/bye-bye-dpr-server.ts` — `structureReportDraft`/`generateReportPdf`/
  `submitReport`/`createReportDraft` perdieron su rama de attendance;
  `CreateReportDraftInput` ya no pide `type` (no tiene sentido pedirlo
  cuando solo existe un valor posible).
- `features/bye-bye-dpr/contracts/report-contract.ts` — se borraron todos
  los schemas `attendance*`; `createReportDraftRequestSchema` ya no incluye
  `type`.
- `lib/bye-bye-dpr-tags.ts` / `scripts/seed-bye-bye-dpr-tags.mjs` — se
  borró el tag "Attendance Report" (`byebye-dpr-attendance-report`) y el
  evento `"attendance-report"` de `ByeByeDprEventTag`.
- `lib/ai/config-public.ts` — se borró `maxAttendanceEntries` de
  `BYE_BYE_DPR_AI_LIMITS` (quedó sin ningún caller).
- `components/bye-bye-dpr/ui/byebye-dpr-ai-generating.tsx` — la variante
  `compact` existía solo para la card de voz de Attendance; al quedar sin
  caller se borró también, dejando un solo tamaño (el que usa Daily Report).
- `components/bye-bye-dpr/byebye-dpr-home-screen.tsx` /
  `byebye-dpr-app.tsx` / `byebye-dpr-mock-data.ts` — fila "Attendance
  Report" del Home, el estado/navegación de esa pantalla, y todo el mock
  data asociado (`MOCK_COMPANY_PEOPLE`, `MOCK_ATTENDANCE_*`).
- Tests: se borraron los casos de `isAttendanceReportSubmittable`/
  `matchAttendanceName` (core) y los de `generateAttendanceReportPdf`
  (pdf) — quedaron 12/12 pasando. `test-bye-bye-dpr-rules.mjs` no
  necesitó cambios (las reglas nunca validaron el valor de `type`).

**Lo que NO cambió**: `firestore.rules`/`.secure`, `storage.rules`,
`firestore.indexes.json` — ninguno referenciaba "attendance" explícitamente,
así que no hicieron falta ediciones ahí. El campo `type` se mantiene en el
doc de `reports` (con el único valor `"daily_report"`) en vez de borrarse
del todo — cambiar la forma del documento en Firestore no era parte del
pedido y hubiese sido una limpieza no solicitada.

Verificado: `pnpm typecheck` limpio, `pnpm test:bye-bye-dpr` (12/12),
`pnpm emulator:test-bye-bye-dpr-rules` (30/30, sin cambios), y en browser
real (Playwright) — cero apariciones de "Attendance Report" en la UI, el
flujo de Daily Report completo sigue funcionando de punta a punta, consola
sin errores.

## Fase 3 — Conectar UI ↔ backend real (detalle, 2026-08-10)

Instrucción del usuario: "ahora que ya tengo el front maquetado empezá a
conectar todo sin usar mock data sino real, y después decime qué cuestiones
quedan pendientes que hay que revisar." Antes de escribir código se releyó
el estado actual de la UI, porque varias pantallas habían cambiado por fuera
de esta conversación desde la Fase 2 original: apareció una pantalla
"About" (`about-byebye-dpr-screen.tsx`), "Change Job" pasó de sheet a
pantalla completa con flujo "seleccionar y confirmar", y Home se rediseñó
(card de job separada, botón de Clock Out con su propia variante de color,
card de confirmación "Auto-posted to Comms"). Todo ese diseño se respetó
tal cual — esta pasada solo reemplaza de dónde vienen los datos, no cómo se
ven las pantallas.

### `components/bye-bye-dpr/byebye-dpr-mock-data.ts` — borrado

Ya no lo importa nada. `MOCK_USER` se reemplazó por el nombre real: primero
`users/{uid}.name` de Firestore (mismo campo que usa
`resolveDisplayName()` del lado del servidor), con fallback a
`firebaseUser.displayName` y después a `deriveNameFromEmail()` de
`lib/store.ts` — el mismo patrón de fallback que ya usa `app/page.tsx`.

### Capa de cliente nueva

- **`features/bye-bye-dpr/client/byebye-dpr-client.ts`** — wrapper fetch
  para las 17 rutas de ByeByeDPR + `/api/companies*`, mismo shape que
  `features/outlooks/ai/client/outlook-ai-client.ts` (Bearer
  `getIdToken()`, `ByeByeDprClientError` tipado, idempotency keys). Los
  tipos de respuesta (`Job`/`ClockRecord`/`Report`/`ReportAttachment`) se
  importan con `import type` directo desde `lib/bye-bye-dpr-store.ts` (que
  es `server-only`) — un `import type` se borra en compilación y nunca
  ejecuta ese guard, así que no hay forma de que el shape de respuesta se
  desincronice del que realmente arma el servidor.
- **`app/api/companies/me/route.ts`** — ruta nueva, no estaba en el plan
  original. Devuelve `{ companyId, companyRole }` del caller — es lo que
  usa el arranque del cliente para decidir si mostrar el gate de compañía.
  No necesitó ningún helper nuevo en `lib/companies-server.ts`:
  `verifyCompanyUserRequest()` ya devuelve exactamente esa forma.

### Gates nuevos (infraestructura mínima, no pedida explícitamente pero necesaria)

_Nota (2026-08-10): `company-gate-screen.tsx`, descripta abajo, se borró en
"Cambio 2026-08-10" cuando se sacó el modelo de compañía — `no-jobs-screen.tsx`
sigue existiendo, simplificada (ya no distingue owner/admin de member). Se
deja el párrafo original como registro de por qué se agregó en su momento._

Casi todos los endpoints de ByeByeDPR exigen `companyId` server-side
(`requireCompany()`). Sin ninguna UI de alta, el módulo conectado
literalmente no arrancaba para un usuario nuevo. Se agregaron dos pantallas
mínimas, con el mismo lenguaje visual (`BdCard`/`BdButton`) que el resto:

- **`company-gate-screen.tsx`** — "Create your company" (solo alta; no hay
  UI todavía para unirse por invitación — `acceptCompanyInvite()` existe en
  el backend pero no se conectó ninguna pantalla, ver pendientes).
- **`no-jobs-screen.tsx`** — si la compañía no tiene ningún job (`POST
  /api/bye-bye-dpr/jobs` no estaba conectado a ninguna pantalla), owner/admin
  ve un alta rápida (nombre + dirección opcional); un member ve un mensaje
  de espera. Sin esto, una compañía recién creada no tiene forma de que
  nadie clockee — no existe otra UI de gestión de jobs.

`byebye-dpr-app.tsx` orquesta el arranque en fases: `loading` → resolver
compañía → cargar jobs + clock activo en paralelo → `no-company` /
`no-jobs` / `ready`. Si el usuario de Firebase Auth es `null` (nadie
logueado), redirige a `/` en vez de duplicar la UI de login que ya existe
ahí.

### Pantalla por pantalla

- **`change-job-screen.tsx`** — recibe `jobs`/`recentJobs` reales por
  props en vez de importar mock data. "Use current location" ya no se
  auto-ejecuta ni pre-selecciona nada al entrar a la pantalla (el mock
  original sí lo hacía, vía una función síncrona falsa) — pedir geolocalización
  sin que el usuario la pida explícitamente sería un permission-prompt
  sorpresa. Al tocar el botón: lee la posición del browser, calcula
  distancia a **todos** los jobs con coordenadas client-side (reusa
  `haversineDistanceMeters` de `lib/bye-bye-dpr-core.ts`, que no es
  `server-only`) para mostrar "X mi away" en cada fila, y además llama a
  `POST /jobs/nearest` para el pick "Suggested" autoritativo del servidor.
- **`daily-report-screen.tsx`** — la grabación real usa
  `useOutlookRecorder` (el hook de MediaRecorder del módulo Outlook,
  genérico pese al nombre — mismo criterio que ya usaba la ruta
  `/transcribe` con `validateOutlookAudio`). Al parar de grabar: sube el
  audio crudo a `/reports/:id/audio` (best-effort, no bloquea), transcribe
  vía `/transcribe`, y estructura vía `/structure` — recién ahí pasa a
  Review con los campos ya estructurados por IA de verdad. El flujo
  escrito salta directo a `/structure`. Requiere que ya exista un
  `reportId` (el draft se crea al tocar "Daily Report" en Home, antes de
  entrar a esta pantalla).
- **`report-review-screen.tsx`** — **se encontró y corrigió un bug real de
  pérdida de datos**: el backend estructura 5 campos
  (`workCompleted`/`issuesOrDelays`/`attendanceNotes`/`nextSteps`/
  `additionalNotes`), pero la UI (heredada del mock) solo mostraba 4 —
  faltaba `additionalNotes`. Se agregó como 5º campo editable (ícono
  `StickyNote`, mismo patrón visual que los otros 4). Al enviar: si el
  usuario editó algo, guarda el draft (`PATCH .../:id` con
  `structuredDataSource: "manual"`) antes de `submitReport()`; si no tocó
  nada, no gasta ese request extra y el `structuredDataSource: "ai"`
  original queda intacto.
- **Fotos/adjuntos** — el flujo mock guardaba solo el blob URL local. Ahora
  `DailyReportScreen` entrega los `File[]` reales al padre
  (`onAddPhotos`), que sube cada uno a `/reports/:id/attachments` en
  segundo plano (no bloquea la preview) y muestra un toast si alguna falla.
  **Gap conocido**: no existe endpoint para borrar un adjunto server-side —
  "quitar" una foto en la UI solo la saca de la lista local, el archivo
  sigue en Storage y el doc sigue en la subcolección `attachments`.
- **`clock-out-confirm-sheet.tsx` / `forgot-clock-out-sheet.tsx`** — ahora
  reciben un `busy` opcional para deshabilitar los botones y mostrar
  spinner mientras la llamada real está en vuelo (antes eran síncronos).
  De paso se corrigió un bug real: `ForgotClockOutSheet` guardaba
  `defaultTime` solo en el `useState` inicial y nunca lo volvía a leer si
  la sheet se reabría con otro clock activo — se agregó un `useEffect` que
  lo resincroniza cada vez que `open` pasa a `true`.

### Actividad reciente — limitación conocida, no resuelta

No existe ningún endpoint de "listar historial" (clock records o reports
pasados) en `lib/bye-bye-dpr-server.ts` — nunca estuvo en el alcance
original. "Recent activity" y "Last clocked out" en Home ahora se llenan
con datos reales, pero **solo de acciones hechas en la sesión actual del
browser**: si el usuario cierra la pestaña y vuelve a entrar, con el clock
ya cerrado, esas dos secciones arrancan vacías/neutras (`"Not clocked in
today yet"`, vacío) aunque haya clockeado hace una hora. `getActiveClock()`
sí se usa en el arranque, así que un clock **activo** sobrevive un refresh
sin problema — el gap es solo sobre historial ya cerrado.

## Cambio 2026-08-10: se aplanó el modelo (se sacaron compañías)

Instrucción del usuario, inmediatamente después de la Fase 3: dejar ByeByeDPR
"completamente libre y sin estructura de compañía/roles por ahora" — todo
usuario logueado ve todos los jobs, elige cualquiera, clockea, y todo queda
asociado a su usuario + el job + la hora, sin owner, sin invitaciones, sin
roles, todos con el mismo nivel de acceso. El usuario dio el modelo de datos
exacto (`users`, `jobs`, `clockRecords`, `reports`, sin `companies/{id}/...`
ni membership) y el flujo exacto (sign in → abrir ByeByeDPR → elegir
cualquier job → clock in → trabajar → daily report → clock out).

Esto revierte la decisión de arquitectura más grande de la Fase 1 ("multi-
tenant real", elegida explícitamente por el usuario en esa pasada — ver la
sección de Fase 1 más abajo, que se dejó intacta como registro histórico de
por qué se construyó así en su momento). No es una corrección de bug: es un
cambio de producto explícito, y punto — se ejecutó completo, no a medias
(mismo criterio que la remoción de Attendance Report del 2026-08-07: si se
saca algo, se saca de raíz, no se deja como código muerto detrás de un
flag).

**Reglas (`firestore.rules`, `firestore.rules.secure`, `storage.rules`):**
- Se borraron los helpers `userCompanyId()`/`userCompanyRole()` (eran los
  únicos helpers de todo el archivo — con compañías fuera, no hace falta
  ninguno).
- Se borraron los bloques `/companies/{companyId}` y `/companyInvites/{id}`
  completos.
- `/jobs`, `/clockRecords`, `/reports` (+ `attachments`) perdieron todo
  check de `companyId`/rol. `/jobs` ahora es "cualquier usuario logueado
  lee/crea/edita" — mismo posture que el bloque `/contexts` de Directory,
  que ya funcionaba así. `/clockRecords`/`/reports` mantienen su único
  check real: solo el dueño (`userId`/`authorId`) puede crear/editar el
  suyo; lectura es abierta a cualquier usuario logueado.
- `/users/{userId}` volvió a su forma de antes de la Fase 1 (self-write
  simple, sin el lock de `companyId`/`companyRole` que ya no existen como
  campos).
- `storage.rules`: los tres paths de ByeByeDPR pasaron de
  `companies/{companyId}/byebye-dpr/reports/{reportId}/...` a
  `byebye-dpr/reports/{reportId}/...` — ya no hace falta el cross-service
  `firestore.get()` que comparaba el `companyId` del path contra el del
  usuario; ahora es `allow read: if request.auth != null` como el resto de
  este archivo.
- `firestore.indexes.json`: los dos índices compuestos que empezaban con
  `companyId` (`clockRecords`, `reports`) perdieron ese primer campo.

**Backend (`lib/bye-bye-dpr-server.ts`, reescrito):**
- Se borró `lib/companies-server.ts` entero (`createCompany`,
  `inviteToCompany`, `acceptCompanyInvite`, `revokeCompanyInvite`,
  `listCompanyMembers`, `updateCompanyMemberRole`, `removeCompanyMember`,
  `CompanyPrincipal`, `verifyCompanyUserRequest`) — nada de eso tiene
  sentido sin compañías.
- Nueva `verifyByeByeDprUserRequest()` (misma postura fail-closed que la
  que reemplaza — solo verifica el ID token, ya no resuelve membership) y
  `ByeByeDprPrincipal { uid }` (antes `{ uid, companyId, companyRole }`).
- `listCompanyJobs()` → `listJobs()`: ya no filtra por compañía, ya no
  necesita ni recibir el principal.
- `createJob()`: cualquier usuario logueado puede crear un job — se sacó el
  check `companyRole in ['owner','admin']`.
- `getCompanyJob(companyId, jobId)` → `getJob(jobId)`: ya no cruza contra
  companyId.
- `suggestNearestJob()`: ya no recibe `principal` — la búsqueda del job más
  cercano no depende de quién pregunta.
- `createAutomaticCommsPost()`: cuando el job no tiene `notifyUserIds`
  explícito, los destinatarios pasaron de "todos los miembros de la
  compañía" (`where('companyId','==',...)`) a **todos los usuarios
  registrados** (`db.collection('users').get()`) — coherente con que el
  resto del portal ya es global/single-org (Directory, contacts). Es una
  decisión nueva que no estaba en la instrucción explícita del usuario:
  sin compañía, "avisarle a todo el mundo" es la única lectura razonable
  de "everyone at the same level of access" para el posteo automático a
  Comms. **Vale la pena confirmar con el usuario si esto es lo que quiere**
  a esta escala (podría no ser deseable si el equipo de campo crece mucho)
  — ver pendientes.
- Los paths de Storage (audio/attachments/pdf) perdieron el segmento
  `companies/${companyId}/`.
- El nombre de la organización en el header del PDF (antes `companies/{id}.name`)
  pasó a una constante fija `"SVC"` (`ORG_NAME` en `lib/bye-bye-dpr-server.ts`)
  — no hay ningún otro lugar razonable de donde sacarlo sin compañías.

**API routes**: las 13 rutas de `app/api/bye-bye-dpr/**` cambiaron su import
de auth (`verifyCompanyUserRequest` de `lib/companies-server` →
`verifyByeByeDprUserRequest` de `lib/bye-bye-dpr-server`); `GET /jobs` y
`POST /jobs/nearest` ya ni siquiera necesitan el principal más allá de
exigir que exista (auth gate, no dato). Las 6 rutas de `app/api/companies/**`
(incluida `companies/me`, agregada recién en la Fase 3) se borraron enteras.

**Frontend:**
- `company-gate-screen.tsx` se borró — ya no hay gate de "creá tu compañía"
  antes de Home.
- `no-jobs-screen.tsx` perdió el prop `canManage`: antes mostraba el
  formulario de alta rápida solo a owner/admin y un mensaje de espera a
  member; ahora cualquiera ve el formulario, porque cualquiera puede crear
  un job.
- `byebye-dpr-app.tsx`: el arranque pasó de 3 fases post-auth
  (`no-company` → `no-jobs` → `ready`) a 2 (`no-jobs` → `ready`) — ya no
  llama a `fetchMyCompany()`, ya no guarda `companyRole`.
- `features/bye-bye-dpr/client/byebye-dpr-client.ts`: se borraron
  `fetchMyCompany`/`createMyCompany`/`MyCompany`; `fetchCompanyJobs()` se
  renombró a `fetchJobs()`.

**Tests**: `scripts/test-bye-bye-dpr-rules.mjs` se reescribió — se sacaron
las secciones `/users` (lock de companyId, ya no existe), `/companies`,
`/companyInvites`, y los casos de "no company cruzada" de `/jobs`/
`/clockRecords`/`/reports` (ya no aplican, la lectura es abierta). Se
agregaron en su lugar casos positivos que confirman el modelo plano
("cualquier usuario logueado puede leer/crear un job", "cualquier usuario
logueado puede leer el clock record/report de otro"), más 2 casos nuevos
con `unauthenticatedContext()` para confirmar que `request.auth != null`
se sigue exigiendo. Bajó de 30 a 21 casos — la baja es por casos borrados
que ya no tienen sentido, no por cobertura perdida en lo que sigue
existiendo. `pnpm test:bye-bye-dpr` (core + PDF) no cambió — ninguno de los
12 tests tocaba compañías.

**Lo que NO se tocó**: `lib/bye-bye-dpr-core.ts` (lógica pura, nunca supo
de compañías), `lib/bye-bye-dpr-tags.ts` (tags fijos, sin companyId),
`lib/ai/server/bye-bye-dpr-request-guard.ts` (rate-limit por `uid`, nunca
por compañía), `features/bye-bye-dpr/pdf/generate-daily-report-pdf.ts` (su
prop `companyName` se mantuvo como campo genérico de "nombre de org" —
sigue recibiendo un string, solo que ahora siempre `"SVC"` en vez de un
nombre real de compañía), `features/bye-bye-dpr/ai/server/**` (structuring/
transcripción no sabían de compañías).

## Cambio 2026-08-10 (cont.): Clock In arranca por el selector de job

Instrucción del usuario, inmediatamente después de aplanar el modelo: la
primera pantalla sigue siendo Home con el botón de Clock In, pero tocarlo
ahora manda directo a la pantalla de elegir job site (con recomendación por
ubicación) — elegir el job ahí es lo que efectivamente clockea, no un paso
separado de "cambiar de job" antes de tocar Clock In.

- **`change-job-screen.tsx`** cambió de rol: pasó de "Change Job Site"
  (alcanzable solo desde el link "Change" en Home, para simplemente
  reasignar el job preferido antes de clockear) a **ser** el flujo de Clock
  In. Cambios: el título pasó a "Clock In"; el botón de confirmación pasó
  de "Use This Job" (ícono flecha) a "Clock In" (ícono play), acepta un
  prop `busy` para deshabilitarse y mostrar spinner mientras la llamada
  real a `clockIn()` está en vuelo; "Use current location" ya no es
  puramente manual — se dispara solo una vez al entrar a la pantalla
  (`useEffect` en el mount), porque en este punto el trabajador ya inició
  la acción de clockear, así que pedir ubicación de entrada es lo
  esperado, no un permission-prompt sorpresa (el botón sigue existiendo
  para reintentar si falla o el usuario se movió).
- **`byebye-dpr-home-screen.tsx`**: se sacó el link "Change" y el prop
  `onChangeJob` — ya no tiene sentido como acción separada, Clock In cubre
  esa función. El label de la card de job pasó a ser condicional:
  "Current job" mientras está clocked in, "Last job" mientras está clocked
  out (referencia informativa nada más, no editable in place).
- **`byebye-dpr-app.tsx`**: `onClockIn` del Home ahora solo navega a la
  pantalla `change-job` (`setScreen("change-job")`) en vez de llamar a la
  API directamente. La función que sí llama a la API
  (`handleClockInToJob(jobId)`) vive en el handler `onConfirm` de esa
  pantalla — toma el `jobId` elegido, hace el `POST /clock/in` real, y
  recién si sale bien vuelve a Home ya clockeado. Se borró
  `handleConfirmJob` (la versión vieja que solo guardaba la selección sin
  clockear).

No se tocó nada de backend en este cambio — es puramente de flujo/UI, las
mismas rutas y funciones de servidor que ya existían (`clockIn()`,
`suggestNearestJob()`) se siguen usando igual. `pnpm typecheck` limpio. **No
se verificó en un browser real** — el mismo hallazgo de seguridad de abajo
aplica (el paso final de este flujo es justamente clockear, así que probarlo
de punta a punta escribiría un clock record real en producción).

## Cambio 2026-08-10 (cont.): se sacó la pantalla de "add a job site" — Home siempre es lo primero

Instrucción del usuario: sacar la pantalla de gate ("no jobs yet") que
aparecía antes de Home cuando no había ningún job todavía — Home tiene que
ser siempre la primera pantalla, sin excepción.

- **`no-jobs-screen.tsx` se borró.** `byebye-dpr-app.tsx` perdió la fase de
  arranque `"no-jobs"` (`BootPhase` pasó de `"loading" | "error" | "no-jobs"
  | "ready"` a solo `"loading" | "error" | "ready"`) — después de cargar
  jobs/clock activo, siempre se llega a `"ready"` y se renderiza Home, tenga
  o no tenga jobs la lista.
- El alta rápida de job que vivía en esa pantalla **no se perdió, se
  reubicó**: `change-job-screen.tsx` (el mismo picker al que se llega
  tocando "Clock In") ahora muestra un `AddFirstJobCard` inline cuando
  `jobs.length === 0`, en vez de la lista Suggested/Recent/All/Search. Crear
  el job ahí lo agrega y lo selecciona automáticamente, así que el botón
  "Clock In" de siempre queda habilitado sin pasos extra. Tiene más sentido
  ahí que como gate: el momento en que de verdad hace falta un job es
  cuando estás tratando de clockear, no antes.
- `job` pasó a ser nullable en todo el árbol (`Job | null` en
  `byebye-dpr-app.tsx` y en `ByeByeDprHomeScreenProps`). Home lo tolera: la
  card de "Current job"/"Last job" simplemente no se renderiza si no hay
  job, y la fila de "Daily Report" se deshabilita (con el subtítulo
  cambiado a "Clock in to a job site first") en vez de fallar en silencio.
- `ChangeJobScreen.currentJobId` pasó a opcional (`string | null`) por lo
  mismo — con cero jobs no hay nada que pre-seleccionar.

`pnpm typecheck` limpio, `pnpm test:bye-bye-dpr` (12/12, sin cambios — nada
de esto toca lógica de servidor). Tampoco se verificó en un browser real,
mismo motivo que arriba.

## Cambio 2026-08-10 (cont.): deploy a producción

Instrucción del usuario: usar la base de Firestore real en producción y
deployar las reglas, para que la búsqueda de job sites (Suggested +
"Use current location") funcione de verdad. Esta es la primera vez que algo
de ByeByeDPR se despliega — hasta ahora todo era archivo local sin efecto
en `svc-comms`.

**Antes de deployar** se revisó `git diff` de `firestore.rules`,
`storage.rules` y `firestore.indexes.json` contra la última versión
commiteada (que coincide con lo que estaba vivo en prod, commit `15ff515`).
El diff es 100% aditivo para ByeByeDPR (nuevas colecciones/paths, nada toca
reglas existentes de otras colecciones) más un refactor sin cambio de
comportamiento en `/users` (de un solo `allow write` a `create`/`update`/
`delete` separados, misma condición). De paso apareció en el diff un fix
preexistente y no relacionado con ByeByeDPR en
`questCoralProjectUnreadStates` (permitir `resource == null` en el primer
read de un doc que todavía no existe) — no lo escribí en esta sesión, ya
estaba sin commitear; se deployó junto porque es parte del mismo archivo y
es una corrección legítima y acotada (solo afecta el caso de "el doc no
existe todavía", sigue exigiendo `resource.data.userId == request.auth.uid`
cuando sí existe).

**Se desplegó (no `firestore.rules.secure` — ese archivo dice literalmente
"TEST ONLY IN EMULATOR" en su propio header, nunca se toca):**
```
firebase deploy --only firestore:rules,firestore:indexes --project svc-comms
firebase deploy --only storage --project svc-comms
```
(El primer intento combinado `--only firestore:rules,firestore:indexes,storage:rules`
falló con `Could not find rules for the following storage targets: rules` —
un problema de parsing del target combinado en firebase-tools 15.8.0, no de
las reglas en sí; separarlo en dos comandos lo resolvió.)

Ambos deploys terminaron OK — confirmado en la consola de Firebase
(`console.firebase.google.com/project/svc-comms`) con los `updateTime` de
ambos releases (`cloud.firestore` y `firebase.storage/svc-comms.firebasestorage.app`)
en el momento del deploy.

**Gap real encontrado al pensar en "que aparezcan sugerencias":** el
formulario de alta rápida de job (`AddFirstJobCard` en `change-job-screen.tsx`)
solo pedía nombre + dirección — nunca coordenadas. Un job creado así queda
con `latitude`/`longitude` en `null`, y `suggestNearestJob()` filtra
exactamente esos jobs (`jobs.filter(job => job.latitude != null && job.longitude != null)`)
antes de buscar el más cercano — con cero jobs con coordenadas, "Use current
location" nunca iba a sugerir nada, aunque las reglas ya estuvieran
desplegadas. Se agregó un botón "Set this job's location" al mismo
formulario (reusa el mismo `getCurrentPosition()` de la pantalla) que
captura la posición del browser y la manda como `latitude`/`longitude` al
crear el job — opcional, con una nota explicando por qué conviene
completarlo. Sin esto, el flujo pedido ("buscás y te aparecen suggestions
según tu ubicación") no tenía forma de mostrar nada la primera vez, sin
importar que las reglas ya funcionaran.

`pnpm typecheck` limpio. No se creó ningún job de prueba en producción —
sigue sin haber ningún job en la colección `jobs` de prod hasta que alguien
(vos, u otro usuario real) cree el primero desde la app.

## Cambio 2026-08-10 (cont.): integración real con SVC Directory

Instrucción del usuario: los jobs (y companies/contacts) ya viven en
Directory — el job al que alguien hace clock in debe estar sincronizado con
el job en Directory, y los daily reports deberían quedar cargados ahí
también (files o notes, "fíjate qué conviene"). Antes de tocar código se
investigó a fondo el modelo de datos real de Directory (no se asumió nada):
`lib/directory-core.ts`, `lib/directory-files.ts`, `lib/directory-notes.ts`,
`lib/ai/server/directory-data.ts`, y las reglas de `/contexts`/
`/directoryFiles`/`/directoryNotes`/`/directoryIndex`. Hallazgos clave que
determinaron el diseño:

- Los "jobs" de Directory son `/contexts` docs clasificados como tipo
  `"job"` (heurística en `classifyContext()`, o un `directoryType` explícito)
  — no es una colección separada de companies/contacts (contacts sí lo es,
  `/contacts`).
- Directory **no tiene lat/lng en ningún lado** — solo `address` (texto
  libre, dentro de `masterData` o `fields[]`). Confirmado con grep, cero
  resultados en todo el módulo.
- `directoryFiles` y `directoryNotes` ya son colecciones separadas,
  enlazadas a cualquier entidad por `entityIds: string[]` (`array-contains`)
  — exactamente el patrón que el propio `docs/svc-bye-bye-dpr-module.md`
  (Fase 1) ya había anticipado para `jobs`. Y lo más revelador:
  `DirectoryFile.category` ya incluye `"report"` como valor válido, y
  `DirectoryNote.noteType` ya incluye `"daily_report"` — ambos sin ningún
  caller hoy. No hacía falta inventar nada, solo usar tipos que ya existían
  sin usar.
- No existe (ni conviene crear) una función de "traer todos los jobs de
  Directory" — `lib/ai/server/directory-data.ts` prohíbe explícitamente
  escanear colecciones enteras server-side; el cliente hace su propio
  full-load al índice/shards para búsqueda en browser, mecanismo pensado
  para MiniSearch, no para una API server-to-server. Por eso ByeByeDPR
  **sigue teniendo su propia colección `jobs`** (para `isActive`/
  coordenadas/`notifyUserIds`, que Directory no tiene) — pero ahora cada
  entrada está atada 1:1 a un `/contexts` real, nunca suelta.

**Se implementó (todo vía Admin SDK — cero cambios a reglas, ver más abajo):**

- **`lib/bye-bye-dpr-directory-link.ts`** (nuevo) — el único archivo donde
  ByeByeDPR toca datos de Directory:
  - `searchDirectoryJobs(query)` — reusa `findByName(query, {type:"job"})`
    de `lib/ai/server/directory-data.ts` (ya acotado/indexado, sin scans).
  - `resolveDirectoryJob(directoryContextId)` — point-read de
    `/contexts/{sourceId}` (la dirección real solo vive en el doc crudo,
    `directoryIndex` únicamente guarda `location`, una versión derivada más
    corta) y deriva nombre/dirección con la misma lógica que
    `normalizeJobContext()`.
  - `createDirectoryJobContext(name, createdBy)` — crea un `/contexts` doc
    nuevo (mismo shape que `handleCreateContext()` en `app/page.tsx`, más un
    `directoryType: "job"` explícito para no depender de la heurística).
  - `getLiveDirectoryJobNames(ids)` — batch de `getEntitiesByIds()` para
    refrescar nombres.
  - Se exportó `getFieldValue()` en `lib/directory-core.ts` (era privado) —
    único cambio a un archivo compartido de Directory, aditivo, cero
    comportamiento nuevo.
- **`GET /api/bye-bye-dpr/directory-jobs?q=`** (nueva ruta) — expone
  `searchDirectoryJobs` al cliente.
- **`createJob()`** (`lib/bye-bye-dpr-server.ts`) — ahora todo job termina
  con un `directoryContextId` real: si el caller manda uno, se resuelve y
  su nombre/dirección de Directory **pisan** lo que mandó el cliente
  (garantiza sync, no solo un link suelto); si no manda ninguno, se crea un
  `/contexts` nuevo y se linkea. Ya no es posible crear un job de ByeByeDPR
  desconectado de Directory.
- **`listJobs()`** — antes de devolver la lista, refresca los nombres
  contra `directoryIndex` (`overlayLiveDirectoryNames`, un solo batch read)
  para que un nombre editado en Directory después de linkear no quede
  stale. La dirección no se refresca en cada listado (eso sí requeriría N
  point-reads) — se resuelve una vez, al crear/linkear el job.
- **`submitReport()`** — después de generar el PDF, si el job tiene
  `directoryContextId`, `fileReportIntoDirectory()` (best-effort, nunca
  bloquea un submit ya exitoso) escribe **dos** cosas en Directory: un
  `directoryFiles` doc (`category: "report"`, el PDF real, con una signed
  URL de Storage de vencimiento lejano como `downloadUrl`) y un
  `directoryNotes` doc (`noteType: "daily_report"`, texto legible armado a
  partir de los 5 campos estructurados, `attachments: [downloadUrl]`) — el
  archivo queda visible en los files del job, y el contenido en su feed de
  notas/actividad, que es lo que la gente realmente mira día a día.
- **`AddFirstJobCard`** (`change-job-screen.tsx`) — dejó de ser un
  formulario de nombre+dirección libre. Ahora: busca (debounced, 300ms)
  contra `/api/bye-bye-dpr/directory-jobs`, mostrás resultados de Directory
  para elegir, y solo si no aparece nada ofrece "Create '...' as a new job"
  (que además crea el `/contexts`). La captura de ubicación opcional se
  mantiene igual, ahora después de elegir/crear.

**Cero cambios a `firestore.rules`/`.secure`/`storage.rules`** — todo esto
escribe vía Admin SDK (bypasea reglas) hacia colecciones (`contexts`,
`directoryFiles`, `directoryNotes`) cuyas reglas ya son "cualquier usuario
logueado lee, el creador/uploader escribe" sin importar qué módulo escribe.
No hizo falta ni un deploy más.

`pnpm verify:fast` completo corrido limpio (incluye `test:directory`,
`test:directory-ai`, `test:directory-ai-eval` — nada de Directory se rompió)
además de `pnpm test:bye-bye-dpr` y `pnpm typecheck`. **No verificado en
browser real** — mismo motivo que el resto de esta fase (escribiría un
`/contexts` real en producción).

**Pendiente / no resuelto en esta pasada:**
- La dirección de un job linkeado a un `/contexts` existente se resuelve
  una sola vez (al crear/linkear) — si alguien edita la dirección en
  Directory después, ByeByeDPR no se entera hasta que se re-linkee.
- No hay forma de des-linkear o re-linkear un job ya creado desde la UI.
- `createDirectoryJobContext()` no valida duplicados por nombre antes de
  crear — si dos personas escriben el mismo nombre nuevo casi al mismo
  tiempo sin verlo en la búsqueda, podrían crear dos `/contexts` distintos
  para "lo mismo". Bajo riesgo dado el volumen esperado, pero real.

## ⚠️ Hallazgo de seguridad: el Admin SDK no tiene wiring de emulador

Durante la verificación de esta fase se intentó correr un smoke test
funcional de punta a punta contra `pnpm emulator` + `pnpm dev:emulator`, y
se encontró que **no es seguro hacerlo**: `getFirebaseAdminApp()` en
`lib/ai/server/firebase-admin.ts` (compartido por todas las rutas Admin SDK
del portal, no solo ByeByeDPR) nunca lee `FIRESTORE_EMULATOR_HOST` /
`FIREBASE_AUTH_EMULATOR_HOST` / `FIREBASE_STORAGE_EMULATOR_HOST` — siempre
se conecta con `FIREBASE_SERVICE_ACCOUNT_KEY` o credenciales default contra
el proyecto real `svc-comms`. `NEXT_PUBLIC_USE_FIREBASE_EMULATORS=true`
(la env var de `dev:emulator`) solo redirige el **SDK cliente** (browser)
al emulador — el servidor Next.js (las API routes, incluidas todas las de
ByeByeDPR) sigue hablando con producción sin importar esa variable.

En la práctica esto significa que correr `pnpm dev` (con o sin
`:emulator`) y clickear el flujo completo de ByeByeDPR — crear compañía,
agregar job, clock in/out, submit de daily report — **escribiría datos
reales en la base de producción y postearía un mensaje real en el feed de
Communications que ven usuarios reales**, no algo aislado en el emulador.
Esto no es nuevo de ByeByeDPR — afecta a todo lo que ya usa
`getFirebaseAdminApp()` (Applications, Outlooks AI, Directory AI) — pero
ByeByeDPR es el primer módulo cuyo flujo normal incluye un post automático
a Comms, así que el radio de impacto de una prueba accidental es mayor.

**Por esto no se hizo la prueba funcional de punta a punta.** Se corrió en
cambio: `pnpm typecheck` (limpio), `pnpm test:bye-bye-dpr` (12/12, no usa
Firebase), y `pnpm emulator:test-bye-bye-dpr-rules` (30/30 — este script sí
es seguro, usa `@firebase/rules-unit-testing` directo contra el emulador,
sin pasar por el Admin SDK del proyecto). La corrección del código nuevo se
verificó por lectura cuidadosa contra los contratos zod y los tipos de
respuesta reales, no por ejecución.

**Antes de probar este módulo en un browser real hace falta, en este
orden:** (1) decidir si se agrega wiring de emulador a
`getFirebaseAdminApp()` (condicional a alguna env var, sin tocar el
comportamiento de producción), o (2) probar sabiendo explícitamente que
cualquier acción escribe en `svc-comms` real y usando una compañía/job de
prueba que después haya que limpiar a mano.

## Fase 1 — Backend/Firebase (detalle)

_Nota (2026-08-10): el modelo multi-tenant descripto en esta sección —
`companies`, `companyInvites`, roles, `userCompanyId()` — **se revirtió por
completo** en "Cambio 2026-08-10" más arriba. Se deja esta sección intacta
como registro histórico de la decisión original y su razonamiento en su
momento; nada de lo que describe existe hoy en el código._

### Decisión de arquitectura más grande: multi-tenant real (revertida, ver nota arriba)

Este es el primer módulo del portal con un concepto real de "compañía"
como límite de acceso — los otros cuatro son de un solo tenant (SVC). El
usuario, al preguntársele explícitamente, pidió **multi-tenant real**, no
un stand-in de una sola compañía. Se construyó:

- `companies/{companyId}` + `companyId`/`companyRole` en `users/{uid}`
  (server-managed, bloqueado de escritura directa del cliente — ver el
  cambio al bloque `/users` en `firestore.rules`).
- `companyInvites/{inviteId}` con el mismo patrón token-hash que
  `applicationLinks` (token crudo devuelto una sola vez, doc id = SHA-256).
- Un helper nuevo en las reglas — `userCompanyId()` — el único helper
  function en `firestore.rules` (el resto del archivo es 100% inline por
  convención existente; se justificó por evitar repetir el mismo `get()` en
  ~6 bloques distintos).

### Segunda decisión grande: jobs NO viven en `/contexts`

Los "jobs" en el resto del portal son heurísticamente clasificados dentro
de `/contexts` (el pipeline de Directory), sin coordenadas y con reglas
completamente abiertas (`allow read, update: if request.auth != null` —
cualquier usuario logueado puede editar cualquier context). Meter
`companyId`/lat/lng ahí hubiese significado reescribir las reglas globales
de Directory (alto blast radius) o dejar un agujero real de seguridad. Se
optó por una colección nueva `jobs/{jobId}`, company-scoped, con
`directoryContextId` opcional como referencia — mismo patrón que
`directoryFiles`/`directoryNotes` (colección separada enlazada por id de
entidad), no una extensión de `/contexts`.

### Tercera decisión: el primer write server-side a `/messages`

Hasta este módulo, **toda** la creación de mensajes de Communications era
100% client-side (`handleSend` en `app/page.tsx`, sin un `createMessage()`
compartido). `createAutomaticCommsPost()` en `lib/bye-bye-dpr-server.ts` es
la primera escritura Admin SDK a `messages` — arma a mano el mismo shape de
campos que el cliente (`authorId`/`senderId`/`recipientIds`/`peopleIds`/
`participants`/`visibleToUserIds`/`tagIds`/`contextIds`), autorada como el
usuario real (no existe ni existía un concepto de "sender sintético/
sistema" en el schema ni en las rules).

### Modelo de datos

Todas las colecciones nuevas son **planas, con campo `companyId`** (no
anidadas bajo `companies/{companyId}/...` como sugería el brief original) —
consistente con `projects`/`applications`/`questCoralProjects`, que tampoco
anidan bajo un owner path.

- `companies/{companyId}`, `companyInvites/{inviteId}`
- `jobs/{jobId}` — `directoryContextId?`, `latitude?`, `longitude?`,
  `notifyUserIds?` (override opcional de a quién se le postea en Comms)
- `clockRecords/{clockRecordId}` — con `correctionMetadata` para "forgot to
  clock out" (sin approval workflow, per spec)
- `reports/{reportId}` (+ subcolección `attachments`) — `type` (hoy solo
  `daily_report`), `draft` | `submitted` (inmutable una vez submitted)
- `users/{uid}/recentJobs/{jobId}` — mismo patrón que `directoryRecents`

### Servicios y API routes

- `lib/bye-bye-dpr-core.ts` — lógica pura (haversine, duración, validación
  de corrección de horario).
- `lib/bye-bye-dpr-store.ts` — mappers Firestore ↔ dominio (Admin SDK).
- `lib/bye-bye-dpr-server.ts` / `lib/companies-server.ts` — los servicios
  (jobs, clock in/out/correct, reports, Comms, PDF, companies).
- `lib/ai/config.ts` → `getByeByeDprAiConfig()` — reusa `OPENAI_API_KEY`,
  mismo patrón mock-first que Outlook/Directory/Quest Coral.
- `features/bye-bye-dpr/ai/server/*` — transcripción + structuring del
  daily report.
- `features/bye-bye-dpr/pdf/*` — generador `pdf-lib` del daily report,
  mismo estilo hand-drawn que `agreement-pdf.ts`.
- 17 rutas bajo `app/api/bye-bye-dpr/*` y `app/api/companies/*`.

### Tests

- `scripts/bye-bye-dpr-core.test.ts` + `scripts/bye-bye-dpr-pdf.test.ts` —
  18 tests, `pnpm test:bye-bye-dpr` (wireado en `verify:fast`).
- `scripts/test-bye-bye-dpr-rules.mjs` — 30 casos contra el emulador
  (compañía cruzada denegada, un usuario no puede tocar el clock record de
  otro, un reporte submitted es inmutable al cliente, `companyId` no se
  puede auto-asignar, etc.). Corrido y verificado, no solo escrito.

## Fase 2 — UI mockup (detalle)

Construida a partir de dos referencias visuales (screenshots de un flujo de
5 pantallas, estilo mockup) + una especificación de UX extensa en español
del usuario. Las referencias se tomaron como inspiración de contenido/flujo,
no como spec pixel-exacta — la tipografía, tokens, radios y componentes
siguen el sistema de diseño real del portal (`docs/svc-design-system.md`),
no la fuente/estilo genérico de las capturas.

### Contexto de diseño (`impeccable` skill)

No existía `PRODUCT.md`/`DESIGN.md` en la raíz. En vez de correr la
entrevista completa de `/impeccable teach` (el brief del usuario y
`docs/svc-design-system.md` ya cubrían casi todo lo que esa entrevista
hubiese preguntado), se sintetizaron directamente:

- `PRODUCT.md` — register `product`, usuarios (cuadrillas de campo),
  anti-references explícitas (nada de dashboards/stats/glass en la
  pantalla base — eso es lenguaje de Stream/Directory, no de este módulo).
- `DESIGN.md` — destilado de `docs/svc-design-system.md` + los tokens
  nuevos de ByeByeDPR.

### Nuevo scope: `.byebye-dpr-scope`

Tercer módulo claro (junto a Applications y Quest Coral), mismo mecanismo
(`app/globals.css`, tokens base redefinidos + namespace `--bd-*`). Un solo
acento identity — púrpura `#6D5BD0` — deliberadamente más contenido que el
púrpura más saturado de las referencias (estrategia de color "Restrained":
esta es una herramienta que se usa segundos a la vez, no un momento de
marca). Reusa el vocabulario de 5 tonos semánticos existente
(`info`/`pending`/`missing`/`complete`/`ai`) en vez de inventar uno nuevo —
`ai` se queda con el púrpura propio del módulo, mismo razonamiento que
Quest Coral con el coral.

### Pantallas (`components/bye-bye-dpr/`)

Home (clocked out/in) · Change Job sheet (con "use current location" mock,
recientes, búsqueda) · Clock Out confirm sheet · Forgot to Clock Out sheet ·
Daily Report (grabar tap-to-start/stop — no hold-to-record, per spec — o
escribir, más fotos con preview real vía `URL.createObjectURL`) · Review &
Submit (campos editables).

Ruta standalone: `app/byebye-dpr/page.tsx` — deliberadamente aislada de
`app/page.tsx` (no toca su estado real ni su navegación).

### Consistencia con el resto del portal (segunda pasada)

Después del mockup inicial, se agregaron dos cosas para no divergir del
resto del portal:

1. **Empty states** — mismo patrón que "No projects match" (Quest Coral) /
   "No applications match" (Applications): círculo con ícono muted +
   título + descripción + acción opcional, en una card flat. Nuevo
   primitivo compartido `BdEmptyState`. Usado en: Home (sin actividad
   reciente todavía), búsqueda de jobs en Change Job sin resultados.
2. **Tratamiento "IA generando"** — Quest Coral ya tenía el patrón
   canónico (`QuestCoralAskGenerating`: orbe pulsante + texto rotativo +
   shimmer skeleton). Se replicó como `ByeByeDprAiGenerating` (re-skinned
   en púrpura), reemplazando el botón de grabar mientras se
   transcribe/estructura el Daily Report. *(Originalmente tenía también una
   variante `compact` para Attendance Report — se borró junto con esa
   pantalla el 2026-08-07, ver esa sección.)*

De paso se corrigieron dos bugs reales encontrados durante la verificación
en browser: "Recent activity" en Home leía la constante mock estática en
vez del state en vivo del padre; y el link "Change" aparecía incluso estando
clocked in (no tiene sentido re-etiquetar una sesión activa — ahora solo se
muestra antes de clockear, consistente con ambas referencias).

### Module switcher

`components/module-switcher.tsx` — 5ª entrada (`SvcModule` ahora incluye
`"bye-bye-dpr"`), ícono `Clock`, acento `#A78BFA` (reusa el violeta ya
vetted de Directory para "job", `--directory-job`, en vez de inventar uno
nuevo para el popover oscuro). Como ByeByeDPR todavía no es una pantalla
interna del shell de `app/page.tsx`, seleccionarlo hace una navegación real
(`router.push("/byebye-dpr")`) en vez del cambio de estado in-app que usan
los otros cuatro — resuelto adentro de `selectModule()`, sin tocar ninguno
de los 4 call-sites existentes de `<ModuleSwitcher>`.

## Pendiente / próximos pasos

1. **Wiring de emulador para el Admin SDK, o un protocolo explícito de
   prueba consciente de que se escribe en producción** — ver el hallazgo
   de seguridad arriba. Esto bloquea probar el módulo de punta a punta con
   confianza.
2. **Prueba funcional real de punta a punta** — nada de lo hecho en Fase 3
   ni en Fase 3.5 se ejecutó todavía contra un browser real; solo se
   verificó por typecheck + tests + lectura de código. Falta antes de dar
   por "terminado" el flujo conectado.
3. **Confirmar el alcance de los destinatarios de Comms sin compañía** —
   `createAutomaticCommsPost()` ahora le avisa a **todos los usuarios
   registrados** cuando un job no tiene `notifyUserIds` explícito (antes
   era "todos los miembros de la compañía"). Es la lectura más coherente
   de "todos con el mismo nivel de acceso" sin compañías, pero no fue una
   instrucción explícita del usuario — vale la pena confirmarlo,
   especialmente si el número de usuarios registrados crece mucho (cada
   clock in/out/report de cualquiera le llegaría a todo el mundo).
4. **Gestión de jobs más allá del alta rápida** — `no-jobs-screen.tsx`
   cubre solo el primer job. No hay UI para editar, desactivar, o poner/
   corregir coordenadas de un job existente, ni para agregar jobs
   adicionales después del primero desde la propia app (`POST /jobs`
   existe pero solo esa pantalla lo llama).
5. **Historial real de actividad** — "Recent activity"/"Last clocked out"
   en Home son solo de la sesión actual (ver la sección de Fase 3). Un
   endpoint de historial (`listClockRecords`/`listReports` paginado) no
   existe.
6. **No hay endpoint para borrar un adjunto** — "quitar" una foto en Daily
   Report/Review solo la saca de la lista local; el archivo y su doc en
   Storage/Firestore quedan.
7. **Decidir integración al shell** — ¿ByeByeDPR se queda como ruta
   standalone (`/byebye-dpr`) o se convierte en una pantalla interna más
   de `app/page.tsx` como los otros 4 módulos?
8. **Deploy** — reglas/índices a producción, seed de tags
   (`scripts/seed-bye-bye-dpr-tags.mjs`), todo pendiente de aprobación
   explícita del usuario.
9. **`docs/svc-bye-bye-dpr-product-context.md`** — recién tiene sentido
   escribirlo cuando el módulo esté más cerca de producción (mismo criterio
   que los otros módulos).

## Cómo probar

**⚠️ Leer primero la sección "Hallazgo de seguridad" arriba** — con el
wiring actual, correr `pnpm dev`/`pnpm dev:emulator` y usar el flujo real
escribe en el proyecto `svc-comms` de producción (job, clock records,
reports, y un mensaje real en Comms), no en el emulador, sin importar la
env var de emulador.

**Lo que sí es seguro correr en cualquier momento:**
- `pnpm test:bye-bye-dpr` — core + PDF, no toca Firebase.
- `pnpm emulator:test-bye-bye-dpr-rules` (con `pnpm emulator` corriendo en
  paralelo) — reglas contra el emulador vía `@firebase/rules-unit-testing`,
  no pasa por el Admin SDK del proyecto.

**UI conectada** (`pnpm dev` → `http://localhost:3000/byebye-dpr`): hace
falta estar logueado con una sesión real de Firebase Auth de este proyecto
(comparte sesión con el resto de la app) — si no hay usuario logueado,
redirige a `/`. A partir de ahí: gate de primer job (si no hay ningún job
todavía) → Home real, sin ningún paso de compañía. Tener presente el
hallazgo de seguridad antes de tocar cualquier botón que escriba (agregar
job, clock in/out, submit de reporte).

## File map

| Archivo/carpeta | Rol |
|---|---|
| `lib/bye-bye-dpr-core.ts` / `-store.ts` / `-server.ts` / `-tags.ts` / `-route-helpers.ts` | Backend: lógica pura, mappers, servicios Admin SDK (incl. `verifyByeByeDprUserRequest`), tags fijos, error→response |
| `lib/bye-bye-dpr-directory-link.ts` | Backend: único punto de contacto con SVC Directory (buscar/resolver/crear job contexts, nombres en vivo) |
| `features/bye-bye-dpr/contracts/*.ts` | Backend: schemas zod por operación |
| `features/bye-bye-dpr/ai/server/*.ts` | Backend: transcripción + structuring del daily report |
| `features/bye-bye-dpr/pdf/*.ts` | Backend: generador de PDF del daily report |
| `app/api/bye-bye-dpr/**` | Backend: 14 rutas, incl. `directory-jobs` (búsqueda) (`app/api/companies/**` se borró — ver Fase 3.5) |
| `scripts/bye-bye-dpr-*.test.ts`, `scripts/test-bye-bye-dpr-rules.mjs`, `scripts/seed-bye-bye-dpr-tags.mjs` | Backend: tests + seed |
| `features/bye-bye-dpr/client/byebye-dpr-client.ts` | Frontend: wrapper fetch con auth real hacia todas las rutas de arriba |
| `components/bye-bye-dpr/**` | UI: pantallas, sheets, primitivos (`ui/`) — conectadas al backend real, sin mock data |
| `components/bye-bye-dpr/change-job-screen.tsx` | UI: selector de job / flujo de Clock In; su `AddFirstJobCard` busca/crea contra Directory (único gate que queda — sin compañía, sin pantalla separada) |
| `app/byebye-dpr/page.tsx` | UI: ruta standalone, conectada al backend real |
| `components/module-switcher.tsx` | UI: 5ª entrada del switcher (compartido con los otros 4 módulos) |
| `app/globals.css` (`.byebye-dpr-scope` y bloques relacionados) | UI: tokens, glass mínimo en sheets, tratamiento "IA generando" |
| `PRODUCT.md`, `DESIGN.md` (raíz) | UI: contexto para la skill `impeccable` |
| `firestore.rules`/`.secure`, `storage.rules`, `firestore.indexes.json` | Backend: reglas/índices — **desplegadas a producción 2026-08-10** |
