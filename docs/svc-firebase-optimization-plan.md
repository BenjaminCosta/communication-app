# SVC — plan incremental de optimización de Firebase y arquitectura

> Plan iniciado el 2026-07-16 a partir de
> `docs/svc-firebase-architecture-performance-audit.md`. El objetivo es mejorar
> performance, mantenibilidad y coordinación sin reescribir la aplicación ni
> operar sobre datos sensibles. Seguridad queda fuera del foco de este plan,
> salvo que una modificación pueda introducir una regresión evidente.

## 0. Objetivo y criterio de trabajo

El resultado buscado es que agregar una feature no obligue a tocar el shell
completo de la app, no agregue otra carga global de Firestore y no dependa de
pasos manuales de deploy.

El trabajo se hará en ciclos pequeños:

```text
hipótesis y alcance
  -> baseline verificable
  -> cambio mínimo
  -> tests/typecheck/build
  -> revisión de diff e invariantes
  -> prueba con emulator o feature flag
  -> observación
  -> mantener, ajustar o revertir
```

No se pasa al siguiente ciclo si el anterior deja una prueba roja, un cambio de
datos no explicado o un rollback incierto.

## 1. Invariantes que no se pueden romper

Durante todos los ciclos deben seguir funcionando:

- login y restauración de sesión;
- creación, edición, lectura y borrado de mensajes;
- visibilidad por `visibleToUserIds` y compatibilidad legacy necesaria;
- tags, proyectos, contactos importados y contexts;
- notificaciones FCM y recordatorios de calendario;
- búsqueda, perfiles, notas, archivos, favoritos y recents de Directory;
- sync `/contacts` + `/contexts` → `/directoryIndex` + shards;
- caché offline existente;
- imports/migraciones con sus guardas actuales.

Restricciones operativas:

- no ejecutar migraciones ni scripts contra producción durante refactors;
- no desplegar automáticamente desde este plan;
- no cambiar rules, índices o schema sin una prueba previa en emulator;
- no eliminar un camino legacy sin medir que ya no tiene documentos;
- no mezclar una refactorización de arquitectura con una migración de datos;
- cada cambio debe tener rollback mediante código/flag, no mediante reparación
  manual de Firestore.

## 2. Gates de verificación comunes

### Gate rápido — para cada slice local

```bash
pnpm verify:fast
```

Ejecuta:

1. tests de Directory;
2. tests del importador VCF;
3. tests del mapper/unión del feed;
4. tests de batching y concurrencia de Functions;
5. TypeScript del frontend;
6. copia del core compartido + TypeScript + contrato de exports de Functions.

### Gate completo — antes de cerrar una fase

```bash
pnpm verify
git diff --check
```

Agrega el build de producción de Next.js. Cuando el cambio afecte Firestore,
también debe pasar un escenario específico en emulator.

### Revisión manual mínima

- el diff contiene solo el dominio del ciclo;
- no aparecieron credenciales ni datos reales;
- no cambió accidentalmente `functions/src/directory-core.ts` sin cambiar el
  source canónico;
- listeners nuevos se desmontan correctamente;
- toda query nueva tiene límite, cursor o una justificación explícita;
- toda escritura derivada es idempotente o reconciliable;
- errores relevantes no se convierten en arrays vacíos silenciosamente.

## 3. Baseline inicial

Estado al comenzar:

| Comprobación | Resultado |
|---|---|
| `pnpm test:directory` | 12/12 |
| `pnpm test:vcf-import` | 6/6 |
| `pnpm exec tsc --noEmit` | pasa |
| `pnpm --dir functions build` | pasa |
| Build anterior de Next.js | pasa |
| Working tree previo | docs sin trackear + `.codex_spreadsheet_flights/` ajeno |

Nota: Functions declara Node 22 y la máquina local ejecuta Node 25. El build
pasa, pero CI/emulator deben fijarse en Node 22 para igualar el runtime.

## 4. Fase 0 — guardas de build y deploy

### Problema

Functions despliega `functions/lib/index.js`, pero el deploy no compilaba
automáticamente `functions/src`. Era posible publicar un artefacto viejo si el
desarrollador olvidaba ejecutar el build.

### Cambio del ciclo 0

- agregar `pnpm typecheck`;
- agregar `pnpm verify:fast` y `pnpm verify`;
- agregar un hook `predeploy` de Functions que ejecute su build;
- mantener el deploy como acción manual.

### Aceptación

- `firebase.json` válido;
- el comando exacto del hook compila Functions;
- regenerar el core no produce diff inesperado;
- `pnpm verify` pasa;
- no cambia ningún archivo runtime del frontend ni ningún documento Firebase.

### Rollback

Revertir scripts y hook. No hay rollback de datos porque esta fase no escribe en
Firebase.

### Estado

**Completado.** `pnpm verify`, la validación JSON y la simulación exacta del
hook con `RESOURCE_DIR` pasaron. El build de Next modificó automáticamente
`next-env.d.ts`; se restauró porque era un artefacto ajeno al alcance. Functions
no dejó diferencias en source generado ni en JavaScript compilado.

## 5. Fase 1 — medir antes de cambiar queries

### Objetivo

Tener un baseline reproducible de listeners, cantidad de documentos recibidos y
tiempo de carga, sin enviar contenido sensible a analytics.

### Slice 1.1 — instrumentación local

- crear un helper de métricas de desarrollo;
- contar snapshots/document changes por nombre de query;
- medir tiempo hasta `messagesLoaded`, contactos y catálogo;
- registrar solo conteos, duración y bytes aproximados;
- activar únicamente con variable local/feature flag.

### Slice 1.2 — dataset de prueba

Preparar datos sintéticos en emulator para:

- 1k, 10k y 50k mensajes;
- mensajes legacy, actuales y superpuestos;
- 30+ proyectos;
- 8k y 20k entidades de Directory.

### Aceptación

- cero acceso a producción;
- baseline guardado como tabla en docs;
- se puede comparar antes/después con el mismo seed;
- instrumentación eliminable o desactivada en producción.

### Estado

**Slice 1.1 completado.** `lib/firebase-dev-metrics.ts` mide tiempo del primer
snapshot, cantidad de documentos/cambios y origen de caché. Solo se activa con
`NEXT_PUBLIC_FIREBASE_DEBUG_METRICS=true` y nunca registra IDs ni payloads.

**Slice 1.2 pendiente.** Los tests funcionales existentes usan emulator, pero
todavía no existe el generador reproducible de 1k/10k/50k mensajes ni la tabla
comparativa de costos. Por eso aún no corresponde afirmar una mejora porcentual.

## 6. Fase 2 — extraer el feed sin cambiar comportamiento

### Objetivo

Separar acceso a Firestore de `app/page.tsx` antes de optimizar queries.

### Slice 2.1 — contratos puros

- mover el mapper de mensajes y helpers de deduplicación a
  `features/communications/messages/message-feed-model.ts`;
- agregar tests con documentos legacy/actuales;
- definir un tipo canónico para el feed.

### Slice 2.2 — módulo de queries

- encapsular las consultas existentes en
  `features/communications/data/message-queries.ts`;
- conservar exactamente los mismos listeners;
- devolver unsubscribe y estados de error explícitos.

### Slice 2.3 — hook coordinador

- crear `useMessageFeed`;
- mover unión/loading/retry fuera de `app/page.tsx`;
- mantener props y UI sin cambios.

### Aceptación

- mismos IDs y orden del feed con el mismo dataset;
- misma visibilidad para casos legacy/actuales;
- cero query adicional;
- listeners se desmontan al cambiar usuario;
- `app/page.tsx` deja de conocer detalles de snapshots de mensajes.

### Rollback

Volver a usar el bloque anterior desde `app/page.tsx`; no hay migración de
datos.

### Estado

**Completado.** `useMessageFeed` concentra listeners, retry, desmontaje, merge y
loading; `app/page.tsx` dejó de mapear snapshots de mensajes. Cuatro tests fijan
el orden, la precedencia de deduplicación, la visibilidad y los datos legacy.
Con el flag paginado apagado se conservan las tres queries previas.

## 7. Fase 3 — feed paginado y consulta canónica

Esta es la optimización de mayor retorno, pero se ejecuta después de aislar y
probar el comportamiento actual.

### Slice 3.1 — auditar compatibilidad legacy

Sobre emulator y luego mediante una inspección de producción explícitamente
autorizada y read-only:

- contar mensajes sin `visibleToUserIds`;
- contar diferencias entre `participants` y `visibleToUserIds`;
- contar mensajes que dependen solo del listener por proyecto;
- documentar el criterio de retiro.

No modificar datos en este slice.

### Slice 3.2 — paginación detrás de flag

Query objetivo:

```text
visibleToUserIds array-contains uid
  + orderBy timestamp desc
  + limit 75
  + startAfter para páginas anteriores
```

- listener realtime únicamente para la ventana reciente;
- páginas históricas one-shot;
- deduplicación por ID entre ventana y páginas;
- feature flag con fallback inmediato al feed anterior.

### Slice 3.3 — retirar redundancia

Solo si la auditoría demuestra cobertura completa:

- retirar listener `participants`;
- retirar listener global por `projectId`;
- conservar compatibilidad en mapper si aún hay campos legacy almacenados;
- observar costo, errores y mensajes faltantes antes de borrar código fallback.

### Aceptación

- snapshot inicial acotado a la ventana configurada;
- historial accesible por cursor sin duplicados ni saltos;
- mensajes nuevos aparecen en realtime;
- visibilidad idéntica al baseline;
- no aumenta cantidad de índices sin justificación;
- rollback cambiando un flag.

### Estado

**Slice 3.2 preparado, no activado.** La implementación usa un listener de 75
mensajes recientes y lecturas one-shot por cursor para el historial. Se activa
solo con `NEXT_PUBLIC_USE_PAGINATED_MESSAGE_FEED=true`; ante un error al montar
la query vuelve al feed legacy para ese usuario.

El índice compuesto requerido quedó versionado en `firestore.indexes.json`,
pero **no fue desplegado**. El flag debe continuar apagado hasta que:

1. se despliegue y termine de construir el índice;
2. una auditoría read-only autorizada confirme que todos los mensajes que deben
   verse tienen `visibleToUserIds` y `timestamp`;
3. se compare el mismo dataset en emulator/staging.

`orderBy("timestamp")` excluye documentos que no tengan ese campo; el fallback
por error no detectaría un documento legacy omitido silenciosamente. Por eso los
slices 3.1 y 3.3 siguen pendientes y no se retiró ningún listener anterior.

## 8. Fase 4 — cerrar el rollout de Directory v4

### Slice 4.1 — contrato por ambiente

- documentar valor de `NEXT_PUBLIC_USE_DIRECTORY_CATALOG` en local, staging y
  producción;
- validar manifest, schema, conteo y 32 shards en emulator/staging;
- habilitar de forma gradual, nunca implícita.

### Slice 4.2 — reconciliador read-only

Primero crear una comprobación que reporte:

- entradas de `/directoryIndex` ausentes en shards;
- shard entries sin índice;
- conteos/revisiones/schema inconsistentes;
- personas que apuntan a compañías inexistentes;
- notas, archivos o relaciones huérfanas.

La primera versión solo informa; una reparación automática requiere otro ciclo.

### Estado

**Slice 4.2 completado localmente.** `pnpm inspect:directory-consistency` valida
manifest, 32 shards, schema/revisión/conteos, asignación por hash, paridad con
`directoryIndex`, tamaño de shard, compañías y referencias huérfanas. Sin
`FIRESTORE_EMULATOR_HOST` exige credenciales explícitas y aun así solo lee. No se
ejecutó contra producción. Los slices 4.1, 4.3 y 4.4 siguen pendientes.

### Slice 4.3 — reparación idempotente

- reconstruir solo shards afectados cuando sea posible;
- manejar delete/type-change de compañías;
- registrar cursor/progreso para fan-outs mayores a 500;
- agregar retry controlado o job de reconciliación.

### Slice 4.4 — delta por shard, solo si se justifica

Implementar `changedShardIds` o revisión por shard únicamente si las métricas
demuestran que las ediciones frecuentes retransmiten demasiado catálogo.

## 9. Fase 5 — separar presencia de usuarios

### Objetivo

Evitar que heartbeats de `lastSeen` invaliden/listen el documento completo de
usuario y disparen triggers no relacionados.

### Estrategia

- introducir `/presence/{uid}` detrás de flag;
- dual-write temporal desde el cliente;
- cambiar solo las pantallas que muestran presencia;
- subir heartbeat de 1 a 3–5 minutos si producto lo acepta;
- retirar `lastSeen` de `/users` después de verificar consumidores.

### Aceptación

- auth/perfil/preferencias no cambian;
- presencia sigue siendo suficientemente fresca;
- actualización de presencia no dispara auto-link;
- reducción medible de eventos sobre `/users`;
- rollback al campo anterior mediante flag.

## 10. Fase 6 — modularizar Functions

Separar source sin renombrar Functions desplegadas:

```text
functions/src/index.ts
functions/src/shared/admin.ts
functions/src/auth/contact-linking.ts
functions/src/communications/push.ts
functions/src/communications/calendar.ts
functions/src/directory/sync.ts
functions/src/directory/catalog.ts
```

Slices independientes:

1. extraer helpers puros y agregar tests;
2. extraer push y trocear FCM en lotes de hasta 500;
3. extraer calendario y acotar concurrencia;
4. extraer Directory sin cambiar orden de escrituras;
5. centralizar región, timeout y memoria después de medir.

Aceptación: mismos nombres/exportaciones, mismo build, mismas rutas de trigger y
ningún cambio de datos mezclado con el movimiento de archivos.

### Estado

**Completado el refactor estructural y los límites inmediatos.** El entrypoint
solo inicializa Admin y reexporta las siete Functions originales. Auth,
notificaciones, calendario y Directory viven en módulos separados. El build
falla si cambia el conjunto de exports. FCM se divide en grupos de hasta 500,
las limpiezas Firestore en hasta 450 usuarios y las lecturas de usuarios y el
calendario tienen concurrencia acotada. No se renombró ni desplegó ninguna
Function durante el refactor local; el despliegue productivo posterior está
registrado en la sección 15.

## 11. Fase 7 — lifecycle e índices

### Cleanup

- limitar documentos de `directoryRecents`;
- revisar tokens FCM antiguos;
- detectar y limpiar blobs huérfanos mediante job idempotente;
- reportar referencias huérfanas antes de borrarlas;
- definir archivo/retención de mensajes con producto.

### Índices

- inventariar `campo → query`;
- medir tamaño/fan-out actual;
- probar exemptions single-field en staging;
- conservar todo campo usado en `where`, `orderBy` o `array-contains`.

No combinar cleanup e índices en un mismo deploy.

## 12. Orden recomendado y dependencias

```text
Fase 0: guardas
  -> Fase 1: baseline medible
      -> Fase 2: aislar feed
          -> Fase 3: paginar/unificar feed

Fase 0
  -> Fase 4: cerrar Directory v4
  -> Fase 6: modularizar Functions

Fase 1
  -> Fase 5: presencia
  -> Fase 7: lifecycle/índices
```

La fase 3 no debe adelantarse a la 2: optimizar y refactorizar simultáneamente
haría difícil detectar si un mensaje faltante es un bug de arquitectura o de la
nueva query.

## 13. Registro de ciclos

| Ciclo | Alcance | Estado | Evidencia |
|---|---|---|---|
| 0A | baseline de tests/typecheck/Functions | completado | 12 + 6 tests, TS y Functions pasan |
| 0B | comandos de verificación + predeploy | completado | `pnpm verify`, JSON y hook pasan; diff limpio |
| 1A | métricas locales de listeners | completado | helper opt-in sin IDs/payloads |
| 1B | datasets sintéticos grandes + baseline | pendiente | — |
| 2A | contratos/mappers/hook de mensajes | completado | 4 tests + legacy default |
| 3A | auditoría legacy read-only | completado | 202/202 mensajes elegibles; query real 75/75 |
| 3B | feed paginado detrás de flag | producción | índice READY; flag Preview + Production activo |
| 4A | verificador de Directory | completado | 15 tests + auditoría remota read-only; rollout bloqueado por inconsistencias |
| 4B | reparación de Directory | pendiente | — |
| 5A | separar presencia | pendiente | — |
| 6A | modularizar Functions | producción | 7 exports verificados y 7 Functions ACTIVE |
| 6B | límites FCM/calendario | completado | lotes 500/450 y concurrencia 50/20 |
| 7A | lifecycle y revisión global de índices | pendiente | solo se agregó el índice del feed |

Este registro debe actualizarse al cerrar cada ciclo con el resultado real, no
solo con la intención del plan.

## 14. Verificación local anterior al rollout — 2026-07-16

Esta sección conserva la evidencia del gate local previo a la autorización de
producción. En ese momento no se había leído ni escrito Firestore productivo,
no se habían ejecutado migraciones remotas y no se habían desplegado Functions,
rules ni índices. El estado productivo vigente está en la sección 15.

### Gates locales

| Comprobación | Resultado |
|---|---|
| `pnpm verify` | pasa |
| Directory | 15/15 tests |
| importador VCF | 6/6 tests |
| mapper/unión del feed | 4/4 tests |
| batching/concurrencia de Functions | 3/3 tests |
| TypeScript frontend | pasa |
| build Functions | pasa; 7 exports verificados |
| build Next.js de producción | pasa |
| JSON de configuración | válido |
| `git diff --check` | pasa |

El build de Next vuelve a escribir automáticamente `next-env.d.ts`; se restauró
la referencia previa porque ese artefacto no pertenece al alcance del plan.

### Gates en emulator

La secuencia `seed → migrate → verify` se ejecutó solo con Auth y Firestore
Emulator. Resultado:

- 7/7 casos de `visibleToUserIds`;
- query canónica paginada para Alice, Bob y Carol, con cursor de dos documentos,
  cobertura completa y cero duplicados;
- 32/32 checks del calendario;
- 63/63 checks de categorías/tags.

El emulator de Functions cargó los siete triggers con sus nombres originales.
El recordatorio programado no se ejecutó porque Pub/Sub no formó parte del
emulator; su módulo sí fue compilado y su export verificado.

Durante esta verificación se encontró que el seed y el verificador A–G todavía
esperaban el modelo anterior a `tagVisibilityV1`. Se alinearon al contrato
canónico ya usado por la app: tags/proyectos clasifican, mientras que la
visibilidad proviene de autor + destinatarios explícitos.

### Estado operativo resultante

- **Sin cambio de conducta por defecto:** el feed legacy continúa activo.
- **Preparado, no habilitado:** feed canónico paginado e índice compuesto.
- **Activo solo bajo opt-in local:** métricas de listeners.
- **Disponible y read-only:** auditor de consistencia de Directory.
- **Modularizado localmente:** Functions, con los mismos siete exports.
- **Pendiente:** dataset sintético grande, auditoría read-only de mensajes
  remotos, rollout de Directory v4, separación de presencia y lifecycle.

Advertencias conocidas:

- Functions apunta a Node 22, pero esta máquina ejecutó los gates con Node 25;
  CI/emulator deberían fijarse en Node 22 antes de desplegar.
- `pnpm lint` no está operativo porque `eslint` no figura entre las dependencias.
  No se agregó una toolchain de lint dentro de este ciclo de Firebase.
- el test VCF emite una advertencia de detección ESM; sus seis casos pasan.

## 15. Rollout productivo controlado — 2026-07-16

El usuario autorizó expresamente continuar con un despliegue productivo
controlado. Se mantuvieron separados los cambios de infraestructura, backend y
frontend, con una verificación entre cada paso.

### Auditorías read-only previas

Mensajes:

- 202 documentos totales y 202 elegibles para la query canónica;
- 0 sin `visibleToUserIds`, timestamp, autor o destinatario canónico;
- 0 destinatarios extra en `visibleToUserIds`;
- la query productiva `array-contains + orderBy + limit(75)` devolvió 75
  documentos sin error;
- 36 destinatarios aparecen solo en `participants`, confirmando que ese campo
  legacy no debe volver a ser la fuente de verdad de visibilidad.

Directory:

- 7.818 entradas en `directoryIndex`, 6.618 referencias y 0 documentos shard;
- faltan los 32 shards y las 7.818 entradas no están proyectadas en ellos;
- el flag `NEXT_PUBLIC_USE_DIRECTORY_CATALOG` permanece apagado;
- no se ejecutó backfill, reparación ni migración de Directory.

### Firebase desplegado

- índice de `messages`: `visibleToUserIds ARRAY_CONTAINS + timestamp DESC`;
- índices de relaciones, notas y archivos de Directory, sin activar el catálogo;
- siete Functions desplegadas, las siete `ACTIVE`, en Node 22 y con el mismo
  hash de source;
- no se desplegaron Firestore Rules;
- no se modificaron documentos de mensajes, usuarios ni Directory.

### Frontend desplegado

- preview validado: `dpl_4auo3XgTMwQvNZ8YhNoe7vaC2VYr`;
- producción: `dpl_HLRyfbq8GbvLkohkHHNwdK1kBDxp`, estado `Ready`;
- alias público: `https://communication-svc.vercel.app`;
- `NEXT_PUBLIC_USE_PAGINATED_MESSAGE_FEED=true` persistido para Preview y
  Production;
- respuesta HTTP 200 y bundle productivo verificado con la estrategia canónica
  activa y la acción de cargar mensajes anteriores;
- no se encontraron logs de error para el deployment durante el smoke test.

### Cambio observable y rollback

No hay rediseño visual. El stream mantiene realtime sobre los 75 mensajes más
recientes y muestra `Load older messages` o `Search older messages` cuando hay
historial adicional. Esto reduce lecturas iniciales y evita sostener en memoria
todo el historial para cada usuario.

Rollback disponible:

1. desactivar `NEXT_PUBLIC_USE_PAGINATED_MESSAGE_FEED` y redesplegar para volver
   al listener legacy;
2. o reasignar los aliases al deployment anterior
   `dpl_J8aRCKu7H3rRH22j6X4gknRa283g`;
3. si la query canónica falla en runtime, el hook ya hace fallback al camino
   legacy para la sesión actual.
