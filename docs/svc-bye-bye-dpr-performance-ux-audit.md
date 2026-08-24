# SVC ByeByeDPR — auditoría de UX y performance/manejo de datos

> Revisión estática de solo lectura sobre `lib/bye-bye-dpr-server.ts`,
> `lib/bye-bye-dpr-directory-link.ts`, `lib/bye-bye-dpr-store.ts`,
> `features/bye-bye-dpr/`, `components/bye-bye-dpr/` y los dos documentos de
> registro del módulo (`docs/svc-bye-bye-dpr-module.md`,
> `docs/svc-bye-bye-dpr-product-context.md`). No se consultó producción, no
> se usaron credenciales, no se desplegó ni cambió nada en esta pasada —
> es solo análisis.

## 0. Veredicto ejecutivo

ByeByeDPR es un módulo de campo: la audiencia es un trabajador parado en una
obra, con el celular, a veces con guantes, que necesita fichar entrada/salida
o mandar un reporte "en segundos" — así lo define el propio doc de producto.
Medido contra ese estándar:

- El **arranque del módulo** ya está bien resuelto: desde el refactor del
  11/08 que lo convirtió en pantalla del shell (igual que Directory/
  Applications/Quest Coral), cambiar de módulo y volver a ByeByeDPR es
  instantáneo — el hook de datos nunca se desmonta, así que no hay pantalla
  de carga salvo la primera vez que se abre la app.
- El **flujo de clock in/out** es simple y ya evita casi todo el trabajo
  pesado — salvo un punto real: la sugerencia de "job más cercano" puede
  disparar una cadena de geocodificación externa costosa la primera vez que
  se usa contra una dirección nueva (§3.1). Es el hallazgo principal de esta
  auditoría.
- El **submit de Daily Report** hace varios pasos servidor en cadena (PDF,
  posteo a Comms, archivado en Directory) pero ya muestra spinner mientras
  corre — no es instantáneo, pero tampoco engaña al usuario.
- El **listado de jobs** trae toda la colección en cada carga — hoy
  irrelevante por volumen, pero es el mismo patrón de "sin techo" que la
  auditoría general de Firebase marca como riesgo a vigilar en otros
  módulos.
- El mayor riesgo de UX no es de performance sino de **datos que no
  sobreviven un refresh**: "Recent activity" y "Last clocked out" en Home
  solo reflejan lo que pasó en la sesión actual del browser — ya documentado
  como gap conocido, confirmado en el código.

### Estado por área

| Área | Estado | Detalle |
|---|---:|---|
| Arranque / cambio de módulo | Muy bueno | Sin loading screen tras la primera vez (hook vive en el shell) |
| Clock in / clock out | Bueno, con una excepción real | "Nearest job" puede tardar segundos en frío (§3.1) |
| Daily Report — grabar/escribir | Bueno | Grabación real, transcripción, structuring — todo con spinner visible |
| Daily Report — submit | Aceptable | Varios pasos servidor en cadena, pero comunicado con spinner |
| Listado de jobs | Sin techo, bajo riesgo hoy | Trae toda la colección en cada carga (§3.2) |
| Notificación de reportes | Riesgo de ruido ya documentado | Sin `notifyUserIds`, avisa a TODOS los usuarios registrados (§3.3) |
| Historial (Recent activity) | Gap de UX real | No sobrevive un refresh de página — no es un problema de performance, es que el dato no se guarda (§3.4) |
| Fotos/adjuntos | Aceptable, con gap conocido | Suben en segundo plano sin bloquear; "quitar" no borra el archivo real (§3.5) |

## 1. Mapa de datos

```text
Firestore
  jobs/{jobId}
    name, address, latitude?, longitude?, directoryContextId, isActive
    notifyUserIds?, createdBy, createdAt, updatedAt

  users/{uid}/recentJobs/{jobId}      ← últimos 5, por viewedAt desc
  clockRecords/{id}                    clockInAt/clockOutAt, jobId, userId
  reports/{id}                         status, structuredData, rawText, jobId
    └─ attachments/{id}                 fotos subidas durante la captura

  byeByeDprJobGeocodeCache/{directoryContextId}   TTL 30 días
    address, latitude, longitude, geocodedAt

Directory (fuente compartida, solo lectura salvo linking)
  contexts/{sourceId}            dirección real, sin lat/lng
  directoryIndex                 versión acotada, con `location` corto

Camino de mayor costo (no es el boot — es "buscar el job más cercano")
  suggestNearestJob()
    → listJobs()                      TODA la colección jobs
    → withGeocodedCoordinates()       geocodifica jobs propios sin coords
    → listGeocodedDirectoryJobs()     hasta 150 candidatos de Directory
        → point-read de cada /contexts (batched, 1 round-trip)
        → geocodeByDirectoryContextId() por candidato, cache-first
            → si no hay cache: llamada real a Google Geocoding API
            → 8 en paralelo, resto en cola
```

## 2. Qué ya está bien diseñado

- **Arquitectura de arranque correcta.** `useByeByeDprDashboard` sigue
  exactamente el patrón de `useApplicationsDashboard`/`useQuestCoralDashboard`:
  se llama incondicionalmente en `page.tsx`, activado una sola vez por un
  flag "sticky", y sus listeners/estado nunca se desmontan. Esto no es un
  detalle menor — fue un refactor completo (dos pasadas, 10 y 11 de agosto)
  específicamente para eliminar una loading screen que aparecía en cada
  cambio de módulo. Ya está resuelto, no hay nada que optimizar ahí.
- **Nunca inventa una ubicación.** El geocoding, el auto-stamp de
  coordenadas y el filtro de "jobs con coordenadas" para nearest-job
  comparten la misma regla: sin dato real, `null`, nunca un valor adivinado.
  Esto costó un bug real en producción (§ ver el módulo doc, "Wax the City")
  que ya se corrigió — la disciplina que quedó después es correcta.
- **Cache de geocoding con TTL.** `byeByeDprJobGeocodeCache` evita
  re-geocodificar la misma dirección en cada búsqueda — sin esto, §3.1 sería
  mucho peor (constante, no solo en frío).
- **Concurrencia acotada en el fan-out de geocoding** (`GEOCODE_CONCURRENCY = 8`)
  — evita saturar la Geocoding API o el propio servidor con 150 llamadas
  simultáneas.
- **Búsqueda de jobs ya usa índices reales**, no un scan: `findByName()` +
  reintento por token + query de `keywords` con índice compuesto dedicado —
  documentado con su propio índice en `firestore.indexes.json`.
- **Submit de report comunica que está trabajando.** El botón muestra
  `Loader2` mientras `submitting`/`organizing` están en curso — el usuario
  nunca ve un botón "muerto" durante los pasos servidor en cadena.
- **Fotos no bloquean.** `DailyReportScreen` sube cada archivo en segundo
  plano tras seleccionarlo, con toast si falla — el worker puede seguir
  escribiendo el reporte mientras las fotos suben.

## 3. Hallazgos con evidencia y estimación de impacto

### 3.1 "Nearest job" puede ser lento la primera vez — el hallazgo principal

`suggestNearestJob()` (disparado por "Use current location" al entrar al
flujo de Clock In) hace, en el peor caso:

1. `listJobs()` — toda la colección `jobs`.
2. `withGeocodedCoordinates()` — geocodifica cualquier job propio sin
   coordenadas (en paralelo, `Promise.all`).
3. `listGeocodedDirectoryJobs()` — hasta **150** candidatos de Directory:
   un query acotado + un batch de point-reads (rápido, 1 round-trip), y
   después, **para cada candidato sin caché vigente, una llamada real a
   Google Geocoding API**, 8 en paralelo.

Con caché fría (primera vez que se busca, o cada 30 días por dirección), y
asumiendo ~200-400ms por llamada a la Geocoding API, geocodificar hasta 150
direcciones a 8 en paralelo son ~19 tandas — del orden de **varios segundos**
antes de que el servidor pueda responder "tu job más cercano es X". Con
caché caliente (el caso normal después del primer uso), esto se reduce a
lecturas de Firestore puras — rápido.

Esto choca directo con el estándar que el propio producto se puso: "finish a
task in seconds" y "no permission-prompt surprise". Un trabajador tocando
"Use current location" por primera vez —o el primer día que se agregó un
lote nuevo de jobs a Directory— puede quedarse esperando varios segundos sin
feedback más que un spinner genérico, sin saber si está cargando o colgado.

**No se tocó el código en esta pasada** — es un cambio de diseño (¿precalcular
geocodes en background en vez de on-demand? ¿bajar el límite de 150? ¿cachear
a nivel de lote, no por candidato?), no un ajuste de una línea. Queda
documentado como el hallazgo de mayor prioridad.

### 3.2 `listJobs()` trae toda la colección, sin límite

Cada carga de Home (y cada llamada a `suggestNearestJob`) hace
`db.collection("jobs").get()` — sin `where`, sin `limit`. Hoy el volumen de
jobs es bajo (el propio doc del módulo dice que producción no tenía ni un
job creado hasta hace poco), así que esto es invisible en la práctica. Es el
mismo patrón de "sin techo pero documentado" que la auditoría general de
Firebase ya identificó en otras colecciones pequeñas (`/users` en CRC, por
ejemplo) — no es urgente, pero es la primera lectura que necesitará un
límite si la cantidad de jobs activos crece mucho (obras simultáneas a
escala de toda una constructora, no de un equipo chico).

### 3.3 Notificación de reporte sin destinatario explícito avisa a TODOS los usuarios

`createAutomaticCommsPost()`: si el job no tiene `notifyUserIds` configurado,
lee **toda** la colección `/users` y postea el mensaje visible a todos —
ya señalado como riesgo abierto en `docs/svc-bye-bye-dpr-product-context.md`
("may become noisy or inappropriate as the team grows"). Se confirma en el
código: es literal, no una aproximación. Cada submit de Daily Report sin
configuración explícita es, en costo de datos, un write proporcional a la
cantidad total de usuarios de la app (un mensaje con `visibleToUserIds`
igual a todos), no solo al equipo del job. A la escala actual (una empresa,
pocos usuarios de oficina) es intrascendente; a escala de una constructora
con decenas de obras y reportes diarios, sería tanto ruido de notificación
(UX, ya documentado) como fan-out de escritura innecesario (performance).

### 3.4 "Recent activity" y "Last clocked out" no sobreviven un refresh

Confirmado en `use-bye-bye-dpr-dashboard.ts`: `recentActivity` y
`lastClockOutLabel` son estado de React puro (`useState`), poblado solo por
las propias acciones de la sesión (`recordActivity()` dentro de
`clockInToJob`/`clockOutConfirm`/`forgotClockOutConfirm`). No existe ningún
endpoint de "traer historial" en `lib/bye-bye-dpr-server.ts` — nunca estuvo
en el alcance original, y el doc del módulo ya lo documenta como limitación
conocida. Esto no es un problema de velocidad: los datos (`clockRecords`,
`reports`) sí existen en Firestore, permanentes — es que nada los vuelve a
leer al arrancar. Un trabajador que clockeó hace una hora, cerró la pestaña
y volvió a entrar ve "Not clocked in today yet" aunque sí clockeó (el clock
**activo** sí sobrevive el refresh — `getActiveClock()` se llama en el
boot — el gap es solo sobre lo ya cerrado). Es el hallazgo de UX más
confuso del módulo: el dato existe, pero la pantalla miente por omisión.

### 3.5 Adjuntos: "quitar" en la UI no borra el archivo real

Confirmado tanto en el código como en el doc del módulo: no existe endpoint
para borrar un adjunto server-side. Sacar una foto de la lista en la UI solo
la quita del estado local — el archivo sigue en Storage y el doc sigue en la
subcolección `attachments`. Mismo patrón de "referencia huérfana" que la
auditoría general de Firebase señala para blobs de Directory — aquí con el
agravante de que el usuario cree activamente que la borró.

### 3.6 `getRecentJobs()`: N point-reads en paralelo en vez de un batch

Detalle menor: trae hasta 5 (`MAX_RECENT_JOBS`) ids desde
`users/{uid}/recentJobs`, y después hace `Promise.all(jobIds.map(id =>
getJob(id)))` — 5 lecturas separadas en paralelo, en vez de un solo
`db.getAll(...)` como sí usa `listGeocodedDirectoryJobs()` en el otro
archivo. Con `Promise.all` la latencia real es casi la misma (todas viajan
juntas), así que el impacto práctico es mínimo a N=5 — se deja registrado
por consistencia con el propio código del módulo, no porque valga la pena
tocarlo hoy.

## 4. Qué no conviene hacer

- No agregar paginación a `listJobs()` todavía — el volumen actual no lo
  justifica, y agregarla implica decidir una UX de "cargar más" que hoy no
  existe en Home/Change Job.
- No precalcular geocoding de TODO Directory de forma preventiva/cron sin
  medir primero cuántos jobs realmente no tienen coordenadas ni caché — el
  límite de 150 y el cache de 30 días ya acotan el peor caso; conviene medir
  antes de construir infraestructura nueva.
- No tocar la política de notificación (`notifyUserIds` fallback) sin
  confirmar con el usuario el comportamiento deseado — ya está marcado como
  pregunta abierta en el propio doc de producto, no una decisión técnica
  unilateral.
- No construir un endpoint de historial completo (clock records/reports
  pasados) como respuesta rápida a §3.4 sin decidir antes la política de
  retención/privacidad de ubicación, voz y fotos — el propio doc de producto
  lo lista como pregunta abierta también.

## 5. Plan recomendado por orden de retorno

### P0 — impacto directo en la experiencia del trabajador de campo
1. Resolver §3.1 (nearest-job en frío): la opción de menor riesgo es bajar
   el límite de candidatos de Directory geocodificados on-demand, o mover el
   geocoding masivo a un job en background (cron/trigger) que mantenga la
   caché tibia, en vez de geocodificar bajo demanda en el camino crítico de
   un tap de usuario.
2. Resolver §3.4 (Recent activity no sobrevive refresh): el dato ya existe
   en Firestore — falta un endpoint de lectura acotada (últimos N
   `clockRecords`/`reports` del usuario) y usarlo en el boot, igual que ya
   se hace con `getActiveClock()`.

### P1 — costo silencioso, confirmar antes de tocar
3. Confirmar con el usuario la política de notificación de §3.3 antes de
   cambiar nada — puede que "avisar a todos" siga siendo lo correcto al
   tamaño actual del equipo.
4. Implementar el borrado real de adjuntos (§3.5) — archivo + doc, no solo
   la UI.

### P2 — vigilar, no actuar todavía
5. Agregar límite/paginación a `listJobs()` si la cantidad de jobs activos
   crece mucho (§3.2).
6. Batchear `getRecentJobs()` con `db.getAll()` si en algún momento se toca
   ese archivo por otro motivo (§3.6) — no vale un cambio aislado solo por
   esto.

## 6. Conclusión

ByeByeDPR ya resolvió el problema de performance que más le costaba —el
arranque del módulo— con un refactor arquitectónico real, no un parche. Lo
que queda no es una arquitectura de lectura mal diseñada: es una función
concreta (`suggestNearestJob`) cuyo peor caso puede tardar varios segundos
la primera vez, y un dato real (historial de actividad) que existe en
Firestore pero que ninguna pantalla vuelve a leer. Ambos son arreglables sin
tocar el modelo de datos ni las reglas de seguridad — el primero es una
decisión de cuándo geocodificar (bajo demanda vs. en background), el segundo
es un endpoint de lectura que falta, no un endpoint que hay que inventar
desde cero conceptualmente.
