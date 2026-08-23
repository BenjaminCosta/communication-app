# SVC — Courtney Roberts Center: auditoría de manejo de datos y performance

> Revisión estática de solo lectura sobre `lib/courtney-roberts-center/`,
> `app/api/courtney-roberts-center/`, `lib/outlook-form-submissions/`, los
> componentes `components/courtney-roberts-center*.tsx` y su punto de entrada
> real: el flujo de mensajes entrantes en `app/api/whatsapp/webhook/route.ts`.
> No se consultó producción, no se usaron credenciales, no se desplegó nada.
> Durante esta sesión se aplicaron tres correcciones concretas, de bajo
> riesgo y sin cambio de contrato — ver §4 — y se corrió la suite
> `pnpm exec tsx --test scripts/courtney-roberts-center.test.ts` (27/27) más
> `pnpm exec tsc --noEmit` para verificarlas.

## 0. Veredicto ejecutivo

Courtney Roberts Center (CRC) es, en cuanto a lectura de datos, **el módulo
mejor comportado de la aplicación** — mejor que Communications, comparable a
Directory:

- No abre ningún listener de Firestore en el cliente. Todo pasa por rutas
  `app/api/courtney-roberts-center/*` con Admin SDK, autenticadas con un
  Bearer token verificado en cada request.
- Toda lectura de lista o de hilo está paginada con cursor (`limit + 1` /
  `startAfter`), exactamente el patrón que la auditoría general de Firebase
  (`docs/svc-firebase-architecture-performance-audit.md`, §3.3) recomienda
  para reemplazar los listeners sin ventana de Communications.
- `orderBy` es siempre single-field (`updatedAtMs`, `createdAtMs`,
  `submittedAtMs`), así que no hace falta ningún índice compuesto — ya es así
  hoy, no es una recomendación pendiente.
- Los adjuntos de WhatsApp se guardan como metadata (`kind`, `filename`)
  nunca como URL — evita que un enlace firmado expirado rompa un transcript
  histórico, y evita que CRC dependa de Storage en absoluto.

El costo real no está en el patrón de lectura del panel de administración
—ese ya es correcto— sino en **cuántas veces se lee o reescribe el mismo
documento de conversación por turno de WhatsApp**, que es el camino de mayor
volumen del módulo (se ejecuta en cada mensaje entrante, no solo cuando un
admin abre el panel). Ahí exhaustivo == encontrar los reads redundantes.

### Estado por área

| Área | Estado | Hallazgo principal |
|---|---:|---|
| Lectura del panel (listas/hilos) | Muy bueno | Paginado, cursor, sin listeners — nada que corregir en el patrón |
| Escritura por turno de WhatsApp | Mejorable | El doc de conversación se lee hasta 3 veces por turno (§3.1) |
| Latencia de "abrir un hilo" | Corregido en esta sesión | Lecturas secuenciales → paralelas (§3.2 / §4) |
| Autenticación por request | Corregido en esta sesión | `/users/{uid}` se leía 2 veces en `reply` (§3.3 / §4) |
| Ciclo de vida de datos | Sin política, bajo riesgo hoy | `/messages` es append-only sin retención (§3.6) |
| Indexado automático | No inventariado | `text` (hasta 8.000 caracteres) se indexa sin necesidad (§3.5) |
| Caché de cliente | Ausente, a propósito | Cada apertura del módulo repite el fetch completo (§3.4) |
| Escala de `/admins` | Documentada como deliberada | Lee todo `/users` sin límite — a propósito, ~10 usuarios (§3.7) |

## 1. Mapa de datos

```text
Firestore
  courtneyRobertsCenterConversations/{sha256(phone)}
    identityStatus, displayName, resolvedUserId?, resolvedPersonId?
    phoneHash, phoneNumber, messageCount
    lastMessageAtMs, lastMessagePreview, lastMessageRole
    createdAtMs, updatedAtMs
    aiPaused, aiPausedAtMs?, aiPausedByName?
    └─ messages/{messageId | assistant:{id} | human:{clientMessageId}}
         role, text (≤8.000 chars), createdAtMs
         presentationKind?, attachments? (metadata only), sentBy?, sentByName?

  users/{uid}
    courtneyRobertsCenterAccess: boolean   ← gate de acceso, ver access.ts
    name, email                            ← releído para "quién envió esto"

  outlookFormSubmissions/{id}
    status, submittedBy*, jobName, window, tasks[], generalNotes
    reviewedAtMs?, reviewedByUid?, reviewedByName?

Rutas API (Admin SDK, sin firestore.rules — default-deny para ambas
colecciones, documentado explícitamente en outlook-form-submissions/store.ts)
  GET  /conversations                 lista, cursor, limit≤200
  GET  /conversations/:id             hilo, cursor, limit≤500
  POST /conversations/:id/link        vincula número → cuenta SVC
  POST /conversations/:id/reply       respuesta manual + pausa IA
  POST /conversations/:id/resume      reanuda IA
  GET  /admins                        lista TODO /users, sin límite
  PATCH /admins/:uid                  otorga/revoca acceso
  GET  /outlook-forms[, /:id]         lista/detalle, cursor, limit≤200
  POST /outlook-forms/:id/review
  GET  /outlook-forms/:id/pdf         genera PDF on-demand, no se cachea

Camino de mayor volumen (no es el panel — es el webhook de WhatsApp)
  app/api/whatsapp/webhook/route.ts
    → recordCourtneyRobertsCenterInboundMessage()   [transacción #1]
    → isCourtneyRobertsCenterAiPaused()              [lectura suelta #2]
    → recordCourtneyRobertsCenterAssistantReply()   [transacción #3]
```

## 2. Qué ya está bien diseñado

- **Sin listeners globales.** A diferencia de `/messages` en Communications
  (auditoría general, §3), CRC nunca mantiene "toda la historia accesible"
  en memoria del cliente. Cada apertura de pantalla es un fetch acotado.
- **Paginación consistente cursor-based** en las tres listas (conversaciones,
  hilo, outlook forms), con el mismo patrón `limit + 1` / `startAfter` que
  Directory usa para notas y archivos.
- **IDs deterministas para idempotencia.** El id del mensaje es el
  `messageId` de WhatsApp (o `assistant:{id}` / `human:{clientMessageId}`),
  así que un reintento de entrega de Meta o un doble-tap en "enviar" nunca
  duplica un mensaje ni descuenta dos veces `messageCount`.
- **Texto acotado a 8.000 caracteres** por mensaje (`MAX_STORED_TEXT_CHARACTERS`)
  y a 4.000 en la respuesta manual del admin — sin esto, un mensaje
  patológicamente largo inflaría el documento sin límite.
- **Adjuntos como metadata, nunca como URL** — evita que este módulo dependa
  de Storage o de la vida de un link firmado.
- **Un solo flag de identidad se mueve en una sola dirección** ("public" →
  "internal" siempre aplica; "internal" → "public" nunca") — no es un tema de
  performance, pero evita escrituras espurias que reescribirían el documento
  completo ante un blip transitorio de resolución.

## 3. Hallazgos con evidencia y estimación de impacto

### 3.1 El documento de conversación se lee hasta 3 veces por turno de WhatsApp

Cada mensaje entrante dispara, en orden, dentro del mismo request del
webhook (`app/api/whatsapp/webhook/route.ts:448-639`):

1. `recordCourtneyRobertsCenterInboundMessage` → `appendMessage` abre una
   transacción que lee `conversationRef` **y** `messageRef` (2 lecturas),
   luego escribe ambos (2 escrituras).
2. `isCourtneyRobertsCenterAiPaused` — una lectura suelta, independiente, del
   mismo `conversationRef` que la transacción del paso 1 ya acababa de leer.
3. Si la IA no está pausada, `recordCourtneyRobertsCenterAssistantReply` →
   otra transacción `appendMessage`, que vuelve a leer `conversationRef` y
   `messageRef` (2 lecturas más) y escribe otras 2 veces.

| Escenario | Lecturas Firestore | Escrituras Firestore |
|---|---:|---:|
| Turno normal (IA responde) | 5 | 4 |
| Conversación pausada (admin ya tomó el control) | 2 | 2 |

El caso pausado ya es eficiente (el código corta ahí explícitamente y no
genera ni registra respuesta — comentario en la línea 456-461 lo documenta a
propósito). El caso normal —la mayoría del tráfico— paga una lectura
redundante del mismo documento: `isCourtneyRobertsCenterAiPaused` podría
resolverse con el `conversationSnap` que la transacción del paso 1 ya leyó,
en vez de un segundo viaje de red.

No se aplicó una corrección aquí en esta sesión — a diferencia de los
hallazgos §3.2/§3.3, este vive en el camino crítico del webhook, dentro de
una `finally`/multi-branch con comentarios que documentan invariantes de
orden delicados (el `aiPaused` debe checkearse *después* de que el mensaje
entrante quede atribuido, pero *antes* de generar cualquier respuesta). Es un
cambio real pero de mayor superficie — amerita su propio PR con tests contra
el emulador, no un ajuste inline dentro de una auditoría de lectura.

**Recomendación:** que `recordCourtneyRobertsCenterInboundMessage` devuelva
el `aiPaused` que ya observó dentro de su propia transacción (o que ambas
lecturas compartan una sola transacción), eliminando el viaje de red #2. Con
volumen bajo (WhatsApp es tráfico humano, no hay ráfagas) esto no es
urgente hoy, pero es puro costo fijo por mensaje que crece linealmente con el
volumen de conversaciones activas.

### 3.2 `getCourtneyRobertsCenterConversationThread`: lecturas secuenciales en vez de paralelas — **corregido en esta sesión**

`lib/courtney-roberts-center/read-api.ts` leía el documento de conversación y
después, solo si existía, ejecutaba la query de mensajes — dos round-trips
de red en serie para abrir cualquier hilo, aunque las dos lecturas son
independientes (la query de mensajes no depende del contenido de la
conversación, solo de su id).

```ts
// antes
const conversationSnap = await conversationRef.get()
const conversation = conversationSnap.exists ? toConversationSummary(...) : null
if (!conversation) return null
const snapshot = await query.get()

// después
const [conversationSnap, snapshot] = await Promise.all([conversationRef.get(), query.get()])
const conversation = conversationSnap.exists ? toConversationSummary(...) : null
if (!conversation) return null
```

Mismo patrón que Directory ya documenta como bueno ("Index and source
profile documents load in parallel", `svc-directory-performance-optimization.md`).
El único costo es que un `conversationId` inexistente ahora también dispara
la query de mensajes (subcolección vacía de un doc que no existe — 0
documentos devueltos, costo marginal) en vez de cortar antes. A cambio, cada
apertura real de un hilo —la interacción principal del panel de admin— pasa
de 2 round-trips secuenciales a 1.

### 3.3 Doble lectura de `/users/{uid}` en la ruta de respuesta manual — **corregido en esta sesión**

`requireCourtneyRobertsCenterAdmin` (en `access.ts`) ya lee
`users/{uid}` para verificar `courtneyRobertsCenterAccess` en **cada** una de
las 12 rutas de CRC. La ruta `POST /conversations/:id/reply` volvía a leer el
mismo documento con su propio helper `adminDisplayName()`, solo para obtener
el campo `name` a usar como `sentByName` — dos lecturas del mismo documento
en el mismo request.

Se unificó: `requireCourtneyRobertsCenterAdmin` ahora devuelve `{ uid, email,
name }` leyendo el doc una sola vez, y la ruta usa `admin.name` directamente.
`adminDisplayName()` y su import no usado de `getFirebaseAdminApp` se
eliminaron del route handler.

Impacto: no cambia el comportamiento observable (mismo fallback a email si
no hay `name`), elimina 1 lectura de Firestore por cada respuesta manual que
un admin envía desde el panel.

### 3.4 Sin caché de cliente — cada apertura del módulo repite el fetch completo

A diferencia de Directory (IndexedDB + revalidación en segundo plano, LRU de
perfiles), las pantallas de CRC (`courtney-roberts-center-screen.tsx`,
`*-thread-screen.tsx`) usan `useState` + `useEffect` puro: cada vez que el
admin vuelve a la lista de conversaciones o reabre un hilo ya visto, se repite
la petición completa a la API, sin caché ni siquiera en memoria de sesión.

Esto es deliberado y razonable para un panel de administración de bajo
tráfico (el propio código lo documenta: `LIST_PAGE_SIZE = 100` con el
comentario "Admin tool, small conversation count expected"). No es un
problema hoy. Si el volumen de conversaciones o la frecuencia de uso del
panel crece, el primer paso barato sería un caché en memoria (no
necesariamente IndexedDB) por conversationId con invalidación al enviar un
mensaje — mismo patrón simplificado que el LRU de perfiles de Directory.

### 3.5 `text` se indexa automáticamente sin que nada lo consulte

Firestore indexa todo campo por defecto. `messages.text` puede llegar a
8.000 caracteres y nunca aparece en una cláusula `where`/`orderBy` — ni en
`read-api.ts` ni en ningún script. Mismo patrón que la auditoría general
identifica en su §7 para el cuerpo de mensajes de Communications: cada
escritura paga el fan-out de indexar un campo grande que nadie consulta desde
el servidor.

Candidatos concretos para `fieldOverrides` en `firestore.indexes.json`
(exención de índice de campo único, no requiere reescribir datos):

| Colección | Campo | Por qué no necesita índice |
|---|---|---|
| `courtneyRobertsCenterConversations/{id}/messages` | `text` | Nunca aparece en un `where` — solo se lee por documento o por rango de `createdAtMs` |
| `courtneyRobertsCenterConversations/{id}/messages` | `attachments` | Array de metadata, solo se lee, nunca se filtra |
| `outlookFormSubmissions` | `tasks`, `generalNotes` | Se leen enteros por documento; el filtro de `jobName`/`status` ya se hace en memoria a propósito (ver comentario en `store.ts:163-169`) |

No se aplicó en esta sesión — es un cambio de configuración de infraestructura
(`firestore.indexes.json` + deploy), no de código, y el propio doc de
auditoría general recomienda inventariar antes de eximir a ciegas.

### 3.6 `/messages` es append-only sin política de retención

Igual que `/messages` de Communications (auditoría general, §8): cada
conversación de WhatsApp acumula mensajes indefinidamente, sin archivo ni
expiración. Hoy esto es de bajo riesgo porque la lectura ya está paginada
(`DEFAULT_MESSAGES_PAGE_SIZE = 200`, tope `500`) — a diferencia de
Communications, abrir un hilo de CRC nunca trae "toda la historia" a la vez.
El costo silencioso es solo de almacenamiento a largo plazo, no de lectura.
No amerita acción ahora; sí vale la pena que cualquier futura política de
retención de mensajes (recomendación P2 de la auditoría general) cubra esta
colección también.

### 3.7 `listCourtneyRobertsCenterAccessUsers`: lectura completa de `/users` sin límite

`admin-management.ts` lee toda la colección `/users` sin `limit()` para
poblar la pantalla "Manage access". El propio comentario en el código lo
declara explícitamente: *"this app has ~10 users, so one unbounded read is
fine"*. Es una decisión documentada, no un descuido — se deja registrado acá
solo como el techo a vigilar: si el número de usuarios de la app crece un
orden de magnitud, esta es la primera lectura que necesitará paginación.

### 3.8b La pestaña "Outlook Forms" es una cola simple, no el editor rico de Directory

Vale aclarar el alcance: "Outlook Forms" dentro de CRC (`outlookFormSubmissions`,
`lib/outlook-form-submissions/`) **no** es el mismo feature que el "3-Week
Outlook" colaborativo de Directory (`contexts/{jobSourceId}/outlooks/`,
documentado en `docs/svc-3-week-outlook-handoff.md`) — ese es un editor en
vivo con listeners, versionado y concurrencia optimista, pensado para
usuarios internos autenticados editando un job. La pestaña de CRC es mucho
más simple por diseño:

- Un super/PM llena un formulario público en `/outlook-form` — **sin login**,
  pensado para que se complete desde el celular en el sitio de obra.
- El submit crea **un documento nuevo, de una sola vez** en
  `outlookFormSubmissions` (`createOutlookFormSubmission`) — no hay draft
  colaborativo, no hay listener en tiempo real, no hay concurrencia que
  resolver.
- Un admin de CRC lo revisa después: lista paginada, detalle de solo lectura,
  botón "Mark reviewed", botón "Generate PDF".

Esta simplicidad es la razón por la que la pestaña ya es rápida: no hereda
ninguno de los costos del editor rico de Directory (sin listeners, sin
versiones, sin recalculo de scheduling en el cliente). El único costo real
es el ya cubierto en §3.5 (el índice automático de `tasks`/`generalNotes`,
que nadie consulta) y en §3.8 (el PDF se regenera cada vez que se pide).

Un dato de UX a tener en cuenta, no de performance: el formulario público no
requiere login, así que cualquiera con el link puede enviar un submission.
Eso es la decisión de producto correcta para que un super lo complete sin
fricción desde el sitio — pero significa que el volumen de `outlookFormSubmissions`
no está acotado por "usuarios de la app" como sí lo está `/admins`; si el link
se comparte ampliamente, esta es la colección de CRC con mayor potencial de
crecimiento no controlado, y la primera candidata a necesitar paginación real
en la lista (hoy usa `LIST_PAGE_SIZE = 100` sin scroll infinito, ver
`courtney-roberts-center-screen.tsx`).

### 3.8 PDF de Outlook Form: generado on-demand, sin caché

`GET /outlook-forms/:id/pdf` reconstruye el PDF en cada request — el propio
comentario documenta que es intencional ("Firestore doc stays the source of
truth"). Con el volumen actual (exportación manual, iniciada por un admin)
esto es apropiado: cachear introduciría un problema de invalidación
(¿cuándo el PDF cacheado queda stale respecto al submission?) para un ahorro
de CPU que hoy no importa. No se recomienda cambiarlo.

## 4. Cambios aplicados en esta sesión

| Archivo | Cambio | Efecto medible |
|---|---|---|
| `lib/courtney-roberts-center/read-api.ts` | `getCourtneyRobertsCenterConversationThread`: lecturas de conversación + mensajes en paralelo (`Promise.all`) | −1 round-trip de red por apertura de hilo |
| `lib/courtney-roberts-center/access.ts` | `requireCourtneyRobertsCenterAdmin` devuelve `name` junto con `uid`/`email`, leído una sola vez | −1 lectura de `/users/{uid}` por respuesta manual enviada |
| `app/api/courtney-roberts-center/conversations/[conversationId]/reply/route.ts` | Eliminado el helper `adminDisplayName()` y su import no usado; usa `admin.name` | Simplifica la ruta, mismo comportamiento observable |

Verificado con `pnpm exec tsc --noEmit` (limpio en todo archivo tocado; los
errores restantes preexisten en `functions/` y son de un paquete/tooling
distinto, no relacionados) y `pnpm exec tsx --test
scripts/courtney-roberts-center.test.ts` (27/27).

Ninguno de los tres cambios toca el webhook de WhatsApp, el schema de
Firestore, ni el contrato público de las rutas — son optimizaciones de
lectura puramente internas.

## 5. Plan recomendado por orden de retorno

### Ya aplicado (esta sesión)
1. Paralelizar lectura de conversación + mensajes al abrir un hilo (§3.2).
2. Eliminar la doble lectura de `/users/{uid}` en `reply` (§3.3).

### P0 — antes de que el volumen de WhatsApp crezca
3. Eliminar la lectura suelta de `isCourtneyRobertsCenterAiPaused` (§3.1):
   derivarla de la transacción que ya registra el mensaje entrante, en vez de
   un segundo round-trip. Requiere su propio PR — toca el camino crítico del
   webhook y sus invariantes de orden documentados.

### P1 — costo silencioso, no urgente
4. Inventariar y eximir (`fieldOverrides`) el índice automático de `text` y
   `attachments` en `messages`, y de `tasks`/`generalNotes` en
   `outlookFormSubmissions` (§3.5).
5. Si el panel de CRC empieza a usarse con más frecuencia, agregar un caché
   en memoria simple por conversationId (§3.4) — no hace falta IndexedDB,
   basta con no repetir el fetch al volver de un hilo ya cargado.

### P2 — vigilar, no actuar todavía
6. Paginar `listCourtneyRobertsCenterAccessUsers` si `/users` supera el orden
   de las decenas (§3.7) — hoy es una decisión correcta al tamaño actual.
7. Incluir `courtneyRobertsCenterConversations/*/messages` en cualquier
   política de retención de mensajes que se defina a nivel de producto (§3.6).

## 6. Qué no conviene hacer

- No agregar un listener en tiempo real al hilo o a la lista de
  conversaciones — el panel de admin no lo necesita, y sería reintroducir
  exactamente el patrón "sin ventana" que la auditoría general identifica
  como el mayor problema de Communications.
- No cachear el PDF de Outlook Form — el costo de invalidación no vale el
  ahorro de CPU al volumen actual (§3.8).
- No tocar el flujo del webhook de WhatsApp sin pruebas contra el emulador:
  los tres módulos de identidad, pausa de IA y transcript comparten
  invariantes de orden documentados explícitamente en los comentarios del
  código (`history-store.ts`, `manual-reply.ts`) que una refactorización
  apurada podría romper de forma silenciosa.
- No migrar `/messages` a una colección sin subcolección (aplanarla bajo la
  conversación) — la estructura actual ya permite paginar por conversación
  sin traer documentos de otras conversaciones, que es exactamente lo que se
  necesita.

## 7. Fuentes oficiales relevantes

- [Cloud Firestore: best practices](https://firebase.google.com/docs/firestore/best-practices)
  — cursors, fan-out de índices, diseño de transacciones.
- [Cloud Firestore: transactions and batched writes](https://firebase.google.com/docs/firestore/manage-data/transactions)
  — costo y semántica de una transacción frente a lecturas/escrituras sueltas.
- [Cloud Firestore: pricing](https://firebase.google.com/docs/firestore/pricing)
  — facturación por documento leído/escrito, relevante para §3.1 y §3.3.
- [Cloud Firestore: field-level index exemptions](https://firebase.google.com/docs/firestore/query-data/index-overview#field-overrides)
  — mecanismo concreto para §3.5.

## 8. Actualización: "Generate Outlook" — convertir un submission en un Outlook real

> Cambios pusheados directo a `main` (commits `b60d8f2`, `481d587`,
> `41aaf4b`) fuera de esta rama — no forman parte de los fixes de esta
> auditoría, se documentan acá porque tocan directamente la sección que este
> archivo ya cubre. Revisión de solo lectura del diff, sin ejecutar nada.

La pestaña "Outlook Forms" dejó de ser solo una cola de revisión (§3.8b): un
submission ahora puede **convertirse en un 3-Week Outlook real** de
Directory — el mismo editor colaborativo documentado en
`docs/svc-3-week-outlook-handoff.md` — vía una pantalla nueva
(`courtney-roberts-center-form-generate-screen.tsx`, 642 líneas) donde el
admin edita las tareas, resuelve el job contra Directory si hace falta
(`outlook-form-job-resolver.tsx`), y confirma "Generate Outlook".

### Lo bueno: una sola implementación, no dos copias

El hallazgo más importante de este cambio es de diseño, no de bug: la
secuencia "publicar versión → generar PDF → subirlo a Directory Files →
postear a Comms" existía antes solo dentro del editor de Directory
(`use-job-outlook-controller.ts`). Se extrajo a
`features/outlooks/generate-real-outlook.ts` y **ambos** callers —el editor
de Directory y esta pantalla nueva de CRC— llaman a la misma función. Antes
de este cambio, agregar esta feature del modo obvio hubiese significado
copiar esa secuencia una segunda vez; el refactor evita exactamente el tipo
de deuda que la auditoría de Firebase general marca como riesgo ("cada
feature nueva agrega otro camino paralelo en vez de reusar el existente").

### Lecturas en cascada al abrir la pantalla — esperado, no un bug

Abrir "Review Outlook" hace, en cascada (cada paso depende del anterior, no
son paralelizables entre sí):

1. `fetchOutlookFormSubmission()` — 1 request a la API de CRC.
2. Si el submission ya tiene `jobContextId`: `loadDirectoryProfileViewModel()`
   — lectura cliente de Directory (índice + fuente en paralelo, ya
   optimizado — ver `svc-directory-performance-optimization.md`).
3. Con el job resuelto: `getJobOutlookDraft()` — un `getDoc` cliente, para el
   aviso de colisión ("ya existe un outlook para este job/semana").

Tres round-trips en cascada es real, pero cada uno es un point-read barato,
y es una pantalla que un admin abre para revisar un submission puntual —no
un camino de alta frecuencia como el webhook de WhatsApp (§3.1). No amerita
paralelizarlo: el paso 3 necesita el resultado del paso 2, así que no hay
nada que ganar corriéndolos juntos sin cambiar el orden de dependencia real.

### El botón "Generate Outlook" es lento a propósito — y lo comunica bien

Tocar "Generate Outlook" dispara una cadena larga: re-chequeo de colisión →
publicar versión (transacción Firestore con concurrencia optimista) →
generar el PDF en el browser (CPU) → subirlo a Storage (red) → adjuntarlo a
la versión → grabar la conversión en el submission → postear a
Communications. Es la misma cadena que el editor de Directory ya hacía, así
que no es más lenta que antes — solo tiene un caller nuevo. A diferencia del
hallazgo de ByeByeDPR (§3.1 de `svc-bye-bye-dpr-performance-ux-audit.md`),
acá el usuario es un admin de oficina haciendo una acción deliberada y poco
frecuente, no un trabajador de campo esperando "en segundos" — la tolerancia
a unos segundos de espera es razonable acá, y el botón ya muestra
"Generating…" / "Saving…" mientras corre.

Lo que sí está bien resuelto, en términos de integridad de datos: si la
publicación de la versión tiene éxito pero el registro de conversión
(`convertOutlookFormSubmission`) falla después (red cortada, 500
transitorio), el estado `createdVersion` sobrevive en memoria y "Retry
saving" reintenta solo el paso que falló — nunca publica una segunda versión
huérfana. Mismo criterio de idempotencia que ya usa el resto del módulo
(mensajes de WhatsApp, respuestas manuales).

### Un campo nuevo con nombre engañoso — no es un problema hoy, pero vale registrarlo

`OutlookFormSubmission.jobContextId` ahora guarda el id **compuesto** de
Directory (`job__<id>`), no un id crudo de `contexts` como su nombre y su
comentario original sugerían — el propio diff lo señala explícitamente
("Despite the name, this is NOT a raw contexts/{id} doc id"). No es un bug:
cada lugar que lo usa ya lo desenvuelve con `parseDirectoryId(...)?.sourceId`
correctamente. Se deja anotado acá porque es exactamente el tipo de
discrepancia nombre/contenido que la auditoría general de Firebase (§9.2)
señala como fuente de bugs futuros si un caller nuevo asume la forma vieja
por el nombre del campo en vez de leer el comentario.

### Nada de esto cambia el veredicto de §3.8b

La pestaña sigue sin listeners, sigue paginada, y el nuevo estado
`"converted"` es solo un tercer valor de un campo que ya se filtraba en
memoria (mismo patrón, sin query nueva). El riesgo de crecimiento sin techo
del link público (§3.8b) tampoco cambia — sigue siendo el mismo formulario
sin login.

## 9. "Generate Outlook" — revisión de correctitud (cabos sueltos)

> Pasada dedicada a buscar bugs y flujos incompletos, no solo performance.
> Un hallazgo (9.1) se corrigió en esta sesión; el resto queda documentado
> con su severidad real porque son decisiones de producto o requieren más
> alcance que un ajuste de una línea.

### 9.1 Datalist de autocompletar compañía nunca se renderizaba — **corregido**

`SimpleTaskCard` (dentro de `courtney-roberts-center-form-generate-screen.tsx`)
renderiza `<input list="crc-outlook-company-options">` en el campo Company de
cada tarea, y la prop `companies` se pasa a través de 4 niveles de
componentes específicamente para alimentar ese autocomplete — pero en
ningún lugar del archivo existía el `<datalist id="crc-outlook-company-options">`
correspondiente. El mismo patrón (`<input list="...">` + `<datalist id="...">`
justo debajo) ya existe en los dos editores de Outlook de Directory
(`outlook-advanced-view.tsx`, `outlook-advanced-sheet.tsx`) — se confirmó
comparando ambos. Sin el datalist, escribir en el campo Company nunca
mostraba sugerencias: ni error en consola, ni diferencia visual con un input
de texto plano — simplemente el admin no tenía forma de saber qué compañías
ya existen en Directory al revisar las tareas de un submission. Se agregó el
`<datalist>` faltante, mismo patrón que los otros dos editores. Verificado
con `pnpm exec tsc --noEmit` (limpio) y `pnpm exec tsx --test
scripts/outlook-form-submissions-core.test.ts` (18/18).

### 9.2 Resolver el job a mano deja el PDF sin compañía/ubicación

Hay dos caminos para que `resolvedJob` quede seteado:

- **Automático** (`submission.jobContextId` ya existe): usa
  `loadDirectoryProfileViewModel()`, que sí trae `companyName`/`location`
  reales de Directory.
- **Manual** (el admin busca o crea el job vía `OutlookFormJobResolver`):
  `onResolved` setea `resolvedJob` con `companyName: null, location: null`
  siempre — ninguna de las dos ramas (`handleSelectDirectoryResult`
  equivalente aquí, ni la creación) enriquece esos campos después.

`handleGenerate()` manda exactamente esos valores a `generateRealOutlook()`,
que los usa en el encabezado del PDF. Resultado: un submission cuyo job se
resuelve manualmente (típicamente "Other / not listed" en el formulario
público, el caso menos automatizado y por eso el que más necesita ayuda)
termina con un PDF sin compañía ni ubicación en el encabezado, aunque el job
real en Directory sí las tenga. No se corrigió en esta pasada — el fix es
sencillo (llamar a `loadDirectoryProfileViewModel()` también dentro de
`onResolved`) pero se dejó documentado en vez de tocado a ciegas, ya que
implica un round-trip extra en un flujo que hoy responde instantáneo al
elegir un resultado.

### 9.3 Un fallo de red durante la resolución automática se disfraza de éxito

Si `loadDirectoryProfileViewModel()` falla por cualquier motivo que no sea
"el doc no existe" (un blip de red, un timeout), el `.catch()` arma un
`resolvedJob` de todos modos — con `name: submission.jobName` (el texto que
tipeó el super en el formulario, nunca verificado contra Directory) y
`companyName`/`location` en `null`. La `JobCard` no distingue este caso del
de una resolución exitosa: ambos se ven igual, "resuelto". Un admin podría
tocar "Generate Outlook" creyendo que el job fue confirmado contra Directory
cuando en realidad nunca se pudo verificar. Práctico: bajo riesgo real
(Directory casi nunca falla en un point-read), pero es la clase de error que,
si ocurre, es indistinguible de un caso normal en la UI.

### 9.4 Una recarga de página entre "Outlook creado" y "bookkeeping guardado" puede duplicar la versión

`handleGenerate()` guarda el resultado de `generateRealOutlook()` en el
estado `createdVersion` — el comentario en el código explica que esto existe
para que un reintento no publique una segunda versión huérfana. Es cierto,
pero **solo dentro de la misma instancia del componente**: `createdVersion`
es `useState`, no algo persistido (ni en el submission, ni en localStorage).
Si el navegador se recarga o se cierra justo después de que
`generateRealOutlook()` tuvo éxito pero antes de que
`convertOutlookFormSubmission()` (el bookkeeping) termine, al reabrir la
pantalla el submission sigue figurando como no convertido — reintentar desde
cero vuelve a pasar por el aviso de colisión ("ya existe un outlook, esto lo
va a sobrescribir") y publica una versión nueva (`v0002`, no un
overwrite real — cada publish es una versión nueva e inmutable), dejando la
primera (`v0001`) huérfana: existe en Firestore, tiene PDF, pero ningún
submission la referencia. No corrompe datos ni bloquea nada — es
desperdicio silencioso, no un error visible. Ventana de tiempo real pero
angosta (milisegundos a pocos segundos entre dos writes en el mismo
request), y de bajo impacto (un doc extra en una subcolección, nunca
mostrado como "la versión oficial" en ningún lado). Se deja documentado, no
corregido — resolverlo bien requeriría persistir el resultado intermedio en
el propio submission antes de intentar el bookkeeping, un cambio de forma de
datos, no un ajuste de UI.

### 9.5 Borrar un submission ya convertido no avisa que rompe el rastro de auditoría

El flujo de borrado (`handleDelete` en `courtney-roberts-center-form-detail-screen.tsx`)
usa el mismo diálogo genérico ("Delete this submission? This can't be
undone.") sin importar el `status` del submission. Borrar uno ya
`"converted"` es seguro en el sentido de que la data real (el Outlook, su
PDF, el archivo en Directory) **no se toca** — así lo documenta el propio
comentario de `deleteOutlookFormSubmission()` — pero sí borra
`convertedByName`/`convertedAtMs`/`convertedVersionId`, es decir, la única
prueba de "qué submission produjo este Outlook y quién lo generó". Después
de borrar, el Outlook en Directory queda igual de funcional, pero
huérfano de contexto: nadie podría reconstruir después qué formulario en
papel/WhatsApp lo originó. Sugerencia de bajo costo: un mensaje de
confirmación distinto cuando `status === "converted"`, explícito sobre qué
se pierde.

### 9.6 Caso límite teórico: `jobContextId` apuntando a un job de Directory borrado

`publishJobOutlook()` escribe en `contexts/{jobId}/outlooks/{windowStart}`
sin verificar que `contexts/{jobId}` exista — Firestore no lo exige para una
subcolección. Si el job de Directory al que apunta un submission fuera
borrado entre el momento en que se vinculó y el momento en que se genera el
Outlook, la escritura igual tendría éxito, pero el resultado sería
inalcanzable desde la UI de Directory (que lista jobs a partir de
`/contexts`/`/directoryIndex`, ninguno de los cuales existiría ya). Probable
solo en teoría hoy — no se encontró ningún flujo en el código que borre un
`/contexts` doc — se deja registrado por completitud, no como una acción
pendiente real.

### Flujos que SÍ están completos y no necesitan nada más

Para que quede explícito qué se revisó y no encontró problema:

- **Confirmar salir con contenido a medias.** No hay draft que se pierda:
  el submission original queda intacto (nunca se sobreescribe) hasta que
  "Generate Outlook" tiene éxito.
- **Tarea eliminada de la que otras dependían.** `scheduleOutlookTasks()` ya
  detecta la dependencia inexistente como issue bloqueante — no se puede
  publicar con una referencia rota, falla visible, no silenciosa.
- **Cambiar de job a mitad de revisión.** El aviso de colisión se re-consulta
  automáticamente al cambiar de job (el `useEffect` depende de
  `resolvedJob`), así que nunca queda un aviso de colisión "pegado" del job
  anterior.
- **Reabrir un submission ya convertido.** Re-resuelve la versión real desde
  sus 3 campos de tracking con un solo `getDoc`, y evita el refetch si ya la
  tiene en memoria (mismo `id`) — no hay parpadeo de "Loading PDF…"
  innecesario.
- **Reintento tras un conflicto de revisión real** (otro admin/editor tocó
  el draft entre el aviso y la publicación): como `handleGenerate()`
  re-consulta `getJobOutlookDraft()` fresco en cada intento (no cachea la
  revisión del primer chequeo), un segundo tap después de un
  `OutlookConflictError` funciona sin recargar la pantalla.

### Acciones/flujos que faltan — respuesta directa a "qué falta"

- **Deshacer una conversión.** Hoy no existe un botón "unconvert" — la única
  forma de revertir es borrar el submission (pierde el rastro, §9.5) o ir a
  editar el Outlook directamente desde Directory. Si conviene agregar un
  "unconvert" explícito (que solo borre el vínculo, no el Outlook) es una
  decisión de producto, no algo que falte por descuido.
- **Detección de duplicados entre submissions.** Dos supers (o el mismo dos
  veces) pueden mandar formularios para el mismo job y semana sin que CRC lo
  señale hasta que un admin intenta generar el segundo — ahí sí aparece el
  aviso de colisión, pero no antes, en la lista.
- **El aviso de colisión es pasivo, no bloqueante.** "Generating will
  overwrite it" es un banner que se puede no leer — no exige una
  confirmación explícita aparte del botón normal de generar. Para una acción
  que crea una versión nueva sobre un draft con trabajo de otra persona,
  podría justificarse un confirm dialog en vez de solo un texto de aviso.
- **Gestión de compañías inexistentes en una tarea.** El datalist recién
  arreglado (§9.1) solo sugiere; si el admin tipea un nombre que no
  coincide exactamente con ninguna compañía real, la tarea se guarda sin
  `companyContextId` sin ningún aviso — mismo comportamiento que el editor
  de Directory ya tiene, no es una regresión nueva, pero tampoco está
  resuelto en ningún lado del código.

## 10. Conclusión

CRC no tiene un problema de arquitectura de lectura — ya sigue el patrón que
la auditoría general de Firebase recomienda como modelo para el resto de la
app (paginado, cursor, sin listeners globales). El costo real vivía en
detalles puntuales y verificables por lectura de código: dos lecturas
secuenciales que podían ser paralelas, un documento de usuario leído dos
veces en el mismo request, y una lectura suelta del documento de conversación
que duplica lo que una transacción cercana ya había leído. Los primeros dos
ya están corregidos; el tercero queda documentado con su propia
recomendación porque vive en el camino crítico del webhook y merece su propio
ciclo de prueba.
