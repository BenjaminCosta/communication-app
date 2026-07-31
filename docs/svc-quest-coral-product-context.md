# SVC Quest Coral — product context

_Updated: 2026-07-31. This document explains Quest Coral for Joseph and the team; it is not technical documentation._

## One-sentence summary

**Quest Coral** is SVC’s project tracker for viewing progress, people involved, next steps, blockers, feedback, and critical reviews in one place.

## Problem it solves

Project status, risks, and decisions can be scattered across meetings, chats, and spreadsheets. Quest Coral provides a shared portfolio view and a history of signals for each project.

It answers: **“Which projects need attention today, what is blocking them, who is involved, and what happens next?”**

## Who uses it

- Project owners, who create and maintain the state of their initiatives.
- Contributors, who add progress, feedback, blockers, or critical reviews.
- Leadership, who reviews the portfolio, identifies risks, and prioritizes intervention.

It is a team tracker, not a private tool for each owner. Current access decisions favor internal collaboration over fine-grained project segmentation.

## How it works

Each project has an owner, involved people, a description, a status, a progress percentage, mission fit, a next step with an optional date, and a short timeline.

Contributors add four types of activity:

- **Update:** what changed or moved forward.
- **Feedback:** an observation from a team or stakeholder.
- **Blocker:** something stopped that needs help.
- **Red Team Review:** a deliberate critical view of what could fail.

An update can also change a project’s status, progress, and next step. The result is a shared history that combines tracking and risk signals without requiring a heavy ceremony.

In addition to the activity history, each project can have a **written Project Context**—purpose, problem it solves, key question, users, operation, flows, capabilities, decisions, current status, and open items—written by a person or uploaded as a file. It is shared per project, preserves its date and source, and provides background orientation distinct from the AI-generated Project Brief and the chronological activity feed.

## Main flows and screens

1. **Projects home.** Shows projects, active/at-risk/completed/recently-updated metrics, search, status filtering, and a portfolio Ask AI question.
2. **Create project.** A short flow for basics, people, next step, timeline, and confirmation to start tracking.
3. **Project detail.** Summarizes status, progress, owner, people, mission fit, next step, alerts, and a Project Context summary. From there users add activity, complete a step, share, open Ask AI, or view and edit the full context.
4. **Activity & Feedback.** A filterable feed of updates, feedback, blockers, and Red Team Reviews, with each item’s detail.
5. **People involved and timeline.** Adds real SVC people and edits a past/present/future timeline.
6. **Add update.** First choose the type of contribution, then complete the form for that case. Blockers and critical reviews request additional context so the signal is actionable.
7. **About Quest Coral.** Explains the module and leads to Ask AI.

## Current functionality

- Project creation, search, and status filtering.
- Project cards with progress, mission fit, people, and next step.
- Planning, On track, At risk, and Completed statuses.
- Involved people selected from real SVC contacts, not free text.
- Updates, feedback, blockers, and Red Team Reviews.
- Progress, status, and next-step updates driven by an activity item.
- A simple past/present/future timeline.
- Project-summary sharing and owner-only project deletion.
- Attention indicators for blockers and Red Team Reviews, plus an internal project-signal coverage measure.
- Ask AI for a project and the portfolio, plus a Project Brief in the detail view.
- A written Project Context with purpose, problem, users, how it works, flows, features, decisions, current status, and open items; it has a short summary, a full view, can be edited as text or uploaded as a file, stays up to date for the whole team, and is included (together with updates) when Ask AI answers a question.

## Key decisions

- **The focus is operational signal, not exhaustive task management.** It does not try to replace a ticketing tool; it shows what is happening and what needs attention.
- **Red Team Review is activity, not separate bureaucracy.** It brings useful criticism into the same history as progress.
- **People must be identifiable.** The picker uses real SVC contacts so projects can later connect with Directory and Communications.
- **Activity functions as a record.** Updates are not edited after creation; this favors traceability over silent rewriting.
- **Broad collaboration.** Anyone logged into SVC can collaborate on a project's status and progress; deleting a project is reserved for its owner. This should be revisited if sensitive projects are introduced.
- **Deleting a project does not automatically delete its historical activity.** This deliberately avoids deleting other people’s contributions without authority; it requires a clear archival and retention policy.
- **Coverage is not geographic coverage.** The 0°–360° indicator represents completeness of project signals and should be validated as a product metric before receiving more visual or decision weight.
- **A person writes or uploads Project Context; it is not generated automatically.** It remains separate from Project Brief and activity history. One shared version is saved per project along with its date and who wrote it; whenever someone edits it, that becomes the new current version.

## How it connects to other modules

| Module | Product connection |
|---|---|
| **Directory** | Supplies the people used in “People involved.” A project is not yet automatically linked to a Directory job, company, or profile. |
| **Communications** | Shares people and can share summaries manually, but a Quest Coral update does not automatically publish a message. Quest Coral projects are distinct from Communications tags/projects. |
| **Applications** | There is no functional integration today. Quest Coral can track a hiring initiative, but does not consume or alter the candidate pipeline. |

## Current status, open items and risks

**Status.** This version of Quest Coral is connected to the real, shared system the whole team uses — so if no projects have been created yet, the portfolio simply starts empty (any sample projects you might see elsewhere are only for demos, not real work). Every project's written context is saved for real and will be there the next time anyone opens it. Ask AI is turned on here, and once it's fully set up, it reads that same written context together with the project's info and updates to answer questions.

**Priority open items.**

- Run a real trial with the team's own data: create a project, add people, post every type of update, and confirm it shows up the same way on everyone's phone and computer.
- Decide how much the team is willing to spend on Ask AI, how to keep an eye on usage, and how to test it safely without runaway costs.
- Decide whether Project Brief should evolve from its current summary into a richer AI experience with loading and sources.
- Review the meaning and presentation of the 0°–360° coverage indicator.
- Decide what should happen to a project's past updates when the project itself is deleted (keep them, archive them, or remove them).
- Test more thoroughly with real data, not just who's allowed to see what.
- Decide whether richer filters, notifications, job/Directory connections, or publication automations to Communications are needed.
- Decide whether Project Context needs to keep a history of past edits, not just the current version.

**Risks to manage.**

- Right now, anyone logged into SVC can collaborate on any project — that may be too open for confidential projects.
- Without a clear deletion policy, a project's past activity can be left behind, disconnected, after the project itself is deleted.
- Blockers don't yet have a clear way to be marked resolved; an old one can keep counting as an alert if it isn't followed by a clear update.
- Real AI answers cost money, and they must only use the project (or portfolio) information they were given — never guess using information from other parts of SVC.

## What AI can answer about Quest Coral

Ask AI only uses the written Project Context, the project's own details, and its updates for whichever project or portfolio is being asked about.

Appropriate questions include:

- “Which projects are at risk, and which blocker is most urgent?”
- “What do I need to know today about this project?”
- “What were the latest update, feedback, and Red Team Review?”
- “Which next step is due first, and who is involved?”
- “Summarize the signals that support this project’s current status.”
- “Which themes recur across portfolio blockers?”

It must not invent progress, turn an opinion into a fact, close blockers by itself, or access profiles, applications, or messages that are not part of the explicit question context.
