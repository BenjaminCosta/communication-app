# SVC — auditoría de Firebase y backend

> Auditoría estática y de solo lectura realizada el 2026-07-16 sobre `main`
> (`2c10e0e`). No se consultó Firestore/Auth/Storage de producción, no se usaron
> credenciales, no se ejecutaron migraciones y no se desplegó nada. Los estados
> de consola, IAM, billing, App Check, backups administrados y configuración real
> de Auth/Storage siguen siendo desconocidos hasta verificarlos expresamente.

## 0. Veredicto ejecutivo

Firebase **no está arquitectónicamente en un quilombo**. La capa de Directory
está bien pensada: separa fuentes de verdad y proyecciones, tiene normalización
compartida, sync incremental, shards, manifest, caché, fallback, paginación y
guardas para imports. El modelo de visibilidad de lectura de mensajes también
tiene una defensa legacy cuidadosa.

El problema principal está en otro lugar: la seguridad actual protege bastante
el *happy path* de la UI, pero no trata al cliente autenticado como hostil. Un
usuario que escriba Firestore directamente puede modificar campos que Functions
y la UI consideran confiables. Hay tres hallazgos críticos antes de considerar
la app robusta frente a usuarios no confiables:

1. `/users/{uid}` permite al dueño escribir cualquier campo y la Function de
   auto-link confía en `email`/`emailVerified` de ese documento. Un usuario puede
   declarar como verificado un email ajeno no linkeado, apropiarse de su contacto
   importado y ser agregado a mensajes que lo referencian.
2. Las reglas de creación de mensajes no obligan a que `authorId` y `senderId`
   sean iguales. Un usuario puede crear un mensaje con `authorId` propio y
   `senderId` de otra persona; la UI y FCM pueden mostrarlo como enviado por la
   víctima.
3. La UI permite crear cuentas con email/password, no envía verificación y todas
   las colecciones globales requieren solamente `request.auth != null`. Si el
   alta pública está habilitada en Firebase Auth, una cuenta nueva/no verificada
   accede de inmediato a usuarios, contactos, contexts y Directory.

Conclusión de estado:

| Área | Estado | Lectura |
|---|---|---|
| Arquitectura Directory | Buena | diseño deliberado y resiliente |
| Funcionamiento normal, equipo pequeño | Probablemente estable | pruebas/build locales pasan |
| Seguridad ante cliente malicioso autenticado | Crítica | hay caminos concretos de abuso |
| Privacidad/admisión de usuarios | Alta exposición | casi todo es global para cualquier autenticado |
| Performance actual | Mixta | schema v4 es bueno; el flag optimizado no está activo localmente |
| Functions/FCM | Funcional con deuda | falta idempotencia, límites y aislamiento de emulator |
| Storage | No auditable desde el repo | no hay reglas versionadas ni emulador configurado |
| Backups/DR | Incompleto | el JSON local no cubre todo ni prueba restauración |
| Tests de reglas | Insuficientes | no hay suite persistida como usuarios autenticados |
| Dependencias | Requiere parcheo | advisories críticos/altos detectados |

No hay evidencia en esta auditoría de que estos caminos hayan sido explotados ni
de que producción esté corrupta. Son vulnerabilidades y riesgos inferidos del
contrato local.

## 1. Alcance y metodología segura

Se revisaron:

- `firebase.json`, `firebase.emulator.json`, `.firebaserc`;
- `firestore.rules`, `firestore.rules.secure`, `firestore.indexes.json`;
- inicialización cliente, Auth, Firestore, Storage y FCM;
- todas las Cloud Functions y su build/deploy contract;
- listeners y escrituras de `app/page.tsx`;
- Directory: índice, shards, relaciones, notas, archivos y caché;
- scripts de import, migración, backup y emulator;
- historial/documentación de las optimizaciones recientes;
- `pnpm audit --prod` en raíz y en `functions/`;
- documentación oficial actual de Firebase para validar reglas, offline cache,
  App Check, listeners, FCM, Storage e idempotencia.

No se hizo:

- lectura ni escritura de datos reales;
- inspección de Firebase Console, Google Cloud IAM, logs o billing;
- comprobación de reglas efectivamente desplegadas;
- comprobación de proveedores Auth, dominios autorizados o allowlists;
- comprobación de reglas/objetos de Storage;
- test de restore, PITR o backup administrado;
- cambios de código/configuración para corregir hallazgos.

## 2. Cómo está armado Firebase hoy

```text
Next/PWA
  ├─ Firebase Auth: email/password + Google
  ├─ Firestore full SDK: listeners realtime + IndexedDB persistente multi-tab
  ├─ Firestore Lite: lecturas one-shot de Directory
  ├─ Storage: imágenes y archivos
  └─ FCM: tokens en /users + service worker

Cloud Functions v1 / Node 22
  ├─ auto-link de contactos al registrar/verificar email
  ├─ push al crear/actualizar mensajes
  ├─ cron diario de calendario
  └─ sync /contacts + /contexts -> Directory index + shards

Firestore
  ├─ fuentes: users, messages, projects, categories, contacts, contexts
  ├─ derivadas: directoryIndex, directorySearchShards, directoryMeta
  ├─ maestro: directoryRelations, directoryReferenceData, review queue
  └─ colaboración: directoryNotes, directoryFiles, favorites, recents
```

El proyecto Firebase está hardcodeado como `svc-comms`. `firebase.json` gestiona
Firestore e Functions, pero no Hosting ni Storage. Functions apunta a
`functions/lib/index.js`; la fuente está en `functions/src/index.ts`.

## 3. Evolución de las optimizaciones

La evolución observada es coherente:

1. Communications comenzó con listeners globales y compatibilidad de mensajes
   legacy.
2. `visibleToUserIds` reemplazó a `participants` como ACL materializada; el
   fallback legacy solo aplica cuando la ACL nueva no existe.
3. `/contacts` y `/contexts` quedaron como fuentes, y `/directoryIndex` como
   proyección read-only mantenida por Functions.
4. El master enrichment agregó `masterData`, relaciones de confianza `>=0.75`,
   review queue y reference data sin romper IDs legacy.
5. Schema v4 agregó 32 `/directorySearchShards`, manifest/revision, MiniSearch en
   Worker, IndexedDB, fallback al índice, perfiles paralelos y paginación.
6. `NEXT_PUBLIC_USE_DIRECTORY_CATALOG=true` permite a Communications dejar de
   escuchar las colecciones completas de contactos y contexts.

El código local no tiene ese flag en `.env.local`; por lo tanto el build local
usa el camino anterior de listeners completos. No se conoce el valor del entorno
desplegado.

Con los conteos históricos (5.183 contactos + 2.635 contexts), un arranque frío
sin flag puede leer aproximadamente 7.818 documentos fuente, además de usuarios,
proyectos y mensajes. Con el catálogo válido, el camino frío usa un metadata doc
y 32 shards: muchas menos lecturas, aunque todavía transfiere varios MB.

## 4. Hallazgos críticos — prioridad P0

### P0.1 — Auto-link confía en identidad editable por el cliente

Evidencia:

- `firestore.rules:20-23`: el usuario puede escribir todo su documento.
- `functions/src/index.ts:60-149`: el auto-link recibe email/verificación.
- `functions/src/index.ts:266-292`: los triggers leen esos valores de Firestore,
  no de Firebase Auth Admin.
- `app/page.tsx:448-455` y `796-807`: la UI escribe una copia de esos campos,
  pero las reglas no limitan a la UI.

Camino de abuso posible:

```text
usuario autenticado
  -> set users/{suUid}.email = email de un contacto corporativo
  -> set users/{suUid}.emailVerified = true
  -> autoLinkOnUserEmailUpdate confía en esos campos
  -> contact.linkedUserId = suUid
  -> mensajes con contactIds incluyen suUid en visibleToUserIds
```

El check que evita reemplazar un contacto ya linkeado reduce alcance, pero no
protege contactos todavía no registrados. El impacto potencial es acceso no
autorizado a mensajes.

Recomendación: la Function debe obtener `getAuth().getUser(uid)` y usar
exclusivamente `UserRecord.email`/`emailVerified`. Las reglas deben permitir al
cliente solo campos de perfil/preferencias explícitos; email verificado, roles,
IDs y datos de sistema deben ser server-owned. Firebase expone
`request.auth.token.email_verified` como fuente confiable en reglas.

### P0.2 — Suplantación de remitente en mensajes

Evidencia:

- `firestore.rules:84-87` valida el `authorId` si existe, pero no exige
  `senderId == authorId == request.auth.uid`.
- `app/page.tsx:176-181` prioriza `senderId` al mapear.
- `functions/src/index.ts:301-314` prioriza `senderId` para nombrar al emisor de
  la push.

Un request manual puede crear:

```text
authorId = UID del atacante
senderId = UID de la víctima
visibleToUserIds incluye al atacante
```

La regla lo acepta; Stream y FCM pueden atribuirlo a la víctima. Updates tampoco
preservan inmutables `authorId`/`senderId`.

Recomendación: exigir ambos campos, igualdad con Auth, tipos y no-mutabilidad en
update. Agregar tests de regla para create/update/delete como atacante, víctima
y tercero.

### P0.3 — Admisión amplia + datos globales

Evidencia:

- existe `createUserWithEmailAndPassword` y botón “Create Account”;
- no existe `sendEmailVerification` ni gate por `emailVerified`;
- luego del alta se navega inmediatamente a la app;
- `/users`, `/contacts`, `/contexts`, Directory, relaciones, notas y archivos
  permiten lectura a cualquier autenticado.

Si email/password o Google permiten creación pública en Console, la frontera de
la base es “tener cualquier cuenta”, no “ser parte de SVC”. Para una aplicación
interna con información sensible, eso es insuficiente.

Recomendación: definir una política de admisión explícita antes de tocar reglas:
invitación/allowlist, dominio corporativo verificado, custom claims o provisioning
administrativo. La UI no debe ser la frontera. App Check complementa Auth y
reglas contra clientes falsificados/abuso, pero no reemplaza autorización.

## 5. Hallazgos altos — prioridad P1

### P1.1 — Reglas sin control por campo ni esquema

Firestore es schemaless y la mayoría de las reglas solo decide quién escribe:

- `/users`: dueño cambia cualquier campo, incluido `isAdmin`, `emailVerified`,
  `fcmTokens`, `id` y metadata Auth.
- `/projects`: cualquier miembro actualiza cualquier campo. Puede ponerse como
  `ownerId`, alterar membresía y luego borrar el proyecto como nuevo dueño.
- `/contexts`: cualquier autenticado actualiza cualquier contexto, incluidos
  `masterData`, provenance y clasificación Directory.
- `/messages`: el autor puede mutar identidad, ACL, timestamps y marcadores de
  notificación sin validación de tipos/tamaño.
- `/contacts`: el owner puede modificar `ownerUserId` y cualquier dato canónico.
- notas/archivos/categorías protegen al creador anterior, pero no preservan
  campos de autoría ni validan shape.

`directoryFavorites` y `directoryRecents` son la excepción positiva: usan
`hasOnly`, ID consistente y timestamp del servidor.

Recomendación: usar `keys().hasOnly/hasAll`,
`request.resource.data.diff(resource.data).affectedKeys()` e invariantes por
colección. Separar campos server-owned de campos editables.

### P1.2 — FCM tokens visibles y copiables

Los tokens viven en `/users/{uid}.fcmTokens`, y cualquier autenticado lee todos
los users. Un cliente puede copiar tokens a su propio documento o recolectarlos.
Aunque el contenido actual de push es genérico, esto permite spam, notificaciones
mal dirigidas y aumenta la exposición de identificadores de dispositivo.

Recomendación: mover tokens a una subcolección privada/server-readable o a un
documento que otros usuarios no puedan leer. Validar plataforma, timestamps y
rotación; limitar cantidad por usuario.

### P1.3 — Storage no está versionado ni aislado

No hay `storage.rules` ni bloque Storage en `firebase.json`; tampoco Storage
Emulator ni `connectStorageEmulator`. Por lo tanto no se puede probar desde Git
quién puede subir, leer o borrar.

Además:

- mensajes y Directory guardan `getDownloadURL()` en Firestore;
- `lib/directory-files.ts` reconoce que el token URL hace el archivo visible a
  quien posea el enlace, independientemente de la lectura normal por reglas;
- los archivos Directory aceptan cualquier MIME hasta 15 MB;
- borrar mensajes no borra su imagen, generando blobs huérfanos;
- borrar archivo elimina primero metadata y hace best-effort del blob, por lo
  que un fallo deja storage huérfano.

Recomendación: inventariar/exportar las reglas reales, versionarlas y testearlas.
Para evidencia sensible, preferir descargas SDK autenticadas (`getBlob`/
`getBytes`) o un backend con URLs breves en vez de persistir tokens compartibles.

### P1.4 — El emulador no está completamente aislado

- `directoryDb` (Firestore Lite) no se conecta al emulator.
- Storage apunta al bucket real.
- FCM no tiene emulator ni guard de entorno en Functions.
- `export-prod-to-emulator.mjs` copia `/users` completos, incluidos potenciales
  `fcmTokens`, y mensajes reales.
- el script asigna la misma contraseña conocida a todos los usuarios emulados.

Riesgo especialmente importante: si Functions Emulator tiene credenciales para
FCM y se crea un mensaje contra users copiados con tokens reales, puede intentar
enviar push a dispositivos reales. No se confirmó una entrega; el camino no está
bloqueado por código.

Recomendación: usar project ID `demo-*`, redacción irreversible de tokens/PII,
guard explícito que deshabilite FCM fuera de producción y conexión de todos los
SDKs a emuladores. Nunca exponer Emulator UI a la red con un dump real.

### P1.5 — No hay tests persistidos de Security Rules

No está instalado `@firebase/rules-unit-testing`. `verify-test-cases.mjs` usa
Admin SDK, que omite reglas, y valida contenido, no autorización. Además sus
casos C/D/G todavía esperan visibilidad por membresía de proyecto, contradiciendo
el modelo actual de destinatarios explícitos.

El documento histórico menciona un test temporal de favoritos/recientes, pero
ese test no quedó en el repositorio. Hoy un cambio de reglas crítico puede llegar
sin regresión automática.

Recomendación: suite versionada de reglas con usuarios autenticados, no Admin,
para todas las colecciones y ataques descritos en este informe.

### P1.6 — Deploy de Functions puede publicar JS viejo

`functions/package.json` apunta a `lib/index.js`, pero `firebase.json` no tiene
hook `predeploy`. La Firebase CLI puede empaquetar el `lib/` existente sin
compilar `src/`. Como los artefactos compilados están versionados, un deploy
olvidando `pnpm functions:build` puede publicar lógica anterior.

`functions:build` sí sincroniza correctamente `lib/directory-core.ts` hacia la
copia generada y compila; `functions:watch` solo corre `tsc --watch` y no vuelve
a copiar el core compartido.

Recomendación: predeploy determinístico que instale frozen lockfile, sincronice,
compile y falle ante drift/tests.

### P1.7 — Scripts de producción tienen guardas inconsistentes

Los scripts nuevos de imports/master/recipients tienen dry-run y confirmaciones
razonables. Otros son peligrosos por default o solo requieren un flag corto:

| Script | Riesgo actual |
|---|---|
| `migrate-prod-visible-to.mjs` | con credencial escribe por default; dry-run requiere `DRY_RUN=true` |
| `backfill-emails.mjs` | escribe directamente; sin dry-run/confirmación |
| `backfill-image-dims.mjs` | escribe por default; dry-run es opt-in |
| `migrate-tag-categories.mjs --prod` | escribe salvo `--dry-run`; comentario de confirmación no coincide con código |
| `backfill-calendar-date-strings.mjs --prod` | `--prod` escribe salvo `--dry-run` |
| `set-admin.mjs` | cambia producción directamente |
| `generate-directory-index.mjs --write/--rebuild` | modo explícito, pero sin segunda confirmación de proyecto |

Recomendación: una librería común de target/safety que haga dry-run por default,
requiera project ID esperado + `--write` + confirmación nominal y emita plan/
checksum. Marcar scripts históricos obsoletos.

### P1.8 — Backup local no es recuperación completa

`backup-firestore.mjs` afirma exportar todas las colecciones, pero la lista
hardcodeada omite, entre otras:

- `categories` y `directorySearchShards`;
- `directoryNotes` y `directoryFiles`;
- subcolecciones favorites/recents;
- `_migrationBackups` y `directoryControl`;
- Firebase Auth y blobs de Storage.

No hay restore script, prueba de restauración, cifrado, retención ni checksum.
El JSON local contiene información sensible en claro. Puede servir como snapshot
auxiliar previo a una migración, no como plan de disaster recovery.

Recomendación: confirmar si existen backups administrados/PITR fuera del repo,
documentar RPO/RTO y probar restauración en un proyecto aislado. Mantener dumps
cifrados y con acceso restringido.

## 6. Hallazgos medios y de crecimiento — prioridad P2

### P2.1 — Amplificación de reads y writes por presencia

Cada cliente escucha toda `/users`. Cada usuario escribe `lastSeen` al entrar,
cada 60 segundos y al volver a foreground. Cada update:

- se entrega a todos los listeners de users;
- invoca `autoLinkOnUserEmailUpdate`, aunque luego retorne porque el email no
  cambió.

El costo crece aproximadamente de forma cuadrática con usuarios activos. A
escala pequeña es tolerable; a decenas/centenas se vuelve ruido de reads,
writes e invocaciones.

Recomendación: presencia separada y acotada, menor frecuencia/TTL, consulta solo
de actividad reciente y evitar que un heartbeat comparta el path del trigger de
identidad.

### P2.2 — Listeners globales todavía pueden estar activos

Sin `NEXT_PUBLIC_USE_DIRECTORY_CATALOG=true`, cada sesión mantiene listeners a
todos los contacts y contexts. Firestore factura cada documento inicial y cada
documento actualizado en el resultado del listener. Con persistencia, una
reconexión tras más de 30 minutos puede facturarse como query nueva.

Recomendación: terminar/verificar el rollout schema v4 y activar el flag por
entorno cuando aceptación y rollback estén comprobados. No asumir que el código
local prueba el estado desplegado.

### P2.3 — Refresh de catálogo completo por cada cambio

Functions modifica solo el shard afectado, pero el cliente, al ver una nueva
revision, vuelve a leer los 32 shards. Es barato en cantidad de documentos, no
necesariamente en ancho de banda: el catálogo histórico ronda 7,3 MB.

Con ediciones poco frecuentes funciona bien. Si contacts/contexts se vuelven
transaccionales o muy activos, conviene que metadata exponga shards afectados o
usar otra estrategia delta.

### P2.4 — Consistencia Directory ante deletes/type changes

Aspectos positivos: composite IDs estables, 800 KB ceiling, transacción shard +
manifest, lock con expiración, upserts idempotentes y eliminación de IDs de tipo
alternativo.

Huecos:

- borrar una compañía elimina su index entry, pero no reindexa personas que la
  referencian ni limpia relaciones/notas/files;
- cambiar company -> job/other tampoco desrelaciona personas;
- cambios de `sourceRecordId` sin rename no disparan re-relación;
- fan-out está limitado a 500 contactos por query;
- deletes se procesan antes de comprobar import lock;
- si el index write funciona pero el shard transaction falla, el trigger arroja
  error antes de `markDirectoryChanged`; sin retry/idempotency operacional puede
  quedar catálogo viejo hasta otro write/rebuild;
- metadata/shards son puntos de contención si crece la frecuencia de escritura.

Recomendación: reconciliación periódica/audit, manejo explícito de deletes y
type changes, cursores para fan-out y alerta ante errores de sync.

### P2.5 — Side effects de Functions no son idempotentes

Las proyecciones Directory son mayormente idempotentes. Las notificaciones no:

- create/update de mensajes no guardan event ID procesado;
- cron marca `reminderSentDates` después de enviar, sin transacción;
- una repetición/fallo parcial puede duplicar push;
- no hay dead-letter ni outbox.

Firebase recomienda que Functions event-driven sean idempotentes cuando pueden
reintentarse. Para notificaciones conviene registrar el evento/entrega antes o
en una transacción y diseñar recuperación explícita.

### P2.6 — Límite FCM y crecimiento de tokens

`sendEachForMulticast` recibe todos los tokens juntos. Firebase limita a 500
targets por invocación. No hay chunking ni dedupe global de tokens, y el array
por usuario crece hasta que un envío detecta tokens inválidos.

Para el equipo actual probablemente alcanza. A futuro: tokens en colección,
dedupe, paginación/chunks de 500, estado lastSeen/revoked y control de errores.

### P2.7 — Caché offline sensible persiste entre sesiones

Firestore se inicializa con IndexedDB persistente multi-tab. Firebase advierte
que la caché web no se limpia automáticamente entre sesiones y recomienda
considerar dispositivos confiables para información sensible.

Sign-out limpia el índice custom de Directory para ese UID, pero no la caché
persistente del SDK de Firestore. La UI vacía el estado, aunque los datos siguen
en disco hasta la política de cache/limpieza del navegador.

Recomendación: definir postura para dispositivos compartidos/robados, cache
memory-only o consentimiento “trusted device”, y proceso de clear persistence
cuando sea técnicamente viable.

### P2.8 — Errores de listeners y observabilidad

Muchos callbacks de error están vacíos o convierten fallos en listas vacías. El
listener legacy por `projectId` no satisface la ACL de reglas y probablemente se
vacía por permission-denied; su comentario aún habla de miembros de proyectos.

El listener principal de `participants` reintenta cada tres segundos ante
cualquier error persistente. No hay telemetría de Functions, alertas de sync,
presupuestos, error reporting ni CI visibles en el repo.

Recomendación: clasificación de errores, logging sin PII, métricas de sync/
notificaciones, alertas de fallos y presupuestos de billing.

### P2.9 — Ciclo de vida de links y objetos huérfanos

Auto-link agrega acceso, pero no hay unlink/revocación si cambia el email Auth,
se borra un usuario o se corrige el contacto. El UID permanece en contacts y
ACLs de mensajes. También faltan cleanup jobs para imágenes, notas/files y
relaciones cuyos owners/entities desaparecen.

Recomendación: política explícita de revocación, auditoría de referencias y
garbage collection segura con dry-run.

## 7. Dependencias y runtime

Auditoría ejecutada sin modificar lockfiles:

| Árbol | Resultado `pnpm audit --prod` |
|---|---|
| raíz | 24 advisories: 1 crítico, 11 altos, 10 moderados, 2 bajos |
| `functions/` | 9 advisories: 1 crítico, 4 altos, 4 moderados |

Hallazgos destacados:

- `next@16.2.4` aparece en varios advisories altos; los reportes señalan fixes
  en 16.2.5/16.2.6 según el caso.
- `websocket-driver <0.7.5` aparece crítico, transitivo por Firebase Database en
  cliente y por Firebase Admin compat en Functions.
- Functions reporta transitivos altos en `@grpc/grpc-js`, `form-data` y
  `protobufjs`.
- raíz también reporta `lodash` vía Recharts.

Un advisory transitivo no confirma explotabilidad en este uso concreto (por
ejemplo, Firebase Realtime Database no se importa en la app), pero el estado no
debe ignorarse. Recomendación: rama separada de upgrades, regenerar lockfiles,
repetir unit/build/emulator y desplegar de forma escalonada. No aplicar `audit
fix --force` sin revisar cambios mayores.

Functions declara Node 22. El build local previo pasó usando Node 25.8.2 con
warning de engine; la verificación de release debe hacerse con Node 22.

## 8. Lo que está bien y conviene preservar

1. `/directoryIndex`, shards, meta, relaciones y review queue no aceptan writes
   de cliente.
2. El fallback de mensajes no permite usar `participants` cuando existe
   `visibleToUserIds`; evita la fuga histórica de participants corruptos.
3. El cliente aplica además un filtro final de visibilidad tras unir listeners.
4. Imports recientes son idempotentes o dry-run-first y preservan provenance.
5. Master enrichment no inventa links bajo confianza 0,75 y manda ambigüedades
   a review.
6. Core Directory tiene una fuente canónica y build que regenera Functions.
7. Shards tienen manifest, conteo, validación de duplicados y ceiling de 800 KB.
8. Notas/files/relaciones están paginados y no crecen embebidos en source docs.
9. Favorites/recents tienen reglas de shape estrictas.
10. Push no incluye el contenido sensible del mensaje, solo “New message”.
11. `service-account.json`, dumps, backups y planillas están ignorados por Git.
12. Tests de Directory/VCF, TypeScript y builds pasaron en la revisión previa.

## 9. Plan sugerido, sin implementar cambios

### Etapa 0 — Contención y confirmación

1. Confirmar en Console si el registro público está habilitado y quién puede
   crear cuentas.
2. Exportar/leer las reglas Storage efectivamente desplegadas.
3. Confirmar reglas Firestore desplegadas vs repo.
4. Revisar logs para auto-links anómalos y Functions fallidas, sin exportar PII.
5. Confirmar App Check, backups administrados/PITR, budgets y alertas.

### Etapa 1 — Seguridad P0

1. Auto-link basado en Auth Admin, no en `/users` editable.
2. Allowlist/invitación/verificación para admisión.
3. Reglas por campo de `/users` y mensajes; impedir suplantación.
4. Tests de reglas que reproduzcan cada exploit antes de corregirlo.

### Etapa 2 — Integridad y privacidad P1

1. Inmutabilidad de owner/creator y política de contexts/projects.
2. FCM tokens privados.
3. Reglas Storage versionadas; estrategia de downloads autenticados.
4. Emulator completamente aislado y dumps redactados.
5. Predeploy de Functions determinístico.
6. Guardas comunes para scripts y backup/restore probado.
7. Upgrade controlado de dependencias.

### Etapa 3 — Estabilidad/costo P2

1. Completar rollout del catálogo y medir reads/bandwidth.
2. Rediseñar presencia y trigger de email.
3. Idempotencia/chunking de FCM.
4. Reconciliación periódica y cleanup de Directory/Storage.
5. Observabilidad, alerts, budgets y CI.
6. Política de caché local para datos sensibles.

## 10. Checks de aceptación para una futura corrección

- Cuenta no invitada/no verificada no puede leer datos globales.
- El usuario no puede escribir `emailVerified`, roles, tokens ajenos ni campos
  server-owned.
- Auto-link ignora completamente el email Firestore y usa Auth verificado.
- `authorId` y `senderId` siempre son Auth UID e inmutables.
- Un miembro de proyecto no puede tomar ownership ni borrar como escalamiento.
- Solo roles definidos pueden mutar contexts/masterData.
- Tokens FCM no son legibles por otros usuarios.
- Emulator no toca Storage/FCM/Firestore de producción.
- Rules tests pasan como cliente y demuestran denegaciones, no solo happy path.
- Deploy compila Functions automáticamente y falla ante drift.
- Push repetida/retry no duplica entregas lógicas.
- Delete/type-change de compañía no deja endpoints Directory rotos.
- Backup incluye Auth, Firestore completo, Storage y restore probado.
- `pnpm audit --prod` queda revisado y sin vulnerabilidades críticas aceptadas.

## 11. Fuentes oficiales consultadas

- [Control de campos en Firestore Security Rules](https://firebase.google.com/docs/firestore/security/rules-fields)
- [Security Rules y claims confiables de Firebase Auth](https://firebase.google.com/docs/rules/rules-and-auth)
- [Firebase App Check](https://firebase.google.com/docs/app-check)
- [Persistencia offline de Firestore](https://firebase.google.com/docs/firestore/manage-data/enable-offline)
- [Billing de listeners Firestore](https://firebase.google.com/docs/firestore/pricing)
- [FCM Admin SDK y límite multicast](https://firebase.google.com/docs/cloud-messaging/send/admin-sdk)
- [Idempotencia y retries de Cloud Functions](https://firebase.google.com/docs/functions/retries)
- [Descargas autenticadas vs download URLs de Storage](https://firebase.google.com/docs/storage/web/download-files)

## 12. Respuesta corta a “¿está estable?”

- **Sí**, para el flujo normal y un equipo pequeño/confiable, la arquitectura y
  especialmente Directory muestran trabajo serio de estabilización.
- **No todavía**, si “estable” incluye resistencia a un usuario autenticado
  malicioso, alta pública, revocación de acceso, disaster recovery y operación
  segura por terceros.
- Lo urgente no es reescribir Firebase: es endurecer identidad/reglas en puntos
  concretos, versionar Storage y agregar tests reales de autorización.
