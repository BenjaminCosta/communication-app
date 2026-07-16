# SVC Communications + Directory — contexto integral para agentes de IA

> Guía de entrada al proyecto para evitar relevar el repositorio desde cero.
> Estado del código documentado: `main` en `2c10e0e` (2026-07-13), revisado el
> 2026-07-16. Antes de actuar, contrastar siempre este documento con `git status`,
> el código actual y el estado real del entorno objetivo.

Alcance histórico: el repositorio no guarda un transcript completo de las
conversaciones anteriores. El contexto se reconstruyó desde los documentos que
esas sesiones dejaron, el historial Git, comentarios, reglas y código vigente.
Cuando una decisión conversada no quedó materializada en alguno de esos lugares,
no debe tratarse como confirmada.

## 0. Resumen ejecutivo

SVC es una aplicación web móvil/PWA interna con dos módulos que comparten
autenticación, datos y navegación:

1. **Communications**: captura y organiza mensajes mediante destinatarios,
   tags/proyectos, contextos, fechas de calendario, respuestas e imágenes.
2. **Directory**: buscador y perfil unificado de personas, compañías y jobs,
   derivado de las colecciones fuente `/contacts` y `/contexts` y enriquecido
   desde bases legacy/maestras.

La app es un Next.js App Router, pero funcionalmente es una SPA centrada en
`app/page.tsx`: no hay una ruta por pantalla. Firebase provee Auth, Firestore,
Storage, Cloud Functions y FCM. La experiencia está optimizada para PWA móvil,
incluidos safe areas, teclado virtual, caché offline y push notifications.

La idea arquitectónica más importante es esta:

```text
                              ┌─> Communications (mensajes, tags, calendario)
Firebase Auth ─> app/page.tsx ┤
                              └─> Directory (búsqueda y perfiles)

/contacts + /contexts ──> normalización ──> /directoryIndex (detalle/fallback)
                                    └─────> /directorySearchShards (catálogo)

master XLSX ──> masterData + relaciones seguras + review queue + reference data
```

No tratar `/directoryIndex` ni `/directorySearchShards` como fuentes de verdad:
son proyecciones derivadas. Las ediciones de entidad deben ir a `/contacts` o
`/contexts`; Cloud Functions mantiene las proyecciones.

## 1. Cómo empezar una tarea sin perder tiempo

Orden recomendado de lectura:

1. Ejecutar `git status --short` y leer el diff relevante. Puede haber trabajo
   del usuario sin commitear; nunca descartarlo ni sobrescribirlo.
2. Leer este documento y después solo el documento especializado relacionado:

   - import original: [Data Import & Normalization](./svc-data-import-normalization.md);
   - enriquecimiento maestro: [Master Enrichment Migration](./svc-master-enrichment-migration.md);
   - contrato/UI: [Directory UI Context](./svc-directory-ui-context.md);
   - performance schema v4: [Directory Performance](./svc-directory-performance-optimization.md).
3. Ubicar el flujo en `app/page.tsx`, los tipos/compatibilidad en `lib/store.ts`
   y, para Directory, en `lib/directory-core.ts`.
4. Revisar `firestore.rules` antes de agregar o modificar cualquier lectura o
   escritura de cliente.
5. Verificar con el conjunto mínimo de pruebas indicado en §11.

Actualmente `README.md` está vacío y no existe `AGENTS.md`. Por eso este archivo
es el punto de entrada humano/agente, pero no reemplaza al código como autoridad.

## 2. Stack y forma de ejecución

| Capa | Tecnología / decisión actual |
|---|---|
| Frontend | Next.js 16.2, React 19, TypeScript estricto, App Router |
| UI | Tailwind CSS 4, Radix UI/shadcn, Lucide, Sora + JetBrains Mono |
| Estado | React local state/hooks; no Redux/Zustand |
| Backend | Firebase Auth, Firestore, Storage, FCM y Cloud Functions v1 |
| Functions | TypeScript, Node 22, `firebase-functions` v6, Admin SDK |
| Búsqueda | MiniSearch en cliente, armado en Web Worker, caché IndexedDB |
| PWA | `public/manifest.json`, `public/sw.js`, service worker propio |
| Analítica | Vercel Analytics solo en build de producción |
| Datos operativos | Firestore; XLSX/VCF se importan mediante scripts Admin SDK |

La configuración pública de Firebase está en `lib/firebase.ts` y en
`public/sw.js`. Es normal que el API key del cliente sea visible; la credencial
secreta es `service-account.json`, que está ignorada por Git y nunca debe
copiarse a código, documentación, logs ni commits.

Hay `pnpm-lock.yaml` y `package-lock.json`, pero los documentos y comandos
operativos recientes usan **pnpm**. Evitar actualizar ambos lockfiles por un
cambio que no toca dependencias. El runtime raíz no está fijado; Functions sí
declara Node 22.

## 3. Arquitectura del frontend

### 3.1 Shell y navegación

- `app/layout.tsx` define metadata PWA, viewport fijo, safe-area workarounds,
  fuentes, service worker, sincronización de viewport y Analytics.
- `app/page.tsx` es un Client Component grande que concentra autenticación,
  listeners Firestore, estado global informal, navegación y handlers CRUD.
- `Screen` es una unión de strings; `navigateTo()` decide la animación por
  profundidad. Cambiar pantallas implica revisar `Screen`, `SCREEN_DEPTH`, el
  render condicional y los callbacks de regreso.
- El módulo usado por última vez se conserva en `localStorage` y cookie bajo
  `svc-last-module`; el siguiente inicio abre Communications o Directory.
- Directory Favorites es una pantalla interna/overlay de Directory, no un valor
  nuevo de `Screen` en `app/page.tsx`.
- Las pantallas secundarias se cargan con `next/dynamic`. Login, Compose y Stream
  pertenecen al camino crítico y se importan estáticamente.

No asumir routing web convencional, URLs profundas ni Server Components para
los flujos de negocio. Una refactorización a rutas reales sería un cambio
arquitectónico, no una corrección local.

### 3.2 Módulo Communications

Flujo principal:

```text
Auth -> Compose -> escritura /messages -> Stream
                    ├─ destinatarios explícitos
                    ├─ tags/proyectos
                    ├─ contactos importados y contextos relacionados
                    ├─ fechas de calendario
                    ├─ reply preview
                    └─ imagen en Storage + metadata/BlurHash
```

Pantallas importantes:

| Área | Archivo principal |
|---|---|
| Componer | `components/compose-screen.tsx` |
| Stream, filtros y mensajes | `components/stream-screen.tsx` |
| Tags / detalle de mensaje | `components/tag-sheet.tsx` |
| Input reutilizable | `components/message-input-bar.tsx` |
| Calendario | `components/calendar-screen.tsx` |
| Personas/contactos | `components/people-screen.tsx` |
| Tags/proyectos | `components/project-list-screen.tsx` |
| Contextos | `components/contexts-screen.tsx` |
| Búsqueda global | `components/global-search-sheet.tsx` |

En el modelo actual, `/projects` funciona también como catálogo de tags. Se
conservan campos legacy (`projectId`, `projectIds`, `type`) a la vez que el
modelo nuevo usa `tagIds`. Los helpers de compatibilidad de `lib/store.ts`
deben ser usados en vez de reimplementar la conversión en componentes.

### 3.3 Módulo Directory

Directory se integra en el shell mediante `ModuleSwitcher` y reutiliza la
sesión Firebase. Sus piezas se encuentran en `components/directory/`:

- `directory-state-provider.tsx`: una sola carga/suscripción compartida de
  catálogo, favoritos y recientes mientras el módulo está abierto.
- `directory-screen.tsx`: home, búsqueda, scopes, browse y favoritos.
- `directory-profile-screen.tsx`: perfil rico y tabs secundarios.
- `directory-search-experience.tsx`: lógica de experiencia de búsqueda.
- `directory-edit-sheet.tsx`: edición, siempre contra colección fuente.
- `directory-notes-tab.tsx` / `directory-files-tab.tsx`: conocimiento y
  evidencia asociados a una entidad.

La búsqueda no consulta Firestore por cada tecla. Descarga un catálogo compacto,
construye MiniSearch en un Worker y conserva documentos + índice comprimido en
IndexedDB. `lib/directory-search.ts` implementa stale-while-revalidate:

1. entrega caché local inmediatamente si existe;
2. lee `/directoryMeta/status`;
3. si schema/revision coinciden, reutiliza caché;
4. si no, lee 32 `/directorySearchShards`;
5. ante catálogo inválido/incompleto, cae a `/directoryIndex`;
6. reconstruye MiniSearch y actualiza IndexedDB.

`NEXT_PUBLIC_USE_DIRECTORY_CATALOG=true` hace que Communications adapte ese
mismo catálogo y evite listeners completos a `/contacts` y `/contexts`. El
default del código es `false`; no inferir que el flag está activo en producción.

## 4. Modelo de datos Firestore

| Colección | Rol | Lectura cliente | Escritura principal |
|---|---|---|---|
| `/users` | cuentas/perfiles, admin, preferencias y tokens FCM | cualquier autenticado | cada usuario, su propio doc |
| `/users/{uid}/directoryFavorites` | favoritos privados | dueño | dueño |
| `/users/{uid}/directoryRecents` | recientes privados | dueño | dueño |
| `/messages` | comunicaciones | por `visibleToUserIds`; fallback legacy | autor |
| `/projects` | tags/proyectos globales y membresía | autenticados | dueño crea/borra; miembros actualizan |
| `/categories` | categorías custom | autenticados | creador |
| `/contacts` | personas/contactos fuente | autenticados, global | `ownerUserId` |
| `/contexts` | compañías/jobs/otros fuente | autenticados | cualquier autenticado actualiza; creador borra |
| `/directoryIndex` | perfil/índice derivado | autenticados | solo Admin/Functions |
| `/directorySearchShards` | catálogo compacto derivado | autenticados | solo Admin/Functions |
| `/directoryMeta/status` | schema, revisión y conteos del catálogo | autenticados | solo Admin/Functions |
| `/directoryRelations` | relaciones seguras derivadas | autenticados | solo Admin |
| `/directoryReviewQueue` | ambigüedades internas | denegada | solo Admin |
| `/directoryReferenceData` | catálogos curados | autenticados | solo Admin |
| `/directoryNotes` | notas por entidad | autenticados | autor |
| `/directoryFiles` | metadata de archivos por entidad | autenticados | uploader |
| `/directoryControl/sync` | lock de import/rebuild | denegada | solo Admin |

`firestore.rules` es la configuración de producción referenciada por
`firebase.json`; `firestore.rules.secure` es la variante que usa
`firebase.emulator.json`. Mantenerlas alineadas cuando corresponda, pero no
desplegar reglas, índices o Functions sin aprobación explícita.

Firebase Storage se usa para imágenes de mensajes y archivos de Directory, pero
este repo no declara reglas de Storage en `firebase.json`. Antes de cambiar ese
flujo, verificar por separado las reglas realmente desplegadas.

## 5. Invariantes de mensajes y visibilidad

Este es el sector con mayor riesgo de fuga de datos.

### 5.1 Modelo vigente

`visibleToUserIds` es la fuente de verdad y se calcula como:

```text
autor + destinatarios explícitos registrados
```

La membresía de tags/proyectos **ya no concede visibilidad implícita**. Antes de
ese cambio, los receptores implícitos fueron backfilleados a `recipientIds`.
Los comentarios antiguos que aún mencionan “tag members” no deben prevalecer
sobre `computeVisibleToUserIds()` en `lib/store.ts`.

No confundir los identificadores:

| Campo | Significado |
|---|---|
| `recipientIds` / `peopleIds` | UIDs Firebase de destinatarios registrados |
| `contactIds` | IDs de documentos importados en `/contacts` |
| `contextIds` | IDs de `/contexts`; enriquecen, no otorgan acceso |
| `tagIds` | clasificación; no otorga acceso |
| `participants` | compatibilidad legacy, potencialmente corrupta |
| `visibleToUserIds` | ACL materializada vigente |

### 5.2 Compatibilidad legacy obligatoria

El cliente mantiene listeners para mensajes encontrados por `participants` y
por `visibleToUserIds` (y cargas relacionadas con proyecto). Después de unir y
deduplicar resultados, vuelve a filtrar en memoria: si existe
`visibleToUserIds`, el UID actual debe estar incluido.

Las reglas replican la misma frontera:

- si el documento tiene `visibleToUserIds`, solo ese campo autoriza lectura;
- únicamente si el campo no existe se permite fallback a `participants`;
- crear exige que el autor autenticado sea autor/sender y esté en la ACL;
- actualizar o borrar exige ser autor/sender.

No simplificar estos listeners, el filtro final o las reglas sin probar casos
legacy. El caso histórico peligroso es un mensaje con `participants=allUIDs`:
jamás debe filtrarse hacia un usuario ausente de `visibleToUserIds`.

### 5.3 Linking de contactos importados

Cuando un usuario con email verificado aparece o actualiza su email, Functions:

1. busca `/contacts` por email normalizado/candidatos;
2. completa `linkedUserId`, `status` y timestamps;
3. agrega el UID a mensajes que referencian ese contacto;
4. marca el update con `importedContactLinkRunId` para no enviar una push
   retroactiva engañosa.

La UI también resuelve contactos importados ya linkeados al componer. Cambiar
normalización de email exige revisar cliente, Functions, importadores e índices.

## 6. Invariantes y pipeline de Directory

### 6.1 Fuentes, proyecciones e IDs

- Personas: `/contacts`.
- Compañías, jobs y otros: `/contexts`.
- ID Directory: `{type}__{sourceId}`, por ejemplo `person__abc123`.
- `DirectoryType`: `person | company | job | other`.
- El tipo de un contexto usa primero `directoryType`; luego heurísticas sobre
  `sourceSheet` y `fields[]`.
- Código canónico del normalizador: `lib/directory-core.ts`.
- `functions/src/directory-core.ts` es **generado**. Nunca editarlo a mano.
- `functions:build` copia el core canónico y compila Functions.

En el código revisado, `DIRECTORY_SCHEMA_VERSION=4` y existen 32 shards. Los
documentos históricos de schema v3 siguen siendo útiles para entender la
migración, no para definir el contrato local actual.

### 6.2 Enriquecimiento maestro y confianza

El import original creó `/contacts` y `/contexts` desde la base legacy. El
workbook maestro posterior no reemplaza esos documentos: preserva IDs y
referencias, agrega `masterData`, crea relaciones/catálogos y deriva una cola de
revisión.

Regla central: una relación persona/job → compañía solo se materializa si su
confianza es `>= 0.75`. Por debajo del umbral puede mostrarse texto crudo, pero
no se debe inventar un link a entidad. Las coincidencias ambiguas van a
`/directoryReviewQueue`; no se fusionan ni eliminan silenciosamente.

Los valores canónicos de `masterData` tienen precedencia para presentación y
búsqueda cuando son seguros. Los campos legacy se preservan por trazabilidad y
compatibilidad. Evitar “limpiezas” que borren provenance, IDs viejos o
excepciones no resueltas.

### 6.3 Escrituras y sincronización

- UI: usar `lib/directory-writes.ts`, que actualiza `/contacts` o `/contexts`.
- Sync incremental: `syncDirectoryOnContactWrite` y
  `syncDirectoryOnContextWrite` en `functions/src/index.ts`.
- Bulk: bloquear sync, importar/enriquecer, regenerar índice/catalogo, verificar
  y desbloquear incluso ante error.
- Catálogo: Functions solo lo actualiza incrementalmente si existe un manifest
  completo y compatible; así un rollout parcial no corrompe la lectura.
- La re-relación de personas al editar una compañía es intencional; revisar el
  impacto fan-out antes de tocar esa lógica.

Notas, archivos, favoritos y recientes referencian el ID composite, pero no
mutan la entidad fuente ni el índice.

## 7. Cloud Functions y trabajos automáticos

Exports actuales en `functions/src/index.ts`:

| Function | Evento | Responsabilidad |
|---|---|---|
| `autoLinkOnRegister` | create `/users/{uid}` | link de contactos por email verificado |
| `autoLinkOnUserEmailUpdate` | update `/users/{uid}` | reintento de link al verificar/cambiar email |
| `onMessageCreated` | create `/messages/{id}` | push a usuarios visibles salvo autor |
| `onMessageUpdated` | update `/messages/{id}` | push solo a UIDs nuevos, salvo auto-link |
| `onDailyCalendarReminders` | cron 08:00 UTC | recordatorios deduplicados del día |
| `syncDirectoryOnContactWrite` | write `/contacts/{id}` | upsert/delete de persona derivada |
| `syncDirectoryOnContextWrite` | write `/contexts/{id}` | reindex de contexto y relaciones afectadas |

Las Functions usan API de primera generación deliberadamente para evitar
complejidad IAM/Eventarc. El cron trabaja en UTC, no en la zona horaria del
usuario. Si se cambia calendario o reminders, revisar `calendarDates`, el array
indexable `calendarDateStrings` y `reminderSentDates` como conjunto.

## 8. Mapa de archivos: dónde cambiar qué

| Necesidad | Empezar por |
|---|---|
| Auth, listeners, navegación, CRUD general | `app/page.tsx` |
| Tipos y compatibilidad Communications | `lib/store.ts` |
| Regla de acceso | `firestore.rules` + `firestore.rules.secure` |
| Query que requiere índice | `firestore.indexes.json` |
| Normalización/shape Directory | `lib/directory-core.ts` |
| Búsqueda/caché Directory | `lib/directory-search.ts` + Worker |
| Perfil Directory | `lib/directory-profile-loader.ts`, `lib/directory-view-models.ts` |
| Edición de entidad Directory | `lib/directory-writes.ts` |
| Relaciones/notas/archivos | `lib/directory-relations.ts`, `directory-notes.ts`, `directory-files.ts` |
| Favoritos/recientes | `lib/directory-user-state.ts` |
| Firebase cliente/persistencia | `lib/firebase.ts` |
| Push cliente | `lib/fcm.ts` + `public/sw.js` |
| Push/sync backend | `functions/src/index.ts` |
| Import de base XLSX | `scripts/import-database-xlsx.mjs` |
| Enriquecimiento maestro | `scripts/enrich-directory-from-master.mjs` |
| Regeneración/auditoría Directory | `scripts/generate-directory-index.mjs`, `audit-directory.mjs` |
| Migraciones de mensajes/tags | scripts `backfill-*`, `migrate-*`, `normalize-tags-v1.mjs` |
| Estilos/tokens globales | `app/globals.css` |

`styles/globals.css` existe, pero el layout importa `app/globals.css`. Confirmar
el import real antes de editar estilos aparentemente duplicados.

## 9. Configuración y entorno local

Variables relevantes:

| Variable | Uso |
|---|---|
| `NEXT_PUBLIC_USE_FIREBASE_EMULATORS=true` | conecta Auth/Firestore/Functions del browser a emuladores |
| `NEXT_PUBLIC_USE_DIRECTORY_CATALOG=true` | activa catálogo compacto también para Communications |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | importación de contactos Google |
| `GOOGLE_APPLICATION_CREDENTIALS` | scripts Admin SDK; normalmente `./service-account.json` |
| `OWNER_UID` | dueño de contactos en importadores |
| `DRY_RUN`, `CONFIRM_*`, `VERIFY` | guardas específicas de scripts de producción |

Inicio habitual:

```bash
pnpm install
pnpm dev
```

Con emuladores:

```bash
pnpm emulator
pnpm dev:emulator
```

El script `emulator` fija una ruta Homebrew concreta para Java 21. Si no existe
en la máquina, ajustar el entorno local o ejecutar Firebase CLI con un Java 21
disponible; no hardcodear otra ruta global sin necesidad.

Puertos: Auth `9099`, Firestore `8080`, Functions `5001`, Emulator UI `4000`.
Proyecto Firebase por defecto: `svc-comms` (`.firebaserc`).

## 10. Scripts de datos y seguridad operacional

Clasificación práctica:

- **Locales/unitarios**: `test:directory`, `test:vcf-import`.
- **Emulador**: seed/verify de visibilidad, categorías, calendario y migraciones.
- **Lectura de producción**: auditorías y dry-runs con service account.
- **Escritura de producción**: imports, backfills, rebuilds y deploys; requieren
  flags de confirmación y aprobación explícita del usuario.

Reglas para agentes:

1. No ejecutar un script contra producción solo porque su default sea dry-run.
   Leer cabecera, argumentos y variables del script exacto.
2. No asumir que `--verify` es local: suele leer producción con Admin SDK.
3. No desplegar Firebase, Functions, reglas, índices ni cliente sin solicitud o
   aprobación explícita.
4. Antes de una migración bulk, crear/verificar backup y usar el lock de
   Directory. Diseñar `try/finally` operacional para no dejar el sync bloqueado.
5. Preferir scripts idempotentes, dry-run y conteos antes/después. No borrar
   excepciones legacy para forzar que los números “cierren”.
6. Admin SDK salta reglas: un test exitoso con service account no demuestra que
   el cliente autenticado tenga acceso.

Comandos de bulk Directory y guardas exactas están en los documentos
especializados. No copiar comandos históricos sin revisar el código actual.

## 11. Verificación proporcional al cambio

Base local recomendada:

```bash
pnpm test:directory
pnpm test:vcf-import
pnpm exec tsc --noEmit
pnpm functions:build
pnpm build
```

Consideraciones:

- `next.config.mjs` tiene `typescript.ignoreBuildErrors=true`. Por eso un
  `pnpm build` exitoso **no reemplaza** `pnpm exec tsc --noEmit`.
- `functions:build` regenera `functions/src/directory-core.ts`; revisar el diff
  generado y mantener también `functions/lib/*` coherente si el proyecto los
  versiona.
- `pnpm lint` figura en scripts, pero actualmente falla con
  `eslint: command not found`: ESLint no está declarado. No reportar lint como
  aprobado hasta que el proyecto incorpore esa dependencia/configuración.
- No hay suite integral de UI. Para cambios de interacción, probar manualmente
  el flujo afectado y, cuando corresponda, la PWA instalada/iOS además del
  browser de escritorio.

Verificación hecha al redactar esta guía (2026-07-16): Directory 12/12, VCF
6/6, `tsc --noEmit`, Functions build y Next production build pasaron. El build
de Functions emitió una advertencia porque la máquina usó Node 25.8.2 mientras
el paquete declara Node 22; repetir con Node 22 antes de atribuir al proyecto un
fallo específico de runtime.

Matriz mínima:

| Cambio | Verificación adicional |
|---|---|
| Mensajes/ACL | emulador: casos de visibilidad legacy y vigente; autor/no autor |
| Tags/proyectos | filtros + compatibilidad `tagIds`/legacy + ACL sin membresía implícita |
| Calendario | fechas múltiples, strings indexables, reminder dedupe |
| Directory core | test Directory + Functions build + ausencia de drift generado |
| Reglas | emulator con usuario dueño y otro usuario; Admin no alcanza |
| Búsqueda/catálogo | caché fría/caliente, fallback índice, ranking y scopes |
| PWA/caché | Safari normal vs instalada; actualización de SW y chunks Next |
| Import/migración | dry-run repetible, backup, conteos, refs rotas, idempotencia |

## 12. Convenciones de implementación y UX

- La UI visible está mayormente en inglés; mantener consistencia salvo decisión
  explícita de localización.
- Diseño mobile-first, fondo oscuro, tipografía Sora, mono para metadata, targets
  táctiles y transiciones direccionales.
- Respetar safe areas, viewport fijo y comportamiento con teclado. Cambios
  inocentes en `layout.tsx`/`globals.css` pueden romper iOS/Android standalone.
- Reutilizar componentes de `components/ui/` y patrones existentes antes de
  crear variantes.
- Mantener carga crítica pequeña: pantallas no esenciales siguen dinámicas;
  Firebase Storage, compresión de imágenes y MiniSearch se cargan bajo demanda.
- En Firestore, conservar timestamps de servidor, arrays normalizados y campos
  de compatibilidad cuando el flujo ya los escribe.
- Los archivos grandes (`app/page.tsx`, `stream-screen.tsx`, `tag-sheet.tsx`) son
  deuda estructural real. Hacer refactors acotados y verificables; no mezclar una
  extracción masiva con un fix funcional urgente.

## 13. Problemas conocidos y trampas históricas

1. **Documentos con estado temporal**. Algunas secciones de
   `svc-directory-ui-context.md` describen archivos “uncommitted” de una sesión
   anterior. Esos cambios ya aparecen en commits actuales. Usar esas secciones
   como bitácora, no como `git status` vigente.
2. **Producción vs código local**. El documento de performance registró que
   producción seguía en schema v3 y sin shards el 2026-07-13, mientras el código
   local ya es schema v4. Ese dato puede haber cambiado: verificar antes de
   rollout, diagnóstico o rollback.
3. **Firestore persistente en iOS/PWA**. Favorites/recents mostraron listeners
   cache-only aunque la escritura y las reglas eran correctas. Los helpers hacen
   reconciliación forzada con servidor. Antes de alterar datos/reglas, comparar
   Safari normal, PWA instalada, lectura server y estado cacheado.
4. **Firestore Lite en Directory**. Los one-shot reads usan `directoryDb`
   deliberadamente para evitar una carrera/assert del pipeline watch del SDK
   completo al convivir con listeners persistentes. No cambiarlo por `db` sin
   reproducir y probar el problema original.
5. **Emulador y Firestore Lite**. `lib/firebase.ts` conecta al emulador solo la
   instancia full `db`; `directoryDb` no recibe `connectFirestoreEmulator`.
   Por eso un flujo Directory basado en Lite no está cubierto end-to-end por
   `pnpm dev:emulator` tal como está hoy. No interpretar ese fallo como dato
   inexistente ni permitir silenciosamente un fallback a producción; aislar y
   verificar el cliente usado por cada lectura.
6. **Service worker**. Nunca cachea `/_next/` para evitar chunks/factories stale.
   No convertirlo en cache-first global.
7. **Contactos globales**. Todos los autenticados leen todos los contactos; las
   escrituras siguen limitadas por `ownerUserId`. El viejo toggle private/global
   fue retirado. Reintroducir privacidad requiere migración, queries y reglas.
8. **Contexts permisivos**. Cualquier autenticado puede actualizar un contexto,
   aunque solo el creador puede borrarlo. Es política actual, no una garantía de
   aislamiento por tenant.
9. **Comentarios stale**. Firestore/docs antiguos pueden describir membresía de
   tag como visibilidad. El helper actual y la migración vigente dicen
   destinatarios explícitos solamente.
10. **Listener legacy por proyecto**. `app/page.tsx` aún abre una query por
   `projectId` cuyo comentario dice que cubre miembros del proyecto. Con las
   reglas actuales esa query no prueba la ACL y su callback de error la vacía;
   no depender de ella para acceso o funcionalidad. Antes de retirarla, cubrir
   los casos legacy con emulador y confirmar que los listeners por
   `visibleToUserIds`/`participants` alcanzan.
11. **Datos legacy ambiguos**. Emails/teléfonos compartidos y nombres repetidos no
   prueban identidad. Respetar canonical IDs, umbral y review queue.
12. **Deploy del frontend no codificado**. Firebase configura Firestore y
    Functions, pero `firebase.json` no contiene un bloque Hosting. No asumir el
    destino del cliente por la presencia de una URL `web.app` o Analytics.

## 14. Orden de autoridad cuando hay contradicciones

Usar este orden:

1. código y reglas del commit/diff actual;
2. pruebas ejecutadas en la sesión actual;
3. estado consultado del entorno objetivo, distinguiendo cliente autenticado de
   Admin SDK;
4. este documento y documentos técnicos especializados;
5. logs de sesión, conteos o afirmaciones históricas.

Los conteos de producción documentados (por ejemplo 5.183 contactos, 2.635
contexts, 7.818 entradas y 6.618 relaciones) son checkpoints históricos útiles,
no constantes de negocio ni assertions eternas.

## 15. Checklist de entrega para otro agente

Antes de terminar una tarea:

- [ ] Revisé `git status` y preservé cambios ajenos.
- [ ] Identifiqué fuente de verdad vs proyección derivada.
- [ ] No rompí `visibleToUserIds` ni confundí UIDs con IDs de contactos.
- [ ] Conservé compatibilidad/provenance legacy cuando aplicaba.
- [ ] Si toqué Directory core, regeneré y verifiqué Functions.
- [ ] Si toqué Firestore, revisé reglas e índices con un usuario real/emulado.
- [ ] Ejecuté TypeScript explícitamente además del build.
- [ ] Probé el flujo funcional, no solo compilación.
- [ ] No ejecuté escrituras/deploys de producción sin autorización.
- [ ] Actualicé esta guía o el documento especializado si cambió una invariante.

## 16. Historial funcional condensado

La evolución observable en Git y en la documentación es:

1. Communications consolidó composición, stream, tags, respuestas, calendario,
   push, PWA y manejo de imágenes.
2. La visibilidad de mensajes se endureció mediante destinatarios explícitos,
   `visibleToUserIds`, migraciones y reglas que aíslan datos legacy corruptos.
3. Contactos pasaron a un modelo global-readable y owner-writable.
4. Se importó la base corporativa XLSX a `/contacts` y `/contexts` con
   normalización, deduplicación y provenance.
5. Se creó Directory como capa derivada y luego sync incremental con Functions.
6. Se enriqueció con el master source of truth, relaciones seguras, review queue
   y reference data, preservando excepciones.
7. Se construyó la UI completa de Directory como segundo módulo.
8. Se implementó schema v4: 32 shards compactos, MiniSearch/Worker/IndexedDB,
   perfiles/relaciones paginados y adaptación opcional de Communications.

Ese recorrido explica por qué conviven campos nuevos y legacy, listeners
duplicados, proyecciones derivadas y documentación de distintas fechas. En este
proyecto, esa compatibilidad suele ser intencional: eliminarla requiere evidencia
de que la migración correspondiente terminó en todos los entornos.
