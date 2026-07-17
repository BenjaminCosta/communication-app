# SVC — Plan de enriquecimiento del Directory desde datos operativos (AppSheet)

> Análisis (sin cambios de código ni de datos todavía) de cómo importar de
> forma **enriquecida y no destructiva** las 5 tablas operativas de
> `supervisioncompany.com` hacia el Directory existente (`/contacts` +
> `/contexts` → `/directoryIndex`), relacionándolas con las entidades ya
> presentes, y qué datos sirven para features futuras.
>
> Fuentes: 5 Google Sheets (exports de AppSheet) compartidas el 2026-07-15.
> Ver estructura completa en la memoria `operational-datasets-appsheet` y el
> pipeline base en `svc-data-import-normalization.md` +
> `svc-master-enrichment-migration.md`.

---

## 0. TL;DR

- Estas tablas son **datos operativos** (ventas, timesheets, reportes de campo,
  scraps), no un catálogo de identidad. Pero **contienen identidad embebida**:
  personas (por email), compañías (por nombre) y jobs (por nombre) que hay que
  **reconciliar** con lo que ya existe en el Directory.
- **Recomendación:** no escribir un enricher nuevo desde cero. Reusar el
  probado `enrich-directory-from-master.mjs` alimentándolo con un **"Operational
  Master" consolidado** (mismas 6 hojas que el master actual), generado por un
  **script de consolidación read-only** nuevo. Así heredamos todo el contrato de
  seguridad (dry-run, matching en cascada, umbral 0.75, review queue,
  idempotencia por `contentHash`, cero destrucción).
- **Match keys:** persona = `email` (fiable); compañía = nombre normalizado
  (+ alias); job = nombre normalizado (fuzzy, poco solape → mayormente nuevos).
- **Hallazgo de oro:** el nombre de los jobs sigue el patrón
  `"{Compañía} - {Proyecto} - {Ubicación}"` (ej. `74 Construction - Drew Marine
  (24-141) - Parsipanny, NJ`). El prefijo **es la compañía** → permite
  **resolver la relación job→compañía** que el import original dejó pendiente a
  propósito.
- **Excluir del Directory:** datos bancarios (routing/checking de `week ending`)
  y contadores transaccionales. Van, si acaso, a features futuras con reglas
  propias.

---

## 1. Qué muestran los datos reales (grounding)

Muestras leídas de las views que traen identidad:

### Personas — 4 poblaciones distintas
| Origen | Ejemplo | Naturaleza vs Directory |
|---|---|---|
| `Sales Database › Leads` (118) | `veronica gregor / vgregor@gregorindustries.com / Gregor Industries Inc / manager` | **externos** (prospectos de venta) → casi todos **nuevos** |
| `Sales Database › Leads v2` (124) | `Stuart Meurer / stuart@windover.com / Windover Construction` + internos (`Alastor Polanco / CEO`) | mezcla externos nuevos + internos ya existentes |
| `Sales Database › Reps` (11) | `ok@ → Okechukwu Uneze / Sales President`, `j@ → Joe / Owner`, `thegreatesthoginhistory@ → Jason Brock` | **internos SVC** → **enriquecen** contactos existentes; aportan nombre real a emails crípticos |
| `Time Sheets › QB User` (88) + `week ending › users+bank` (85) | `mcravo22@gmail.com / rate 45`, `af@supervisioncompany.com` | **workforce** (supers de campo); mezcla de existentes y nuevos; aportan `rate` |

### Compañías
`Sales Database › Companies` (165): `1901 Contracting`, `74 CONSTRUCTION`,
`7-Eleven ($18.25B)`, con Phone/Address/Website/Timezone/Description. Son
**cuentas/targets de venta** → mayormente **nuevas** para el Directory.

### Jobs
`week ending › jobs↔rate` (87) y `Job Reports` referencian jobs por nombre
`"{GC} - {Proyecto} - {Ubicación}"` + un `job ref` hex interno de AppSheet.

### Puente de identidad crítico
`week ending › users+bank` mapea `qb user` (alias de QuickBooks, p.ej.
`afonsecatime`, `afraser28@gmail.com`) → `our user` (email canónico
`af@supervisioncompany.com`). Es la **tabla que resuelve los múltiples alias**
de cada super entre sistemas — clave para no duplicar personas.

### Gotchas de calidad detectados (a manejar antes de importar)
1. **Columnas "ref" contaminadas (AppSheet):** en `Leads`, `State` y
   `Total Number of SMS` **no** contienen un estado ni un conteo, sino IDs hex
   (`0bd9d5ca`, `7579a103`) que apuntan a filas de otras hojas (funnel/estación).
   No importar esos campos por su nombre literal.
2. **Placeholders basura nuevos:** `this is a whiteboard`, `blank`, `NONE`,
   `No Title`, `$1.00` (revenue), `1/1/1950` (fecha epoch). Es la misma clase de
   basura que el import original ya trata (`"a whiteboard!"`) → hay que
   **extender** `INVALID_VALUE_RE`/`isInvalid` con estos tokens.
3. **Variación de emails/nombres:** `J@SUPERVISIONCOMPANY.COM` vs `j@…`
   (resuelto por `normalizeEmail`), nombres en minúscula (`veronica gregor`) y
   con comas colgando (`Herrera,`).
4. **Bank fields mayormente vacíos** en la muestra (solo `qb user/our user/rate`
   poblados) — pero donde existan son PII financiera.

---

## 2. Estrategia de importación enriquecida (recomendada)

### 2.1 Arquitectura: consolidar → master curado → enricher probado

```
5 workbooks AppSheet (raw)
      │  scripts/consolidate-operational-master.mjs   ← NUEVO, read-only
      │    • parse (reusa parse-database-xlsx.py sobre .xlsx exportados,
      │      o lee las Sheets vía export)
      │    • dedup personas por email (une Leads/Reps/QB/users+bank)
      │    • dedup compañías por nombre normalizado (+ prefijo de job)
      │    • extrae jobs y resuelve job→compañía por el prefijo del nombre
      │    • arma relaciones seguras + cola de revisión
      │    • limpia basura (whiteboard/blank/NONE/1950/$1)
      ▼
  Operational_Master.xlsx  (MISMAS 6 hojas que el master actual:
      People_Master, Companies_Master, Jobs_Master,
      Relationships_Master, Reference_Data, Review_Queue)
      │  scripts/enrich-directory-from-master.mjs   ← YA EXISTE, sin cambios
      │    (dry-run → --write → --verify, envuelto en lock/rebuild/unlock)
      ▼
  /contacts + /contexts enriquecidos (masterData/namespaced) →
  Cloud Functions → /directoryIndex
```

**Por qué así:** el enricher actual ya resuelve matching en cascada, umbral de
confianza 0.75, `contentHash` idempotente, review queue, y **nunca borra ni
pisa IDs**. Reutilizarlo evita reintroducir esos riesgos. El trabajo nuevo
queda contenido en un script de **solo lectura** que produce un artefacto
(el xlsx consolidado) inspeccionable antes de tocar nada.

### 2.2 Provenance namespaced (no pisar el Master del Directory)

El Master del Directory ya escribió `masterData` con la identidad canónica
(confianza 0.75). Esta segunda fuente es **más ruidosa** (ventas/operación), así
que **no debe sobrescribir** `masterData`. Opciones:

- **Preferida:** escribir en un mapa embebido separado por fuente
  (`operationalData` / `salesData` / `workforceData`) con su propio
  `sourceFile`, `workbookSha256`, `contentHash` y `confidence`. Los
  normalizadores de `directory-core.ts` siguen prefiriendo `masterData` para
  identidad; lo operativo solo **rellena huecos** (rol, teléfono, compañía si el
  Directory no la tiene) y **agrega señales** (es super/lead/rep, rate, etc.).
- Requiere una extensión mínima y aditiva del enricher (un "source profile"),
  sin cambiar su contrato de seguridad.

### 2.3 Match keys y regla new-vs-existing por entidad

| Entidad | Match contra Directory | Si matchea | Si no matchea |
|---|---|---|---|
| Persona | `email` normalizado (exacto). Fallback: `nombre+compañía` único | enriquecer in-place (namespaced), status/rol/rate aditivos | crear contacto nuevo **global**, `source:"operational"` |
| Compañía | nombre normalizado + aliases (incl. prefijo de job) | enriquecer fields/`companyMasterData` | crear context company nuevo |
| Job | nombre normalizado completo (fuzzy, bajo solape) | enriquecer + **resolver companyEntityId** vía prefijo | crear job nuevo o mandar a review si es dudoso |
| Relación job→compañía | prefijo del nombre del job ↔ compañía conocida (≥0.75) | materializar `companyEntityId` (¡gap histórico resuelto!) | queda como texto, no se linkea |

### 2.4 Mapeo de categorías (los "distintos nombres/categorías")

Directory usa taxonomía `person | company | job | other`. Estas apps usan otras
etiquetas → normalizar al importar (como tag/estado, no como tipo nuevo):

| Etiqueta origen | Directory |
|---|---|
| Lead / Customer / prospecto (Sales) | `person` + tag `salesStatus` (funnel stage) |
| Company / Account (Sales) | `company` |
| Super (workforce/timesheets/reports) | `person` + tag `role: super` + `rate` |
| Sales Rep / Owner / President (Reps) | `person` (interno) + `role` |
| Applicant / Contact (Activities) | `person` |
| CAT / funnel station / groups | `Reference_Data` (catálogo), no entidad |

### 2.5 Contrato de seguridad (igual que siempre)
- **Dry-run primero**, siempre. Ninguna escritura sin `DRY_RUN=false` +
  confirmación explícita + tu aprobación.
- Envolver el import masivo en
  `generate-directory-index.mjs --lock → import → --rebuild → --unlock`.
- Backup Firestore previo (`scripts/backup-firestore.mjs`), como en la
  migración del Master.
- Nada corre contra producción en este plan sin OK explícito.

---

## 3. Mapeo detallado view → destino

### Va al Directory (identidad)
| Workbook › View | Filas | Destino Directory |
|---|---|---|
| Sales Database › Leads | 118 | personas (externas nuevas) + compañías (por `Company`) |
| Sales Database › Leads v2 | 124 | personas (merge con Leads por email) + URLs sociales |
| Sales Database › Companies | 165 | compañías (cuentas/targets) |
| Sales Database › Reps | 11 | **enriquece** personas internas (nombre real, rol, phone) |
| Time Sheets › QB User | 88 | personas workforce (super) + `rate` |
| week ending › users+bank | 85 | **puente de alias** qb→email; `rate`; **bank excluido** |
| week ending › jobs↔rate | 87 | jobs + `rate`; **resuelve job→compañía** por prefijo |

### NO va al Directory (transaccional → features futuras, §4)
Timesheets/hours/billing, actividades/calls/emails de ventas, fotos/notas/plans
de reportes, scraps, contadores, calendarios de semana, bank balance.

---

## 4. Qué sirve a futuro (features nuevas)

Todo esto **referencia** entidades del Directory pero es transaccional →
colecciones nuevas, unidas por `email` (persona) y nombre/ref (job). No entra al
Directory; sí es la base de módulos nuevos en la communication-app.

| Feature futura | Datos fuente | Colecciones sugeridas | Join |
|---|---|---|---|
| **Timesheets / Payroll** | Time Sheets (raw + QB User + resumen), week ending (hours report, rates, bank) | `/timesheets`, `/timesheetPeriods`, `/payrollProfiles` (bank, acceso restringido) | super=email, job=nombre/ref |
| **Sales / CRM** | Sales Database (Leads, Companies, Activities, Call/Email logs, funnel) | `/leads`, `/salesActivities`, `/salesCalls`, `/salesEmails` | rep/contact=email, company=nombre |
| **Field Reports** | Job Reports (Report Picture, notes, daily super notes+"Feelings", Plans/Sub-Plans, Files, expenses) | `/jobReports`, `/jobReportPhotos`, `/jobPlans` | super=email, job=ref |
| **Scraps / Quick Capture** | SCRAPAPALOOZA (drawings, scans, CAT, tag person/job) | `/scraps` | user/person=email, job, cat |

Notas de producto:
- `Job Reports › daily super notes` (355, con `Feelings` Good/Bad) es casi un
  **feed de actividad/moral por super** → integrable con el feed de Comms.
- Imágenes (`SCRAP_Images/…`, `Report Picture_Images/…`, `Command Center/…`)
  son rutas a un storage AppSheet externo → migrarlas a Firebase Storage sería
  parte de esas features, no del enrichment.
- Los `rate` de super/job y el bank son la base de facturación/nómina; el bank
  **solo** en una colección con reglas estrictas, nunca en `/contacts`.

---

## 5. Riesgos y decisiones abiertas

1. **Segundo master vs Master del Directory:** confirmar el namespacing
   (`operationalData` separado) para no degradar la identidad canónica ya
   resuelta. **(decisión de diseño)**
2. **Bank data:** excluida del Directory por defecto. ¿Se conserva para un
   futuro Payroll? Si sí, colección aparte + reglas admin-only. **(decisión del
   usuario)**
3. **Jobs con bajo solape de nombres:** muchos jobs operativos son más nuevos
   que `New Database.xlsx` → esperar muchos "nuevos"; validar contra review antes
   de crear en masa.
4. **Columnas ref de AppSheet:** mapear por significado real, no por header.
5. **Duplicados de personas internas** entre Reps/QB/users+bank/Directory →
   resolver por email; los alias qb se resuelven con el puente de §1.

---

## 6. Próximo paso concreto (sigue siendo read-only)

1. Exportar las 5 Sheets a `.xlsx` (o leerlas vía Drive) y correr un
   **`consolidate-operational-master.mjs` en modo dry-run** que produzca:
   - el `Operational_Master.xlsx` propuesto (6 hojas), y
   - un **reporte de cobertura**: cuántas personas/compañías/jobs matchean por
     email/nombre contra un export read-only del Directory, cuántos serían
     nuevos, cuántos van a review, y cuántas relaciones job→compañía se
     resolverían por prefijo.
2. Revisar ese reporte juntos **antes** de tocar el enricher o Firestore.
3. Recién entonces: extensión aditiva del enricher (source profile namespaced),
   dry-run del enricher, y —con tu OK— write envuelto en lock/rebuild/unlock.

Ningún paso escribe en producción sin aprobación explícita.
