# SVC Directory: 3-Week Outlook handoff

Última actualización: 2026-07-17

> ⚠️ **Nota (2026-07-18):** las secciones que hablan de la IA/voz como "trabajo
> futuro" (y "No existe actualmente: LLM / transcripción / parsing") están
> **desactualizadas** — esa capa **ya está implementada** en modo mock. Para el
> estado real de la IA y cómo pasar a live con una API key, ver
> **`docs/svc-outlook-ai-handoff.md`**. Este doc sigue siendo la referencia del
> dominio determinístico (fechas, scheduling, versiones, PDF, persistencia).

## Propósito

Este documento resume el trabajo realizado para el MVP de `3-Week Outlook` dentro de SVC Directory. Está pensado como punto de entrada para otro agente o desarrollador que deba continuar con la siguiente etapa: entrada por lenguaje natural, integración con IA y transcripción de voz.

El objetivo principal de la siguiente etapa debe ser agregar asistencia para capturar y estructurar información sin reemplazar la lógica determinística actual de fechas, dependencias, validación, versiones, PDF y publicación.

## Resumen ejecutivo

El MVP actual ya permite:

- abrir un Outlook desde el detalle de un job;
- trabajar en una ventana exacta de 21 días;
- crear y editar tareas estructuradas;
- relacionar trade, company y dependencias;
- calcular fechas finales de manera determinística;
- detectar datos faltantes, dependencias inválidas y conflictos;
- guardar un draft colaborativo en Firestore;
- publicar snapshots versionados e inmutables;
- generar un PDF determinístico;
- guardar el PDF como archivo de Directory;
- compartirlo o descargarlo;
- preparar un mensaje de Stream con el PDF adjunto mediante `Post update`.

No existe actualmente:

- integración con Gemini, GPT u otro LLM;
- transcripción de voz;
- grabación o persistencia de audio;
- parsing de texto libre a tareas;
- Google Calendar;
- sistema especial de roles para Outlook;
- cálculo por días hábiles, feriados o calendarios laborales.

## Decisiones de producto vigentes

- El job sigue siendo la fuente de verdad y el Outlook vive bajo el job fuente.
- No se creó un producto ni un sistema de permisos separado.
- Todos los usuarios autenticados de SVC pueden colaborar en el draft durante V1.
- La experiencia usa progressive disclosure:
  - panel simple dentro del job;
  - pantalla completa cuando se necesita más control;
  - Advanced es una vista opcional de los mismos datos.
- La IA futura debe proponer datos, no publicar ni generar fechas finales sin confirmación.
- Después de la confirmación, scheduling, validación, versionado y PDF deben continuar siendo determinísticos.
- `Post update` no publica silenciosamente: abre Compose con texto, contexto y adjunto precargados para que el usuario confirme.

## Stack relevante

- Next.js 16.2 con App Router.
- React 19.
- TypeScript.
- Tailwind CSS 4.
- Firebase Auth.
- Cloud Firestore.
- Firebase Storage.
- Firebase Functions disponibles en el repositorio, aunque el Outlook MVP se ejecuta principalmente desde el cliente.
- `pdf-lib` para generación del PDF.
- Lucide para los iconos existentes de la app.

No se agregó ninguna dependencia de IA, audio o speech-to-text.

## Punto de entrada en Directory

La integración comienza en:

- `components/directory/directory-profile-screen.tsx`

`DirectoryProfileScreen` agrega la pestaña `Outlook` sólo para entidades `job`.

Estados relevantes:

- `tab === "outlook"` muestra el panel embebido;
- `fullOutlook === true` muestra la pantalla dedicada;
- la pantalla dedicada conserva el header de Directory y cambia el contenido central.

Render embebido:

```tsx
<ThreeWeekOutlookTab
  job={vm}
  userId={userId}
  companies={companies}
  onPostUpdate={onPostOutlook}
  mode="embedded"
  onSeeFullOutlook={() => setFullOutlook(true)}
/>
```

Render dedicado:

```tsx
<ThreeWeekOutlookTab
  job={vm}
  userId={userId}
  companies={companies}
  onPostUpdate={onPostOutlook}
  mode="full"
/>
```

## Identidad del job: distinción crítica

El view model del job contiene dos IDs diferentes:

- `job.id`: ID de la proyección/entidad de Directory;
- `job.sourceId`: ID del documento fuente en `contexts`.

El Outlook se guarda bajo `job.sourceId`, porque pertenece al job fuente:

```text
contexts/{job.sourceId}/outlooks/{windowStart}
```

El campo `jobDirectoryId` guarda además `job.id` para vincular archivos y Directory.

No intercambiar estos IDs al agregar endpoints de IA, Functions o Storage.

## Flujo UX actual

### Panel embebido dentro del job

El panel tiene dos vistas:

1. `Preview`
   - muestra una mini vista de las tres semanas;
   - lista tareas resumidas;
   - muestra rango, cantidad de tareas, trades y estado del draft/versionado.

2. `Quick Update`
   - actualmente es un formulario estructurado para agregar una tarea;
   - campos principales: task name, start date y duration;
   - trade y company aparecen como detalles opcionales;
   - al guardar vuelve a Preview.

Ambas vistas ofrecen `See full outlook`.

### Pantalla dedicada

Tiene tres tabs inline:

1. `Preview`
   - Gantt de 21 días;
   - encabezados Week 1, Week 2 y Week 3;
   - marcador de hoy cuando está dentro de la ventana;
   - barras por tarea;
   - filas compactas con trade, company, fecha, duración y estado;
   - acciones inferiores: Quick update, Generate PDF y Post update.

2. `Tasks`
   - búsqueda;
   - filtros All, Planned, Active, At risk y Done;
   - Add task;
   - tarjetas con punto de color, título, trade, company, fecha, duración, progreso circular, dependencia y estado;
   - tocar una tarjeta abre el detalle;
   - desde el detalle se puede pasar a Advanced.

3. `Advanced`
   - resumen de progreso por semana;
   - múltiples tarjetas pueden permanecer expandidas;
   - campos editables: task, description, trade, company, start date, duration, dependency, status y completion;
   - permite agregar y eliminar tareas;
   - acciones inferiores: Save, Generate PDF y Post update.

### Selector de ventana

La pantalla dedicada ya no usa flechas para avanzar o retroceder bloques completos.

El usuario elige la fecha inicial exacta mediante un input de fecha. La fecha final se calcula automáticamente como inicio más 20 días.

El valor inicial continúa siendo el lunes de la semana local actual:

```ts
const [windowStart, setWindowStart] = useState(() => mondayForDate(new Date()))
```

Después de seleccionar otra fecha, no se normaliza a lunes. Cualquier fecha ISO válida puede ser inicio de una ventana.

Cada fecha inicial identifica un draft independiente en Firestore. Cambiar la fecha no desplaza automáticamente las tareas del draft anterior: carga el Outlook correspondiente a la nueva clave `windowStart`.

## Componentes activos

### Orquestación

- `components/directory/outlooks/three-week-outlook-tab.tsx`
  - selecciona modo embedded/full;
  - compone las tres tabs;
  - controla sheets, task seleccionada y drafts locales de Advanced;
  - define las acciones inferiores según la tab activa.

- `features/outlooks/use-job-outlook-controller.ts`
  - suscripciones Firestore;
  - estado de carga, guardado, errores y notices;
  - selección de ventana;
  - persistencia del draft;
  - publicación y generación del PDF;
  - preparación de Post update.

### Preview

- `components/directory/outlooks/outlook-gantt-calendar.tsx`
- `components/directory/outlooks/outlook-preview-view.tsx`
- `components/directory/outlooks/outlook-inline-preview.tsx`

### Tasks

- `components/directory/outlooks/outlook-tasks-view.tsx`
- `components/directory/outlooks/outlook-task-detail-sheet.tsx`

### Quick Update

- `components/directory/outlooks/outlook-quick-task-sheet.tsx`
- `EmbeddedQuickForm`, privado dentro de `three-week-outlook-tab.tsx`.

### Advanced

- `components/directory/outlooks/outlook-advanced-view.tsx`

### Acciones

- `components/directory/outlooks/outlook-action-bar.tsx`

### Estilos compartidos

- `app/globals.css`
  - `.outlook-label`;
  - `.outlook-input`;
  - `.outlook-compact-fields`;
  - variables de color de Directory/Job.

## Archivos legacy o actualmente no conectados

Estos archivos existen pero no forman parte del flujo activo de la pantalla dedicada actual:

- `components/directory/outlooks/outlook-advanced-sheet.tsx`
- `components/directory/outlooks/outlook-calendar-preview.tsx`

Antes de modificarlos, verificar si realmente se volvieron a conectar. Para la implementación actual, Advanced usa `outlook-advanced-view.tsx` y Preview usa `outlook-gantt-calendar.tsx`.

## Modelo de dominio determinístico

Archivo principal:

- `lib/outlook-core.ts`

Constantes:

```ts
OUTLOOK_SCHEMA_VERSION = 1
OUTLOOK_DAY_COUNT = 21
MAX_OUTLOOK_TASKS = 60
```

### OutlookWindow

```ts
interface OutlookWindow {
  start: string // YYYY-MM-DD
  end: string   // start + 20 días
}
```

### OutlookTask

```ts
interface OutlookTask {
  id: string
  sortOrder: number
  title: string
  description: string
  trade: string
  companyName: string
  companyContextId: string | null
  startDate: string | null
  durationDays: number
  endDate: string | null
  dependencyTaskId: string | null
  status: "not_started" | "in_progress" | "blocked" | "complete"
  completionPercent: number
}
```

Notas:

- `companyContextId` conserva un nombre histórico; actualmente recibe el ID de la company provista por Directory.
- `endDate` se vuelve a calcular; no debe confiarse en un end date sugerido por IA.
- `sortOrder` se normaliza según el orden del array.
- `completionPercent` se limita entre 0 y 100.
- `durationDays` se redondea y tiene mínimo 1.

### Scheduling y validación

Función central:

```ts
scheduleOutlookTasks(tasks, window)
```

Reglas actuales:

- las duraciones son días calendario, no días hábiles;
- las fechas son inclusivas;
- una tarea de 3 días iniciada el 16 termina el 18;
- si una tarea sólo tiene dependency, comienza el día calendario siguiente al end date de la dependencia;
- un start date explícito anterior al final de su dependencia se conserva, pero genera un conflicto bloqueante;
- las dependencias circulares bloquean publicación;
- una dependencia inexistente bloquea publicación;
- faltar title, start date válido o duration bloquea publicación;
- comenzar o terminar fuera de la ventana genera warning, pero no bloquea publicación;
- el máximo procesado es 60 tareas;
- `canPublish` requiere al menos una tarea y cero issues bloqueantes.

La futura IA no debe duplicar estas reglas. Debe producir candidatos y pasar el resultado por `createOutlookTask` y `scheduleOutlookTasks`.

## Persistencia Firestore

Archivo:

- `lib/job-outlooks.ts`

### Draft

Ruta:

```text
contexts/{jobSourceId}/outlooks/{windowStart}
```

El ID del documento es la fecha inicial ISO, por ejemplo:

```text
contexts/abc123/outlooks/2026-07-17
```

Campos relevantes:

```text
schemaVersion
jobId
jobDirectoryId
windowStart
windowEnd
tasks[]
revision
nextVersionNumber
latestPublishedVersionId
latestPdfUrl
createdBy
createdAt
updatedBy
updatedAt
```

### Versiones publicadas

Ruta:

```text
contexts/{jobSourceId}/outlooks/{windowStart}/versions/{versionId}
```

Formato de version ID:

```text
v0001
v0002
v0003
```

Campos relevantes:

```text
schemaVersion
versionNumber
kind: "published"
jobId
jobDirectoryId
windowStart
windowEnd
tasks[]
createdBy
createdAt
pdf
```

El snapshot de `tasks` queda congelado en la versión. El PDF se adjunta después mediante una actualización limitada al campo `pdf`.

### Concurrencia

El draft usa optimistic concurrency:

- el controller conserva `revisionRef`;
- cada save/publicación envía `expectedRevision`;
- la transacción exige que la revisión coincida;
- cada write incrementa `revision` exactamente en uno;
- si otro dispositivo modificó el draft, se lanza `OutlookConflictError`.

Una integración de IA no debe escribir directamente sobre el documento saltándose `saveJobOutlookDraft` o el control de revisión.

### Suscripciones

El controller mantiene listeners en tiempo real para:

- draft de la ventana seleccionada;
- últimas 20 versiones, ordenadas por `versionNumber` descendente.

Al cambiar `window.start`, se limpian draft, tasks, versions y revision antes de suscribirse a la nueva ruta.

## Reglas de seguridad

### Firestore

Archivo:

- `firestore.rules`

V1 no usa roles especiales:

- cualquier usuario autenticado puede leer Outlooks;
- cualquier usuario autenticado puede crear/actualizar el draft respetando identidad, ventana y revisión;
- no se permite borrar drafts;
- las versiones publicadas no se borran;
- una versión sólo puede actualizar el campo `pdf` después de creada.

El repositorio contiene estas reglas. Antes de probar un ambiente nuevo, confirmar que las reglas estén desplegadas en el proyecto Firebase correcto.

### Storage

Archivo:

- `storage.rules`

Los PDFs usan:

```text
directory-files/{userId}/{timestamp}-{fileName}
```

Reglas actuales:

- lectura para usuarios autenticados;
- escritura sólo cuando `request.auth.uid == userId`;
- límite de 15 MB;
- `application/pdf` permitido.

## Guardado de archivos de Directory

Archivo:

- `lib/directory-files.ts`

`uploadDirectoryFile` realiza dos operaciones:

1. sube el binario a Firebase Storage;
2. crea un documento en `directoryFiles` con:
   - `entityIds`;
   - `storagePath`;
   - `downloadUrl`;
   - `fileName`;
   - `mimeType`;
   - `size`;
   - `category`;
   - `caption`;
   - `uploadedBy`;
   - `createdAt`.

El PDF del Outlook usa category `report` y se vincula mediante `job.id`, el ID de Directory.

## Flujo exacto de Generate PDF

La implementación está en:

- `features/outlooks/use-job-outlook-controller.ts`
- `features/outlooks/pdf/generate-outlook-pdf.ts`
- `features/outlooks/pdf/share-outlook-pdf.ts`

Secuencia:

1. bloquea la acción si ya se está guardando o generando;
2. valida/schedulea tasks;
3. publica una nueva versión Firestore, salvo que exista una versión sin PDF con exactamente las mismas tasks;
4. genera bytes PDF desde el snapshot confirmado;
5. crea un `File` en el browser;
6. sube el PDF a Directory Files/Storage;
7. adjunta metadata del PDF a la versión;
8. usa Web Share API si el dispositivo permite compartir files;
9. de lo contrario descarga mediante un object URL.

Si la publicación Firestore funciona pero Storage falla, la versión puede existir con `pdf: null`. Un retry con las mismas tasks reutiliza esa versión sin PDF.

Si una versión ya tiene PDF y el usuario vuelve a generar, se crea una nueva versión aunque las tareas sean iguales.

### Formato del PDF

- landscape, 792 x 612 points;
- encabezado con job, company, location y schedule window;
- leyenda agrupada por company/trade;
- calendario de tres semanas;
- task registry;
- primera página muestra hasta 4 filas del registry;
- páginas de continuación muestran hasta 17 filas;
- status y completion se reflejan en el registry;
- generado con fuentes estándar de `pdf-lib` y texto normalizado a ASCII.

### Deuda técnica conocida

El draft incluye `latestPdfUrl`, pero `attachPdfToOutlookVersion` actualmente sólo actualiza `version.pdf`. No sincroniza `latestPdfUrl` en el documento draft.

No basar la siguiente etapa en `draft.latestPdfUrl` sin corregir o confirmar este comportamiento. La UI actual usa `latestVersion.pdf`.

## Flujo de Post update

`postLatestVersion` sólo se habilita cuando:

- existe una latest version;
- esa versión tiene PDF;
- existe callback `onPostUpdate`.

Payload:

```ts
interface OutlookPostPayload {
  text: string
  contextId: string
  attachment?: MessageFileAttachment | null
}
```

En `app/page.tsx`, `handlePostOutlook`:

- precarga el texto;
- selecciona `job.sourceId` como contexto;
- precarga el PDF como attachment;
- abre Compose en fullscreen.

El usuario todavía debe revisar/enviar el mensaje.

## Estado de UI y diseño

El diseño es mobile-first y usa las superficies oscuras/glass de Directory.

Decisiones visuales vigentes:

- job accent basado en `--directory-job`;
- Preview usa Gantt alto, task names a la izquierda y barras sin texto interno;
- Tasks usa un punto de color pequeño, no icon tiles grandes;
- Advanced usa tarjetas técnicas compactas y permite varias expandidas;
- inputs se apilan en una columna en pantallas demasiado angostas;
- `.outlook-input` tiene `min-width: 0` y `max-width: 100%` para evitar overlap de date/duration en iOS;
- barra inferior sticky;
- Quick update/Generate PDF usan superficie oscura;
- Post update es el CTA violeta sólido;
- targets táctiles principales tienen aproximadamente 44-48 px de alto.

No reemplazar estos componentes con una UI aislada que no respete Directory.

## Estado local importante

En pantalla dedicada:

- `activeTab`: preview/tasks/advanced;
- `quickUpdateOpen`: sheet de creación;
- `selectedTask`: detalle de una tarea;
- `advancedFocusId`: abre en Advanced una tarea elegida desde Tasks;
- `advancedDrafts`: copia editable local;
- `advancedDirty`: evita que una actualización remota sobrescriba silenciosamente edits locales.

Al cambiar la ventana:

- se cierra task detail;
- se cierra Quick Update;
- se limpia el focus avanzado;
- se resetea dirty state.

## Pruebas y comandos

Pruebas del dominio y PDF:

```bash
pnpm test:outlooks
```

Actualmente cubren:

- lunes de semana y ventana de 21 días;
- durations inclusivas;
- resolución de dependencias;
- ciclos y warnings de overflow;
- generación de un PDF legible.

TypeScript:

```bash
pnpm typecheck
```

Build:

```bash
pnpm build
```

Verificación completa disponible en el proyecto:

```bash
pnpm verify
```

Generar un PDF local de muestra:

```bash
pnpm exec tsx scripts/generate-outlook-pdf-preview.ts
```

Salida default:

```text
tmp/pdfs/outlook-preview.pdf
```

## Integración futura de IA: frontera recomendada

La IA debe insertarse entre la captura del usuario y `createOutlookTask`, no dentro del scheduler ni del generador PDF.

Flujo recomendado:

```text
texto o transcript
  -> parser IA
  -> propuestas parciales + incertidumbres
  -> normalización contra job/company/tasks existentes
  -> review del usuario
  -> createOutlookTask
  -> scheduleOutlookTasks
  -> persist
  -> publish/PDF/post existentes
```

### Contrato sugerido del parser

No pedir al modelo que devuelva objetos Firestore completos. Usar un contrato de sugerencias sin campos derivados:

```ts
interface ParsedOutlookTaskSuggestion {
  clientSuggestionId: string
  title: string
  description?: string
  trade?: string
  companyName?: string
  startDate?: string | null
  durationDays?: number | null
  dependencyReference?: string | null
  status?: "not_started" | "in_progress" | "blocked" | "complete"
  completionPercent?: number
  confidence: {
    title: number
    startDate: number
    durationDays: number
    trade: number
    companyName: number
    dependencyReference: number
  }
  warnings: string[]
}
```

Después del review:

- generar IDs reales con `createOutlookTask`;
- resolver `companyName` contra `companies` y completar `companyContextId` sólo con match confirmado;
- resolver dependency por ID de una task existente o sugerida;
- ignorar cualquier `endDate` del modelo;
- ejecutar siempre `scheduleOutlookTasks`;
- mostrar issues determinísticos junto con incertidumbres del modelo.

### Contexto mínimo para el modelo

Enviar sólo lo necesario:

- texto/transcript;
- `window.start` y `window.end`;
- fecha local actual;
- job name y location si ayudan a desambiguar;
- lista acotada de companies disponibles;
- tasks actuales con ID/title/start/end para dependencias;
- reglas explícitas: no inventar fechas/durations cuando no están claras.

No enviar toda la base de Directory ni datos sensibles no relacionados.

### Seguridad

- Nunca colocar API keys de Gemini/OpenAI en el cliente.
- Preferir Firebase Callable Function o endpoint server-side autenticado.
- Verificar Firebase ID token antes de llamar al proveedor.
- Aplicado en las rutas actuales: límites server-side de tamaño/duración, timeout,
  rate limiting Firestore por usuario, lock distribuido, idempotencia y logging
  de metadata sin texto/audio/transcript.
- Validar la salida con un schema runtime antes de mostrarla.
- El servidor no debe escribir directamente el draft como efecto de una respuesta del modelo.

### Archivos sugeridos para IA

Una estructura posible:

```text
features/outlooks/ai/outlook-parser-contract.ts
features/outlooks/ai/normalize-outlook-suggestions.ts
features/outlooks/ai/parse-outlook-update-client.ts
components/directory/outlooks/outlook-natural-language-input.tsx
components/directory/outlooks/outlook-ai-review.tsx
functions/src/outlooks/parse-outlook-update.ts
```

Los nombres son sugerencias; confirmar primero las convenciones actuales de `functions/src`.

## Integración futura de voz

La voz no es necesaria para el dominio. Debe ser otra forma de obtener el mismo texto de entrada.

Flujo recomendado:

```text
micrófono
  -> audio temporal
  -> transcripción
  -> transcript editable
  -> mismo parser de texto
  -> mismo review
```

### Recomendación de arquitectura

- mantener `transcript` como estado editable antes de enviarlo al parser;
- no persistir audio por default;
- no guardar transcript en Firestore hasta que el usuario confirme una operación;
- cancelar tracks del micrófono al cerrar/unmount;
- indicar recording, processing, error y permission denied;
- imponer tamaño/duración máximos;
- reutilizar exactamente el mismo endpoint de parsing para texto escrito y transcripto.

### Opciones técnicas

1. Speech recognition nativo del browser
   - menor costo inicial;
   - soporte y comportamiento inconsistentes entre browsers/PWA;
   - no debería ser la única estrategia para una función crítica.

2. MediaRecorder + servicio speech-to-text
   - comportamiento más controlable;
   - requiere backend, proveedor, costo y política de retención;
   - API key siempre server-side.

3. Transcripción dentro del mismo proveedor de IA
   - simplifica vendors;
   - sigue requiriendo endpoint seguro y monitoreo de costo.

La selección de proveedor quedó deliberadamente abierta.

### Archivos sugeridos para voz

```text
features/outlooks/voice/use-outlook-recorder.ts
features/outlooks/voice/transcribe-outlook-audio-client.ts
components/directory/outlooks/outlook-voice-control.tsx
functions/src/outlooks/transcribe-outlook-audio.ts
```

## Flujo UX recomendado para la siguiente etapa

### Quick Update

Mantener el formulario estructurado actual como fallback y agregar una entrada simple:

- textarea para escribir o pegar notas;
- botón de micrófono cuando voz esté habilitada;
- transcript visible y editable;
- CTA `Review tasks`, no `Save` directo.

### Review de IA

Antes de persistir:

- mostrar task suggestions como cards editables;
- destacar missing/uncertain fields;
- permitir match/corrección de company;
- permitir resolver dependency;
- mostrar fecha y duration interpretadas;
- ofrecer `Add to outlook` sólo después de revisión.

### Confirmación

Al confirmar:

1. convertir suggestions con `createOutlookTask`;
2. combinar con tasks actuales;
3. ejecutar `scheduleOutlookTasks`;
4. mostrar issues determinísticos;
5. llamar `persist` únicamente si el usuario acepta.

No generar PDF automáticamente después del parsing.

## Riesgos y preguntas abiertas para IA/voz

### Producto

- ¿El texto libre crea tareas nuevas solamente o también puede actualizar tareas existentes?
- ¿Cómo debe expresarse una eliminación mediante lenguaje natural?
- ¿Se necesita guardar el texto original/transcript para auditoría?
- ¿Debe una sugerencia de IA quedar asociada a una versión o sólo a un draft?
- ¿Cuál es el máximo razonable de tareas por una sola nota?

### Fechas

- ¿Cuál es la timezone oficial de cada job?
- ¿`next week` empieza lunes o siete días después?
- ¿Las duraciones futuras seguirán siendo días calendario?
- ¿Se deben excluir domingos, fines de semana o feriados?
- ¿Qué ocurre con frases como `after that` cuando hay varias tareas candidatas?

### Entidades

- ¿El modelo puede proponer una company inexistente o debe forzar match?
- ¿Qué lista oficial de trades se debe usar?
- ¿Debe dependency aceptar milestones externos al Outlook?

### Voz y privacidad

- proveedor aprobado;
- idiomas esperados, incluyendo mezcla español/inglés;
- duración máxima;
- retención de audio/transcript;
- consentimiento y aviso al usuario;
- comportamiento offline o con mala conexión.

### Operación y costo

- presupuesto mensual;
- rate limits definidos: 20 generations y 10 transcriptions por usuario cada 10 minutos;
- métricas de parsing correcto;
- estrategia de fallback cuando el proveedor falla;
- logging/redaction de datos sensibles.

## Mejoras técnicas recomendadas antes o durante IA

- agregar runtime schema para documentos Firestore de Outlook; actualmente `storedTasks` acepta objetos sin validación profunda;
- agregar tests específicos para `selectWindowStart` con fechas no lunes;
- agregar tests de optimistic concurrency con emulador;
- agregar tests de reglas para drafts y versions;
- sincronizar o retirar `latestPdfUrl` del draft;
- decidir si `companyContextId` debe renombrarse o documentarse como Directory entity ID;
- agregar telemetry de parse request, correction rate y confirm/cancel sin guardar contenido sensible;
- agregar un límite de caracteres para texto libre y transcript;
- impedir doble submit de parsing/transcripción;
- conservar el formulario manual como fallback permanente.

## Criterios de aceptación sugeridos para IA V1

- el usuario puede escribir una nota con varias actividades;
- el servidor devuelve suggestions validadas por schema;
- ninguna suggestion se guarda antes de review;
- fechas inciertas aparecen marcadas;
- company/dependency no se enlazan silenciosamente con matches ambiguos;
- el usuario puede editar todas las fields antes de confirmar;
- confirmar usa el mismo `persist` actual;
- el scheduler sigue siendo la única fuente de `endDate`, dependency resolution e issues;
- PDF y Post update siguen funcionando sin cambios;
- falla del proveedor no afecta edición manual;
- no hay API keys en el bundle del cliente.

## Criterios de aceptación sugeridos para voz V1

- permiso de micrófono manejado explícitamente;
- recording state visible;
- stop/cancel confiable;
- transcript editable;
- audio temporal eliminado después de procesar/cancelar;
- mismo review que la entrada escrita;
- fallback manual disponible;
- errores de red/proveedor no eliminan el texto ya transcripto.

## Checklist para el próximo agente

1. Leer este documento completo.
2. Revisar `lib/outlook-core.ts` antes de diseñar el contrato IA.
3. Revisar `use-job-outlook-controller.ts` antes de agregar writes.
4. Confirmar proveedor, presupuesto, idiomas y privacidad.
5. Confirmar timezone y semántica de fechas relativas.
6. Diseñar schema de suggestions, no schema Firestore directo.
7. Implementar endpoint server-side autenticado.
8. Implementar review antes de persistir.
9. Reutilizar `createOutlookTask`, `scheduleOutlookTasks` y `persist`.
10. Mantener formulario manual, PDF y Post update sin regresiones.
11. Ejecutar tests, typecheck y build.
12. Verificar Firestore/Storage rules en el ambiente objetivo.

## Fuente de verdad para retomar

Si este documento contradice el código, el orden de autoridad es:

1. `lib/outlook-core.ts` para dominio y fechas;
2. `lib/job-outlooks.ts` para persistencia/versiones;
3. `features/outlooks/use-job-outlook-controller.ts` para orquestación;
4. `components/directory/outlooks/three-week-outlook-tab.tsx` para flujo UI;
5. reglas Firebase y componentes especializados.

El principio que no debe perderse en la próxima etapa es simple: IA y voz ayudan a capturar; el usuario confirma; el core determinístico decide y persiste.
