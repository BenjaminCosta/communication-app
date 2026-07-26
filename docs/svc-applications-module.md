# SVC Applications — contexto del módulo y plan de backend

Última actualización: 2026-07-25

> **Estado (2026-07-25):** Funcional de punta a punta. Reglas de Firestore +
> Storage + índices **DEPLOYADAS a producción** (`svc-comms`). **Data falsa
> eliminada** — Firestore arranca vacío; el pipeline se llena con invites y
> aplicaciones reales. Documentos y video **se suben a Storage de verdad**; la
> firma del acuerdo es **funcional** (sella un PDF server-side, guarda evidencia
> con hashes, cambia el estado con Admin SDK). Todo detrás de
> `NEXT_PUBLIC_APPLICATIONS_BACKEND`. **Falta sólo el paso de Vercel** (deploy
> del código + 2 env vars) para que el sitio vivo lo use — ver "Estado en
> producción".

## Estado en producción (2026-07-25)

**Deployado a producción (Firebase, en vivo):**
- `firestore:indexes` — 4 índices compuestos de `applications`.
- `firestore:rules` — bloques `/applications`, `/applicationLinks`,
  `/applicationAgreements`. **No toca las reglas existentes.**
- `storage` (`storage.rules`) — `application-uploads/{id}/documents|video`
  (candidato escribe por claim, staff lee) y `application-agreements/{id}`
  (server-only write, staff read).
- **Data falsa eliminada** (`pnpm seed:applications:teardown:prod`). Firestore
  arranca vacío; se llena con invites reales.

**Funcional de punta a punta:**
- **Subida real de archivos**: documentos (imagen/PDF, comprimidos) con
  `uploadBytes`; video con `uploadBytesResumable` + barra de progreso + reintento.
  Se guarda `storagePath` + `downloadUrl` en el doc. El revisor abre el documento
  ("View") y reproduce el video (`<video>`) en el detalle.
- **Firma funcional**: el candidato firma en canvas → `POST /api/applications/
  agreement/sign` verifica su ID token, sella un PDF con `pdf-lib` (texto +
  firma embebida + fecha), lo sube a Storage, guarda `/applicationAgreements`
  con `bodyHash` (SHA-256 del texto exacto) + `signedPdfHash`, y cambia
  `agreement.status=signed` + `status=payroll_in_progress` con Admin SDK (en
  transacción). El cliente **nunca** escribe ese estado — las reglas lo prohíben.
- **Post-aprobación funcional**: `POST /api/applications/approve` verifica el
  token del revisor y, en una sola transacción Admin SDK, marca `approved`,
  desbloquea el acuerdo y deja el evento de auditoría. El dashboard crea el
  link de acuerdo de 72 h y abre un bottom sheet con Share, SMS, copiar mensaje
  y copiar link. También se auditan link generado/abierto, mensaje compartido o
  copiado y acuerdo firmado.
- **Invite usable**: "Invite a candidate" pide nombre + trade + job, crea la
  aplicación real y su link persistido (`/applicationLinks`). Ya no es un draft
  en blanco.

**Falta SÓLO el paso de Vercel (no tengo CLI acá, es tuyo):**
1. **Deployar el código a Vercel** (commit + push a la branch que auto-deploya).
   Incluye `/api/applications/session`, `/api/applications/approve`,
   `/api/applications/agreement/sign` y los
   componentes en modo live.
2. **`NEXT_PUBLIC_APPLICATIONS_BACKEND=true`** — build-time, antes del build.
3. **`FIREBASE_SERVICE_ACCOUNT_KEY`** — obligatoria para la sesión del candidato,
   aprobar/desbloquear el acuerdo y sellar la firma (todos usan Admin SDK).
   Verificá que esté seteada.
4. Redeploy en Vercel.

**Cómo verificar una vez encendido:** SVC Applications → "Invite a candidate" →
completá nombre/trade → se crea el link → abrilo en incógnito → llená el form,
subí un documento y un video (se suben de verdad), enviá. Volvé al dashboard,
abrí el candidato, mirá el documento/video. Aprobalo → mandale el link del
acuerdo → firmá desde el teléfono → el PDF sellado queda en Storage.

## Propósito

`Applications` es el tercer módulo del portal SVC, junto a Communications y
Directory. Cubre dos experiencias distintas sobre el mismo dato:

- **Candidate flow** — el obrero abre un link seguro y completa su aplicación
  (datos generales → video de presentación → documentos → revisión → enviado).
- **Internal dashboard** — el equipo de SVC revisa, pide información, aprueba o
  archiva.

El objetivo de la etapa actual fue únicamente la UI, la navegación y el estado
local. Todo lo que toca red está deliberadamente mockeado detrás de funciones
chicas, para que conectarlo sea reemplazar implementaciones, no reescribir
pantallas.

---

# Parte 1 — Estado actual

## Resumen ejecutivo

Hoy funciona, end-to-end y sin red:

- entrar al módulo desde el switcher (Communications / Directory / Applications);
- abrir el flujo del candidato por link (`?apply=<token>`) **sin estar logueado**;
- completar los 4 pasos con autosave simulado, validación y "continuar donde
  quedó" (el link reabre en el primer ítem faltante);
- grabar/subir video y subir documentos (mock: sólo se guarda el nombre del archivo);
- revisar y enviar, con bloqueo si falta algo obligatorio;
- listar candidatos con búsqueda, filtros (status / job / trade), orden y contadores;
- abrir el detalle: progreso, checklist, ítems faltantes, placeholder de IA,
  historial de actividad;
- pedir información (pantalla completa con checkboxes + mensaje autogenerado),
  aprobar y archivar, con la actividad reflejándose en el detalle.

## Integración con el resto del portal

**Routing.** No hay rutas de Next: `app/page.tsx` es un único client component
con una unión `Screen` y un `SCREEN_DEPTH` que decide la animación de entrada.
Applications agregó tres pantallas:

| Screen | Depth | Notas |
|---|---|---|
| `applications` | 1 | Lista interna. Mismo nivel que `stream` y `directory`. |
| `application-detail` | 2 | La lista queda montada con `hidden` detrás (igual que Directory) para conservar filtros y scroll. |
| `apply` | 0 | Flujo del candidato. Es raíz: se llega por link, no bajando en la jerarquía. |

**Link del candidato.** `?apply=<token>` se lee **una sola vez** al montar
(`applyTokenRef`) y cortocircuita la rama de `onAuthStateChanged`, así que el
candidato nunca ve el login. Además **no escribe `svc-last-module`**: una sesión
de candidato no debe cambiar el módulo al que vuelve un usuario interno.

**Módulo switcher.** `components/module-switcher.tsx` pasó de un tipo de dos
valores a tres. El popover se portalea a `<body>`, por lo que queda fuera del
scope claro y mantiene el look oscuro del chrome en los tres módulos; por eso
cada módulo puede definir `labelAccent` para el color del título en su propia
barra.

## El tema claro (la parte no obvia)

La app es oscura globalmente. Applications es clara **sin forkear un solo
componente**: Tailwind v4, con `@theme inline`, resuelve cada utilidad de color
a `var(--token)` en el punto de uso. Entonces la clase `.applications-scope`
(en `app/globals.css`) redefine los tokens base sobre un wrapper:

```css
.applications-scope {
  --background: #F5F8FC;  --foreground: #0F172A;
  --card: #FFFFFF;        --border: #D8E3EE;
  --primary: #2563EB;     --muted-foreground: #64748B;
  /* + identidad propia: --apps-blue, --apps-sky, --apps-complete, --apps-ai, … */
}
```

Todo lo que se renderiza adentro —utilidades de Tailwind y primitivas de
shadcn— cambia de tema solo. Sin variantes `dark:`, sin componentes duplicados.

**Consecuencia a recordar:** cualquier cosa que se portalee a `<body>` (modales
globales, toasts) sale del scope y vuelve a verse oscura. Los sheets de
Applications (`AppsSheet`) se renderizan **dentro** del contenedor del módulo
justamente por eso.

## Archivos

| Capa | Archivos |
|---|---|
| Dominio (sin framework, testeado) | `lib/applications-core.ts` |
| Estado | `features/applications/mock-applications.ts`, `use-applications-dashboard.ts`, `use-candidate-application.ts` |
| Primitivas UI | `components/applications/ui/` — `apps-primitives.tsx`, `apps-form.tsx`, `apps-sheet.tsx`, `tone.ts` |
| Candidato | `components/applications/candidate/` — `candidate-flow-screen.tsx`, `step-layout.tsx`, `steps/*` |
| Dashboard | `components/applications/dashboard/` — `applications-list-screen.tsx`, `application-card.tsx`, `application-detail-screen.tsx`, `request-info-screen.tsx` |
| Integración | `app/page.tsx`, `components/module-switcher.tsx`, `app/globals.css` |
| Test | `scripts/applications-core.test.ts` → `pnpm test:applications` (dentro de `verify:fast`) |

## Modelo de dominio (`lib/applications-core.ts`)

Todo el criterio vive acá, libre de React y de Firebase, para que las mismas
reglas puedan correr después en una Cloud Function sin una segunda
implementación:

- **9 estados**: `draft`, `submitted`, `needs_information`, `ready_for_review`,
  `approved`, `agreement_pending`, `payroll_in_progress`, `hired`, `archived`.
- **4 estados del acuerdo**: `locked`, `awaiting_signature`, `signed`, `expired`.
- **Progreso ponderado**: general 45 / video 25 / documentos 30. General se
  puntúa por campo (la barra se mueve mientras escribe), las otras dos son
  gruesas.
- **`computeApplicationProgress()`** devuelve porcentaje, estado por sección y
  la lista de ítems faltantes — un solo cálculo alimenta la lista, el detalle,
  el review del candidato y el sheet de aprobación.
- **`resumeStep()`** decide dónde reabre el link.
- **`requestableItems()` + `composeRequestMessage()`** arman la pantalla de
  Request info y su mensaje por defecto.

## Lo que hoy es mock (los "seams" a reemplazar)

| Mock actual | Dónde | Qué lo reemplaza |
|---|---|---|
| Lista de candidatos | `mock-applications.ts` | Query a `/applications` |
| Guardado del borrador | `use-candidate-application.ts` → `mutate()` + `markSaved()` | `setDoc` con debounce |
| Subida de documentos | `uploadDocument()` (guarda sólo el nombre) | Firebase Storage + doc de metadata |
| Grabar/subir video | `captureVideo()` (timeout de 1.4 s) | MediaRecorder + upload resumable |
| Aprobar / archivar / pedir info | `use-applications-dashboard.ts` | Escrituras con reglas + trigger |
| Resumen de IA | Tarjeta violeta con texto fijo | Transcripción + LLM (patrón mock/live existente) |
| Operating agreement | Sólo los 4 estados | PDF + proveedor de firma |
| Link seguro | `?apply=` sin validar | Token firmado + sesión (ver abajo) |

---

# Parte 2 — Plan de backend

## Decisiones tomadas (2026-07-23)

| Tema | Decisión | Consecuencia |
|---|---|---|
| Lectura de `/applications` | **Cualquier usuario autenticado** | Reglas simples, sin `get()` sobre `/users`. Los datos personales quedan visibles para todo el equipo — aceptado, mismo criterio que `/contacts` |
| Rol de revisor | **Ninguno: cualquier usuario autenticado revisa, aprueba y archiva** | No hay permisos que mantener. La **subcolección de actividad pasa a ser la auditoría**: cada evento guarda `actorUid` |
| Firma electrónica | **Firma dibujada + PDF sellado**, sin proveedor externo | Se construye 100% adentro con `pdf-lib` (ya está en el repo). Sin costo por sobre, sin dependencia de terceros |
| Relación con jobs | **Sí, contra Directory** vía composite id `job__<contextId>` | La aplicación referencia al job real; el candidato contratado puede volverse persona de Directory |

## Cómo se relaciona con Directory

Los jobs de Directory **son documentos de `/contexts`** normalizados por
`normalizeJobContext()`; su id público es el composite `job__<sourceId>` que
arma `directoryId()`. El patrón para colgar algo de una entidad ya existe dos
veces (`/directoryNotes` y `/directoryFiles`): un array `entityIds: string[]`
de composite ids, colección global-readable y escritura scopeada al autor.

La aplicación lo replica:

```
/applications/{applicationId}
    jobEntityId: "job__ctx_abc"          ← abre el job en Directory con un tap
    companyEntityId: "company__ctx_xyz"  ← derivado del job
    entityIds: ["job__ctx_abc", "company__ctx_xyz", "person__contact_123"]
```

`person__…` aparece recién cuando el candidato es contratado y se crea/enlaza
su contacto (fase 6). A partir de ahí la persona existe en Directory con su
job, y el historial de aplicación queda accesible desde su perfil.

> ⚠️ **`/directoryRelations` es de sólo lectura para el cliente**
> (`allow write: if false`): lo escribe la función de sync. Para que la
> aplicación aparezca en el panel de relaciones del job hay que emitir la arista
> **desde el trigger**, nunca desde el navegador.

## Decisión #1: cómo se autentica el candidato

Es **la decisión que condiciona todo lo demás** y no tiene precedente en el
repo: hoy toda `firestore.rules` exige `request.auth != null`, y no existe
ningún flujo anónimo en la app.

| Opción | Cómo | Contra |
|---|---|---|
| **A. Custom token con claim** (recomendada) | El candidato abre el link → `POST /api/applications/session` valida el token contra `/applicationLinks/{hash}` → el Admin SDK emite un **custom token** con claim `applicationId` y uid determinístico `cand_<applicationId>` → `signInWithCustomToken` en el cliente | Requiere Admin SDK bien configurado en prod (ya lo está para IA) |
| **B. Todo por API routes** con Admin SDK, sin Firebase en el cliente del candidato | Reglas triviales (denegar todo al cliente) | Un endpoint por operación, sin realtime, uploads con signed URLs, más código |
| **C. Anonymous Auth** | Un tap y listo | La regla no puede probar *qué* aplicación le corresponde a ese uid sin un doc de mapeo extra; termina siendo A pero con más piezas |

**Por qué A.** Reproduce el modelo que ya usa toda la app ("escrituras
scopeadas al dueño"), habilita subir a Storage directo desde el teléfono con
reglas (clave para videos), y el uid determinístico hace que reabrir el link
retome la misma sesión. La regla queda legible:

```
match /applications/{applicationId} {
  allow read, update: if request.auth.token.applicationId == applicationId;
}
```

**Higiene del token del link** (es un secreto tipo bearer, va en la URL):
guardar sólo el **hash** en Firestore, con `expiresAt`, `usedCount` y
`revokedAt`; poder rotarlo desde el dashboard; y no loguear la URL completa en
ningún lado.

## Modelo de datos propuesto

```
/applications/{applicationId}
    candidateName, trade, jobEntityId, companyEntityId, entityIds[],
    jobName, jobLocation, companyName,    ← desnormalizado para la lista
    status, general{…}, video{…}, documents[…], agreement{…},
    progressPercent, missingCount,        ← derivados, escritos por trigger
    createdAt, updatedAt, submittedAt, pendingRequest

/applications/{applicationId}/activity/{eventId}
    kind, actor, actorUid, message, at    ← actorUid = auditoría (no hay roles)

/applicationLinks/{tokenHash}
    applicationId, purpose, step, expiresAt, revokedAt, usedCount, createdBy

/applicationDocuments/{docId}          ← igual que /directoryFiles
    applicationId, documentId, storagePath, downloadUrl,
    contentType, bytes, status, uploadedAt

/applicationAgreements/{agreementId}   ← evidencia de firma (ver más abajo)

/applicationsAiUsage/{userHash}        ← presupuesto de transcripción
```

Notas de diseño:

- `documents[]` embebido en la aplicación (son ≤ 6 y siempre se leen juntos),
  pero el **binario y su metadata** en colección aparte, igual que
  `lib/directory-files.ts`, para no inflar el doc ni romper el límite de 1 MB.
- `progressPercent` y `missingCount` **derivados por trigger**, no calculados en
  el cliente al escribir: así la lista puede filtrar y ordenar por ellos sin
  leer cada documento (misma lógica que ya usa `/directoryIndex`).
- La actividad como **subcolección**, no array: crece sin límite y se pagina.

## Reglas de Firestore

Con las decisiones tomadas, quedan simples: **usuario autenticado = revisor**,
y el candidato entra por claim. La única distinción real es *qué campos* puede
tocar cada uno.

```
match /applications/{applicationId} {
  function isStaff()     { return request.auth != null
                           && !("applicationId" in request.auth.token); }
  function isCandidate() { return request.auth.token.applicationId == applicationId; }
  function touches(fields) { return request.resource.data.diff(resource.data)
                                    .affectedKeys().hasOnly(fields); }

  allow read:   if isStaff() || isCandidate();
  allow create: if isStaff();
  allow update: if isStaff()
                || (isCandidate()
                    && touches(['general','video','documents','updatedAt','status'])
                    // el candidato sólo puede enviar, nunca aprobarse
                    && request.resource.data.status in ['draft','submitted']
                    && resource.data.status in ['draft','needs_information']);
  allow delete: if false;
}
```

Dos detalles que importan:

- **`isStaff()` se define por ausencia del claim**, no por un rol. Sin eso, la
  sesión de un candidato pasaría por revisor y podría aprobarse sola.
- **El estado del acuerdo nunca lo escribe el cliente.** `agreement.status` sólo
  cambia desde el servidor (Admin SDK), porque es lo que habilita payroll.
  En reglas: excluirlo de los campos permitidos en ambos caminos.

> ⚠️ **Las reglas de producción no se tocan ni se deployan sin aprobación
> explícita.** Preparar el bloque en `firestore.rules` + `firestore.rules.secure`,
> probarlo en el emulador con casos de test, y recién ahí pedir el OK.

> ⚠️ **Las reglas de producción no se tocan ni se deployan sin aprobación
> explícita.** Preparar el bloque en `firestore.rules` + `firestore.rules.secure`,
> probarlo en el emulador con casos de test, y recién ahí pedir el OK.

## Storage

Prefijo nuevo, con el mismo patrón que `directory-files/`:

```
application-uploads/{applicationId}/documents/{documentId}-{filename}
application-uploads/{applicationId}/video/intro-{timestamp}.mp4
```

Reglas: `request.auth.token.applicationId == applicationId`, límite de 15 MB
para documentos (`image/*`, `application/pdf`) y **~200 MB para video**
(`video/*`). Un video de 1–2 minutos desde un teléfono moderno pesa fácil
50–150 MB, así que el upload tiene que ser **resumable**
(`uploadBytesResumable`) con barra de progreso real y reintento — no el
`uploadBytes` simple que se usa para imágenes. Para documentos conviene
reutilizar la compresión que ya existe en `lib/image-upload.ts`.

## Índices

Las consultas de la lista necesitan compuestos en `firestore.indexes.json`:

- `status ASC, submittedAt DESC` (bandeja por estado, más nuevos primero)
- `jobId ASC, status ASC, submittedAt DESC` (filtro por job)
- `status ASC, updatedAt DESC` (orden "recientemente actualizado")

La búsqueda por nombre/trade sigue siendo cliente-side mientras el volumen sea
bajo (como hace Directory hasta el índice derivado).

## Cloud Functions

`functions/src/index.ts` ya exporta triggers por dominio; agregar
`functions/src/applications/`:

| Trigger | Qué hace |
|---|---|
| `onApplicationWrite` | Recalcula `progressPercent` / `missingCount` con `applications-core` (regenerado a `functions/src/`, igual que `directory-core.ts`) |
| `onApplicationSubmitted` | Notifica a los revisores vía FCM, reutilizando `functions/src/communications/notifications.ts` y `lib/fcm.ts` |
| `onApplicationHired` | Crea/enlaza el contacto en `/contacts` para que el candidato aparezca en Directory (patrón `functions/src/directory/sync.ts`) |
| `onApplicationLinkExpiry` | Job diario que expira links y acuerdos vencidos |

## IA: transcripción y resumen del video

**No inventar arquitectura nueva** — el repo ya tiene el patrón resuelto dos
veces (Outlooks y Directory Ask):

- `lib/ai/config.ts` → `canCallProvider()` decide **mock vs live**; sin API key
  el modo mock es el default, así que el placeholder violeta puede quedar
  funcionando tal cual hasta que exista la key.
- `lib/ai/server/auth-guard.ts` → verificación del bearer token (con fallback de
  dev cuando no hay credenciales de Admin).
- `lib/ai/server/request-guard.ts` → idempotencia + presupuesto diario; **acepta
  override de colección y de límites**, así que `applicationsAiUsage` es
  configuración, no código nuevo.
- Rutas: `app/api/applications/transcribe` y `.../summarize`, calcadas de
  `app/api/outlooks/*`.

Diferencia importante: acá el audio **sí se persiste** (es el video del
candidato), a diferencia de Outlooks donde se descarta. Eso cambia el análisis
de privacidad y de retención.

## Links: un solo concepto, tres propósitos

El flujo del supervisor obliga a que el link deje de ser "la URL de la
aplicación" y pase a ser un objeto con **propósito**. Los tres casos usan el
mismo mecanismo de sesión (custom token) y la misma pantalla de candidato:

| `purpose` | Se genera desde | Abre en | Vence |
|---|---|---|---|
| `application` | Dashboard → "Compartir link" | Welcome, o donde quedó | 14 días |
| `step` | Request info → link directo al paso | El paso exacto (`documents`, `video`, `general`) | 7 días |
| `agreement` | Al aprobar | Revisión + firma del acuerdo | 72 h |

**El paso viene del token, no de la URL.** `?apply=<token>&step=documents`
sería manipulable y ensucia la URL; con el paso guardado en
`/applicationLinks/{hash}.step`, la sesión resuelve a dónde entrar y el link
compartido queda corto: `svc.app/?apply=a7f3…`.

**Compartir desde el dashboard.** `navigator.share()` (Web Share API) abre el
menú nativo del teléfono — SMS, WhatsApp, mail, lo que tenga instalado — con un
fallback a copiar al portapapeles en desktop. Ya hay precedente en el repo:
`features/outlooks/pdf/share-outlook-pdf.ts`. Los deep links directos
(`sms:?body=…`, `mailto:?body=…`, `https://wa.me/?text=…`) sirven como atajos
opcionales, pero el menú nativo cubre los cuatro casos con un solo botón.

**Request info genera el link del paso.** La pantalla ya arma el mensaje
(`composeRequestMessage()`); lo único que falta es que el backend cree el link
`purpose: "step"` apuntando al primer ítem pendiente y lo agregue al final del
texto. El candidato toca, sube lo que falta y listo: **sin volver a empezar y
sin instalar nada**.

## Operating agreement: firma dibujada + PDF sellado

Decidido: **sin proveedor externo**. Se construye adentro con `pdf-lib`, que ya
está en el repo (`features/outlooks/pdf/generate-outlook-pdf.ts`) y corre tanto
en el navegador como en Node — así el sellado puede pasar en el servidor.

### Flujo del candidato

1. Se aprueba la aplicación → el acuerdo se desbloquea y se emite un link
   `purpose: "agreement"` con vencimiento corto.
2. El candidato abre el link y **lee el acuerdo completo** (scroll hasta el
   final; el botón de firmar se habilita recién ahí).
3. **Consentimiento explícito**: checkbox "Acepto firmar electrónicamente".
4. **Escribe su nombre** tal como aparece en el acuerdo.
5. **Firma con el dedo** en un canvas (trazo suavizado, botón de borrar).
6. Envía → el servidor sella el PDF y el estado pasa a `signed`.

### Qué se guarda (la evidencia es el producto)

```
/applicationAgreements/{agreementId}
    applicationId, templateId, version,
    bodyHash,           ← SHA-256 del texto EXACTO que se le mostró
    consentAt, typedName, signerIp, userAgent,
    signatureImagePath, ← PNG del trazo, en Storage
    signedPdfPath, signedPdfHash,   ← SHA-256 del PDF final
    signedAt,           ← serverTimestamp, no la hora del teléfono
    expiresAt, revokedAt
```

`bodyHash` es lo que hace verificable la firma: prueba **qué versión del texto**
aceptó esa persona. Sin eso, un PDF firmado no demuestra nada si la plantilla
cambia después.

### Dónde corre cada cosa

- **Canvas → PNG**: en el cliente (`<canvas>` con eventos de puntero).
- **Sellado del PDF, hashes y `signedAt`**: **en el servidor**, en
  `POST /api/applications/agreement/sign` con el Admin SDK. El cliente nunca
  puede escribir `agreement.status = "signed"` — si pudiera, la firma no valdría
  nada. La API valida el claim del candidato, embebe el PNG con
  `PDFDocument.embedPng()`, calcula los hashes, sube el PDF y actualiza el
  estado en una sola transacción.
- **Desbloqueo de payroll**: trigger que reacciona a `signed`, no una escritura
  del cliente.

### Sobre el valor legal

Consentimiento + nombre tipeado + trazo + timestamp de servidor + hash del
documento es el conjunto de evidencia que se espera de una firma electrónica
simple. **No soy abogado**: la plantilla del acuerdo y este conjunto de
evidencia los debería revisar quien les lleve los temas legales antes de usarlo
con gente real.

### Payroll

Sigue sin sistema destino definido. Hasta que se defina,
`payroll_in_progress` es un estado que alguien mueve a mano después de la firma.

## Fases sugeridas

Cada fase deja la app funcionando; el flag
`NEXT_PUBLIC_APPLICATIONS_BACKEND` (default `false`) elige mock o Firestore,
igual que los flags de IA.

| # | Fase | Entregable | Listo cuando | Estado |
|---|---|---|---|---|
| 0 | Contratos | `lib/applications-store.ts` (mappers Timestamp↔ISO) + `lib/applications-writes.ts` + `scripts/seed-applications.mjs` con `DRY_RUN` | El seed carga los 5 candidatos mock en el emulador | **✅ 2026-07-24** |
| 1 | Lectura interna | Lista y detalle leen de `/applications` detrás del flag, con `jobEntityId` composite | El dashboard muestra datos del emulador; con el flag apagado sigue el mock | **✅ 2026-07-24** |
| 2 | Escritura interna | Aprobar / archivar / pedir info + actividad con `actorUid` + reglas | Los tres botones persisten y la actividad se ve al recargar | **✅ 2026-07-24** |
| 3 | Sesión del candidato | `/api/applications/session` (custom token + claim `applicationId`), `signInWithCustomToken`, autosave + submit contra Firestore | Abrir un link en incógnito abre la sesión, guarda y envía; no puede aprobarse | **✅ 2026-07-24** |
| 4 | Compartir + links del paso | `/applicationLinks` persistidos, links `purpose: "step"` desde Request info, Web Share API | El link del paso abre directo en el ítem faltante | UI hecha (mock); falta persistir los links |
| 5 | Archivos | Documentos + video a Storage, upload resumable con progreso | Subir desde un teléfono real, con el video completo | **pendiente — bloquea el candidato en prod** |
| 6 | Derivados y avisos | Triggers de progreso, notificación al enviar, contacto en Directory al contratar | El % se recalcula solo, llega el push y el contratado aparece en Directory | pendiente |
| 7 | Acuerdo | Pantalla de lectura + consentimiento + canvas de firma + `/api/applications/agreement/sign` con sellado y hashes | Firmar desde el teléfono deja el PDF sellado y el estado en `signed` | UI hecha (mock) |
| 8 | IA | Transcripción + resumen en modo mock, live detrás de key | La tarjeta violeta muestra texto real cuando hay key | pendiente |

**Orden recomendado: 0 → 1 → 2 antes de tocar nada del candidato.** El lado
interno se puede probar con usuarios reales sin exponer datos personales de
terceros, y valida el modelo de datos antes de que exista un link público. La
IA quedó última a propósito: es la única fase que no bloquea a nadie — el
placeholder violeta ya comunica lo que va a pasar ahí.

## Estado del backend interno (fases 0–2, hecho 2026-07-24)

Todo detrás de `NEXT_PUBLIC_APPLICATIONS_BACKEND` (default `false` → mock).
Probado contra el emulador de Firestore; **nada deployado a producción**.

**Archivos nuevos:**
- `lib/applications-store.ts` — mappers Firestore↔dominio. Único lugar que
  conoce Timestamp Y string ISO; el dominio (`applications-core`) sigue puro. Al
  crear **no** escribe `progressPercent` / `missingCount`: los deriva un trigger,
  así el cliente nunca pelea una copia vieja.
- `lib/applications-writes.ts` — `subscribeApplications` (lista, `orderBy
  updatedAt desc`), `subscribeApplicationActivity` (subcolección, sólo del
  candidato abierto), y las acciones del revisor. **Regla de arquitectura:
  ninguna acción del revisor toca `agreement.status`** (eso desbloquea payroll y
  es server-side), y **cada acción agrega un evento con `actorUid`** — sin roles,
  la actividad ES la auditoría.
- `lib/applications-flags.ts`, `scripts/seed-applications.mjs` (DRY_RUN por
  defecto, sólo emulador), `scripts/test-applications-rules.mjs`.

**Hook `use-applications-dashboard`:** dos backends detrás de una sola
superficie. Con el flag, mutaciones **optimistas** (el estado local cambia
primero, el listener reconcilia). Las pantallas no saben cuál está activo — eso
es lo que deja el mock funcionando como demo. `firebaseUser.uid` entra al hook
como el `actorUid` del revisor.

**Reglas** (preparadas en `firestore.rules` **y** `firestore.rules.secure`, NO
deployadas): `appIsStaff()` = autenticado **sin** claim `applicationId`;
`appIsCandidate()` = con el claim. El candidato sólo puede editar
`general/video/documents/updatedAt/submittedAt` **mientras** su status es
`draft` o `needs_information`, y sólo puede mantener el status o pasar a
`submitted` — nunca aprobarse. `agreement` queda fuera del update del staff. La
actividad es append-only y el `actorUid` debe ser el propio. `/applicationLinks`
es **ilegible para el cliente** (los resuelve el servidor). `/applicationAgreements`
sólo lo lee el staff, lo escribe el servidor.

**Índices** (en `firestore.indexes.json`, NO deployados): `status+submittedAt`,
`status+updatedAt`, `jobEntityId+status+submittedAt`, `entityIds+updatedAt`.

**Verificación (emulador):**
```
pnpm emulator                         # levantar (Java 21)
pnpm emulator:seed-applications:dry   # ver qué escribiría
pnpm emulator:seed-applications       # escribir los 5 candidatos + links
pnpm emulator:test-applications-rules # 15 casos de reglas — 15/15 verde
```
El test de reglas encontró un bug real: la primera versión no dejaba a un
candidato en `needs_information` corregir sus datos. Corregido y reprobado. La
query exacta de la lista (`orderBy updatedAt desc`) se validó aparte: pasa para
staff, se deniega para candidato y anónimo (un candidato lee su doc pero no
puede enumerar la colección).

## Estado de la sesión del candidato (fase 3, hecho 2026-07-24)

El candidato ya es funcional de punta a punta contra Firestore, detrás del mismo
flag. Probado en el emulador (auth + firestore); **nada deployado**.

**Cómo funciona:**
1. El browser abre el link → `POST /api/applications/session` con el token.
2. El server (`lib/applications-server.ts`, Admin SDK) valida el link con
   `resolveLink()` (existe / no revocado / no vencido), confirma que la
   aplicación existe, y emite un **custom token** con uid `cand_<applicationId>`
   y claim `applicationId`. Reusa el mismo `getFirebaseAdminApp()` de la IA.
3. El browser hace `signInWithCustomToken`. Ahora las reglas dejan a ese
   candidato leer/escribir **sólo** su aplicación.
4. Autosave con debounce (`saveCandidateDraft`) y submit
   (`submitCandidateApplication`) contra Firestore; el snapshot reconcilia.

**Archivos nuevos:** `lib/applications-server.ts` (`createCandidateSession`),
`app/api/applications/session/route.ts` (runtime node), y en cliente
`features/applications/candidate-session.ts` + rewire de
`use-candidate-application.ts` (mock vs live detrás del flag, con estados
`connecting` / `ready` / `error`).

**Dos decisiones que importan:**
- **La sesión del candidato NO setea `firebaseUser` en el estado de la app**
  (`app/page.tsx`): si lo hiciera, arrancarían los listeners de todo el portal
  (users/projects/contacts) que el candidato no puede leer. El flujo del
  candidato maneja su propio sign-in por dentro.
- **El preview desde el dashboard fuerza modo mock** (`preview` prop): un
  `signInWithCustomToken` real desconectaría al revisor de la instancia de auth
  compartida y lo firmaría como el candidato.

**Firma del acuerdo:** sigue optimista-local aún en modo live. Escribir
`agreement.status = "signed"` es server-only (las reglas lo prohíben al
candidato), así que la firma real espera el endpoint de sellado (fase 7). Hoy en
live la UI cambia pero **no persiste**.

**Verificación (emulador con auth + firestore):**
```
pnpm emulator                              # firestore + auth
pnpm emulator:test-applications-session    # 7/7: custom token real → sign in →
                                           # leer/guardar/enviar propio; aprobar
                                           # y tocar el acuerdo se deniegan
```

## Lo que falta para encender el candidato en prod

- **Fase 5 (Storage)** — hoy documentos/video guardan sólo el nombre de archivo,
  no el binario. Encender el candidato en prod sin esto significa "subidas"
  falsas. **Es lo que bloquea el flujo público.**
- **Persistir los links** (`/applicationLinks` real) para que compartir/Request
  info emitan tokens que la sesión pueda resolver — hoy los links son mock
  in-memory, aunque la sesión ya sabe leer `/applicationLinks` cuando existan.
- **Endurecer el endpoint de sesión**: rate-limit y hash del token en reposo
  (`/applicationLinks/{tokenHash}`) antes de exponerlo público.
- **Desplegar reglas + índices** (con aprobación).

**El dashboard interno (fases 0–2) sí puede ir a prod antes** que el candidato:
no expone nada al público y se prueba con usuarios reales.

## Estado del mock para estos dos flujos (hecho 2026-07-23)

Las tres piezas ya están construidas, siempre sobre estado local:

1. **Compartir link** — `components/applications/dashboard/share-link-sheet.tsx`
   + `features/applications/use-share-link.ts`. Entradas: "Invite a candidate"
   arriba de la lista, y en el menú del detalle "Share application link" /
   "Send agreement link". Muestra la URL, el estado (Active / Expired /
   Revoked), el vencimiento y un preview del mensaje; comparte con
   `navigator.share()` y cae a copiar en desktop. Regenerar y revocar funcionan
   contra el registro mock.
2. **Acuerdo y firma** — `steps/agreement-step.tsx` +
   `ui/signature-pad.tsx` + `steps/agreement-signed-step.tsx`. El botón de
   firmar aparece recién cuando el candidato llega al final del texto;
   consentimiento, nombre (validado contra el nombre en ficha, tolerante a
   mayúsculas/acentos) y trazo son obligatorios. Al firmar: estado `signed`,
   versión y nombre guardados, y la aplicación pasa a `payroll_in_progress`.
3. **Request info** — genera un link `purpose: "step"` apuntando al primer ítem
   pendiente, lo muestra con su vencimiento y lo agrega al mensaje. El link se
   emite una vez por visita: regenerarlo en cada toggle invalidaría uno que el
   revisor quizá ya copió.

Lo que **sigue siendo mock** en estas piezas: el token no se valida contra nada,
el PNG de la firma no se sube, no hay PDF sellado ni hash ni `signedAt` de
servidor, y `navigator.share()` comparte una URL que todavía no resuelve para
un tercero.

## Temas cerrados (2026-07-25)

- ✅ **Storage** — documentos y video suben de verdad; el revisor los ve.
- ✅ **Firma funcional** — sellado server-side + evidencia + estado con Admin SDK.
- ✅ **Post-aprobación** — aprobación atómica, acuerdo desbloqueado, link y
  bottom sheet de envío para el candidato.
- ✅ **Data falsa** — eliminada de prod.
- ✅ **Invite usable** — nombre + trade + job; crea aplicación y link reales.

## Temas que quedan (menores)

1. **Endpoint de sesión sin endurecer.** Falta rate-limit y hashear el token en
   reposo (`/applicationLinks/{tokenHash}`) antes de uso público intenso. Hoy el
   token se guarda tal cual bajo su propio id. Mitigado en parte por vencimiento
   corto + revocación.
2. **Reasignar el job de una aplicación existente** no tiene UI todavía (el
   invite lo setea al crear; editarlo después queda pendiente). Idealmente el
   job saldría de Directory (`/directoryIndex`) en vez de texto libre.
3. **Transcripción + resumen de IA del video** (fase 8): el video ya está en
   Storage; falta la transcripción. La tarjeta violeta muestra el placeholder.
4. **PII / retención** sigue sin decidir (borrado de docs/videos de rechazados).
5. **`FIREBASE_SERVICE_ACCOUNT_KEY` en Vercel** — requisito duro para la sesión
   del candidato Y el sellado de la firma; verificá que esté seteada.

## Riesgos abiertos

1. **El token del link es un secreto que viaja en la URL.** Se comparte por
   SMS/WhatsApp y queda en el historial del chat y del navegador. Mitigación:
   vencimiento corto por propósito (14 d / 7 d / 72 h), hash en reposo, revocar
   y regenerar desde el dashboard. **El link del acuerdo es el más sensible**:
   quien lo tenga puede firmar.
2. **Sin roles, cualquier usuario autenticado aprueba.** Es lo decidido y
   simplifica todo, pero significa que **la actividad con `actorUid` es la única
   trazabilidad**. Que quede completa no es opcional.
3. **Retención de PII.** Sigue sin definir cuánto tiempo se guardan licencias,
   videos y acuerdos de candidatos rechazados. No bloquea las fases 0–2, sí
   conviene resolverlo antes de que haya datos reales de gente.
4. **Peso del video.** El riesgo técnico más concreto: obra, señal mala, subida
   de 100 MB. Upload resumable, reintento y —idealmente— bajar bitrate en el
   cliente antes de subir.
5. **`?apply=` hoy no valida nada.** Mientras siga en mock no importa, pero no
   puede llegar a producción sin la fase 3.
6. **Documentos requeridos por job.** El modelo distingue `origin: "job"`, pero
   no existe dónde configurarlos. Con jobs ya enlazados a Directory, el lugar
   natural es un campo en el context del job — queda por definir.
7. **Revisión legal de la plantilla del acuerdo** y del conjunto de evidencia
   que guardamos, antes de usarlo con gente real.

## Checklist antes de tocar producción

- [x] Reglas nuevas probadas en el emulador con casos de candidato **y** de staff,
      incluido el intento de que un candidato se apruebe a sí mismo (falla) —
      `pnpm emulator:test-applications-rules`, 15/15
- [x] `agreement.status` inescribible desde el cliente, verificado en el emulador
- [ ] Índices compuestos **deployados** (deploy de índices **antes** que el código que los usa)
- [ ] Reglas de Storage con límites de tamaño y content-type verificados (fase 5)
- [ ] Decidida y documentada la política de retención de PII
- [ ] **Aprobación explícita del dueño del proyecto** para cualquier deploy de
      reglas, migración de datos o cambio en Vercel

## Referencias en el repo

- Patrón mock/live de IA: `docs/svc-outlook-ai-handoff.md`, `lib/ai/config.ts`
- Capa derivada y triggers: `docs/svc-directory-ui-context.md`, `functions/src/directory/sync.ts`
- Composite ids y relaciones: `lib/directory-core.ts` (`directoryId`), `lib/directory-relations-core.ts`
- Archivos + Storage: `lib/directory-files.ts`, `storage.rules`
- PDF y compartir nativo: `features/outlooks/pdf/generate-outlook-pdf.ts`, `share-outlook-pdf.ts`
- Convención de scripts con `DRY_RUN` / `CONFIRM_*`: `package.json`, `scripts/`
