---
title: "SVC Company, Mission & Operating Framework Knowledge"
audience: "internal"
language: "en"
status: "company-context / source-grounded"
last_updated: "2026-08-14"
purpose: >
  Stable company-level context for Courtney Roberts: what SVC does,
  how SVC organizes work, the Vision/Mission/Operation framework,
  Cool Breeze, Operation Major Kong, the Adventure Map, and related
  internal operating terminology.
recommended_parent:
  - "SVC_AI_Secretary_Canonical_Knowledge_Pack.md"
---

# SVC Company, Mission & Operating Framework Knowledge

# 0. Purpose

This document complements the technical/product Canonical Knowledge Pack.

The Canonical Pack explains **how the SVC software works**.

This document explains more of **what SVC is, how SVC thinks about work, and the internal operating framework behind the company**.

Courtney Roberts should use this knowledge when answering questions such as:

- What does SVC do?
- What is site supervision?
- What is a Site Supervisor?
- What is SVC's Vision?
- What is a Mission at SVC?
- What is an Operation?
- What is the difference between an Objective, Goal, Task, and Action?
- What is Cool Breeze?
- What is Operation Major Kong?
- How does Major Kong fit inside Cool Breeze?
- What does "Cool Breeze Ready" mean?
- Why does SVC build technology around site supervisors?
- What should someone understand before joining SVC?
- Where can I learn the SVC operating framework?

This is **stable company/context knowledge**, not a source for live operational facts.

Current people, jobs, project status, reports, clock-ins, applications, messages, and outlooks must still come from live SVC tools.

---

# 1. Reliability model

Use the following source labels.

## COMPANY-SOURCE CONFIRMED

Directly provided in SVC internal materials, presentations, or instructions from Joseph.

This information does not need to exist in application source code to be valid company knowledge.

## PRODUCT / CODE CONFIRMED

Directly supported by the current SVC application implementation.

Technical behavior belongs primarily in the main Canonical Knowledge Pack.

## HISTORICAL / TIME-SENSITIVE

A real statement from SVC material that was tied to a specific period, plan, company size, target, or forecast.

It may be useful for understanding company history or strategy but should not automatically be presented as current.

## NEEDS CLARIFICATION

The source contains the information, but its exact meaning is not fully defined.

Do not invent the missing interpretation.

---

# 2. What SVC is

**Status: COMPANY-SOURCE CONFIRMED**

SVC stands for **Supervision Company**.

SVC describes itself as a company focused on **onsite construction management / site supervision**.

The company was created around the idea that modern construction sites have become increasingly complex while the Site Supervisor remains the central person responsible for coordinating what happens onsite.

SVC combines:

- human capital;
- recruiting;
- site-supervisor placement;
- field support;
- management and oversight;
- training;
- technology and internal systems.

Its service model is designed to help general contractors and construction organizations find, place, support, and manage effective Site Supervisors.

SVC's own material describes the company as operating at the intersection of **human capital and technology**.

---

# 3. Site Supervision and the Site Supervisor

**Status: COMPANY-SOURCE CONFIRMED**

## Site Supervision

SVC defines **Site Supervision** as the commercial-construction management and coordination of onsite construction activity.

Construction involves many different parties:

- subcontractors;
- project managers;
- architects;
- engineers;
- inspectors;
- suppliers;
- owners/clients;
- other professional entities.

The Site Supervisor operates at the center of this activity.

## Site Supervisor

A **Site Supervisor / Site Super / Super** is the staff role inside a general contracting organization responsible for onsite construction activities.

SVC's company material frames the Site Supervisor as the practical connection between the office/planning side of construction and what actually happens in the field.

A recurring SVC concept is:

> **from suits to boots**

or:

> **from 1D to 3D**

The idea is that plans, contracts, schedules, drawings, and decisions begin as information, while the Site Supervisor helps coordinate the real-world execution that turns those plans into a finished physical project.

Courtney Roberts can use this concept to explain the role, but should avoid repeating the deliberately colorful/informal wording from old presentation material unless it is appropriate for the conversation.

---

# 4. SVC's service philosophy

**Status: COMPANY-SOURCE CONFIRMED**

SVC is not positioned only as a recruiting company and not only as software.

Its internal company material describes a broader service covering the lifecycle of site supervision, including:

- identifying supervisors;
- recruiting;
- vetting;
- placing;
- training;
- managing;
- supporting;
- supervisor accountability;
- replacement when needed;
- field troubleshooting;
- job-site diplomacy and support;
- billing/invoicing support;
- workforce development.

A central value proposition is to create additional **bandwidth** for clients by handling supervisor-related problems and support needs so that the client does not have to solve everything with its own internal resources.

---

# 5. Provide and Guide

**Status: COMPANY-SOURCE CONFIRMED**

A useful SVC principle is:

# PROVIDE AND GUIDE

SVC's internal technology and systems are intended to help **provide, guide, and support Site Supervisors**.

The technology is not intended to replace the supervisor.

It is meant to make field supervision easier to scale and easier to support.

This is useful context for understanding why SVC builds tools for:

- communication;
- job/person/company discovery;
- reporting;
- near-term planning;
- project tracking;
- onboarding;
- field clocking;
- operational history;
- AI assistance.

The software ecosystem should reduce friction and make useful information easier to access while allowing Site Supervisors to spend more time focused on the field.

---

# 6. SVC technology philosophy

**Status: COMPANY-SOURCE CONFIRMED**

SVC's internal materials describe the platform as being designed around the **operational / field side** of construction.

A recurring contrast is:

- **Suits** — office-side functions such as planning, purchasing, project management, contracts, and administration.
- **Boots** — the onsite operational reality of construction.

SVC's technology philosophy emphasizes:

- tools designed specifically around Site Supervisors;
- simple and user-friendly interfaces;
- "just enough information";
- easily accessible information;
- on-the-fly updates;
- reporting;
- tracking;
- reducing administrative friction;
- keeping people in the field rather than behind a desk.

This philosophy helps explain why SVC's applications are being developed as a connected operating system rather than isolated software products.

---

# 7. The SVC Adventure Map

**Status: COMPANY-SOURCE CONFIRMED**

SVC has an interactive **Adventure Map**:

https://svc-app.vercel.app/

Its purpose is to teach the SVC operating framework in a short, visual format.

The current landing experience identifies it as the **SVC Adventure Map**, uses the phrase:

> **Lift everybody up**

and presents it as a way to:

> **Learn the SVC framework in 5 minutes**

When someone asks for a tutorial on SVC's Vision / Mission / Operation / Objective / Goal / Task methodology, Courtney Roberts can:

1. explain the framework briefly;
2. answer specific questions;
3. offer the Adventure Map as the dedicated interactive tutorial.

The Adventure Map should be treated as a company-training resource, not as live operational data.

---

# 8. How SVC organizes effort

**Status: COMPANY-SOURCE CONFIRMED**

One of the core things someone joining SVC should understand is the hierarchy used to organize effort.

The general structure is:

```text
VISION
  ↓
MISSION
  ↓
OPERATION
  ↓
OBJECTIVES
  ↓
GOALS
  ↓
TASKS
  ↓
ACTIONS
```

An **Operation** groups related Objectives under a Mission, so it is conceptually a coordination layer rather than simply another time scale.

Another useful representation is:

```text
VISION
 └── MISSION
      ├── OPERATION
      │    ├── OBJECTIVE
      │    │    ├── GOAL
      │    │    │    ├── TASK
      │    │    │    │    └── ACTION
      │    │    │    └── TASK
      │    │    └── GOAL
      │    └── OBJECTIVE
      └── other future Operations / Objectives
```

---

# 9. Vision

**Status: COMPANY-SOURCE CONFIRMED**

## Definition

The **Vision** is the broad, ongoing direction.

It is not intended to be completed on the same short time horizon as an Objective or Goal.

Joseph's materials describe Vision as:

> **ongoing**

## SVC Vision

The SVC Adventure Map uses:

> **Lift everybody up**

as the top-level vision language.

Courtney Roberts should understand this as company-level context and can explain it when asked about the company's Vision or operating philosophy.

Do not invent a more detailed definition of "Lift everybody up" unless additional authoritative SVC material provides one.

---

# 10. Mission

**Status: COMPANY-SOURCE CONFIRMED**

## Definition

A **Mission** is a major outcome pursued over a substantially longer horizon than an Objective or Goal.

Internal SVC materials describe the approximate Mission horizon in slightly different ways:

- roughly **6–24 months or ongoing** in one Adventure Map presentation;
- roughly **12–18 months** in Joseph's later onboarding notes.

Treat these as planning heuristics, not strict mathematical deadlines.

The important concept is:

> A Mission is a large strategic outcome that contains Objectives and can contain one or more Operations.

---

# 11. Operation

**Status: COMPANY-SOURCE CONFIRMED**

An **Operation** is a coordinated group of work inside a Mission.

Joseph described it as:

> **a series of related objectives under a mission**

Another SVC internal presentation defines an Operation as the:

> tasks and goals required to obtain a set of related objectives.

Taken together, the useful interpretation is:

**An Operation coordinates a related set of Objectives, Goals, and Tasks that collectively advance a Mission.**

An Operation is therefore not simply another smaller item beneath Objective.

It is a way of grouping and coordinating related work.

---

# 12. Objective

**Status: COMPANY-SOURCE CONFIRMED**

An **Objective** is a meaningful outcome below the Mission / Operation level.

Planning heuristic:

> approximately **one month**

An Objective should represent an outcome to achieve, not merely an isolated action.

Objectives break into Goals.

---

# 13. Goal

**Status: COMPANY-SOURCE CONFIRMED**

A **Goal** is a shorter-term result that contributes to an Objective.

Planning heuristic:

> approximately **one week**

Goals break into Tasks.

---

# 14. Task

**Status: COMPANY-SOURCE CONFIRMED**

A **Task** is a concrete unit of work that advances a Goal.

Planning heuristic:

> approximately **a few hours / a couple of hours**

Tasks should be small enough to execute directly.

---

# 15. Action

**Status: COMPANY-SOURCE CONFIRMED FROM JOSEPH'S ONBOARDING NOTES**

An **Action** is the smallest immediate execution unit in the hierarchy.

Planning heuristic:

> **minutes**

Actions are the concrete steps used to perform a Task.

---

# 16. Time-scale summary

These durations are heuristics used to help people think at the correct level.

They are not hard limits.

| Level | Typical horizon |
|---|---|
| Vision | Ongoing |
| Mission | Roughly 6–24 months / commonly framed as 12–18 months |
| Operation | Spans the related Objectives required by the Mission |
| Objective | Roughly 1 month |
| Goal | Roughly 1 week |
| Task | A few hours |
| Action | Minutes |

When explaining the framework, emphasize the **difference in level and scope**, not only the time durations.

---

# 17. Current / historical Mission: COOL BREEZE

**Status: COMPANY-SOURCE CONFIRMED; CURRENTNESS SHOULD BE TREATED CAREFULLY**

SVC internal strategy material explicitly names:

# MISSION: COOL BREEZE

One Adventure Map presentation connects **Cool Breeze** to a target of:

> **$100 Million in 18 months**

This should be treated as a real SVC strategic Mission from the provided internal materials.

However, because the source is tied to a particular planning period, Courtney Roberts should distinguish:

- **"What is/was Cool Breeze?"** → can be answered from this knowledge.
- **"Is Cool Breeze still the active Mission today?"** → current status should be verified rather than assumed from an older strategy document.

Do not discard Cool Breeze simply because it is not represented in application source code.

It is company/organizational knowledge.

---

# 18. Cool Breeze Ready

**Status: COMPANY-SOURCE CONFIRMED**

Internal SVC material defines:

> **COOL BREEZE READY = Prepared to consistently increase output on an average of 20% each month**

The framework applies this readiness concept across:

- Sales;
- Preconstruction;
- Field Operations.

This is useful internal terminology.

If asked what "Cool Breeze Ready" means, Courtney Roberts can provide this definition while noting that it comes from the Cool Breeze strategy framework.

---

# 19. Operation Major Kong

**Status: COMPANY-SOURCE CONFIRMED; CURRENTNESS SHOULD BE VERIFIED WHEN RELEVANT**

Internal SVC materials explicitly identify:

# OPERATION: MAJOR KONG

Major Kong sits **inside Mission Cool Breeze**.

The Adventure Map visually presents Major Kong as an Operation grouping related Objectives that advance the Cool Breeze Mission.

A planning document for Major Kong includes work across:

- Sales;
- Preconstruction;
- Field Operations.

It also includes shared areas such as:

- output evaluation processes, systems, and people;
- forecasting process and systems;
- wiki/video library;
- training;
- system/process improvement.

Courtney Roberts should understand the relationship as:

```text
VISION
  ↓
MISSION: COOL BREEZE
  ↓
OPERATION: MAJOR KONG
  ↓
RELATED OBJECTIVES
  ↓
GOALS
  ↓
TASKS
```

If asked whether Major Kong is **currently active today**, Courtney should verify current company information if available rather than relying only on historical planning material.

---

# 20. Major Kong — example objective structure

**Status: HISTORICAL / COMPANY-SOURCE CONFIRMED**

One internal planning document lists Major Kong work beginning with:

## Objective #1 — Sales Mission Ready

Example January Sales goals included:

- 4 reps operating;
- Sales onboarding system improvements;
- Sales Managers understood & underway;
- Train & Gain.

## Common Sales / Preconstruction / Field Ops goals

Examples included:

- output evaluation process, systems, and people;
- forecasting process and systems;
- wiki/video library;
- Adventure Map video;
- systems/process/people training content.

The same document also names:

- Objective #2 — Preconstruction Goals;
- Objective #3 — Field Operations Goals.

These are useful examples of how SVC applies the hierarchy.

They should not automatically be presented as the current month's active Objectives.

---

# 21. Sales / job progression framework

**Status: COMPANY-SOURCE CONFIRMED; EXACT AXIS SEMANTICS NEED CLARIFICATION**

Joseph supplied the following progression model.

Original framing:

```text
X,Y axis: dependent requirements
Z Axis: good things to do
```

The exact interpretation of the numeric scale and axes is not fully specified in the available source.

Preserve the structure without inventing what the numbers mathematically represent.

| Value | Milestone / note |
|---:|---|
| 22.5 | Lead acquired |
| 45 | Rapport established |
| 67.5 | — |
| 90 | Job mentioned |
| 112.5 | — |
| 135 | — |
| 157.5 | — |
| 180 | Start date confirmed |
| 202.5 | — |
| 225 | Boots and Billing -10 days |
| 247.5 | — |
| 270 | Billing Starts / Super and Rate Accepted |
| 292.5 | — |
| 315 | Keys |
| 337.5 | Review |
| 360 | Final Check Cleared |

## Courtney Roberts behavior

Courtney Roberts may:

- repeat the milestone framework;
- explain the milestone names;
- identify where a named stage sits in the sequence;
- explain that some points are currently blank in the provided framework.

Courtney Roberts should **not** invent:

- what degrees/numbers technically represent;
- formulas for X/Y/Z axes;
- missing milestones;
- automation rules based on this model.

Until clarified, those parts are `NEEDS CLARIFICATION`.

---

# 22. Company history and scale — historical context only

**Status: HISTORICAL / TIME-SENSITIVE**

SVC presentation material contains historical company figures and forecasts, including:

- founding / development-stage timelines;
- team-size figures;
- supervisor-network size;
- jobs-running counts;
- revenue projections;
- a goal of $100M yearly revenue.

These can be useful when someone asks about the history of SVC or the origin of its strategy.

They should **not** be presented as current 2026 facts without live/current verification.

A reliable Courtney Roberts should distinguish:

> "SVC's internal 2024 presentation said..."

from:

> "SVC currently has..."

---

# 23. Why this context matters to Courtney Roberts

This company framework gives Courtney Roberts information that cannot be discovered by reading React components or Firestore collections.

It allows Courtney to answer the **why**, not only the **what**.

Examples:

## "What does SVC do?"

Use the company/service knowledge.

## "What's a Site Super?"

Use the Site Supervision definition.

## "Why does SVC build all these apps?"

Explain Provide and Guide, the field/boots focus, and the connected support model.

## "What's the difference between a Mission and Objective?"

Use the hierarchy.

## "What's Major Kong?"

Explain that it is an Operation under Cool Breeze and how Operations group related Objectives.

## "What should I know before joining SVC?"

Give a short orientation:

1. SVC manages/supports onsite construction supervision.
2. Understand the Vision → Mission → Operation → Objective → Goal → Task → Action framework.
3. Understand the current/historical strategic language relevant to the employee.
4. Learn how the SVC applications support actual execution.

## "Can you teach me the SVC framework?"

Give a short explanation, then offer the Adventure Map:

https://svc-app.vercel.app/

---

# 24. Relationship to the software knowledge

Courtney Roberts should combine this document with the main Canonical Knowledge Pack.

Example:

> "I was given a Goal for Major Kong. Where should I track it?"

This may require:

1. this document to understand **Goal** and **Major Kong**;
2. product knowledge to understand what Quest Coral or other SVC tools do;
3. live data to see whether a related current project already exists.

Company Knowledge tells Courtney **what the organizational concepts mean**.

Product Knowledge tells it **how SVC software works**.

Live Data tells it **what is currently happening**.

Conversation Memory tells it **what the user is currently referring to**.

---

# 25. Recommended answer style

When explaining this methodology:

- start with the simple answer;
- use the exact SVC terminology;
- give the hierarchy visually if useful;
- do not turn every answer into a long strategy lesson;
- offer the Adventure Map for users who want the complete walkthrough;
- distinguish historical Missions/Operations from current live status;
- do not invent missing company doctrine.

Example:

> **An Objective is roughly a month-level outcome. A Goal is the shorter, usually week-level result underneath it, and Tasks are the few-hour pieces of work that achieve the Goal.**
>
> At SVC these sit inside the broader Vision → Mission → Operation framework. If you want, the SVC Adventure Map walks through the full framework in about five minutes.

---

# 26. Source and freshness notes

Primary company-context sources for this document:

1. Joseph's direct onboarding/framework notes supplied to the SVC project.
2. `Kong & Finn.pdf` — internal SVC Adventure Map / Mission Cool Breeze / Operation Major Kong strategy material.
3. `Supervision Company Presentation_internal sourcing and notes deck.pdf` — SVC company, service, market, technology, and site-supervision presentation.
4. SVC Adventure Map — https://svc-app.vercel.app/

Source roles:

- The presentations and Joseph's notes are authoritative for the **company concepts they explicitly define**.
- They are **not automatically authoritative for current numbers, active status, staffing, or forecasts**.
- Current application behavior remains governed by the technical Canonical Knowledge Pack and live system.
- Current operational facts remain governed by live-data tools.

---

# 27. Core summary for Courtney Roberts

At a high level:

> **SVC (Supervision Company) provides and supports onsite construction management through Site Supervisors, combining human capital, operational support, and technology.**

SVC organizes effort using:

> **Vision → Mission → Operation → Objective → Goal → Task → Action**

with approximate levels:

> **ongoing → months → coordinated objectives → month → week → hours → minutes**

SVC's internal strategy material identifies:

> **Vision language: Lift everybody up**

> **Mission: Cool Breeze**

> **Operation: Major Kong**

The Adventure Map exists to teach this framework visually:

> https://svc-app.vercel.app/

Courtney Roberts should understand these concepts deeply enough to explain them, relate them to SVC's software and workflows, and distinguish stable company methodology from time-sensitive operational status.
