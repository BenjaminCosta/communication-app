# SVC AI Secretary — Product Context

Updated: 2026-08-15

## Problem it solves

SVC information is spread across people and jobs, active projects, hiring, field reports, time records, Outlooks, and team communications. An employee should not need to know which application owns an answer before they can ask for it. The AI Secretary gives the team one conversational starting point on WhatsApp.

## Question it answers

At its simplest, it answers: **“What does SVC know that can help me right now, and where should I look or act next?”**

It can answer questions about the company, a person, a company, a job, project progress, candidates, recent reports, clocking, Outlooks, and the sender’s own SVC situation—only when the sender is allowed to see that information.

## Who uses it

- **SVC employees and operations staff** who need a quick answer while away from the web app.
- **Field and site teams** who need to understand job activity, reports, clocking, or next steps from a phone.
- **Managers and coordinators** who need a fast cross-module view without opening each system separately.
- **New or infrequent users** who benefit from a guided first interaction and examples based on what is actually linked to them.

## How it works

The Secretary is a WhatsApp conversational layer for SVC. A message is matched to an SVC identity using an exact phone-number match. The result determines what it can safely access:

- An **unknown or ambiguous sender** receives only a small, curated public company introduction.
- A **uniquely identified SVC person** can ask read-only questions across the authorized SVC modules.
- A person may create a ByeByeDPR Daily Report draft only when they also have a linked SVC app account, and only after an explicit confirmation phrase.

The assistant retrieves small, relevant pieces of real data instead of receiving entire collections. It should say when information is unavailable rather than inventing people, jobs, roles, dates, or answers.

## Main flows and screens

### 1. First contact and discovery

A recognized user receives a short introduction that explains what the Secretary can actually do for them and offers useful starter questions. It adapts to the user’s available access and linked SVC records without guessing a role or job.

### 2. Ask a cross-SVC question

The user sends a normal WhatsApp message such as “What should I check today?”, “What is happening with this project?”, or “Who works with this company?” The Secretary identifies the relevant source, retrieves a bounded answer, and replies in WhatsApp.

### 3. Personal SVC context

The user can ask what SVC knows about them, their projects, linked jobs and companies, current clock, recent reports, Outlooks, communications they are allowed to see, and application status when applicable.

### 4. Daily brief and guided tour

The Secretary can summarize the user’s most relevant work signals for the day and can guide them through common ways to find information or take the next step.

### 5. Daily Report draft

For an authorized linked user, the Secretary can prepare a Daily Report draft after it understands the job and report details. It previews the result first. Only an exact explicit confirmation creates the draft; it never submits a final report on the user’s behalf.

### 6. Requested files and photos

When the user explicitly asks for an available report, Outlook PDF, or Communications image/file, the Secretary can send it as a native WhatsApp attachment rather than a plain link.

## Current functionality

- Conversational answers grounded in stable SVC company knowledge and live operational data.
- Authorized read access to Directory, Quest Coral, Applications, ByeByeDPR reports, Clocking, Outlooks, and Communications.
- Stronger protection for Communications: operational system history is distinct from human-written messages, and human message results remain scoped to the sender’s existing visibility.
- Personalized “my profile,” “my SVC context,” and “what can I ask?” answers.
- Guided first-contact discovery and a daily brief.
- One controlled write path: creating a **draft** ByeByeDPR Daily Report after preview and exact confirmation.
- Native WhatsApp delivery of supported reports, PDFs, images, and files when the user asks for them.
- Conversation continuity for recent questions and resolved entities, so a follow-up can remain on the same person, job, or project.

## Key decisions

- **Read before write:** the product prioritizes finding, understanding, explaining, and routing before expanding automation.
- **Identity and access are enforced by the server:** phone recognition alone never grants broad access, and unknown/ambiguous senders stay public.
- **No invented answers:** the Secretary uses grounded knowledge and bounded live-data retrieval; missing information is stated plainly.
- **One deliberate write flow:** Daily Report creation is preview-first, uses an exact confirmation, stays a draft, and is safe to retry without duplicates.
- **Personalization without overreach:** a user’s self-context is about that user and does not broaden access to other people’s private information.
- **Human message privacy is preserved:** the Secretary can only return human Communications messages already visible to the identified sender in the app.

## Current service channel

- **Channel:** WhatsApp through the official Meta Cloud API test/sandbox number.
- **Production-number status:** no dedicated SVC production number has been purchased, migrated, or registered yet.
- **Meta Phone Number ID:** `1165212860018618`. This is a configuration identifier, **not** a user-facing phone number.
- **Display phone number:** not retained in the repository or product documentation. It must be confirmed from Meta before it is presented as the public SVC AI Secretary contact number.

## How it connects to other modules

- **Directory:** resolves people, companies, jobs, contact details, relationships, and the sender’s linked identity.
- **Quest Coral:** answers questions about projects, Project Context, activities, blockers, and next steps.
- **Applications:** answers candidate, queue, job-history, and application-status questions without exposing source files or videos.
- **ByeByeDPR:** reads daily reports and supports the controlled Daily Report draft flow.
- **Clocking:** answers job clock-history and current-workforce activity questions without exposing raw GPS locations.
- **Outlooks:** answers questions about active job outlooks and current tasks.
- **Communications:** separates operational broadcasts from human messages and respects the existing audience of human conversations.

## Current status, open items and risks

### Current status

The Secretary is live as an internal pilot on the official Meta test/sandbox channel. It is deployed inside the SVC application and supports the current read-first experience, personalized discovery, and the guarded Daily Report draft flow.

### Open items

- Confirm and record the user-facing Meta sandbox display number if it needs to be shared internally.
- Complete a real production end-to-end Daily Report draft confirmation and verify that exactly one draft is created and a repeated confirmation does not duplicate it.
- Decide when to move from the Meta test number to a dedicated SVC production number.
- Continue testing real conversations, especially ambiguous identities, unavailable information, and multi-step follow-ups.

### Risks

- A Meta test/sandbox number is not a stable production support channel.
- Answers are only as complete as the linked Directory, project, report, and user data.
- A person without an exact unambiguous identity match must receive a limited public answer, even if they are an SVC employee in practice.
- The product must preserve the distinction between reading information and taking action; expanding write capabilities needs the same preview and confirmation safeguards.

## Questions the AI can answer about this module

- What is the SVC AI Secretary and who should use it?
- What can I ask it from WhatsApp?
- Why did it not recognize a sender or why is an answer limited?
- What can it read from Directory, Quest Coral, Applications, ByeByeDPR, Clocking, Outlooks, or Communications?
- What does it know about my SVC role, jobs, projects, reports, and current work context?
- How does the Daily Report draft flow work, and what does confirmation do?
- What can it send as a WhatsApp attachment?
- Is the service on a production phone number yet?
- What are the next product decisions, current limitations, and risks?

## Sources

- `SVC_AI_Secretary_Canonical_Knowledge_Pack.md`
- `docs/svc-whatsapp-ai-secretary-handoff.md`
- Current Meta/WhatsApp configuration status recorded in the handoff
