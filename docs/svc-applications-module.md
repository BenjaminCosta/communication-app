# SVC Applications — estado actual y guía de operación

Última actualización: 2026-07-26

Rama de integración: `development`

Estado del código: funcional end-to-end en el preview de `development`.

## Resumen ejecutivo

`Applications` cubre el recorrido completo de contratación de SVC:

1. Un revisor invita a un candidato con nombre, oficio y job.
2. El candidato abre un link seguro sin iniciar sesión, completa la aplicación,
   sube documentos y video, y envía.
3. El equipo revisa archivos, pide información o aprueba.
4. Al aprobar, el sistema crea un link de acuerdo, el candidato firma desde el
   teléfono y el servidor sella la evidencia en PDF.
5. La aplicación pasa a payroll; al terminar, el revisor la marca como
   `hired`.

No hay candidatos de muestra en Firestore. Las aplicaciones reales se crean
desde **Invite a candidate**.

## Estado por entorno

| Entorno | Backend Applications | Observaciones |
|---|---|---|
| Local sin flag | Mock local | Guarda en `localStorage` del navegador/dispositivo. Útil para UI, no se comparte entre celular y desktop. |
| Preview de `development` | Firestore / Storage reales | `NEXT_PUBLIC_APPLICATIONS_BACKEND=true` está configurada específicamente para Preview + rama `development`. El mismo candidato se ve en cualquier dispositivo autenticado como staff. |
| Production | No se modificó en esta etapa | Antes de promover hay que configurar el flag de backend en Production y confirmar credenciales/retención de PII. |

### Regla importante sobre mock

Cuando el flag está apagado, el registro local
`svc-applications-local-v1` pertenece al navegador. No puede aparecer por
arte de magia en otro dispositivo ni tiene una contraparte en Firestore.

El modo local sigue permitiendo descargar un PDF: se genera en el dispositivo.
En modo live el PDF lo genera el servidor y deja una actividad de auditoría.

## Infraestructura desplegada

Firebase del proyecto `svc-comms` tiene desplegados:

- Reglas de Firestore para `/applications`, `/applicationLinks` y
  `/applicationAgreements`.
- Índices de Applications en `firestore.indexes.json`.
- Reglas de Storage para documentos, video y acuerdos sellados.
- Firestore sin los cinco candidatos de muestra anteriores.

El preview de `development` tiene:

- `NEXT_PUBLIC_APPLICATIONS_BACKEND=true` (build-time y acotada a esa rama).
- `FIREBASE_SERVICE_ACCOUNT_KEY` disponible para las rutas de Admin SDK.

No se hizo deploy ni cambio de configuración de Production en este ciclo.

## Experiencia del candidato

### Link y sesión segura

- El link compartido tiene la forma `/?apply=<token>`.
- Firestore sólo guarda el SHA-256 del token; nunca guarda el bearer token
  crudo.
- `POST /api/applications/session` valida que el link exista, no esté
  revocado y no esté vencido. Después emite un Firebase custom token con:
  - uid determinístico `cand_<applicationId>`;
  - claim `applicationId`;
  - claim con el hash del link activo.
- Firestore y Storage vuelven a comprobar el hash del link en cada acceso.
  Revocar o vencer un link corta también una sesión ya abierta.

| Propósito | Vencimiento | Destino |
|---|---:|---|
| `application` | 14 días | Inicio o punto donde el candidato quedó. |
| `step` | 7 días | El paso puntual pedido por el revisor. |
| `agreement` | 3 días | Lectura y firma del Operating Agreement. |

El propósito y el paso viven en el registro del link; no se aceptan como
parámetros editables en la URL.

### Datos, video y documentos

- Datos personales y laborales: nombre, teléfono, email, ciudad/estado,
  experiencia, oficio, CV y referencia.
- **Record video** usa `<input capture="user">`, para abrir la cámara del
  teléfono sin construir un grabador propio.
- Documentos: imagen o PDF, máximo 15 MB. Las imágenes se comprimen antes de
  subir.
- Video: máximo 200 MB, sube con `uploadBytesResumable`, porcentaje visible y
  reintento.
- Se guarda `storagePath`, `downloadUrl`, nombre y fecha en la aplicación.

Rutas de Storage:

```text
application-uploads/{applicationId}/documents/{documentId}-{filename}
application-uploads/{applicationId}/video/intro-{timestamp}-{filename}
application-agreements/{applicationId}/{template}-v{version}-{timestamp}.pdf
```

### Firma del acuerdo

El candidato debe leer el acuerdo, dar consentimiento, escribir su nombre y
dibujar la firma. `POST /api/applications/agreement/sign`:

1. verifica el ID token del candidato y la vigencia del link de acuerdo;
2. valida nombre, consentimiento y PNG de la firma;
3. crea un PDF con el texto exacto del acuerdo, nombre, fecha y firma embebida;
4. sube el PDF sellado a Storage;
5. guarda una evidencia en `/applicationAgreements` con:
   `bodyHash`, `signedPdfPath`, `signedPdfHash`, versión, nombre y fecha;
6. en la misma transacción cambia:
   - `agreement.status` a `signed`;
   - `application.status` a `payroll_in_progress`;
   - y agrega la actividad `agreement_signed`.

El cliente candidato no puede escribir esos estados. Esa separación es
intencional: la firma y el salto a payroll son decisiones del servidor.

## Dashboard interno

### Lista

- Búsqueda por candidato, oficio y job.
- Filtros por estado, job y oficio; orden por fecha/progreso.
- Métricas compactas y tarjetas de candidato.
- **Approved** se muestra como estado intermedio azul: acuerdo enviado.
- **Hired** se distingue con tarjeta, avatar, pill y mensaje verdes:
  onboarding terminado.
- FAB y acción superior para invitar candidatos reales.

### Detalle del candidato

El perfil interno incluye:

- identidad, job, estado, contacto y progreso;
- archivos cargados;
- video reproducible en `<video>`, abrir en nueva pestaña y descargar;
- documentos con **View** y descarga;
- transcript y resumen de video si están disponibles;
- acuerdo y línea de actividad;
- acciones sticky: Request info, Approve o Mark hired según el estado.

El menú **Application actions** reúne compartir links, reenviar acuerdo,
archivar y **Download application PDF**.

### PDF del perfil

El PDF del perfil contiene:

- identidad, job, estado y fechas;
- todos los datos de la aplicación;
- checklist de documentos, estado, archivo y fecha;
- metadatos del video, resumen AI y la transcripción completa si ya fue
  procesada;
- estado, firmas y fechas del acuerdo;
- actividad de la aplicación.

En modo live:

- `POST /api/applications/export` exige un ID token normal de staff;
- nunca expone URLs de Storage dentro del PDF;
- genera el archivo en el servidor y agrega una nota de actividad
  **Downloaded the candidate application profile PDF**.

En modo mock:

- el mismo contenido se genera localmente bajo demanda;
- no se intenta consultar Firestore con un ID que sólo existe en
  `localStorage`.

## Acciones y transiciones

| Acción | Resultado seguro |
|---|---|
| Invite a candidate | Crea `/applications/{id}` y un link `application` persistido. |
| Submit candidate application | Pasa a `submitted` y registra actividad. |
| Request info | Pasa a `needs_information`, guarda el mensaje y comparte un link directo si corresponde. |
| Approve | `POST /api/applications/approve` hace una transacción: `approved`, desbloquea acuerdo, emite un link de 72 h y registra aprobación/link. |
| Share / SMS / copy | Usa Web Share cuando existe y registra los eventos de mensaje compartido/copied. |
| Agreement signed | El servidor pasa a `payroll_in_progress`. |
| Mark hired | Sólo se habilita desde `payroll_in_progress`; cambia a `hired`. |
| Archive | Cierra la aplicación sin contratar. |

Estados posibles:

```text
draft → submitted → ready_for_review / needs_information
      → approved → payroll_in_progress → hired
                        ↑
                  agreement signed

archived puede cerrarse desde cualquier estado no archivado.
```

`agreement_pending` sigue soportado para registros existentes; el flujo actual
de aprobación deja la aplicación en `approved` mientras el acuerdo está
esperando firma.

## Seguridad y acceso

### Staff

No hay roles de Applications por ahora: cualquier usuario Firebase autenticado
sin claim `applicationId` se considera staff. La actividad append-only con
`actorUid` es el registro de auditoría.

### Candidate

Un candidato sólo puede leer su propia aplicación y subir/actualizar:

- `general`;
- `video`;
- `documents`;
- `status` sólo para conservarlo o enviar desde `draft` /
  `needs_information`.

No puede:

- enumerar aplicaciones;
- abrir links de otros candidatos;
- aprobarse;
- marcarse hired;
- modificar `agreement`;
- escribir evidencia de firma.

### Storage

- Staff autenticado puede leer uploads.
- El candidato necesita su claim de aplicación y el hash de un link activo.
- Documento: imagen/PDF y menos de 15 MB.
- Video: `video/*` y menos de 200 MB.
- Acuerdos sellados: el navegador no puede escribirlos; sólo Admin SDK.

## Arquitectura relevante

| Capa | Archivos principales |
|---|---|
| Dominio / estados / links | `lib/applications-core.ts` |
| Mapeo Firestore ↔ dominio | `lib/applications-store.ts` |
| Lecturas y escrituras del cliente | `lib/applications-writes.ts` |
| Sesiones, aprobación, firma, export | `lib/applications-server.ts` |
| Upload, reproducción y descarga de archivos | `lib/applications-storage.ts` |
| Modo local / links locales | `features/applications/candidate-links.ts` |
| Estado dashboard | `features/applications/use-applications-dashboard.ts` |
| Estado del candidato | `features/applications/use-candidate-application.ts` |
| PDF del acuerdo | `features/applications/agreement-pdf.ts` |
| PDF de perfil | `features/applications/application-profile-pdf.ts` |
| API | `app/api/applications/**/route.ts` |
| Dashboard | `components/applications/dashboard/**` |
| Candidate flow | `components/applications/candidate/**` |
| Configuración | `firestore.rules`, `storage.rules`, `firestore.indexes.json` |

Rutas API actuales:

```text
POST /api/applications/session
POST /api/applications/approve
POST /api/applications/reviewer-action
POST /api/applications/agreement/link
POST /api/applications/agreement/sign
POST /api/applications/export
```

## Navegación y loading

- No existe bottom navigation; el switcher de módulos es la salida.
- `svc-last-module` y la cookie homónima guardan el último módulo interno.
  Si el usuario salió de Applications, la próxima apertura vuelve allí.
- La pantalla de carga del módulo usa fondo blanco, destellos celestes y:

```text
[ 👷 ]
SVC Applications
APPLY · REVIEW · ONBOARD
━━━━━━━◉━━━━━━
LOADING
```

- Un link candidato no cambia el último módulo del staff.

## Verificación reciente

Ejecutado el 2026-07-26:

```bash
pnpm test:applications  # 31/31 verde
pnpm typecheck
pnpm build
```

También se validaron anteriormente las reglas de Applications y la sesión de
candidato en el emulador:

```bash
pnpm emulator:test-applications-rules
pnpm emulator:test-applications-session
```

## Pendientes reales

1. **Rate limit del endpoint de sesión.** El token ya se hashea y se valida
   continuamente, pero falta limitar intentos del endpoint público.
2. **Transcripción y resumen AI reales.** La UI, el campo `video.transcript`
   y la exportación PDF están listos; falta el job/provider que procese el
   video subido.
3. **Reasignación de job.** El job se define al invitar. Falta UI para cambiarlo
   después, idealmente con selector de Directory.
4. **Integración de payroll y Directory.** Marcar `hired` no crea todavía un
   contacto/enlace automático en Directory ni integra un proveedor de payroll.
5. **Política de retención de PII.** Definir y automatizar retención/borrado de
   licencias, videos y acuerdos, especialmente para archivados/rechazados.
6. **Revisión legal.** Validar plantilla del acuerdo y evidencia de firma antes
   de uso operativo con candidatos reales.
7. **Production enablement.** Cuando se decida promover:
   - configurar `NEXT_PUBLIC_APPLICATIONS_BACKEND=true` para Production
     antes de build;
   - confirmar `FIREBASE_SERVICE_ACCOUNT_KEY`;
   - hacer deploy explícito y ejecutar la prueba end-to-end.

## Prueba manual recomendada en development

1. Abrir el preview actual de `development` con una cuenta interna.
2. Crear un invite con nombre, trade y job.
3. Abrir el link en incógnito o en el teléfono.
4. Completar datos, subir un documento y grabar/subir video.
5. Enviar y volver al dashboard desde desktop: el candidato debe aparecer.
6. Abrir archivos y video desde el perfil.
7. Descargar **Application PDF** y comprobar datos, transcript, acuerdo y
   actividad.
8. Aprobar, compartir el link de acuerdo, firmar desde el teléfono.
9. Confirmar `payroll_in_progress` y marcar `hired`.

> Si una aplicación fue creada antes de activar el backend, vive sólo en el
> localStorage de ese navegador. Para una prueba cross-device hay que crear un
> invite nuevo en el preview live; no existe migración automática de datos
> locales.
