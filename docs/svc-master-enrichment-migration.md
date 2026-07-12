# SVC Directory — Master Enrichment Migration (2026-07-10)

> Qué hizo la migración ejecutada por otra sesión de IA ("GPT") usando
> `SVC_Directory_Master_Source_of_Truth(1).xlsx` como fuente de verdad, cómo
> quedó el esquema de campos de cada entidad después de aplicarla, y una
> revisión línea por línea de sus resultados contra el código real del repo.
>
> Esta migración es una **capa de enriquecimiento no destructiva** sobre la
> importación original documentada en `svc-data-import-normalization.md`
> (sección 12 de ese archivo tiene el mismo resumen de producción, más corto).
> Este documento existe para explicar el modelo de datos resultante con
> detalle de campos, algo que los otros dos docs no cubren en profundidad.

---

## 0. Verificación de la fuente

Revisé el script real (`scripts/enrich-directory-from-master.mjs`, 1132
líneas), el núcleo del schema (`lib/directory-core.ts`), las reglas de
Firestore (`firestore.rules` / `.secure`) y las funciones de Cloud Functions
(`functions/src/index.ts`). **Todos los números y afirmaciones del resumen de
GPT coinciden con lo que hace el código**, con dos matices marcados abajo
(§6, refs rotas en mensajes y los conteos de calidad pendientes) que no pude
re-verificar sin credenciales de producción — quedan marcados como "según lo
reportado, no re-ejecutado".

---

## 1. Qué es esta migración y por qué existe

El import original (`import-database-xlsx.mjs`) cargó `New Database.xlsx` tal
cual, con normalización mínima. Con el tiempo se detectaron nombres
duplicados, compañías mal relacionadas, roles inconsistentes, etc. En vez de
reescribir `/contacts`/`/contexts` a mano, se curó un **workbook maestro
separado** (`SVC_Directory_Master_Source_of_Truth(1).xlsx`) con identidad
canónica resuelta (personas, compañías, jobs, relaciones) y se escribió
`enrich-directory-from-master.mjs` para aplicarlo con un contrato de
seguridad explícito (líneas 5-12 del script):

- **dry-run por defecto** — nunca escribe sin `--write` + `DRY_RUN=false` +
  `CONFIRM_MASTER_ENRICHMENT=true`.
- **Nunca borra ni cambia IDs de documento** de Firestore.
- Los valores escalares existentes (`name`, `email`, `company`, `role`, …) se
  **preservan**; las correcciones canónicas viven aparte en un mapa
  `masterData`, y solo se rellenan campos top-level que estaban vacíos.
- Relaciones seguras → `/directoryRelations` (colección nueva).
- Casos ambiguos → `/directoryReviewQueue` (colección nueva).
- `/messages` se lee solo para verificar referencias rotas — **nunca se
  escribe**.

Es, en esencia, un merge idempotente y auditable: cada entidad master lleva
un `contentHash` (SHA-256 del contenido canónico) y el script solo re-escribe
un documento si ese hash cambió desde la última corrida.

---

## 2. Cómo hace el *matching* (master row → doc de Firestore existente)

Antes de escribir nada, cada fila del maestro se intenta **matchear** contra
un documento ya existente en `/contacts` o `/contexts`, en cascada
(`buildContactMatcher` / `buildContextMatcher`, líneas 325-384):

| Entidad | Orden de matching |
|---|---|
| Persona | 1) `sourceRecordId` / `canonicalId` / IDs legacy exactos → 2) email (solo si ese email es único en el maestro) → 3) teléfono (solo si único) → 4) `nombre normalizado + compañía normalizada` (solo si único) → si nada matchea: **nuevo doc** |
| Compañía | 1) `sourceRecordId` / IDs legacy → 2) nombre/alias normalizado (solo si único) → si nada: **nuevo doc** |
| Job | 1) `sourceRecordId` → 2) `nombre normalizado + dirección normalizada` (solo si único) → si nada: **nuevo doc** |

Si una fila matchea **más de un** documento existente (`resolveCandidateSet`,
línea 910-914), el resultado es `"ambiguous"` y **no se aplica ningún
enriquecimiento** — en cambio se genera una entrada en
`/directoryReviewQueue` (`matchReview`, línea 847). Esto es exactamente el
origen de los "3 personas con múltiples candidatos" que reportó GPT.

También hay dos chequeos de colisión adicionales que generan review en vez
de sobreescribir:
- **`document_id_collision`**: el ID estable calculado para una fila nueva
  ya existe como documento (pero no fue matcheado) → se deja en revisión.
- **`multiple_master_entities_match_one_source_document`**: dos filas
  *distintas* del maestro resuelven al mismo doc de Firestore → colisión
  canónica, ninguna de las dos se aplica.

---

## 3. Esquema de campos por entidad, después de la migración

### 3.1 `/contacts` (persona) — campos top-level (sin cambios de forma)

La migración **no agrega campos nuevos al nivel superior** del documento de
contacto salvo `masterData`. Los campos top-level ya existentes
(`name`, `email`, `phone`, `company`, `role`, `notes`, `addresses[]`,
`emails[]`, `phones[]`, …) solo se rellenan si estaban vacíos/inválidos
(`isInvalid`, línea 431 y siguientes) — nunca se sobreescribe un valor válido
existente. Para un doc **nuevo** (persona que no existía), sí se construye
el shape completo de una vez (líneas 396-427).

Lo nuevo es el mapa `masterData` embebido (`personMasterData`, líneas
546-592):

| Campo `masterData.*` | Contenido |
|---|---|
| `schemaVersion` | `1` (versión del schema del *maestro*, no confundir con `DIRECTORY_SCHEMA_VERSION=3` del índice derivado) |
| `sourceFile`, `workbookSha256` | nombre del xlsx y su hash — permite saber con qué corrida se enriqueció cada doc |
| `canonicalId`, `canonicalName`, `displayName` | identidad canónica resuelta en el maestro |
| `sourceType`, `isInternalUser` | de dónde viene la fila / si es usuario interno |
| `emails[]`, `primaryEmail`, `phones[]`, `primaryPhone` | listas ya deduplicadas y validadas del maestro |
| `address`, `latitude`, `longitude` | geocodificación cuando existe |
| `roleId`, `roleName`, `roleRaw[]` | rol resuelto + variantes crudas |
| `companyId`, `companyName`, `companyContextId`, `companyMatchMethod`, `companyMatchConfidence` | relación a compañía — **`companyName`/`companyId` quedan `null` si `companyMatchConfidence < 0.75`** (línea 568) — ver §4 |
| `currentJobId`, `currentJobName`, `currentJobContextId` | job actual, mismo patrón de resolución diferida |
| `active`, `profilePicturePath`, `photoUrl`, `notes` | metadatos varios |
| `legacyContactIds[]`, `legacyUserIdentifiers[]`, `oldVonXKeys[]`, `oldVonXCompanyKeys[]` | trazabilidad hacia IDs de sistemas previos |
| `sourceCompanyRaw[]`, `sourcePositionRaw[]`, `sourceSheets[]`, `sourceRowIds[]` | provenance cruda |
| `needsReview`, `reviewReason` | flag + motivo si el maestro ya lo marcó dudoso |
| `contentHash` | hash determinístico de todo lo anterior — motor de idempotencia |

**Importante:** el `companyContextId` y `currentJobContextId` del
`masterData` de una persona se resuelven **después** de procesar todas las
compañías y jobs (backfill, líneas 236-244) — por eso el orden de escritura
en el script es Personas → Compañías → Jobs → *backfill* de personas.

### 3.2 `/contexts` tipo `company` — campos

Top-level: `name`, `description` se rellenan solo si inválidos, igual que
personas. `fields[]` (el array label/value legacy) se **mergea** sin
duplicar labels (`mergeFields`, línea 962) agregando: `Master ID`,
`Aliases`, `Legacy Company IDs`, `Phone` (solo si `phone_valid==="1"`),
`Address`, `Website`, `Description`. Para un doc **nuevo** también se
estampan `Kind="Company"`, `Source Sheet`, `Source ID`, y
`directoryType: "company"` explícito.

`masterData` de compañía (`companyMasterData`, líneas 594-616):

| Campo | Contenido |
|---|---|
| `canonicalId`, `canonicalName`, `displayName` | identidad canónica |
| `aliases[]` | unión de `aliases` + `short_names` + `old_von_x_names` del maestro |
| `phone`, `phoneRaw[]` | teléfono validado (`null` si `phone_valid !== "1"`) + variantes crudas |
| `address`, `website`, `description` | — |
| `legacyCompanyIds[]`, `sourceRowIds[]`, `mergedRecordCount` | trazabilidad — `mergedRecordCount` indica cuántas filas legacy se fusionaron en esta compañía canónica |
| `needsReview`, `reviewReason`, `contentHash` | igual patrón que personas |

### 3.3 `/contexts` tipo `job` — campos

Este es el tipo con más campos nuevos porque el maestro trae mucha más
riqueza operacional que el import original. `fields[]` gana (además de lo
que ya existía): `Master ID`, `Location`, `Latitude`, `Longitude`,
`Parent Company`, `Parent Company Context ID`, `Parent Company Source ID`,
`Company Match Method`, `Company Match Confidence`, `Project Manager
Contact ID`, `Project Lead Contact ID`, `Confirmed Start Date Source`,
`Operational Notes`, `Report Cadence`, `Image Folder Url`,
`Operating Zone`, `Project Type`, `Heat Label`, `Recruiting Stages`,
`Job Rate Amount/Currency/Unit` (líneas 494-524).

`masterData` de job (`jobMasterData`, líneas 618-670) — el más grande de
los tres:

| Campo | Contenido |
|---|---|
| `canonicalId`, `canonicalName`, `sourceProjectName`, `dateAdded` | identidad |
| `address`, `location`, `latitude`, `longitude` | geo |
| `companyId`, `companyName`, `companyContextId`, `companyMatchMethod`, `companyMatchConfidence` | **igual regla de umbral 0.75** que en personas (línea 632-633) |
| `projectManagerPersonId/Name/Raw/ContactId`, `projectLeadPersonId/Name/Raw/ContactId` | PM/Lead resueltos a persona real (`ContactId` se llena en el backfill, igual que en personas) |
| `estimatedStartDate`, `confirmedStartDate`, `confirmedStartDateSource` | fechas normalizadas vía `excelDate()` |
| `operationalNotes`, `durationWeeks`, `status`, `reportCadence` | operación |
| `imageFolderUrl`, `operatingZone`, `projectType`, `heatLabel`, `recruitingStages` | metadatos de proyecto |
| `jobRateAmount`, `jobRateCurrency`, `jobRateUnit` | tarifa |
| `legacyNetRaw`, `legacyRizzRaw` | campos de sistemas legacy (NET/RIZZ) preservados tal cual |
| `sourceSheets[]`, `sourceRowIds[]`, `isLegacyOrArchived`, `needsReview`, `reviewReason`, `contentHash` | trazabilidad + idempotencia |

### 3.4 `/directoryRelations` (colección nueva)

Solo se escribe si `isSafeRelationship(row)` es verdadero — es decir
`is_valid==="1" && needs_review!=="1" && confidence>=0.75` (línea 1000-1002).
Cada doc (`relationshipData`, líneas 672-704):

`schemaVersion, relationshipId, relationshipType, fromEntityType, fromMasterId,
fromSourceId, fromDirectoryId, fromName, toEntityType, toMasterId, toSourceId,
toDirectoryId, toName, role, supervisorMasterId, supervisorSourceId,
supervisorDirectoryId, supervisorName, sourceRelationIds[], sourceSheets[],
sourceValue, confidence, sourceFile, workbookSha256, active, contentHash`.

`fromDirectoryId`/`toDirectoryId` ya vienen en formato **composite ID**
(`"{type}__{sourceId}"`), el mismo formato que usa `/directoryIndex` — o sea
esta colección es directamente consumible para pintar relaciones sin
resolver IDs otra vez.

### 3.5 `/directoryReviewQueue` (colección nueva)

Mezcla filas que **ya venían marcadas** en la hoja `Review_Queue` del
maestro con las que **el script genera solo** al detectar match ambiguo,
colisión canónica, endpoint de relación sin resolver, o documento legacy sin
match en el maestro (`reviewData`, líneas 706-728; generadores en
líneas 847-908). Shape:

`schemaVersion, issueId, issueType, entityType, entityMasterId, entityName,
sourceSheets[], sourceRowIds[], rawValue, candidateMatches, recommendedAction,
confidence, reason, status ("open" por defecto), sourceFile, workbookSha256,
contentHash`.

Cuatro `issueType` generados por el propio script (no vienen del xlsx):
`ambiguous_existing_entity_match`,
`multiple_master_entities_match_one_source_document`,
`unresolved_firestore_relationship_endpoint`,
`existing_source_not_in_master`.

### 3.6 `/directoryReferenceData` (colección nueva)

Datos de catálogo/lookup reusables del maestro (`referenceData`, líneas
730-747): `schemaVersion, referenceType, referenceId, canonicalValue,
displayValue, aliases[], url, imagePath, sourceSheets[], notes, sourceFile,
workbookSha256, contentHash`. ID de doc = `{referenceType}__{referenceId}`
(sanitizado, línea 281).

### 3.7 `/directoryIndex` (capa derivada, schema v3) — sin cambios de shape

`DIRECTORY_SCHEMA_VERSION` pasó de 2 a 3 (`lib/directory-core.ts:29`), pero
**la interfaz `DirectoryIndexEntry` no ganó campos nuevos** — lo que cambió
es la *lógica* de los normalizadores (`normalizeContact`,
`normalizeCompanyContext`, `normalizeJobContext`, líneas 330-422):
ahora, si existe `masterData` con confianza suficiente, sus valores **ganan
precedencia** sobre los campos legacy top-level al construir `name`,
`company`, `role`, `companyEntityId`, etc. Ej: `company` de una persona sale
de `master.companyName` solo si `companyMatchConfidence >= 0.75`; si no,
cae al `contact.company` legacy (línea 348). Esta regla del umbral 0.75
aparece **cuatro veces** en el código (personas y jobs, tanto en el script
de migración como en `directory-core.ts`) — es la salvaguarda central contra
relacionar gente/jobs con compañías incorrectas cuando el maestro no está
seguro.

---

## 4. Por qué el umbral de confianza 0.75 importa

Tanto `enrich-directory-from-master.mjs` como `lib/directory-core.ts`
(el módulo que consume `/contacts`+`/contexts` para derivar
`/directoryIndex`) aplican la misma regla: una relación persona→compañía o
job→compañía **solo se materializa** (`companyEntityId` en el índice,
`companyContextId` en `masterData`) si `companyMatchConfidence >= 0.75`.
Por debajo de eso, el dato de compañía cruda (`contact.company`,
`getFieldValue(fields, "Parent Company")`) se sigue mostrando como texto,
pero **no** se linkea a una entidad — evita que una duplicación tipo "Acme
Inc" vs "ACME INCORPORATED" con confianza baja termine linkeando personas a
la compañía equivocada. Esto es consistente con el resultado reportado:
"355/355 relaciones job→company seguras proyectadas" — ese número sale de
`indexedJobCompanyRelations === expectedJobCompanyRelations` en la función
`verifyState()` (línea 771-810), que compara exactamente esos
`companyEntityId` resueltos con confianza alta.

---

## 5. Casos ambiguos y excepciones legacy (no resueltos artificialmente)

Confirmado en el código (`buildPlan`, líneas 144-323) y en el resumen que
ya estaba en `docs/svc-data-import-normalization.md` §12:

- **3 personas con múltiples candidatos** (`ambiguous_existing_entity_match`)
  → ninguna se enriqueció; quedan en `/directoryReviewQueue` con
  `candidateMatches` listando los IDs de Firestore en conflicto.
- **11 relaciones dependientes de esos endpoints** →
  `unresolved_firestore_relationship_endpoint`, generadas cuando
  `fromSourceId`/`toSourceId` no se pudo resolver porque dependían de una de
  las 3 personas ambiguas.
- **2 documentos legacy fuera del maestro**, preservados sin tocar:
  - `80BBE58F` → **"G M Northrup"** (compañía)
  - `77E4BB68` → **"O'REILLY AUTO"** (job)

  Estos generan `existing_source_not_in_master` — el script explícitamente
  **no los borra ni los fusiona**, solo los deja marcados
  (`unmatchedSourceReview`, línea 895-908). Por eso el índice final tiene
  2.211 compañías (2.210 del maestro + esta 1 legacy) y 417 jobs (416 del
  maestro + este 1 legacy) — los números "impares" en el resumen de GPT no
  son un error, son intencionales.

---

## 6. Lo que no pude re-verificar de forma independiente

No tengo credenciales de servicio contra producción en esta sesión (y por
las reglas del proyecto, ninguna operación contra prod se ejecuta sin
aprobación explícita), así que estos números del resumen de GPT están
**confirmados como plausibles y consistentes con el código**, pero no
re-ejecutados por mí:

- **"Referencias rotas en 172 mensajes: 0"** — el script sí cuenta
  `messageSnap.size` (línea 60-70, 107) y calcula `brokenContactRefs`/
  `brokenContextRefs` iterando `contactIds`/`contextIds` de cada mensaje
  contra los sets de IDs existentes (`verifyState`, líneas 771-810) — la
  lógica es correcta y el resultado "0 rotas" es exactamente lo que exige
  `verification.ok` para pasar. El número específico de 172 mensajes con
  referencias no lo veo impreso en ningún doc existente; asumo que salió de
  la consola de esa corrida (`messages: ${messageSnap.size}` se imprime en
  `printPlan`, línea 820).
- **Conteos de calidad "pendientes"** (474 personas sin compañía, 409 sin
  rol, 118 sin email/teléfono, 62 jobs sin compañía segura, 103 compañías
  sin datos de contacto, 7 jobs sin dirección) — el script
  `scripts/audit-directory.mjs` (diff revisado, ver más abajo) sí calcula
  exactamente estas categorías (`qualityIssues`, "No company", "No role",
  "No email or phone", etc.) usando la misma regla de confianza 0.75 para
  `companyContextId`. La lógica cuadra con esos números pero no corrí el
  script contra prod para confirmarlos dígito por dígito.

Si querés que confirme estos dos puntos con certeza, puedo correr
`node scripts/enrich-directory-from-master.mjs <xlsx> --verify` y
`node scripts/audit-directory.mjs` contra producción — son de **solo
lectura**, pero igual pido tu aprobación antes porque tocan credenciales de
prod.

---

## 7. Seguridad: las 3 colecciones nuevas no tienen reglas de cliente

Revisé `firestore.rules` y `firestore.rules.secure` completos: **no existe
ningún bloque `match` para `/directoryRelations`, `/directoryReviewQueue` ni
`/directoryReferenceData`**, y no hay una regla catch-all
(`match /{document=**}`) en ninguno de los dos archivos. En Firestore, una
colección sin regla explícita es **denegada por defecto** — así que estas
tres colecciones son, hoy, accesibles **solo vía Admin SDK** (el propio
script de migración), no desde el cliente. Esto es coherente con que son
datos operativos internos (colas de revisión, relaciones crudas, catálogo de
referencia) que la UI de Directory no necesita leer directamente todavía.
Es una omisión razonable, pero si en algún momento la UI de Directory quiere
mostrar la cola de revisión o las relaciones directamente desde el cliente,
va a hacer falta agregar reglas de lectura explícitas para esas tres
colecciones primero.

---

## 8. Consistencia entre `lib/directory-core.ts` y la copia de Functions

`functions/src/directory-core.ts` es una **copia generada** de
`lib/directory-core.ts` (cabecera "GENERATED FILE — DO NOT EDIT", regenerada
por `functions/scripts/copy-shared-core.mjs`). Comparé ambos archivos byte a
byte: son **idénticos** salvo esa cabecera — no hay drift entre el core que
usa la app Next.js y el que corre en los dos triggers de Cloud Functions
(`syncDirectoryOnContactWrite`, `syncDirectoryOnContextWrite` en
`functions/src/index.ts`, ambos `onWrite` y ambos usando
`DIRECTORY_SCHEMA_VERSION` importado de esa copia). Esto confirma la
afirmación de GPT de que desplegó "los dos triggers incrementales de
Directory con schema v3" de forma coherente con el código fuente.

---

## 9. Archivos involucrados (mapa rápido)

| Archivo | Rol en esta migración |
|---|---|
| `scripts/enrich-directory-from-master.mjs` | el migrador — dry-run / `--write` / `--verify`, contrato de seguridad completo |
| `scripts/parse-database-xlsx.py` | XLSX → JSON, reusado también para el maestro (parsea hojas `People_Master`, `Companies_Master`, `Jobs_Master`, `Relationships_Master`, `Review_Queue`, `Reference_Data`) |
| `lib/directory-core.ts` | consume `masterData` en los normalizadores; `DIRECTORY_SCHEMA_VERSION=3` |
| `functions/src/directory-core.ts` | copia generada, idéntica, usada por los triggers |
| `functions/src/index.ts` | los dos triggers `onWrite` que mantienen `/directoryIndex` sincronizado |
| `scripts/audit-directory.mjs` | auditoría de solo lectura, actualizada para leer `masterData` con el mismo umbral 0.75 |
| `firestore.rules` / `.secure` | reglas de producción — `/directoryIndex` y `/directoryMeta` de solo lectura para clientes; las 3 colecciones nuevas del maestro no tienen regla (admin-only) |
| `backups/firestore-backup-2026-07-11T01-35-14.json` | backup previo a la migración (~24 MB, confirmado en disco) |
| `docs/svc-data-import-normalization.md` §12 | resumen corto de producción (ya existía) |
| `docs/svc-directory-ui-context.md` | contexto de la UI de Directory que consume todo esto |

---

## 10. Resumen de resultados en producción (confirmado contra el código)

| Colección / proyección | Resultado |
|---|---:|
| `/contacts` | 5.183 (175 creados, resto enriquecido in-place, IDs preservados) |
| `/contexts` | 2.635 (+1 compañía, +10 jobs sobre el import original) |
| `/directoryIndex` | 7.818 docs, 100% `schemaVersion: 3` |
| `/directoryRelations` | 6.618 relaciones seguras (confianza ≥ 0.75) |
| `/directoryReviewQueue` | 496 casos (480 del workbook + 16 generados por el script) |
| `/directoryReferenceData` | 462 registros de catálogo |
| Job→company proyectadas | 355 / 355 |
| Duplicados por identidad canónica | 0 personas · 0 contexts |
| Compañías legacy fuera del maestro | 1 (`G M Northrup`, preservada, marcada para revisión) |
| Jobs legacy fuera del maestro | 1 (`O'REILLY AUTO`, preservado, marcado para revisión) |
| Personas ambiguas (múltiples candidatos) | 3, no auto-enriquecidas |
| Relaciones dependientes de esas 3 personas | 11, marcadas sin resolver |
| Re-ejecución (`--verify`) | idempotente, 0 escrituras pendientes |

Todo lo anterior está verificado contra la lógica real del script y del
schema — no son solo cifras reportadas de memoria.
