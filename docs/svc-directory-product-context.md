# SVC Directory — product context

_Updated: 2026-07-31. This document explains Directory for Joseph and the team; it is not technical documentation._

## One-sentence summary

**Directory** is the unified view of people, companies, jobs, and related operational knowledge, so the team can quickly find who to contact, what relates to what, and which information is missing.

## Problem it solves

Contact, company, and job information is often split across spreadsheets, imported contacts, and conversations. Directory turns that information into searchable profiles and navigable relationships.

It answers: **“Who is this person or company, which job is involved, what connections do they have, and what do we know today?”**

## Who uses it

- Internal staff who need to locate people, companies, and jobs during operations.
- Job owners who need to plan the next three weeks.
- Teams that need to capture notes, files, or relationships around an entity.

Directory is shared across the whole logged-in SVC team, not a private address book per person. That makes it a useful shared source, but requires careful handling of contact data.

## How it works

Directory presents a shared catalog of four entity types: **people, companies, jobs, and other operational records**. The catalog is an organized view of operational sources; it does not try to replace ownership of the original data.

People can search by name, alias, company, role, or location; limit the view to People, Companies, or Jobs; and open a profile. A profile brings together identity, contact details, quick actions, relationships, activity, notes, files, and—for a job—the 3-Week Outlook.

Search stays fast because it works from information already saved on your device, and it quietly catches up when something newer is available. The screen can show that it's displaying saved information while it reconnects.

## Main flows and screens

1. **Home and search.** Search field, title suggestions, type filters, recent items, and favorites. It also supports browsing an entity type without searching.
2. **Results.** Best matches shown first, loading more as you scroll, with shortcuts straight to the profile.
3. **Entity profile.** Shows essential information, available actions—for example calling, writing, opening a website, or editing where allowed—and a readable entity summary.
4. **Related.** Navigates safe relationships between people, companies, and jobs.
5. **Notes and Files.** Records operational knowledge and attaches evidence directly to an entity. Each person can edit or delete their own contributions.
6. **3-Week Outlook, jobs only.** Plans an exact 21-day window with tasks, dependencies, progress, validations, published versions, and PDF output. The PDF can move to Communications as a human-reviewed update draft.
7. **Ask SVC Directory.** Natural-language questions with optional voice input, visible sources, name disambiguation, and up to two follow-up questions.

## Current functionality

- Search for people, companies, jobs, and other operational records.
- Personal favorites and recents without changing the shared catalog.
- Profiles with contact information, relationships, quality signals, and quick actions.
- Editing a person, company, or job's details where allowed, without treating the search catalog as the master record.
- Collaborative notes and files associated with a profile.
- Relationships among people, companies, and jobs, including connection paths when sufficient data exists.
- Collaborative 3-Week Outlook for jobs: quick task entry, calendar/Gantt view, advanced editing, publishing, PDF output, and preparation of an update message.
- Assisted Outlook capture: text or voice can propose tasks, but a person reviews and confirms before saving.
- Ask SVC Directory with answers grounded in Directory data, supporting cards, confidence, and explicit limits.

## Key decisions

- **A shared way to find things, not a new master record.** The screen can show a slightly-behind version of the information and catch up after an edit; it shouldn't promise that everything updates everywhere instantly.
- **Evidence-based relationships.** An unclear match is not forced into a definite identity. When information is missing or contradictory, the product should show that rather than inventing a connection.
- **Search first.** The interface is built for finding information quickly, not for loading someone's entire history up front.
- **Assisted Outlook, not automated Outlook.** AI can transcribe or suggest tasks, but dates, dependencies, checks, publishing, and the PDF are handled by fixed, predictable steps and always need a person's confirmation.
- **Read-only AI.** Ask SVC Directory does not modify people, companies, jobs, notes, or relationships.
- **Open to the whole internal team.** Anyone logged in can look up Directory; who can edit what still depends on ownership and the type of information.

## How it connects to other modules

| Module | Product connection |
|---|---|
| **Communications** | Provides people and contexts for addressing and classifying messages. Related messages can only be shown when the user already had access to them in Communications. |
| **Applications** | Directory jobs provide hiring context. The integration that automatically creates or links a hired person when an application reaches `hired` is still missing. |
| **Quest Coral** | The “People involved” picker uses real people from the SVC ecosystem rather than unstructured names. There is no automatic connection yet between a Quest Coral project and a Directory job. |
| **Outlook/Communications** | A published Outlook generates a PDF and opens Communications with a draft; it does not send an update without human action. |

## Current status, open items and risks

**Status.** Search, profiles, favorites, recent items, relationships, notes, files, the 3-Week Outlook, and Ask AI are all built and working. In this preview version, Ask AI and voice questions are turned on; depending on how it's set up, answers either come from the real AI or from a stand-in version used for testing. Before treating any of this as live for the whole team, it needs to be checked and confirmed directly wherever it will actually be used.

**Product open items.**

- Complete duplicate merging, including safe reassignment of historical references in Communications.
- Improve the presentation of related messages without breaking visibility rules.
- Define how incomplete, ambiguous, or review-pending records are shown and resolved at operational scale.
- Decide how much the team is willing to spend on AI and voice questions, how usage will be tracked, what languages to support, and how long voice recordings are kept.
- Decide whether Outlook should account for business days, holidays, or work calendars; it currently uses a 21-calendar-day window.

**Risks to manage.**

- As a global internal source, Directory contains contact data that needs a clear use and retention policy.
- The list of people, companies, and jobs can briefly show slightly old information, especially on iPhones using the installed app; a short delay in updating must not be confused with the data actually being missing.
- Relationships, summaries, and recommendations are only as reliable as their source data. AI must distinguish facts, inferences, and missing data.
- The 3-Week Outlook and AI features cost money to run and involve recording voice and work data; they need spending limits, a person double-checking results, and clear privacy rules.

## What AI can answer about Directory

Ask SVC Directory is intended for read-only questions about information visible in Directory. With sources and warnings, it can answer questions such as:

- “Who works with this company and in which jobs do they appear?”
- “Which active jobs does this company have in this location?”
- “Which contacts or jobs do these two companies share?”
- “What is the connection path between this person and this job?”
- “What do we know about this person, what is missing, and what information appears contradictory?”
- “Which notes are relevant to this job or company?”
- “Which upcoming work, dependencies, or risks appear in this job’s Outlook?”

It must not promise that external data is current, resolve ambiguous identities without showing alternatives, or edit records. Its answers must use only data the person asking can already access.
