# SVC — auditoría de arquitectura, mantenibilidad y performance de Firebase

> Revisión estática y de solo lectura realizada el 2026-07-16 sobre `main`
> (`2c10e0e`). Esta auditoría deliberadamente no prioriza seguridad: evalúa si
> Firebase y el backend están bien organizados, cuánto cuesta extenderlos, cómo
> escalan las lecturas/escrituras y dónde pueden aparecer problemas operativos.
> No se consultó ni modificó producción, no se usaron credenciales, no se
> ejecutaron scripts contra Firebase y no se desplegó nada.

## 0. Veredicto ejecutivo

La aplicación **no está en un quilombo hoy**. Para un equipo pequeño, pocos
usuarios concurrentes y el volumen histórico conocido, la arquitectura es
funcional y probablemente estable. No hace falta cambiar Firebase ni reescribir
la aplicación.

Sí hay deuda que va a encarecer cada feature nueva si continúa acumulándose:

1. La pantalla raíz mantiene varios listeners globales y toda la historia de
   mensajes accesible en memoria, sin límite ni paginación.
2. Durante la transición de `participants` a `visibleToUserIds`, un mismo
   mensaje puede entrar por dos consultas —y hasta por una tercera de proyectos—
   aunque luego se deduplique en memoria.
3. `app/page.tsx` concentra autenticación, listeners, transformación de datos,
   navegación y CRUD; `functions/src/index.ts` concentra todos los dominios del
   backend. Son los dos principales puntos de conflicto al agregar funciones.
4. La presencia (`lastSeen`) actualiza `/users` cada minuto mientras todos los
   clientes escuchan toda esa colección. El costo crece aproximadamente en
   forma cuadrática con los usuarios simultáneos.
5. Functions tiene un build correcto, pero `firebase.json` no lo ejecuta como
   `predeploy`; un deploy manual puede publicar JavaScript compilado viejo.
6. Directory es la parte mejor diseñada, pero su índice y sus shards se
   actualizan en pasos separados y no hay un reconciliador periódico que repare
   divergencias.

### Estado por área

| Área | Estado actual | Riesgo al crecer | Diagnóstico |
|---|---:|---:|---|
| Firebase como plataforma | Bueno | Bajo | Encaja bien con el producto actual |
| Directory / búsqueda | Bueno | Medio | Diseño sólido; falta cerrar rollout y reconciliación |
| Lectura de mensajes | Funcional | Alto | Sin paginación y con consultas superpuestas |
| Organización del frontend | Frágil | Alto | `app/page.tsx` es un coordinador monolítico |
| Organización de Functions | Funcional | Medio/alto | Todos los dominios comparten un único módulo |
| Presencia de usuarios | Aceptable hoy | Alto | Fan-out de reads por heartbeat global |
| Índices Firestore | Razonables | Medio | Pocos compuestos; falta revisar single-field innecesarios |
| Ciclo de vida de datos | Parcial | Medio | Recents, blobs y referencias pueden quedar huérfanos |
| Build/deploy/CI | Débil | Alto | Compilación manual, sin staging ni pipeline visible |
| Observabilidad de costo/performance | Insuficiente | Medio | No hay presupuesto ni métricas versionadas |

La prioridad correcta no es una gran refactorización. Es **estabilizar los
límites entre módulos**, hacer acotadas las lecturas de mensajes y volver
repetible el despliegue de Functions.

## 1. Mapa de la arquitectura actual

```text
Next.js / React
  app/page.tsx
    ├─ Auth y perfil
    ├─ listeners globales
    ├─ unión/deduplicación de mensajes
    ├─ navegación de Communications y Directory
    └─ CRUD de messages, contacts y contexts

  Directory
    ├─ /contacts + /contexts            fuentes de verdad
    ├─ /directoryIndex                  proyección derivada completa
    ├─ /directorySearchShards (32)      catálogo compacto schema v4
    ├─ /directoryMeta/status            manifest/revision
    ├─ Worker + MiniSearch               búsqueda local
    └─ IndexedDB + profile LRU           caché cliente

Cloud Functions v1 / Node 22
  functions/src/index.ts
    ├─ auto-link de contactos
    ├─ notificaciones de mensajes
    ├─ recordatorios diarios
    └─ sync incremental de Directory

Firebase
  ├─ Auth
  ├─ Firestore
  ├─ Storage
  └─ FCM
```

Hay una decisión arquitectónica especialmente buena: `/contacts` y
`/contexts` siguen siendo fuentes de verdad y Directory es una proyección
derivada. Eso permite reconstruir el índice sin destruir datos fuente y evita
que la optimización de búsqueda invada Communications.

## 2. Qué ya está bien implementado

### 2.1 Directory tiene una arquitectura deliberada

- IDs derivados determinísticos y tipos explícitos (`person`, `company`,
  `job`, `other`).
- Normalización compartida entre cliente y Functions mediante
  `lib/directory-core.ts` y su copia generada.
- Sync incremental más rebuild/backfill controlado para operaciones masivas.
- Lock de import para evitar miles de actualizaciones incrementales durante una
  carga grande.
- Catálogo schema v4 dividido en 32 shards con techo preventivo de 800 KB.
- Manifest con versión/revisión, caché IndexedDB, MiniSearch en Worker y fallback
  al índice completo.
- Perfil que carga proyección y fuente en paralelo, más LRU local.
- Notas y archivos paginados de a 50 con cursor; relaciones consultables por
  `entityIds`.

Esto está por encima de una implementación Firebase improvisada. Conviene usar
Directory como referencia para ordenar Communications.

### 2.2 Las consultas derivadas importantes tienen forma indexable

- Mensajes visibles: `array-contains` sobre `visibleToUserIds`.
- Recordatorios: `array-contains` sobre `calendarDateStrings`.
- Relaciones: `entityIds` + `active`.
- Notas y archivos: orden por fecha/document ID y cursor.

`firestore.indexes.json` es pequeño y comprensible. No hay una explosión de
índices compuestos ni consultas con offsets. Esa base es buena.

### 2.3 Hay guardas útiles en scripts y pruebas focalizadas

Los scripts de migración más delicados usan dry-run, flags de confirmación y/o
emulador. En esta revisión pasaron:

- `pnpm test:directory`: 12/12;
- `pnpm test:vcf-import`: 6/6;
- `pnpm exec tsc --noEmit`;
- `pnpm functions:build`;
- `pnpm build`.

Eso no reemplaza CI, pero demuestra que los caminos principales compilan y que
la lógica pura más importante de Directory tiene cobertura útil.

## 3. Principal cuello de botella: mensajes sin ventana

Al autenticarse, `app/page.tsx` abre simultáneamente:

1. todos los `/users`;
2. todos los `/projects`;
3. todas las `/categories`;
4. mensajes con `participants array-contains uid`;
5. mensajes con `visibleToUserIds array-contains uid`;
6. todos los `/contacts` y `/contexts` si el catálogo compacto está apagado;
7. mensajes cuyo `projectId` está en los primeros 30 proyectos.

Las consultas de mensajes no tienen `orderBy`, `limit` ni cursor. Por lo tanto,
cada sesión mantiene en tiempo real **toda la historia accesible**, aunque la UI
solo muestre una parte.

### 3.1 La deduplicación en React no elimina el costo de Firestore

El cliente combina los resultados por ID, pero Firestore ya ejecutó cada query.
Si un documento contiene al usuario tanto en `participants` como en
`visibleToUserIds`, puede cobrarse/transferirse por ambas consultas. Si además
coincide con el listener de proyectos, puede llegar una tercera vez.

Ejemplo de orden de magnitud, no medición de producción:

| Mensajes accesibles por usuario | Dos consultas superpuestas al iniciar |
|---:|---:|
| 500 | hasta ~1.000 lecturas de documentos |
| 5.000 | hasta ~10.000 lecturas de documentos |
| 20.000 | hasta ~40.000 lecturas de documentos |

El impacto real depende de cuánto se superpongan los resultados y del estado de
la caché, pero el diseño no tiene un techo. Firestore entrega todos los
documentos coincidentes en el snapshot inicial y luego cada cambio pertinente;
la facturación ocurre antes de que React deduplique.

### 3.2 El listener por proyecto es un camino de compatibilidad frágil

Solo considera los primeros 30 IDs porque `in` tiene un máximo. A medida que
haya más proyectos, el resultado depende del orden de la colección. Además,
puede pedir mensajes que las reglas no permitan al usuario, y el callback de
error deja `projectMessages` vacío sin diagnóstico visible.

No debería convertirse en la base de futuras features. El contrato estable debe
ser una sola ACL materializada (`visibleToUserIds`) y una estrategia separada
para filtrar/consultar por proyecto dentro del conjunto visible.

### 3.3 Diseño recomendado

Primero hay que confirmar que la migración legacy está completa. Después:

```text
consulta inicial
  where visibleToUserIds contains uid
  orderBy createdAt desc
  limit 50–100

scroll hacia atrás
  misma consulta
  startAfter último documento
  limit 50–100

realtime
  listener solo sobre la ventana reciente
```

Si el feed necesita combinar más de una dimensión, es preferible materializar
una bandeja por usuario o diseñar consultas específicas que reabrir toda la
historia. La primera mejora, sin cambiar el modelo, es paginar y retirar los
listeners legacy redundantes.

## 4. Presencia: un costo pequeño que crece cuadráticamente

Cada cliente autenticado:

- escucha toda la colección `/users`;
- escribe su propio `lastSeen` al entrar;
- vuelve a escribir cada 60 segundos;
- vuelve a escribir al regresar al foreground.

Con `N` usuarios conectados, hay aproximadamente `N` heartbeats por minuto y
cada heartbeat actualiza un documento observado por `N` clientes. El orden de
magnitud es `N²` entregas/lecturas por minuto:

| Usuarios simultáneos | Heartbeats/min | Entregas de cambios/min aproximadas |
|---:|---:|---:|
| 5 | 5 | 25 |
| 10 | 10 | 100 |
| 20 | 20 | 400 |
| 50 | 50 | 2.500 |

Es aceptable con pocos colaboradores y sesiones cortas. No es un buen contrato
para crecer porque identidad, preferencias y presencia comparten el mismo
documento y el mismo listener.

Además, cada heartbeat dispara técnicamente
`autoLinkOnUserEmailUpdate`. La Function retorna enseguida si el email no cambió,
pero la invocación ya ocurrió.

### Evolución recomendada

- Separar presencia en `/presence/{uid}` o en un mecanismo específico.
- Escuchar presencia solo donde realmente se muestra y, si alcanza, solo para
  usuarios relevantes.
- Subir el heartbeat a 3–5 minutos o derivar estado aproximado desde eventos de
  sesión.
- Mantener `/users` para identidad y preferencias de baja frecuencia.

No es P0 para el tamaño actual, pero conviene resolverlo antes de ampliar el
número de colaboradores.

## 5. Directory: buen diseño, con cuatro bordes a cerrar

### 5.1 El rollout del catálogo no está garantizado por el repo

`NEXT_PUBLIC_USE_DIRECTORY_CATALOG=true` reemplaza listeners completos de
`/contacts` y `/contexts` por un manifest y 32 shards. En `.env.local` el flag
no está definido, por lo que local usa el camino antiguo. El valor desplegado es
desconocido.

Con los conteos históricos documentados —5.183 contactos y 2.635 contexts— el
camino legacy puede leer unos 7.818 documentos fuente al iniciar. El catálogo
reduce el número a aproximadamente un manifest más 32 shards, aunque el payload
histórico total sigue rondando 7,3 MB.

Acción: verificar schema/revision en producción y fijar explícitamente el flag
por ambiente. Mientras eso no ocurra, existe una optimización importante pero
no un contrato operativo garantizado.

### 5.2 Cada revisión vuelve a leer los 32 shards

El listener de `/directoryMeta/status` invalida la caché y `loadEntityCatalog`
revalida el catálogo completo. Para un directorio con pocas ediciones esto es
un buen trade-off: muy pocos documentos y lógica simple. Si aumenta la
frecuencia de edición, cada cambio de una persona puede retransmitir varios MB a
cada cliente conectado.

No hace falta optimizarlo hoy. El umbral para hacerlo debería ser medible:

- frecuencia de cambios de fuente;
- clientes concurrentes;
- MB descargados por revisión;
- tiempo de reconstrucción del índice en dispositivos móviles.

Cuando ese producto sea alto, el manifest puede publicar `changedShardIds` o
revisiones por shard para descargar únicamente los afectados.

### 5.3 Índice y shards no se actualizan atómicamente

En un write de fuente se actualiza primero `/directoryIndex` y después el shard
correspondiente mediante transacción. Si el segundo paso falla, el índice puede
quedar nuevo y el catálogo viejo. No hay política explícita de retry ni tarea
periódica que compare y repare ambas proyecciones.

El fallback del cliente ayuda a leer, pero no garantiza reparación. La solución
no es forzar una transacción gigante: es agregar un reconciliador idempotente
que periódicamente valide:

- conteo y schema del manifest;
- existencia de los 32 shards;
- hash/revisión por shard;
- correspondencia con `/directoryIndex`;
- referencias a compañías existentes.

### 5.4 Renames y deletes tienen fan-out incompleto

Crear o renombrar una compañía reindexa personas relacionadas, con queries
limitadas a 500 y lotes paralelos de 50. Eso es razonable para el volumen actual,
pero:

- una compañía con más de 500 coincidencias puede quedar parcialmente
  actualizada;
- borrar una compañía o cambiarla a otro tipo elimina su índice, pero no vuelve
  a relacionar inmediatamente a todas las personas que la apuntaban;
- relaciones, notas o archivos pueden conservar referencias a entidades fuente
  borradas.

Conviene registrar estas situaciones como trabajo de reconciliación, no agregar
más lógica sin límite al trigger síncrono.

### 5.5 Shards: techo conocido y plan de crecimiento

Los shards actuales rondaron históricamente 167–223 KB y el código rechaza uno
que supere 800 KB. Hay margen suficiente hoy. Si la distribución y el tamaño
medio se mantienen, el orden de magnitud problemático aparecería cerca de 4× el
dataset actual, no mañana.

Antes de llegar al techo hay que versionar un schema v5 con más shards y
rollout dual/read fallback. El techo preventivo existente hace que el problema
sea detectable; falta convertirlo en métrica/alerta.

## 6. Cloud Functions: organización y confiabilidad

### 6.1 Un solo archivo mezcla cuatro dominios

`functions/src/index.ts` tiene 784 líneas e importa desde el inicio Admin,
Messaging y todo el core de Directory. Esto no está roto, pero hace que:

- cambios no relacionados compartan conflictos de merge;
- sea más difícil asignar ownership y tests;
- todos los exports dependan del mismo grafo de inicialización;
- los límites y configuración de runtime queden implícitos.

Separación incremental propuesta, preservando nombres de Functions:

```text
functions/src/index.ts                  solo exports
functions/src/shared/admin.ts           inicialización y helpers comunes
functions/src/auth/contact-linking.ts
functions/src/communications/push.ts
functions/src/communications/calendar.ts
functions/src/directory/sync.ts
functions/src/directory/catalog.ts
```

No hace falta migrar de v1 a v2 para lograr esta mejora. Primero modularizar,
agregar tests y conservar el comportamiento desplegado.

### 6.2 El deploy puede publicar build viejo

El entrypoint desplegado es `functions/lib/index.js`. El comando
`pnpm functions:build` copia el core compartido y ejecuta TypeScript, pero
`firebase.json` no tiene hook `predeploy` y no hay pipeline CI visible.

Consecuencia: `firebase deploy --only functions` puede usar el contenido ya
existente de `functions/lib`, aunque `functions/src` haya cambiado. También
`functions:watch` ejecuta solo `tsc --watch` y no resincroniza automáticamente
`directory-core.ts` cuando cambia el original.

Este es un riesgo de coordinación alto y barato de resolver:

1. agregar `predeploy` que ejecute instalación reproducible + build;
2. agregar un check de drift del core generado;
3. ejecutar tests y typecheck antes del deploy;
4. no depender de archivos compilados trackeados como señal de frescura.

### 6.3 Falta configuración operacional explícita

No se define región, memoria, timeout ni retry por Function. Antes de cambiar
valores hay que confirmar la región real de Firestore y medir duración/memoria.
Luego conviene centralizar configuración por tipo:

- triggers livianos de mensaje;
- fan-out de Directory;
- cron diario;
- tareas administrativas/rebuild.

La región de Functions debería estar alineada con Firestore para evitar latencia
y transferencia interregional innecesaria.

### 6.4 Fan-out de notificaciones y cron no están acotados

Para cada notificación se leen en paralelo el emisor y todos los destinatarios,
y todos los tokens se mandan en un solo `sendEachForMulticast`. FCM admite hasta
500 tokens por invocación multicast. El equipo actual está muy por debajo, pero
el helper debería trocear lotes y limitar concurrencia antes de que ese supuesto
se filtre a nuevas features.

El recordatorio diario usa `Promise.all` sobre todos los mensajes del día. La
query `calendarDateStrings array-contains today` es buena; lo que falta es
concurrencia acotada e idempotencia más fuerte si una ejecución falla después de
enviar y antes de marcar `reminderSentDates`.

## 7. Índices y costo de escritura

Los índices compuestos versionados parecen responder a queries reales y no hay
evidencia de sobre-indexación compuesta. El punto a revisar es el indexado
automático single-field.

Firestore indexa campos por defecto. Campos grandes que nunca se consultan
desde el servidor aumentan almacenamiento y fan-out de cada write. Candidatos a
inventariar —no eximir a ciegas—:

- texto/cuerpo y metadata visual de mensajes;
- mapas y arrays de importación/provenance;
- `masterData` voluminoso;
- campos de búsqueda que solo consume MiniSearch en el cliente;
- URLs, descripciones y blobs de metadata no usados en `where`/`orderBy`.

Se deben conservar índices para todos los campos usados por:
`participants`, `visibleToUserIds`, `projectId`, `calendarDateStrings`,
`contactIds`, emails de auto-link y relaciones de Directory.

La tarea correcta es generar una tabla “campo → query que lo usa” y después
agregar exemptions controladas. Firebase identifica el fan-out de índices como
uno de los principales componentes de latencia de escritura.

## 8. Ciclo de vida y crecimiento de datos

Hay varias colecciones/recursos con crecimiento sin política explícita:

- `/users/{uid}/directoryRecents` guarda un documento por entidad vista, pero
  solo consulta los últimos tres; los anteriores nunca se limpian.
- `fcmTokens` puede crecer hasta que un envío detecta tokens inválidos.
- `reminderSentDates` crece dentro de cada mensaje.
- los mensajes no tienen archivo, retención ni paginación de lectura.
- borrar un mensaje elimina Firestore pero no su imagen de Storage.
- borrar metadata de un archivo de Directory antes que el blob puede dejar un
  objeto huérfano si falla Storage.
- borrar fuentes puede dejar notas, archivos o relaciones apuntando a IDs que ya
  no existen.

Ninguno amenaza la estabilidad inmediata. Son costos silenciosos que conviene
resolver con jobs idempotentes y métricas:

- conservar solo los 20–100 recents más nuevos por usuario;
- cleanup periódico de tokens;
- borrado de blobs con cola/retry o estado `deleting`;
- reporte de referencias huérfanas;
- política de archivo/retención de mensajes definida por producto.

## 9. Organización para agregar features sin romper otras

### 9.1 El frontend necesita una capa de datos por feature

`app/page.tsx` tiene 1.947 líneas y `components/stream-screen.tsx` 2.879. Hoy una
feature puede modificar al mismo tiempo auth, listeners, navegación, mappers y
estado visual.

Arquitectura objetivo gradual:

```text
features/communications/
  model/message.ts
  data/message-queries.ts
  data/message-mutations.ts
  hooks/use-message-feed.ts
  components/...

features/directory/
  model/...
  data/...
  hooks/...
  components/...

lib/firebase/
  client.ts
  converters.ts
  observability.ts
```

`app/page.tsx` debería quedar como shell/coordinador y no conocer cada operación
Firestore. No se recomienda mover todo en un solo PR: extraer primero el feed de
mensajes, después presencia y luego CRUD de contacts/contexts.

### 9.2 Falta un contrato tipado único de Firestore

Hay interfaces útiles, pero también conversiones repetidas y datos tratados
como `Record<string, unknown>`/casts en distintos módulos. Al agregar un campo
es fácil actualizar escritura, olvidar un mapper o asumir otra forma en
Functions.

Usar converters y schemas compartidos para:

- `User`;
- `Message`;
- `Project`/categorías;
- `Contact`/`Context` fuente;
- documentos derivados de Directory.

`zod` ya está instalado. Puede validar bordes —lecturas, scripts y payloads— sin
reemplazar las interfaces internas. Directory core ya demuestra el patrón de
lógica pura compartida.

### 9.3 Los caminos legacy necesitan fecha de retiro

`participants`, `visibleToUserIds`, listener por proyecto, índice completo y
catálogo por shards conviven por compatibilidad. Esa convivencia fue útil para
migrar, pero cada nuevo desarrollador/agente debe decidir qué camino es
autoritativo.

Cada compatibilidad debería tener:

- fuente de verdad declarada;
- métrica de documentos todavía legacy;
- verificación de migración;
- criterio explícito para eliminar fallback;
- rollback conocido.

Sin eso, las optimizaciones nuevas se suman a las viejas en lugar de
reemplazarlas.

## 10. Build, entornos y coordinación

### Hallazgos

- `.firebaserc` apunta por defecto a `svc-comms`.
- No hay alias visible para dev/staging.
- No hay workflow CI versionado.
- `firebase.json` no tiene predeploy de Functions.
- `firebase.json` versiona Firestore/Functions, pero no Storage/Hosting.
- `pnpm lint` no funciona actualmente porque ESLint no está instalado como
  dependencia ejecutable del proyecto.

Para un equipo confiable, el mayor riesgo no es un atacante: es que una persona
o agente ejecute el comando correcto contra el ambiente equivocado o despliegue
un artefacto viejo.

### Pipeline mínimo recomendado

```text
pull request
  -> pnpm install --frozen-lockfile
  -> tests de lógica pura
  -> tsc --noEmit
  -> functions build + check de core generado
  -> tests de reglas en emulator
  -> next build

deploy staging
  -> smoke test

promoción manual a producción
  -> mismo artefacto / build reproducible
```

Agregar un proyecto Firebase de staging/demo vale más para coordinación que una
gran cantidad de documentación: permite probar triggers, índices, migraciones y
variables sin usar datos sensibles.

## 11. Observabilidad que falta para decidir con datos

Antes de optimizar microdetalles, medir semanalmente:

| Métrica | Para qué sirve |
|---|---|
| reads por sesión y por usuario activo | detectar feeds/listeners crecientes |
| reads y writes por colección | separar messages, users y Directory |
| documentos/bytes recibidos al abrir la app | validar catálogo y paginación |
| cantidad de mensajes accesibles por usuario | proyectar costo del snapshot inicial |
| duración/error/retry por Function | detectar fan-out y divergencias |
| tamaño máximo/p95 de shards | anticipar schema v5 |
| revisiones de catálogo por día | saber si conviene delta por shard |
| entidades índice vs shards | detectar desincronización |
| blobs/referencias huérfanas | controlar ciclo de vida |
| costo diario por usuario activo | traducir arquitectura a presupuesto |

También conviene un pequeño escenario de carga reproducible con 1k, 10k y 50k
mensajes, y con 8k, 20k y 40k entidades de Directory. La métrica principal debe
ser tiempo/bytes de arranque en un móvil medio, no solo el build de Next.

## 12. Plan recomendado por orden de retorno

### P0 — antes de sumar muchas features

1. **Paginar el feed de mensajes** y escuchar solo una ventana reciente.
2. **Verificar la migración** y retirar consultas legacy redundantes cuando los
   datos lo permitan.
3. **Hacer reproducible el deploy de Functions** con predeploy/build/check de
   core generado.
4. **Extraer el acceso a mensajes de `app/page.tsx`** a un módulo/hook con
   contrato tipado.

### P1 — estabilizar crecimiento y coordinación

5. Verificar/activar el catálogo schema v4 de forma explícita por ambiente.
6. Separar presencia de `/users` y bajar frecuencia/fan-out.
7. Dividir `functions/src/index.ts` por dominio sin cambiar exports.
8. Agregar reconciliador de Directory y cubrir deletes/type changes.
9. Agregar staging y CI mínimo.
10. Trocear FCM y acotar concurrencia del cron/fan-out.

### P2 — optimización sostenida

11. Inventariar y eximir índices single-field innecesarios.
12. Agregar retención/cleanup de recents, tokens, blobs y referencias.
13. Descargar solo shards modificados si la frecuencia de cambios lo justifica.
14. Definir dashboards, presupuesto y pruebas de carga.

## 13. Qué no conviene hacer

- No reescribir la app ni migrar de Firebase solo por esta deuda.
- No reemplazar el diseño de Directory; usarlo como modelo.
- No optimizar shards por adelantado sin medir frecuencia de cambios.
- No eliminar `participants` o fallbacks hasta verificar producción.
- No hacer una refactorización masiva de `app/page.tsx`; extraer verticales con
  tests y comportamiento equivalente.
- No agregar más listeners globales como atajo para una feature.
- No usar una Function síncrona con fan-out ilimitado para resolver limpieza o
  reconstrucciones grandes.

## 14. Criterios de éxito

La arquitectura queda preparada para crecer cuando:

- abrir Communications lee una ventana acotada de mensajes;
- existe una sola fuente de verdad documentada para visibilidad;
- el costo inicial no depende linealmente de toda la historia;
- deployar Functions siempre compila el source y el core compartido;
- cada dominio tiene módulo de datos/Functions y tests focalizados;
- una falla entre índice y shards se detecta y repara automáticamente;
- producción y staging tienen configuración explícita;
- el equipo puede explicar reads/writes por sesión con métricas reales.

## 15. Fuentes oficiales relevantes

- [Cloud Firestore: best practices](https://firebase.google.com/docs/firestore/best-practices)
  — cursors, fan-out de índices, contención y diseño para escala.
- [Cloud Firestore: realtime listeners](https://firebase.google.com/docs/firestore/query-data/listen)
  — snapshot inicial, cambios y lifecycle de listeners.
- [Cloud Firestore: pricing](https://firebase.google.com/docs/firestore/pricing)
  — facturación de reads y listeners.
- [Firestore: real-time queries at scale](https://firebase.google.com/docs/firestore/enterprise/real-time-queries-at-scale)
  — consultas específicas y listeners de larga duración.
- [Firebase Admin FCM](https://firebase.google.com/docs/cloud-messaging/send/admin-sdk)
  — multicast y límite de 500 tokens por llamada.
- [Cloud Functions retries](https://firebase.google.com/docs/functions/retries)
  — reintentos e idempotencia de funciones background.

## 16. Conclusión

El backend actual está bien para el uso limitado de hoy. La base de Directory
es sólida y Firebase sigue siendo una elección apropiada. El “quilombo” futuro
no vendría de Firestore en sí, sino de permitir que cada feature agregue otro
listener global, otro fallback y más lógica dentro de los dos archivos
monolíticos.

La intervención de mayor retorno es concreta: **feed paginado con una consulta
canónica, deploy reproducible de Functions y extracción gradual de módulos por
feature**. Con esas tres cosas, el proyecto gana margen para crecer sin una
reescritura y sin tocar datos sensibles.
