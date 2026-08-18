---
title: "Courtney Roberts — Canonical Company & Product Knowledge Pack"
audience: "internal"
language: "en"
status: "draft-canonical / requires code audit before production use"
last_updated: "2026-08-13"
purpose: "Stable company, product, workflow, and tutorial knowledge for Courtney Roberts"
---

# Courtney Roberts — Canonical Company & Product Knowledge Pack

## 0. Purpose of this document

This document is intended to become a **trusted internal knowledge source** for Courtney Roberts.

It is not a database dump and it is not a replacement for live SVC data.

Use this document for relatively stable knowledge such as:

- what SVC is;
- how SVC operates;
- what each SVC application/module is for;
- when an employee should use each module;
- how the main workflows work;
- how the modules relate to each other;
- internal terminology;
- onboarding guidance;
- common user questions;
- known product rules and boundaries.

Use **live application data/tools** for changing information such as:

- current people;
- current phone numbers or emails;
- jobs;
- project status;
- recent updates;
- applications;
- reports;
- clock-ins;
- outlooks;
- current dates or deadlines.

Do not treat this document as authority when current code, Firebase data, or live SVC configuration clearly says otherwise.

---

# 1. Reliability and source-of-truth rules

This pack was assembled from the accumulated SVC project conversations and the current Courtney Roberts handoff.

It intentionally avoids filling unknown areas with generic assumptions.

## Evidence labels

### CONFIRMED
Explicitly established in the SVC project conversations or current implementation handoff.

### PRODUCT DIRECTION
A repeated product decision or intended architecture that has been discussed, but Claude/Codex should verify the current implementation before treating UI details as exact.

### NEEDS VERIFICATION
The project conversations do not contain enough reliable information. Do not invent the missing behavior. Inspect current code/product context before promoting it to canonical knowledge.

## Authority order

When information conflicts, use this order:

1. Current production code and current Firebase/data model.
2. Current product/module documentation generated from the repository.
3. Explicit recent SVC project decisions.
4. This knowledge pack.
5. Older project discussions.

If a behavior cannot be verified, Courtney should say that it does not have enough reliable information rather than inventing an answer.

---

# 2. SVC company overview

**Status: CONFIRMED**

## What SVC is

SVC stands for **Supervision Company**.

SVC is a U.S. construction-site supervision company. Its core business is not software itself. The technology exists to support and scale the supervision service.

SVC operates around the problem of getting qualified site supervisors onto construction projects and supporting those supervisors and clients throughout the job.

The service has been described as a full-service supervision model that can include:

- finding supervisors;
- recruiting supervisors;
- evaluating/vetting supervisors;
- placing supervisors on jobs;
- supporting and training supervisors;
- managing active supervision;
- replacing supervisors when required;
- supporting field operations;
- helping contractors and construction companies keep projects supervised.

A site supervisor is the person responsible for coordinating and overseeing onsite construction activity. Typical concerns include trades, schedule, quality, safety, daily issues, and communication with the project/client side.

## Business operating areas

The SVC operating model has repeatedly been discussed around:

- **Sales**
- **Recruiting**
- **Field Operations**

Other connected operational areas discussed in the platform include:

- preconstruction / forecasting;
- finance;
- applications / candidate onboarding;
- project tracking;
- communications;
- reporting;
- clocking / attendance.

A high-level lifecycle is:

```text
Lead / Client
→ Job opportunity
→ Forecast / coverage need
→ Recruit / match supervisor
→ Candidate onboarding
→ Supervisor placement
→ Active field operations
→ Daily reporting / planning / project tracking
→ Issues / updates / replacement if required
→ Billing / closeout / continued relationship
```

## Organizational language

SVC has used the hierarchy:

```text
Vision
→ Mission
→ Operation
→ Objective
→ Goal
→ Task
```

The stated vision in project context is:

> Lift everybody up.

The mission discussed in the project has been:

> Cool Breeze.

The organizational framework called **Operation Major Kong** has been discussed as grouping Sales, Recruiting, and Field Operations.

This language is company-specific and should be preserved when answering questions about SVC planning or organizational structure.

## Strategic product principle

The SVC software platform is intended to become an internal operating system connecting the company rather than a collection of unrelated apps.

The apps should share context such as:

```text
People
↔ Companies
↔ Jobs
↔ Projects
↔ Applications
↔ Reports
↔ Outlooks
↔ Operational updates
```

Courtney Roberts should help users navigate this connected system without requiring them to know where every piece of information lives.

---

# 3. Platform architecture — conceptual map

**Status: CONFIRMED / PRODUCT DIRECTION**

SVC is becoming a modular platform.

The Communications app originally acted as the primary portal/home and remains an important shared communication layer.

Other modules have been added or discussed as dedicated operational surfaces, including:

- Directory
- Quest Coral
- Applications
- ByeByeDPR
- 3-Week Outlooks
- Clocking
- other operational modules

The long-term product direction is not that each app becomes an isolated island.

Instead:

```text
SVC user
   │
   ├── Communications
   ├── Directory
   ├── Quest Coral
   ├── Applications
   ├── ByeByeDPR
   ├── 3-Week Outlooks
   └── Clocking / other modules
```

All of these should increasingly share the same people, companies, jobs, relationships, authentication, and operating context.

Courtney Roberts sits above those modules as a conversational access layer.

---

# 4. Important SVC data concepts

## 4.1 Recipients

**Status: CONFIRMED**

Recipients answer:

> Who receives or is allowed to see this communication?

Recipients are primarily a Communications concept.

Message visibility should be determined by the intended recipients/visibility rules, not by tags.

Do not confuse:

- **recipient** = who receives/sees;
- **entity/context** = who/what the information is about.

---

## 4.2 People

**Status: CONFIRMED**

People are real human beings.

Typical person data may include:

- name;
- email;
- phone;
- role/title;
- company;
- addresses;
- notes or imported source data;
- linked SVC user identity.

Imported contact data should remain associated with the person rather than being converted into arbitrary tags.

When a person later registers/login with a matching normalized identity, the system direction has been to link that user to the existing imported record rather than create duplicate identities.

---

## 4.3 Companies

**Status: CONFIRMED**

Companies represent organizations connected to SVC.

They can be associated with:

- people;
- jobs;
- contexts;
- projects;
- other operational relationships.

A company may have multiple contacts and multiple jobs.

---

## 4.4 Jobs

**Status: CONFIRMED**

A Job represents a construction job/worksite or operational job context.

Jobs are central across multiple modules.

A job can connect:

- company/client;
- people;
- supervisors;
- project information;
- Daily Reports;
- 3-Week Outlooks;
- clocking;
- operational context.

When users ask broad questions about a job, Courtney Roberts should be prepared to combine multiple modules rather than assume one module contains the complete answer.

---

## 4.5 Contexts

**Status: CONFIRMED**

Contexts were introduced as a flexible way to preserve real business context that does not fit cleanly into a single person record.

Contexts can represent things such as:

- companies;
- projects;
- clients;
- topics;
- situations;
- other relevant business context.

An important rule from the import work:

- human contact information belongs in People/contact fields;
- company/project/topic information can belong in Contexts.

Contexts are intended to remain useful business knowledge rather than become another arbitrary tagging system.

---

## 4.6 Tags

**Status: CONFIRMED**

Tags are lightweight classification.

The product direction simplified tags to a **flat/global tag system**.

Categories were intentionally removed/hidden from the user experience while legacy compatibility could remain in Firebase.

Tags should not be used as the primary visibility/permission mechanism.

In conceptual terms:

```text
Recipients = who sees it
Entities / Contexts = what or who it is about
Tags = lightweight classification
Dates = when
Messages = communication/content
```

---

# 5. Communications

**Status: CONFIRMED / some UI details require code verification**

## Purpose

Communications is the shared communication layer of SVC.

It has been treated as the default/home experience of the SVC portal and a place where employees can communicate updates and information.

Core concepts discussed include:

- Stream/messages;
- recipients;
- people;
- tags;
- dates/calendar;
- attachments;
- replies/context flow;
- imported contacts;
- notifications;
- mobile-first PWA usage.

## Messages

Messages are communication records.

They can include:

- sender;
- recipients / visibility;
- tags;
- dates;
- attachments;
- replies/contextual follow-up.

### Important visibility rule

Message access is sensitive.

A message may be intended for specific recipients and should not automatically be visible to every internal user.

For this reason, **Communications/Messages is currently intentionally excluded from Courtney Roberts' broad internal-read scope** until the permission behavior is designed carefully.

Do not tell an internal user that Courtney can search Messages unless that capability has explicitly been added.

## Tags in Communications

Tags classify messages but should not determine who can see them.

The project explicitly moved away from using tags/categories as a complex hierarchy.

## Relationship to other modules

Communications is not intended to own all structured operational data.

Other modules can generate or connect operational information that may later be surfaced/distributed through Communications.

Examples discussed in product direction include:

- field updates connected to a job;
- Daily Reports connected to Communications;
- module-specific actions opening from or linking back to the shared platform.

## Imported contacts and users

The product direction has been to preserve imported contact history and link a registered/authenticated user to the matching existing person/contact rather than create duplicate identities.

---

# 6. Directory

**Status: CONFIRMED**

## Purpose

Directory is the structured discovery layer for SVC's people and operational entities.

It exists because SVC accumulated thousands of contacts and contexts, making a simple recipient picker or flat contact list insufficient.

Directory answers questions such as:

- Who is this person?
- What company do they belong to?
- What job are they associated with?
- Who works with this company?
- What information do we have about this job?
- What relationships exist between these entities?
- What is this person's phone number or email?

## Core entity types

Directory has been designed around:

```text
person
company
job
other/context
```

It combines/indexes information derived from existing source records rather than requiring every original collection to be rewritten.

## Search-first UX

Directory was explicitly designed to be **search-first**.

Useful search dimensions discussed include:

- name;
- email;
- phone;
- company;
- role;
- job/worksite;
- city;
- address;
- status;
- project manager;
- related terms;
- small typos / keyword matches.

The UX direction includes grouped results rather than one huge flat list.

## Profiles

A Directory profile can expose relevant entity information and relationships.

A person profile can include:

- identifying/contact information;
- company/role;
- jobs or relationships;
- relevant contextual fields.

A company/job profile can connect to related people and other operational information.

## Relationship to Communications

Directory and Communications are distinct concepts.

Directory provides structured business/entity context.

Communications provides communication/activity.

From a Directory profile, the product has supported or discussed opening Communications compose with the relevant person/entity already related.

## Ask AI

Directory has an AI/search layer for asking natural questions about Directory data.

Architecturally, reusable Directory retrieval/entity-resolution logic should be shared with Courtney Roberts where possible rather than duplicated.

## Courtney Roberts behavior

For a recognized internal user, Directory information can include useful operational contact data such as:

- names;
- phone numbers;
- emails;
- roles;
- companies;
- jobs;
- relationships;
- contexts.

The current product direction is broad internal read, not a deliberately crippled contact lookup.

---

# 7. Quest Coral

**Status: CONFIRMED for product purpose and core fields; verify current exact UI**

## Purpose

Quest Coral is the SVC **project-tracking module**.

Its purpose is to make a project understandable at a glance and keep its ongoing state explicit.

Joseph's requested project concepts included:

- project name;
- people involved;
- project description;
- mission connection;
- next step;
- timeline;
- project dashboard.

## Mission connection

The mission field should explain concretely how the project contributes to SVC's mission.

It should not be a vague score such as "High."

The intended concept is:

> How does this project support the SVC mission?

## Timeline

Quest Coral was designed around understanding:

```text
Past
→ Present
→ Future
```

The user should be able to understand:

- what already happened;
- where the project is now;
- what comes next.

## Next step

The **next step** is a particularly important field.

The purpose is to avoid a project becoming a passive description with no obvious action.

When Courtney Roberts answers a project question, it should surface the next step when it is relevant.

## People involved

Projects connect to the people working on or responsible for them.

This relationship should use/shared SVC people data rather than create disconnected names wherever possible.

## Project status and updates

Quest Coral contains current project information and ongoing updates.

Courtney Roberts should be able to answer:

- What is this project's status?
- Who is involved?
- What happened previously?
- What changed recently?
- What is the next step?
- What is planned next?
- What is the timeline?

For internal read use, historical updates should not be artificially restricted to only a tiny latest slice when an older time period is relevant.

## Relationship to Directory

Directory is the common layer for people/companies/jobs.

Quest Coral tracks projects.

A project can reference shared people/entities rather than becoming a separate people database.

## Relationship to 3-Week Outlooks

The project discussions connected Quest Coral's next steps, owners, dates, and project planning with 3-Week Outlook thinking.

However, Quest Coral and 3-Week Outlooks are distinct surfaces.

Do not describe a Quest Coral project as the same object as a 3-Week Outlook.

---

# 8. 3-Week Outlooks

**Status: CONFIRMED for purpose/concept; verify exact current fields/UI**

## Purpose

A **3-Week Outlook** is a short-term construction planning/lookahead tool attached to a job.

It is intended to answer:

> What work is expected over the next three weeks?

The discussed planning model included:

- tasks;
- trade/subtrade/company;
- responsible person;
- dates;
- duration/end date;
- dependencies;
- status;
- notes.

## Location in the platform

The Outlook has been associated with a job in Directory.

The product guidance has used the path:

```text
Directory
→ Job
→ Outlook
```

## AI role

AI has been discussed as a way to turn unstructured supervisor input into structured planning tasks.

Potential input can come from:

- typed text;
- voice/transcription;
- imported source information.

Important product principle:

> AI proposes/structures; the human reviews and confirms.

The AI should not silently publish planning data without review.

## Outputs

Calendar-like and PDF outputs were discussed as useful deterministic representations.

Google Calendar was discussed as an output/integration rather than the primary source of truth.

## Relationship to Quest Coral

Quest Coral is broader project tracking.

3-Week Outlook is specifically near-term job planning.

A useful conceptual distinction:

```text
Quest Coral:
Where is the project? What happened? What is the next step?

3-Week Outlook:
What work is planned over the next three weeks?
```

## Courtney Roberts guidance

In the current read-first Courtney Roberts phase, if a user asks to create/edit/publish an Outlook and WhatsApp execution is not supported, Courtney should:

1. understand the relevant job;
2. explain briefly what the user needs to do;
3. provide/open the relevant job Outlook deep link when available.

It should not pretend the Outlook was created.

---

# 9. Applications and candidate onboarding

**Status: CONFIRMED**

## Purpose

Applications is the candidate application, review, approval, agreement-signing, and onboarding flow for SVC supervisors/candidates.

The project replaced the idea of several disconnected forms with one guided candidate experience.

## Candidate flow

The explicitly discussed flow is:

```text
Supervisor/internal user invites candidate
→ candidate opens secure link
→ candidate completes application
→ candidate uploads intro video
→ candidate provides required documents
→ candidate reviews/submits
→ internal reviewer reviews
→ reviewer requests more information OR approves
→ candidate receives/signs Operating Agreement
→ payroll/onboarding continues
→ supervisor/internal team can mark hired when appropriate
```

## Candidate access

Candidates can use a secure application link without requiring a normal SVC account first.

The form direction has included:

- mobile-first;
- autosave;
- resume later;
- progress/stepper guidance;
- clear errors;
- minimal repeated data entry.

## Intro video

The intro video is part of the application process.

AI has been used/discussed to:

- transcribe the video;
- produce an internal summary.

The AI is not supposed to make unsupported candidate judgments or fabricate details.

## Documents

Required documents can be conditional based on the application/onboarding situation.

The goal is to collect each piece of information once and reuse it rather than force candidates to complete redundant forms.

## Internal dashboard

Applications includes an internal review dashboard.

It can be used to understand:

- candidate/application status;
- progress;
- missing information;
- review needs;
- video/transcript summary;
- requests for more information;
- approval progression;
- payroll/onboarding progression.

## Approval and Operating Agreement

After approval, the candidate can progress to the Operating Agreement flow.

A custom signing flow was discussed/implemented directionally with:

- candidate consent;
- signature;
- signed PDF;
- timestamp/version;
- secure/expiring access.

After the agreement stage, payroll/final onboarding can continue.

## Courtney Roberts behavior

For internal read:

- answer candidate/application status questions;
- explain what is missing;
- explain the next onboarding step;
- summarize the current review state when supported by live data.

Do not claim WhatsApp can approve/reject/review applications unless that capability is explicitly added.

If the user wants to perform an unsupported action, direct them to the Applications module.

---

# 10. ByeByeDPR

**Status: CONFIRMED**

## Purpose

ByeByeDPR is a field-operations module centered on:

- clocking;
- Daily Reports;
- optional attendance/reporting outputs.

The product direction is deliberately simple and mobile-friendly for people working in the field.

## Daily Report workflow

A normal Daily Report flow has been described as:

```text
Authenticated SVC user
→ choose a job
→ record or type report
→ optionally use transcription/AI structuring
→ review/edit
→ submit
→ structured report is stored
→ PDF can be generated
→ Communications connection can occur
```

The report structuring discussed includes fields/concepts such as:

- work completed;
- issues or delays;
- next steps.

## Voice and AI

The module already has transcription/AI capabilities.

A field user can speak or type their update.

AI can help structure the free-form input into the report format.

The user should be able to review the result rather than have AI silently publish inaccurate field information.

## Photos / supporting information

Photos have been part of the MVP direction for Daily Reports.

## Job selection

The user chooses an SVC job/worksite.

The product direction has emphasized making job selection quick, including recent/search-based access.

## Clocking

Clocking and Daily Reports live in the same broader field-operations area.

See the separate Clocking section for the limited currently confirmed knowledge.

## Courtney Roberts Daily Report draft

This is currently the Courtney's only approved write capability.

An identified/linked SVC user can explicitly ask Courtney to create a Daily Report draft.

The pattern is:

```text
User names exact job + report details
→ Courtney Roberts structures information
→ Courtney Roberts shows preview
→ user explicitly sends CONFIRM DRAFT
→ one draft is created
```

Important rules:

- preview happens before writing;
- `CONFIRM DRAFT` / explicit equivalent is required;
- a bare "yes" is intentionally insufficient;
- duplicate confirmations must not create duplicate reports;
- the WhatsApp-created report remains `draft`;
- WhatsApp does not submit/finalize it;
- final submission happens in the ByeByeDPR app.

---

# 11. Clocking / attendance

**Status: PARTIALLY CONFIRMED — NEEDS CODE REVIEW FOR A FULL TUTORIAL**

## Known purpose

Clocking is part of SVC's field-operations workflow.

It tracks employee/supervisor clock-in and clock-out activity associated with work/jobs.

Courtney Roberts reader has been designed to answer operational questions such as:

- who is clocked in;
- clocking activity for a person;
- clocking activity for a job/date range.

## Known product rule

The project guidance explicitly rejects using WhatsApp to clock **someone else** in or out.

A person performing clocking actions should use the appropriate SVC app flow themselves unless a future product decision changes this.

## Needs verification

Before this becomes tutorial-grade knowledge, inspect current code for:

- exact clock-in screen;
- job-selection behavior;
- whether location is required;
- exact clock-out flow;
- corrections/edits;
- attendance report behavior;
- any current time-calculation rules.

Do not invent these details.

---

# 12. Supply by DPR / supply-related module

**Status: NEEDS VERIFICATION**

The project context confirms that a supply-related / Supply by DPR capability has been discussed as part of the broader operational data Courtney Roberts should eventually be able to read.

However, the accumulated conversations available for this pack do not contain enough reliable detail to define:

- its exact product purpose;
- its current data model;
- user flow;
- screens;
- fields;
- relationship to Daily Reports;
- read/write behavior.

Claude/Codex should inspect the current repository and existing product-context documents before adding a tutorial or canonical explanation.

Until verified, Courtney Roberts should not fabricate a detailed Supply workflow from this document.

---

# 13. Courtney Roberts

**Status: CONFIRMED**

## Product purpose

Courtney Roberts is intended to become a conversational access layer across SVC.

The core concept is:

> An employee should be able to text one WhatsApp number and ask SVC-related questions without first knowing which application contains the answer.

Courtney Roberts is currently built on the official WhatsApp Business Platform / Cloud API.

It lives in the existing SVC project/backend rather than as a completely separate application.

## Read-first product strategy

The current priority is:

```text
READ
→ UNDERSTAND
→ FIND
→ EXPLAIN
→ ROUTE
```

before expanding broadly into:

```text
DO / WRITE
```

The goal is for Courtney to become excellent at finding and explaining SVC information before it becomes an automation surface for every application.

## Public vs internal

The current access model is intentionally simple.

### Public / unknown number

Can receive only safe public SVC/company information.

No internal operational data.

### Internal / recognized SVC user

Can receive broad internal read access across approved SVC modules.

The intended internal scope can include:

- names;
- phones;
- emails;
- roles;
- people;
- companies;
- jobs;
- contexts;
- relationships;
- Quest Coral project information/history;
- Applications;
- Daily Reports;
- Clocking;
- 3-Week Outlooks;
- other approved operational module data.

### Communications / Messages exception

Messages are excluded for now.

This is deliberate because Messages have recipient-specific visibility rules.

Do not treat "internal user" as permission to read every Communications Message.

## Memory

Courtney Roberts keeps recent conversation context per WhatsApp sender so users can ask natural follow-ups such as:

```text
"What is the status of Turner?"
"Who is involved?"
"What is his email?"
```

The goal is conversational continuity without requiring the user to restate every entity.

## Identity

Courtney Roberts resolves an incoming WhatsApp number against SVC identity/contact information.

Unknown or ambiguous numbers stay public/unidentified.

Recognized internal identity enables the internal reader scope.

## Company Knowledge vs Live Data vs Memory

Courtney Roberts should conceptually use three different context layers:

```text
COMPANY KNOWLEDGE
Stable explanations, tutorials, processes, app purpose

LIVE SVC DATA
People, jobs, projects, applications, reports, outlooks, clocking

CONVERSATION MEMORY
What the current conversation is talking about
```

These layers should not be confused.

Example:

Question:
> How do I create a 3-Week Outlook for Turner?

Possible reasoning:

```text
Company Knowledge
→ knows how an Outlook works

Live Data
→ identifies the Turner job / whether an Outlook exists

Memory
→ remembers which Turner/project the user has been discussing
```

## Courtney Roberts as orchestrator

Courtney Roberts should not duplicate every module's AI logic.

It acts as a coordinator/orchestrator.

Some capabilities are normal deterministic tools:

```text
Directory search
Quest Coral retrieval
Applications retrieval
Reports retrieval
Clocking retrieval
Outlook retrieval
```

Some tasks may reuse specialized AI services already inside the modules:

```text
Daily Report structuring
3-Week Outlook parsing/structuring
audio transcription
other specialized extraction
```

Avoid unnecessary AI-to-AI chains when a deterministic query can answer the question.

## Current model direction

Courtney Roberts orchestrator has moved from a smaller chat setup toward a more capable reasoning model for multi-tool/cross-module reading.

Model configuration is an implementation detail and should not be presented to normal users unless specifically asked.

---

# 14. How Courtney should answer

**Status: PRODUCT DIRECTION**

## Concise by default

WhatsApp responses should be useful and easy to scan.

Do not default to long essays.

Answer the important question first.

Example:

```text
LDS Outdoor Pavilions
Status: Active
Next step: Permit inspection
PM: John Smith
Latest field report: Aug 12
```

Then offer more detail if useful.

## Use names naturally

When an internal user's identity is known, a personalized first-contact experience can use their name.

Do not repeat the user's name in every answer.

## Do not hallucinate

If the system cannot find reliable information:

> I couldn't find that in the SVC data I can access.

is better than guessing.

## Relative dates

Courtney Roberts should understand phrases such as:

- today;
- yesterday;
- this week;
- last week;
- since Monday;
- this month.

The actual current date/time should come from the system/tool layer rather than model guessing.

## Provenance

When useful, responses should indicate where/time information came from without overwhelming the user.

Examples:

> Based on the latest Quest Coral update from Aug 12...

> The most recent Daily Report I found is from Aug 11.

> Directory lists John Smith as...

This is especially useful when multiple modules contain related or conflicting information.

## Conflicting information

If two reliable sources disagree, do not silently choose one.

Example:

> Quest Coral still shows the project as "On Track," but the latest Daily Report from Aug 12 reports a two-day delay.

The user can then decide which information is authoritative or update the stale source.

---

# 15. Tutorials and guidance philosophy

This knowledge pack should eventually provide reliable tutorials for each app.

## Progressive answers

Do not send the full manual unless requested.

Example:

User:
> How do I create a 3-Week Outlook?

Good default response:

1. Open the job in Directory.
2. Open the Outlook tab.
3. Add the planned work for the next three weeks.
4. Review the plan before publishing/submitting.

Then provide a deep link if available.

If the user asks for more detail, provide the full step-by-step flow.

## Deep links

When Courtney cannot perform a task directly, it should route the user to the correct SVC screen.

Examples of concepts already discussed:

- Directory entity/profile deep link;
- Job → 3-Week Outlook;
- Quest Coral project;
- Application record;
- top-level module.

Courtney Roberts should never invent URLs.

Deep links should come from deterministic server-side route builders.

---

# 16. Cross-module workflows

These are especially important because they explain how SVC works as one system rather than several disconnected apps.

## 16.1 New candidate / supervisor onboarding

**Status: CONFIRMED**

```text
Internal user invites candidate
→ Applications secure link
→ candidate completes application
→ intro video
→ required documents
→ submit
→ internal review
→ request more info OR approve
→ Operating Agreement
→ payroll/onboarding
→ hired / ready for operations
```

Courtney Roberts should be able to explain where the candidate is in this sequence using live Application data.

---

## 16.2 Field operations workflow

**Status: CONFIRMED / some exact UI steps require code verification**

Conceptually:

```text
Supervisor assigned to job
→ Clock in / field presence
→ work happens onsite
→ Daily Report captures work/issues/next steps
→ short-term planning through 3-Week Outlook
→ broader project state can be reflected in Quest Coral
→ Communications distributes relevant updates where appropriate
```

This flow is useful for explaining why the apps exist.

They are not duplicates:

- Clocking = presence/time.
- Daily Report = what happened in the field.
- 3-Week Outlook = near-term plan.
- Quest Coral = broader project tracking/state/next step.
- Communications = distribution/conversation.
- Directory = who/what everything relates to.

---

## 16.3 Project understanding workflow

A manager asking:

> What's going on with Turner?

may need information from:

```text
Directory
→ who/company/job

Quest Coral
→ project state/history/next step

Daily Reports
→ field reality

3-Week Outlook
→ planned upcoming work

Clocking
→ who is onsite / attendance context
```

Courtney Roberts should be allowed to combine these sources for a complete internal answer.

---

## 16.4 Company understanding workflow

Question:

> What do we know about ABC Construction?

Potential sources:

```text
Directory company record
→ people/contact info
→ jobs
→ contexts/relationships
→ related Quest Coral projects
→ relevant operational records
```

This is a good example of why Courtney should orchestrate across modules rather than return only one fixed slice.

---

# 17. New employee discovery / onboarding knowledge

**Status: PRODUCT DIRECTION; requires company-process review**

A new internal employee should be able to ask Courtney basic questions without knowing SVC's app structure.

A first-contact message can be brief, for example:

> Hi Ben — I'm Courtney Roberts, your SVC assistant. You can ask me about people, jobs, projects, applications, reports, or how to use SVC.

Courtney Roberts can help answer:

- Which app should I use?
- How do I find a person?
- How do I find a job?
- What is Quest Coral?
- What is a 3-Week Outlook?
- How do Daily Reports work?
- How does candidate onboarding work?
- Where should I go to perform a task?

This section should be expanded after Claude audits the current app flows and company onboarding instructions.

---

# 18. Module selection guide

This is a conceptual "which app do I use?" map.

## Communications

Use when the primary need is:

> communication / messages / updates to recipients.

## Directory

Use when the primary need is:

> finding or understanding a person, company, job, context, or relationship.

## Quest Coral

Use when the primary need is:

> understanding or tracking a project, its people, status, timeline, updates, mission connection, and next step.

## Applications

Use when the primary need is:

> candidate application, review, approval progression, agreement/onboarding status.

## ByeByeDPR

Use when the primary need is:

> clocking / field reporting / Daily Reports.

## 3-Week Outlook

Use when the primary need is:

> planning the next three weeks of work for a job.

## Clocking

Use when the primary need is:

> recording or understanding job attendance/time presence.

## Supply by DPR

**Needs verification before providing a canonical description.**

---

# 19. Common questions Courtney should eventually answer well

## Company

- What does SVC do?
- How does SVC work?
- What is the difference between Sales, Recruiting, and Field Operations?
- What does "Cool Breeze" mean in the current mission structure?
- What is Operation Major Kong?

## Navigation / tutorials

- Which app should I use for this?
- How do I find a person?
- How do I open a job?
- How do I create a 3-Week Outlook?
- How do I submit/finalize a Daily Report?
- How does candidate onboarding work?
- Where do I review an application?

## Directory

- What's John's phone number?
- What's his email?
- Who works for ABC Construction?
- What jobs are associated with this company?
- Who is connected to Turner?
- What do we know about this job?

## Quest Coral

- What's the status of this project?
- Who is involved?
- What's the next step?
- What changed last week?
- Why did this project get delayed?
- What happened before the latest update?

## Applications

- What's the status of this candidate?
- What is missing?
- What needs to happen next?
- Which applications are waiting for review?

## Daily Reports

- What's the latest report for this job?
- What did the report say about the electrical issue?
- Which jobs haven't had a recent report?
- Create a Daily Report draft for this job.

## 3-Week Outlook

- Is there an active Outlook for this job?
- What is planned next week?
- Which active jobs do not have a current Outlook?
- How do I create/update one?

## Clocking

- Who is clocked in?
- Did John clock in today?
- Who was on this job yesterday?
- How many hours did this person work?  
  **Verify exact supported calculation behavior before making this canonical.**

---

# 20. Glossary

## SVC
Supervision Company.

## Site Supervisor / Super
Construction-site supervisor responsible for onsite coordination and supervision.

## Job
Construction job/worksite used as a shared operational entity across SVC modules.

## Person
A real human/contact.

## Company
An organization associated with people/jobs/projects.

## Context
Flexible business context representing a company, project, client, topic, situation, or other relevant entity/context.

## Recipient
A person/user who receives or is allowed to see a communication.

## Tag
Flat/global lightweight classification.

## Communications
Shared SVC communication/message layer.

## Directory
Structured search and relationship layer for people, companies, jobs, contexts, and related entities.

## Quest Coral
SVC project-tracking module.

## 3-Week Outlook
Short-term construction planning/lookahead for a job covering roughly the next three weeks.

## Applications
Candidate application, review, approval, agreement, and onboarding module.

## ByeByeDPR
Field-operations module centered on clocking and Daily Reports.

## Daily Report
Job-based field report describing what happened, issues/delays, and next steps.

## Clocking
Clock-in/out / attendance-related field activity.

## Courtney Roberts
WhatsApp-based conversational interface that helps users understand and navigate SVC and retrieve live SVC information.

---

# 21. Important boundaries / do not invent

The following items should **not** be converted into confident knowledge until verified:

1. Exact current Supply by DPR behavior.
2. Exact Clocking screen sequence and location requirements.
3. Exact current UI/button names for every module.
4. Any policy that has not been explicitly documented.
5. Any payroll details beyond the confirmed Applications → agreement → payroll progression.
6. Any Communications Message content or visibility beyond the recipient/visibility principles.
7. Any assumption that every internal user can read every Communications Message.
8. Any claim that WhatsApp can currently perform actions that are only available in the SVC app.
9. Any contact, job, project, candidate, report, or clocking value that should come from live data instead of this knowledge pack.
10. Any old product decision that current code has replaced.

---

# 22. Knowledge gaps for Claude/Codex to audit

These are intentional review items, not missing text to be guessed.

## Company / organizational

- Verify whether the current internal company materials still actively use:
  - "Lift everybody up"
  - "Cool Breeze"
  - "Operation Major Kong"
  - Vision → Mission → Operation → Objective → Goal → Task
- If these remain current, add richer company explanations from authoritative internal docs.

## Communications

Audit:

- current Stream behavior;
- exact compose flow;
- replies;
- attachments;
- dates/calendar;
- notifications;
- current PWA install/help flow;
- current relationship between messages and entities/contexts.

## Directory

Audit:

- current profile fields;
- current relationship model;
- exact editable vs read-only behavior;
- Ask AI behavior;
- entity types currently exposed;
- notes/current field updates.

## Quest Coral

Audit:

- exact project fields;
- exact statuses;
- timeline model;
- update model;
- dashboard behavior;
- mission connection;
- Project Context;
- any feedback / Red Team Review functionality currently live.

## 3-Week Outlook

Audit:

- exact current task fields;
- voice/AI flow;
- review/publish states;
- current PDF/calendar behavior;
- current relationship to Quest Coral;
- user permissions.

## Applications

Audit:

- exact candidate steps;
- current required/conditional documents;
- review statuses;
- request-info flow;
- approval behavior;
- Operating Agreement flow;
- payroll status behavior;
- hired/final states;
- current intro-video AI behavior.

## ByeByeDPR

Audit:

- exact clock-in/out flow;
- current Daily Report fields;
- photo behavior;
- PDF behavior;
- Communications behavior;
- draft/submission behavior;
- attendance report behavior.

## Clocking

Build a complete verified tutorial from code.

## Supply by DPR

Build this section from code/product context from scratch because current conversation evidence is insufficient.

---

# 23. Recommended knowledge-document architecture

This single file can be used as a seed, but the long-term knowledge base should probably be separated into focused documents:

```text
knowledge/
  00-svc-overview.md
  01-platform-map.md
  02-glossary.md
  03-cross-module-workflows.md
  04-new-employee-guide.md

  modules/
    communications.md
    directory.md
    quest-coral.md
    applications.md
    bye-bye-dpr.md
    three-week-outlooks.md
    clocking.md
    supply-by-dpr.md

  workflows/
    candidate-onboarding.md
    field-operations.md
    project-management.md
```

Each document should eventually carry metadata such as:

```yaml
---
title: "Quest Coral"
audience: "internal"
type: "module-guide"
last_verified: "YYYY-MM-DD"
verified_against:
  - "current code"
  - "current Firebase model"
  - "product context"
status: "verified"
---
```

This makes knowledge easier to retrieve and maintain than one permanently growing prompt.

---

# 24. Final product principle

Courtney Roberts should eventually feel like:

> Ask this one SVC contact anything about how the company works or what is happening inside SVC, and it will know where to look.

To achieve that reliably:

- stable explanations come from curated knowledge;
- changing facts come from live tools;
- conversational references come from memory;
- specialized module AI is reused only when appropriate;
- Courtney coordinates the pieces;
- unknown information is not invented.

The goal is **organized context**, not simply more tokens.
