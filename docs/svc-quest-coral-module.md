# SVC Quest Coral — development record and operating notes

_This is a chronological engineering record, retained for implementation
history. For the current English, product-focused explanation for Joseph and
the team, see `docs/svc-quest-coral-product-context.md`. The local mock
adapter remains only for development demos; production uses Firestore when
the corresponding Vercel environment flag is enabled._

Última actualización: 2026-07-30

Rama de integración: `main` (sin commitear al momento de escribir esto — ver
`git status`).

Estado del código: **Fase 2 (Firestore) LIVE en producción (svc-comms).**
`NEXT_PUBLIC_QUEST_CORAL_BACKEND=true` en `.env.local` (decisión explícita del
usuario: correr contra Firestore real de producción, no el emulador) y las
reglas de `firestore.rules` ya están desplegadas (2026-07-29,
`firebase deploy --only firestore:rules`). Esto significa que `pnpm dev`
normal ahora lee/escribe `/questCoralProjects` y `/questCoralUpdates` reales
— arranca **vacío** (sin los 5 proyectos ficticios), igual que Applications.
El diseño de las pantallas (Project Detail y el sheet de "Add update", sobre
todo) se sigue puliendo en paralelo — lo que describe este documento es el
estado visual más reciente, no un diseño congelado. **Fase 3 (IA real para
"Ask AI") está LIVE en producción desde 2026-07-30**, con aprobación explícita
del usuario: `NEXT_PUBLIC_QUEST_CORAL_AI_ENABLED=true` en `.env.local`, y la
regla de `questCoralAiUsage` desplegada (`firebase deploy --only
firestore:rules`, mismo comando que la Fase 2). Cada pregunta de "Ask AI"
(por proyecto o portfolio-wide) ahora pega de verdad a `gpt-5-mini` — genera
costo real por llamada. Verificado con `pnpm typecheck` + `pnpm build`
limpios y un smoke test directo a `/api/quest-coral/ask` (sin token → 401
`unauthenticated` limpio, confirmando que la ruta y el auth guard están
vivos); un click-through real en browser con sesión logueada queda para el
usuario, sin browser driver en este sandbox.

## Resumen ejecutivo

`Quest Coral` es el 4º módulo del portal SVC (junto a Communications,
Directory y Applications): un project tracker mobile-first para centralizar
proyectos, responsables, progreso, feedback, blockers, próximos pasos y
updates, con Red Team Review, un indicador de cobertura 0°–360°, AI Project
Brief y "Ask AI" por proyecto.

Se construyó a partir de mockups de referencia (Figma/imagen) que mostraban
un tracker genérico de proyectos; el nombre "Quest Coral" viene de ese
mockup y de la solicitud explícita del usuario, no implica que el contenido
tenga que ver con conservación de arrecifes. Los datos ficticios usan nombres
de proyecto acordes al dominio real de SVC (staffing/trades), no al tema del
mockup original.

La instrucción explícita del usuario fue: primero un mockup funcional con
datos ficticios, consistente con el resto del portal y con la identidad
visual de Applications (fondo blanco, texto navy, bordes suaves, coral como
color principal, teal y violeta solo de apoyo), reutilizando toda la
infraestructura ya construida (mismo patrón de módulo, mismos primitivos de
diseño, misma capa de IA cuando llegue esa fase) en vez de inventar algo
nuevo. Firestore y la IA real quedan para fases posteriores, con aprobación
explícita. *(El violeta de apoyo para IA fue la decisión inicial; una pasada
de diseño posterior lo sacó a favor de un solo acento coral — ver punto 2 de
"Decisiones de diseño tomadas".)*

## Estado por fase

| Fase | Alcance | Estado |
|---|---|---|
| **Fase 1 — Mockup** | Todo el módulo corre sobre `localStorage`. "Ask AI" y "AI Project Brief" generan texto localmente a partir de los campos del proyecto (sin red). | **Hecho.** |
| **Fase 2 — Backend real** | Colecciones `questCoralProjects`/`questCoralUpdates`, reglas de Firestore, `lib/quest-coral-store.ts` (mappers) + `lib/quest-coral-writes.ts` (reads/writes), flag `NEXT_PUBLIC_QUEST_CORAL_BACKEND`, y ahora "People involved" conectado a `/contacts` reales (ver más abajo). | **LIVE en producción.** Reglas desplegadas 2026-07-29; flag en `true` en `.env.local` del usuario. Reglas validadas contra el emulador antes de desplegar (`pnpm emulator:test-quest-coral-rules`, 12/12 OK). Sin click-through en browser real todavía (sin browser driver en este sandbox) — pendiente que el usuario lo pruebe en `pnpm dev`. |
| **Fase 3 — IA real (Ask AI + AI Project Brief)** | `getQuestCoralAiConfig()` reusando `OPENAI_API_KEY`, rutas `/api/quest-coral/ask` y `/api/quest-coral/brief`, request guard compartido + colección `questCoralAiUsage` (`allow read, write: if false` en `firestore.rules`/`.secure`, **desplegado**), siguiendo el mismo esqueleto que `/api/directory/ask`. | **LIVE en producción (2026-07-30).** Flag `NEXT_PUBLIC_QUEST_CORAL_AI_ENABLED=true` en `.env.local` del usuario. Cada pregunta de "Ask AI" (proyecto o portfolio) y cada "AI Project Brief" pegan de verdad a `gpt-5-mini` — costo real por llamada. Falta: un click-through real en browser (pendiente del usuario). |

### Regla importante sobre el mock

A diferencia de Applications (que arranca vacío porque solo existen
candidatos reales invitados), Quest Coral **arranca sembrado** con 5
proyectos ficticios (`lib/quest-coral-core.ts` → `MOCK_PROJECTS`/
`MOCK_UPDATES`) la primera vez que `localStorage['svc-quest-coral-local-v1']`
no existe en ese navegador/dispositivo. Es intencional: no hay un flujo de
"invitar" que la llene, y una pantalla vacía en la primera demo se hubiera
visto rota. Los datos creados después (nuevo proyecto, updates) sí persisten
solo en ese navegador — no se sincronizan entre dispositivos hasta la Fase 2.

## Decisiones de diseño tomadas

1. **Paleta nueva, mismo mecanismo que Applications.** `.quest-coral-scope`
   en `app/globals.css` redefine los tokens base de shadcn (como
   `.applications-scope`) y agrega un namespace propio `--coral-*`. Color
   principal: `--coral: #FF7A59` (un coral suave/salmón, no un naranja-rojo
   saturado, ajustado el 2026-07-29 para calzar con las imágenes de
   referencia). No existían tokens "coral" ni "navy" antes de este módulo.
2. **La IA ya NO usa violeta en este módulo — cambio de decisión.** La
   primera versión reservaba violeta (`--coral-violet` / `--coral-ai`,
   `#8B5CF6`) para AI Project Brief y Ask AI, calcada de la convención de
   Applications ("violeta reservado para IA"). En una pasada posterior esos
   tokens se re-apuntaron al mismo coral principal —
   `--coral-violet: #FF7A59` y `--coral-ai: #FF7A59` en `app/globals.css` —
   con el comentario en el propio código: *"AI keeps the coral identity in
   this module rather than introducing a second, competing accent colour."*
   Quest Coral **diverge a propósito** de Applications en esto: un solo
   acento en vez de dos. Ver "Pendiente de alinear" más abajo — no todas las
   pantallas reflejan el cambio todavía.
3. **Cobertura 0°–360°** se sigue calculando igual (`computeProjectCoverage()`
   en `lib/quest-coral-core.ts`, deriva de 6 dimensiones — progreso, gente,
   mission fit, sin blockers abiertos, al menos un update, al menos un Red
   Team Review), pero **ya no se muestra visualmente** en Project Detail: la
   pasada de diseño más reciente la dejó solo como texto para lectores de
   pantalla (`<span className="sr-only">{coverage.degrees} degrees…</span>`).
   El cálculo sigue vivo y el hook lo sigue exponiendo (`coverageFor`); es una
   decisión de presentación, no un retiro de la función.
4. **Red Team Review es un 4º tipo de update** (`update | feedback | blocker
   | red_team_review`), no una pantalla ni entidad separada — mismo patrón
   que `MESSAGE_TYPE_CONFIG` en `lib/store.ts` para Communications. Ya no
   tiene una tarjeta-resumen propia en Project Detail (ver punto 6): se ve
   como una entrada más del feed de actividad, con su pill de tipo.
5. **"Ask AI" tiene dos superficies mock**: una por proyecto (Project Detail)
   y una de portafolio (Home, tarjeta "Ask AI"), ambas resueltas con texto
   generado localmente (`features/quest-coral/quest-coral-mock-ai.ts`) por
   coincidencia de palabras clave en la pregunta — no hay modelo real detrás
   todavía.
6. **Add update pasó de un formulario único a un flujo en dos etapas**
   (`components/quest-coral/add-update-sheet.tsx`): primero se elige el tipo
   en una grilla 2×2 con descripción propia por tipo, después aparece un
   formulario contextual. `Feedback` suma foco (Process/Communication/
   Quality/Team/Other) + acción sugerida; `Blocker` suma impacto (Low/Medium/
   High) + qué se necesita + dueño + fecha objetivo; `Red Team Review` suma
   qué cuestionar + acción recomendada + severidad (Observation/Concern/
   Critical). Nada de esto tocó el modelo de datos: todo se serializa como
   líneas rotuladas dentro del mismo `body` de texto plano
   (`ProjectUpdate.body` sigue siendo un string). El toggle independiente
   "¿Es un blocker?" desapareció — ahora `isBlocker` es estrictamente
   `type === "blocker"`.
7. **Project Detail se consolidó**: las tarjetas separadas de "Risks /
   blockers" y "Red Team Review" que tenía la primera versión ya no existen.
   Ahora hay una sola tarjeta "Latest update" con el update más reciente y un
   `<details>` colapsable "View all activity" para el resto — blockers y Red
   Team Review se distinguen únicamente por la pill de tipo en cada fila, no
   por una sección dedicada.
8. **Sin filtros de owner/prioridad** en Home (el mockup los sugería): con 5
   proyectos ficticios no aportaban valor y sí complejidad. Solo quedó
   filtro por status + búsqueda por texto.

### Pendiente de alinear (visual, no funcional)

El punto 2 de arriba (IA → coral, no violeta) solo se aplicó a
`components/quest-coral/project-detail-screen.tsx` y a los primitivos
compartidos (`ui/quest-coral-primitives.tsx`, `ui/tone.ts`, `ui/quest-coral-sheet.tsx`).
Dos lugares todavía tienen colores violeta **hardcodeados** (no leídos de
variable) que no se actualizaron solos al repuntar los tokens, y hoy quedan
con un fondo coral pero texto violeta:

- `components/quest-coral/quest-coral-screen.tsx` — la tarjeta "Ask AI" de
  Home (`text-[#4C3A80]`, `text-[#6D3EE0]`, `border-[#E0D6FB]`).
- `components/quest-coral/about-quest-coral-screen.tsx` — el banner final
  "Need help getting started?" (mismos hex).

No lo toqué porque el pedido de esta vuelta fue solo documentación / backend,
no UI. Si la intención es que **todo** Quest Coral use un solo acento coral
(sin violeta en ningún lado), esos dos archivos son los que faltan alinear.

## Arquitectura relevante

| Capa | Archivos principales |
|---|---|
| Dominio / estados / mock data | `lib/quest-coral-core.ts` |
| Feature flag (`QUEST_CORAL_BACKEND_ENABLED`, sigue en `false`) | `lib/quest-coral-flags.ts` |
| Store local (`localStorage`) | `features/quest-coral/quest-coral-store.ts` |
| Mappers Firestore ↔ dominio (Fase 2, sin usar aún) | `lib/quest-coral-store.ts` |
| Reads/writes Firestore (Fase 2, sin usar aún) | `lib/quest-coral-writes.ts` |
| Estado del dashboard (un hook, dos backends detrás del flag) | `features/quest-coral/use-quest-coral-dashboard.ts` |
| Ask AI mock (por proyecto y portafolio) | `features/quest-coral/quest-coral-mock-ai.ts`, `features/quest-coral/use-quest-coral-ask.ts` |
| Home / lista de proyectos | `components/quest-coral/quest-coral-screen.tsx` |
| Detalle de proyecto | `components/quest-coral/project-detail-screen.tsx` |
| Sheet "Agregar update" | `components/quest-coral/add-update-sheet.tsx` |
| Sheet "Nuevo proyecto" (5 pasos) | `components/quest-coral/create-project-sheet.tsx` |
| Picker de personas (contactos reales) | `components/quest-coral/ui/people-search-picker.tsx` (usa `lib/smart-search.ts`) |
| About / Tutorial | `components/quest-coral/about-quest-coral-screen.tsx` |
| Primitivos de diseño (clon de `apps-primitives.tsx`) | `components/quest-coral/ui/quest-coral-primitives.tsx`, `ui/quest-coral-sheet.tsx`, `ui/tone.ts` |
| Identidad visual | `app/globals.css` (`.quest-coral-scope`, `.quest-coral-canvas`, etc.) |
| Selector de módulo | `components/module-switcher.tsx` (`SvcModule` += `"quest-coral"`) |
| Shell / navegación | `app/page.tsx` (`Screen` += `"quest-coral" | "quest-coral-detail"`, `SCREEN_DEPTH`, `persistLastModule`, bloque de render) |
| Cookie de último módulo | `app/layout.tsx` |
| Splash de carga | `components/app-loading-screen.tsx` (`QuestCoralLoadingScreen`) |
| Reglas Firestore (agregadas, no desplegadas) | `firestore.rules`, `firestore.rules.secure` — bloques `/questCoralProjects` y `/questCoralUpdates` |
| Test de reglas (emulador) | `scripts/test-quest-coral-rules.mjs` (`pnpm emulator:test-quest-coral-rules`) |
| Variable de entorno | `.env.example` → `NEXT_PUBLIC_QUEST_CORAL_BACKEND=false` |

### Cómo quedó armado el backend real (Fase 2)

Mismo split "un hook, dos backends" que `useApplicationsDashboard`:

- **Firestore, no subcolección.** `questCoralProjects` y `questCoralUpdates`
  son colecciones de nivel superior (no `projects/{id}/updates`), porque el
  dashboard necesita consultas cross-proyecto (el Ask AI de portafolio agrega
  updates de todos los proyectos, y `updatedThisWeek` los necesita todos
  igual). Cada update lleva `projectId`; el filtrado por proyecto pasa en el
  cliente, igual que hoy con el mock.
- **Reglas**: proyectos con lectura global (como `/contacts`) y escritura de
  progreso/status abierta a cualquier autenticado (como `/contexts`) porque
  es un tracker de equipo, no datos privados — pero **borrar** un proyecto
  requiere ser el dueño (`ownerUserId`). Updates son de solo-creación por su
  propio autor y **nunca editables** una vez posteados (`allow update: if false`),
  como un log de auditoría.
- **`createProject`/`addUpdate` ahora son `async`** en el hook (antes eran
  síncronos) para que el mismo código de la UI sirva a ambos backends sin
  ramas — el mock simplemente resuelve la promesa al instante.
- **`subscribeWithServerReconcile`** (`lib/firestore-reconcile.ts`, ya usado
  por Applications) para los dos listeners — evita el bug conocido de
  Firestore cache-only en iOS/PWA (ver problema conocido #3 en
  `svc-project-context-for-ai-agents.md`).
- **Nada de esto se ejecutó contra el emulador con la app real corriendo** —
  solo se probaron las reglas de forma aislada (`@firebase/rules-unit-testing`,
  el mismo paquete que usa `test-applications-rules.mjs`). Antes de prender
  el flag en cualquier entorno, habría que hacer el click-through real
  (`pnpm dev:emulator` + `NEXT_PUBLIC_QUEST_CORAL_BACKEND=true`) que esta
  sesión no pudo hacer por falta de browser driver (mismo límite ya
  documentado en Fase 1).

### Segunda pasada — completitud y consistencia con Firebase (2026-07-29)

Sin tocar UI, se cerraron algunos huecos que habían quedado de la primera
versión de la Fase 2:

- **Timestamps de creación con `serverTimestamp()`.** `createQuestCoralProject`
  y `createQuestCoralUpdate` escribían `createdAt`/`updatedAt` con la hora del
  cliente (vía el conversor genérico). Ahora los pisan con `serverTimestamp()`
  al escribir — mismo patrón que `lib/applications-writes.ts` usa para
  aplicaciones nuevas (`{...applicationToFirestore(application), createdAt: serverTimestamp(), updatedAt: serverTimestamp()}`).
  El valor devuelto en el momento sigue siendo optimista (hora del cliente);
  el listener lo reconcilia con el valor real del servidor enseguida.
- **`subscribeQuestCoralUpdates` no tenía manejo de error.** El listener de
  proyectos sí lo tenía; el de updates lo silenciaba. Ahora ambos alimentan
  el mismo `loadError`.
- **Delete faltante.** Las reglas ya permitían borrar (dueño→proyecto,
  autor→update), pero no existía ninguna función que lo hiciera en ninguno
  de los dos backends. Se agregó `deleteProject`/`deleteUpdate` al hook,
  respaldados por `deleteMockProject`/`deleteMockUpdate` (mock) y
  `deleteQuestCoralProject`/`deleteQuestCoralUpdate` (Firestore). Ninguna
  pantalla los llama todavía — quedan disponibles para cuando el diseño
  incluya esa acción.
- **Decisión explícita: sin cascada al borrar un proyecto.** Tanto el mock
  como Firestore dejan huérfanos los updates de un proyecto borrado, a
  propósito: la regla de Firestore solo deja borrar un update a su propio
  autor, así que un dueño de proyecto no puede necesariamente limpiar los
  updates que escribió un compañero de equipo. Intentar la cascada en
  Firestore (un `writeBatch` que borra proyecto + updates) fallaría entero en
  cuanto hubiera un update ajeno de por medio, porque los batches son
  atómicos. Se documenta acá para que quien lo retome no lo "arregle"
  agregando una cascada que después falla en producción.
- **Se re-verificó** `pnpm typecheck` y `pnpm build` después de estos
  cambios — limpios. No se re-corrió el test de reglas porque las reglas en
  sí no cambiaron, solo el código de aplicación que las invoca (ya cubierto
  por los 12 casos existentes).

### "People involved" ahora usa contactos reales, no texto libre (2026-07-29)

Antes, tanto el paso "People" de `create-project-sheet.tsx` como el "Add
people" de `project-detail-screen.tsx` eran un campo de texto libre: quien
tipeaba un nombre generaba un `ProjectPerson` con un id sintético
(`person-<timestamp>-<slug>`), sin relación real con nadie del resto de la
app. Pedido explícito del usuario: usar los contactos/usuarios reales
(registrados o no) de Communications/Directory.

- **`components/quest-coral/ui/people-search-picker.tsx`** (nuevo) — lista
  buscable embebida (no es un `QcSheet` propio, se monta dentro del sheet que
  ya esté abierto) sobre `Contact[]` + `ImportedContact[]`, reusando
  `lib/smart-search.ts` (`scoreRegisteredPersonSearch`/
  `scoreImportedContactSearch`/`compareBySearchScore`) — la misma lógica de
  ranking que ya usan `compose-screen.tsx`/`tag-sheet.tsx`, no una reimplementación.
  Solo muestra `ImportedContact` con `status === "not_registered"` (los
  registrados ya aparecen vía `Contact`), mismo criterio que compose-screen.
- **`ProjectPerson.id`** ahora es el id real: el UID de Firebase para un
  `Contact`, o el id de documento de Firestore para un `ImportedContact` — ya
  no un slug inventado. Esto es lo que permite, a futuro, cruzar "quién está
  en este proyecto" con Directory/Communications.
- **`NewProjectInput.peopleNames: string[]`** (texto libre) se reemplazó por
  **`additionalPeople: ProjectPerson[]`** (ya resueltos por el picker).
  `use-quest-coral-dashboard.ts` ahora expone `currentUserId`/`currentUserName`
  en su retorno para que las pantallas sepan a quién excluir del picker (el
  dueño ya se agrega solo).
- **Prop drilling, no listeners nuevos**: `contacts`/`importedContacts` ya
  vivían en `app/page.tsx` (para Communications/Directory) — Quest Coral solo
  las recibe como props nuevas en `QuestCoralScreen`/`ProjectDetailScreen`.
  Cero queries Firestore adicionales.
- `pnpm typecheck` y `pnpm build` limpios después del cambio.

### Fase 2 pasó a LIVE en producción (2026-07-29)

A pedido explícito del usuario (eligió "producción real" en vez de emulador
cuando se le preguntó), se hicieron dos cambios con impacto real:

1. **`firebase deploy --only firestore:rules`** contra `svc-comms` — las
   reglas de `/questCoralProjects` y `/questCoralUpdates` (idénticas a las ya
   probadas en el emulador) están desplegadas en producción.
2. **`.env.local` → `NEXT_PUBLIC_QUEST_CORAL_BACKEND=true`** — solo el
   archivo local del usuario (gitignored, nunca llega a Vercel). El único
   efecto es que su `pnpm dev` normal ahora habla con Firestore real en vez
   del mock. El deploy en Vercel no se tocó y no se ve afectado por este
   archivo.

No se sembró ningún dato ficticio en producción — las colecciones arrancan
vacías, igual que Applications.

## Navegación y loading

- No hay bottom navigation; el `ModuleSwitcher` en el header es la única
  salida, igual que en Communications/Directory/Applications.
- `svc-last-module` (localStorage + cookie) ahora también acepta
  `"quest-coral"`. Si el usuario salió de Quest Coral, la próxima apertura
  vuelve ahí.
- El splash de carga usa fondo blanco, destellos coral y:

```text
[ 🎯 ]
SVC Quest Coral
PROJECTS · PROGRESS · FEEDBACK
━━━━━━━◉━━━━━━
LOADING
```

## Verificación reciente

Ejecutado el 2026-07-29:

```bash
pnpm typecheck                        # sin errores (Fase 2 + última pasada visual)
pnpm build                            # compiló OK, incluidos los chunks dinámicos del módulo
pnpm emulator:test-quest-coral-rules  # 12/12 casos OK contra el emulador
```

`pnpm typecheck` se corrió de nuevo después de la última pasada de diseño
(Project Detail, Add update, primitivos/tone/sheet compartidos) para
confirmar que el rediseño no rompió el contrato de props con `app/page.tsx`
ni con el hook — sigue limpio.

Casos cubiertos por `test-quest-coral-rules.mjs`: lectura global autenticada,
lectura bloqueada sin sesión, cualquier autenticado puede actualizar
progreso/status de un proyecto ajeno, solo el dueño puede borrarlo, crear un
proyecto exige que `ownerUserId` sea el propio uid, crear un update exige que
`authorId` sea el propio uid, un update no se puede editar una vez creado, y
el autor sí puede borrar su propio update.

`pnpm lint` sigue fallando con `eslint: command not found` — problema
preexistente del repo (ESLint no está instalado), no introducido acá.

**Seguimos sin click-through real en navegador** (ni en Fase 1 ni ahora en
Fase 2) — este sandbox no tiene `chromium-cli` ni Playwright, así que no se
probó el flujo completo con el flag `NEXT_PUBLIC_QUEST_CORAL_BACKEND=true`
contra el emulador. Lo que sí se probó de forma aislada y con la herramienta
oficial de Firebase para esto (`@firebase/rules-unit-testing`) son las
reglas. Con el flag apagado (estado actual en todos los entornos), el
comportamiento de la app es idéntico a la Fase 1.

## Revisión final — botones y optimización (2026-07-29)

Pasada completa por todos los archivos de `components/quest-coral/` (incluido
lo que Codex venía agregando): cada `<button>`/`<QcButton>` del módulo tiene
un handler real — no quedó ninguno decorativo. Se encontraron y corrigieron
tres cosas puntuales:

1. **`about-quest-coral-screen.tsx`** todavía tenía el violeta hardcodeado
   (`#4C3A80`/`#E0D6FB`) que había quedado pendiente de alinear — ya se
   corrigió, ahora coincide con el resto del módulo (coral, sin violeta).
2. **`project-detail-screen.tsx`**: `sortedUpdates`/`visibleUpdates`/
   `latestUpdates`/`blockerCount`/`redTeamCount`/`brief`/`accent` se
   recalculaban en cada render (incluso al tipear en el buscador de Ask AI o
   en el formulario de timeline, que son estado local de la misma pantalla).
   Ahora están en `useMemo`, dependientes solo de `project`/`updates`/
   `activityFilter`.
3. **`ActivityEntries`** recorría la cola de la lista por cada fila para
   calcular el progreso anterior (`O(n²)` sobre el feed de actividad
   completo) — ahora es un solo pase hacia atrás (`O(n)`).
4. **`ProjectCard`** (Home) ahora usa `memo()`, mismo patrón que
   `ApplicationCard` en Applications — tipear en el buscador o en Ask AI de
   Home ya no vuelve a renderizar las tarjetas que no cambiaron.

`pnpm typecheck` y `pnpm build` limpios después de estos cambios.

### Botones de IA — auditados, los 4 andan

| Dónde | Qué hace | Estado |
|---|---|---|
| Home → tarjeta "Ask AI" | `useState` local en `quest-coral-screen.tsx` → real si `QUEST_CORAL_AI_ENABLED`, si no `answerPortfolioQuestion()` | **Real, LIVE** |
| Project Detail → "Ask AI" / "Ask a question" | `useQuestCoralAsk` → real si `QUEST_CORAL_AI_ENABLED`, si no `answerProjectQuestion()` | **Real, LIVE** |
| Project Detail → AI Project Brief | `useQuestCoralBrief` → real si `QUEST_CORAL_AI_ENABLED`, si no `generateProjectBrief()`, siempre visible (no es un botón, es contenido) | **Real, LIVE** (con cache de sesión, ver abajo) |
| About → banner "Ask AI" | Vuelve a Home con el panel de Ask AI abierto | Funcional |

### Cómo quedó armado el Ask AI real (Fase 3) — 2026-07-29

Construido siguiendo el mismo esqueleto que `/api/directory/ask`, pero con el
patrón más simple de `features/outlooks/ai/server/parse-service.ts` (un solo
llamado `createStructuredJson`, sin tool-calling ni retrieval) — no hace
falta retrieval server-side porque el proyecto + sus updates ya son datos
acotados que el cliente ya tiene cargados por completo.

- **`lib/ai/config.ts`** → `getQuestCoralAiConfig()`, reusa `OPENAI_API_KEY`
  (ningún secreto nuevo) con sus propios `QUEST_CORAL_AI_MODE` /
  `QUEST_CORAL_AI_ASK_MODEL` (default `gpt-5-mini`). `lib/ai/config-public.ts`
  → `QUEST_CORAL_AI_LIMITS` (preguntas ≤400 chars, ≤40 proyectos/updates por
  request, `maxAnswerTokens: 500`).
- **`lib/ai/server/quest-coral-request-guard.ts`** — rate-limit/idempotencia/
  single-active-request transaccional sobre su propia colección
  `questCoralAiUsage`, mismo core compartido que Outlook/Directory
  (`request-guard-core.ts`). Escribe solo vía Admin SDK. `acquireQuestCoralAiRequest`
  recibe `operation: "ask" | "generation"` (generalizado cuando se sumó Brief,
  ver abajo) — ambas comparten el mismo balde de rate-limit no-transcripción,
  solo cambia la etiqueta en los logs.
- **`features/quest-coral/ai/quest-coral-ask-contract.ts`** — zod schemas del
  request/response de `/api/quest-coral/ask`. El request lleva
  `{ question, scope: "project"|"portfolio", projects: [...] }` — cada
  proyecto incluye sus propios campos + sus updates recientes (hasta 20). No
  hay "records" separados como en Directory: el proyecto entero ya es el
  contexto acotado.
- **`features/quest-coral/ai/server/prompt.ts`** — system prompt + schema
  JSON estricto (`{ answer: string }`), serializa cada proyecto a texto plano
  para el modelo.
- **`features/quest-coral/ai/server/mock-ask.ts`** — respuestas mock sobre el
  contrato de red (no sobre `lib/quest-coral-core.ts`), usado cuando no hay
  key o `QUEST_CORAL_AI_MODE=mock`. Independiente de
  `quest-coral-mock-ai.ts` (ese sigue siendo el fallback client-side cuando
  el flag está apagado).
- **`features/quest-coral/ai/server/ask-service.ts`** — elige mock vs. live
  igual que `parse-service.ts`.
- **`app/api/quest-coral/ask/route.ts`** — auth (`authenticateOutlookRequest`)
  → idempotencia → rate-limit (solo si `user.verified`) → `ask-service` →
  safe-log (`logQuestCoralAi`, nuevo tag en `safe-log.ts`) → respuesta con
  `X-Request-Id`/`X-RateLimit-Remaining`.
- **`features/quest-coral/ai/client/quest-coral-ai-client.ts`** — fetch
  wrapper con Bearer token + idempotency key, reusa
  `OutlookAiClientError`/`createOutlookAiIdempotencyKey` tal cual Directory.
- **`features/quest-coral/use-quest-coral-ask.ts`** (reescrito) — mismo
  contrato público (`question`/`phase`/`answer`/`submit`/`reset`/`canSubmit`),
  ahora con `phase: "error"` y `error`/`cooldownSeconds`/`attempt` agregados
  (aditivo, no rompe nada que ya leyera el contrato viejo). Rama a real solo
  si `QUEST_CORAL_AI_ENABLED`; si no, corre exactamente igual que antes
  (mismo delay de 450ms, misma función mock). Exporta
  `projectToAskPayload()`, reusado también por `quest-coral-screen.tsx` para
  el Ask AI del portfolio.
- **`components/quest-coral/ui/quest-coral-ask-generating.tsx`** +
  CSS en `app/globals.css` (`quest-coral-ai-shimmer`,
  `quest-coral-ask-generating-orb`, `quest-coral-ask-generation-copy`) — el
  mismo patrón de esqueleto + copy rotativo que
  `components/directory/ask/directory-ask-generating.tsx`, re-skinned en el
  acento coral-only del módulo en vez del violeta/ámbar/cian oscuro de
  Directory. Se muestra vía `useGeneratingReveal` (mismo hook que Directory)
  para sostener el esqueleto un mínimo de ~500ms aunque la respuesta (mock o
  real) vuelva antes.
- **`lib/ai/server/request-guard-core.ts`** — se encontró y arregló un bug
  preexistente al leer este archivo como molde: `normalizeActive()` no
  reconocía `operation: "ask"` (solo `"generation"`/`"transcription"`), así
  que los leases activos/recientes de Ask SVC Directory (que sí usa `"ask"`)
  se descartaban silenciosamente en cada lectura de Firestore, debilitando su
  protección contra duplicados/concurrencia. Corregido — afecta a Directory,
  no solo a Quest Coral.

### Cómo quedó armado el AI Project Brief real (Fase 3) — 2026-07-30

"AI Project Brief" es contenido siempre visible, no una pregunta tipeada por
el usuario — eso lo hace distinto de Ask AI en un punto importante: sin
cuidado, reabrir el mismo proyecto sin cambios facturaría OpenAI en cada
visita. La solución fue reusar casi toda la infraestructura del Ask AI
(mismo config, mismo request guard, mismo cliente) y sumarle **cache de
sesión** en el hook:

- **`features/quest-coral/ai/quest-coral-brief-contract.ts`** — zod schemas
  del request/response de `/api/quest-coral/brief`. El request es
  `{ project }` (reusa `questCoralAskProjectSchema` del contrato de Ask, sin
  duplicar); la respuesta es `{ brief: string, mode }`, no `{ answer }` — es
  un resumen, no una respuesta a una pregunta.
- **`features/quest-coral/ai/server/prompt.ts`** — `QUEST_CORAL_BRIEF_SYSTEM_PROMPT`
  + `QUEST_CORAL_BRIEF_JSON_SCHEMA` (`{ brief: string }`), reusando
  `serializeProject()` (exportada, antes privada) para no duplicar cómo se
  serializa un proyecto a texto para el modelo.
- **`features/quest-coral/ai/server/mock-ask.ts`** → `mockGenerateQuestCoralBrief()`,
  reusando los mismos helpers `projectBrief()`/`contextExcerpt()` que ya
  usaba el mock de Ask.
- **`features/quest-coral/ai/server/brief-service.ts`** — mismo patrón
  mock-vs-live que `ask-service.ts`.
- **`app/api/quest-coral/brief/route.ts`** — mismo esqueleto que la ruta de
  ask, pero etiqueta la operación como `"generation"` en vez de `"ask"` (no
  hay pregunta de usuario) — comparten balde de rate-limit igual.
- **`features/quest-coral/use-quest-coral-brief.ts`** (nuevo hook) — expone
  `{ brief, phase: "idle"|"loading"|"ready", mode, error, regenerate }`.
  Mantiene un **cache a nivel de módulo** (`Map` en memoria, vida = la pestaña
  abierta) por `project.id` + un fingerprint (status, progress, next step,
  cantidad/última update, contexto) — mientras el fingerprint no cambie,
  reabrir el mismo proyecto reusa el brief ya generado sin llamar a la red.
  Un cambio real (progreso, status, next step, nueva update, contexto
  editado) o el botón "Regenerate" fuerza una llamada nueva. Si la llamada
  real falla, degrada con gracia al mock local (`generateProjectBrief()`) en
  vez de mostrar un bloque de error duro — es contenido ambiente, no una
  acción explícita del usuario, así que un error visible ahí se siente peor
  que un resumen genérico. Con el flag apagado se comporta exactamente igual
  que antes (síncrono, mismo `generateProjectBrief()`, cero red).
- **`components/quest-coral/ui/quest-coral-ask-generating.tsx`** →
  `QuestCoralBriefGenerating` (nuevo export) — variante compacta del
  esqueleto de Ask (sin el copy rotativo, porque generar un brief es una sola
  llamada corta, no una conversación).
- **`components/quest-coral/ui/quest-coral-primitives.tsx`** → `AiBriefCard.body`
  pasó de `string` a `ReactNode` (acepta el esqueleto o el texto), y se sumó
  `headerAction` (botón "Regenerate" con ícono `RefreshCw`, solo visible con
  el flag prendido y `phase === "ready"`).
- **`lib/quest-coral-mock-ai.ts`** → `generateProjectBrief()` ahora acepta un
  tercer parámetro opcional `contextMarkdown` y lo agrega al resumen — antes
  no sabía nada del "Project Context" que Codex sumó en paralelo
  (`useQuestCoralContext`/`edit-project-context-sheet.tsx`).

Verificado con `pnpm typecheck` + `pnpm build` limpios y un smoke test directo
a `/api/quest-coral/brief` (sin token → 401 `unauthenticated`, igual que
`/ask`).

**Ya en producción** (aprobado y ejecutado 2026-07-30):

1. ~~Desplegar la regla de `questCoralAiUsage`~~ — hecho
   (`firebase deploy --only firestore:rules`, salida confirmada:
   "✔ firestore: released rules firestore.rules to cloud.firestore").
2. ~~Setear `NEXT_PUBLIC_QUEST_CORAL_AI_ENABLED=true`~~ — hecho en
   `.env.local`. `QUEST_CORAL_AI_MODE`/`QUEST_CORAL_AI_ASK_MODEL` quedan sin
   setear (usa el default: live porque hay `OPENAI_API_KEY`, modelo
   `gpt-5-mini`).

3. ~~Decidir si "AI Project Brief" también migra a real~~ — hecho 2026-07-30
   (`/api/quest-coral/brief`, ver "Cómo quedó armado el AI Project Brief
   real" arriba). Tiene su propio loading state (`QuestCoralBriefGenerating`)
   y cache de sesión para no re-facturar en cada visita al mismo proyecto sin
   cambios.

**Sigue pendiente:**

4. **Esto ya cuesta plata por llamada** (mismo modelo `gpt-5-mini` que usa
   Directory) desde que se encendió — tanto Ask AI como AI Project Brief.
   Sin click-through real en browser todavía (sin browser driver en este
   sandbox) — falta que el usuario pruebe una pregunta real y abra un
   proyecto en `pnpm dev` y confirme que ambas respuestas llegan y tienen
   sentido.

## Pendientes reales

1. **Click-through real en `pnpm dev`** (ahora contra Firestore de
   producción) — crear un proyecto, agregar gente real vía el picker, postear
   un update, confirmar que el listener reconcilia. No se pudo hacer en esta
   sesión (sin browser driver disponible) — es lo primero a probar del lado
   del usuario.
2. **`.env.example`** todavía documenta el flag como `false` (es el default
   recomendado para cualquier otro entorno/colaborador) — solo el
   `.env.local` de este usuario lo tiene en `true`. No confundir uno con otro.
3. **Fase 3 (IA real para Ask AI y AI Project Brief)**: LIVE en producción
   desde 2026-07-30 (ver "Cómo quedó armado..." arriba, ambas secciones) —
   regla desplegada, flag encendido, ambas generan costo real por llamada.
   El Brief usa cache de sesión para no re-facturar en cada visita a un
   proyecto sin cambios — ver "Sigue pendiente" ahí mismo para lo que falta.
4. **Decisión pendiente sobre "cobertura 0°–360°"**: se implementó como
   indicador derivado de completitud (ver arriba). Si el usuario tenía en
   mente otra cosa (p. ej. cobertura geográfica de eventos), avisar antes de
   construir nada sobre esa base.
5. Sin índices compuestos necesarios hoy (ambas colecciones se consultan con
   un solo `orderBy`, sin `where`). Si más adelante se agrega un filtro
   server-side, revisar `firestore.indexes.json`.
6. Sin tests automatizados de la lógica de mappers (`lib/quest-coral-store.ts`)
   más allá de las reglas — no se pudo ejercitar `lib/quest-coral-writes.ts`
   de punta a punta porque `lib/firebase.ts` sólo conecta al emulador dentro
   de un browser (`typeof window !== "undefined"`); forzarlo desde un script
   de Node se salteaba esa guarda seguridad y arriesgaba pegarle a
   producción, así que se evitó a propósito.
7. **Alinear los dos archivos que quedaron con violeta hardcodeado**
   (`quest-coral-screen.tsx` y `about-quest-coral-screen.tsx`, ver "Pendiente
   de alinear" arriba) con el resto del módulo, si la decisión de "IA en
   coral, no violeta" es definitiva.

## Project Context (brief en Markdown) — persistente, 2026-07-31

Nueva sección dentro de Project Detail: cada proyecto puede tener un
documento Markdown completo (propósito, problema que resuelve, pregunta
principal, usuarios, funcionamiento, flujos, funcionalidades, decisiones,
estado actual, pendientes) que un humano carga/edita — distinto del "AI
Project Brief" (auto-generado) y del feed de actividad.

Cuando `NEXT_PUBLIC_QUEST_CORAL_BACKEND=true`, el brief se guarda como un
documento por proyecto en `questCoralProjectContexts/{projectId}`. Es
independiente de proyectos y updates para no alterar el feed ni el modelo de
actividad, pero se escucha en tiempo real tanto en el detalle como en la vista
de portafolio. Con el backend apagado se conserva el store local de mock
(`svc-quest-coral-context-v1`) para la experiencia de demostración.

La colección exige un proyecto padre existente y que el id del documento sea
ese mismo `projectId`; admite hasta 12.000 caracteres y no permite borrar el
brief desde cliente. Al guardar, una edición humana remueve la procedencia del
seed para que una migración posterior nunca sobrescriba texto de una persona.
Los cuatro briefs de producto de SVC se cargan mediante
`scripts/seed-quest-coral-project-contexts.mjs`: ids determinísticos,
verificación en seco por defecto, validación de proyecto/credenciales y
actualización sólo si el hash de su fuente cambió.

- **Resumen en Project Detail**: tarjeta nueva "Project context" (ícono
  `NotebookText`) entre las acciones rápidas y el "AI Project Brief" — fecha
  de actualización, fuente (`contextSourceLabel`: "Written manually" o
  "Uploaded · nombre-archivo.md") y un excerpt (`summarizeMarkdown`, strip de
  sintaxis Markdown). Acciones: "View context" / "Edit" / "Replace".
- **Vista completa**: nuevo tercer valor de `activeView` en
  `project-detail-screen.tsx` (`"overview" | "activity" | "context"`), mismo
  patrón que la vista "Activity" ya existente — el header cambia de ícono a
  un lápiz (editar) en vez del menú de opciones. Render vía
  `components/quest-coral/ui/markdown-view.tsx`, un parser de Markdown
  minimalista hecho a mano (headings `##`/`###`, listas `-`/`1.`, negrita
  `**`) — no es CommonMark completo, no se agregó ninguna dependencia nueva.
- **Editar/reemplazar**: `components/quest-coral/edit-project-context-sheet.tsx`,
  un sheet con dos tabs ("Write" / "Upload file"). "Upload file" lee el
  `.md`/`.txt` elegido con `FileReader` en el cliente (sin Storage, sin red)
  y vuelca el texto en el mismo textarea para revisar antes de guardar.
  Tope de 300KB por archivo y 12.000 caracteres en el textarea.
- **Hook**: `features/quest-coral/use-quest-coral-context.ts` —
  `useQuestCoralContext(projectId, currentUserName)` selecciona el listener
  compartido o el store mock según el flag, sin cambiar la UI.
  `ProjectDetailScreen` ahora recibe `currentUserName` como prop nueva
  (viene de `questCoralDashboard.currentUserName` en `app/page.tsx`) para
  poblar `updatedBy` al guardar.
- **Ask AI**: el contexto del proyecto se agrega al payload de la pregunta
  junto con hasta 20 updates. En consultas de portafolio se agrega sólo el
  brief de cada proyecto incluido, con límites de tamaño y una instrucción
  explícita de tratar Markdown como referencia, nunca como instrucciones.

Las reglas de Project Context se validaron en el emulador junto con las de
proyectos y updates. Sigue pendiente un click-through real: abrir un proyecto,
editar el contexto y confirmar que el resumen, la fecha y la respuesta de Ask
AI se reconcilian entre sesiones.

## Prueba manual recomendada

1. `pnpm dev` (o `pnpm dev:emulator` si se prefiere probar con el emulador).
2. Iniciar sesión con una cuenta real de SVC.
3. Abrir el `ModuleSwitcher` desde cualquier header y confirmar que aparece
   "SVC Quest Coral" como 4ª opción.
4. Cambiar a Quest Coral: confirmar tema claro/coral, stats (Active/At
   risk/Completed/Updated this week), tarjeta "Ask AI" y los 5 proyectos
   ficticios.
5. Abrir un proyecto, probar "Ask AI about this project" y confirmar que el
   "AI Project Brief" tiene sentido con los datos del proyecto.
6. Tocar "Add", elegir cada uno de los 4 tipos en la grilla y confirmar que
   el formulario contextual correspondiente aparece (Feedback: foco + acción
   sugerida; Blocker: impacto + qué se necesita + dueño + fecha; Red Team
   Review: qué cuestionar + acción recomendada + severidad). Guardar uno de
   cada tipo y confirmar que aparece en "Latest update", y que el resto queda
   accesible al abrir "View all activity".
7. Crear un proyecto nuevo con el flujo de 5 pasos y confirmar que aparece en
   Home con sus stats actualizados.
8. Abrir "About Quest Coral" (ícono de info) y volver.
9. Cerrar y reabrir la pestaña estando en Quest Coral: debe reabrir ahí
   (cookie `svc-last-module`), sin flash de otro módulo.
10. Recargar y confirmar que lo creado en los pasos 6–7 persiste
    (`localStorage['svc-quest-coral-local-v1']`).
