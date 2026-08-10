# SVC ByeByeDPR — product context

_Updated: 2026-08-10. This document explains ByeByeDPR for Joseph and the team; it is not technical documentation._

## One-sentence summary

**ByeByeDPR** is SVC’s mobile field-crew tool for recording a job-site clock in or clock out and creating an AI-assisted daily progress report by voice or text.

## Problem it solves

Paper daily progress reports and manual timesheets make it difficult to capture accurate field work while the crew is busy on site. Details can be delayed, forgotten, or scattered after the workday.

ByeByeDPR replaces that friction with a short mobile flow that records where and when someone worked, then turns spoken or typed notes into a reviewable daily report.

It answers: **“Where did I work, when did I work, and what happened on that job today?”**

## Who uses it

- Field-crew workers—such as carpenters, electricians, laborers, and foremen—using their own phone at a job site.
- Field workers who may be outdoors, wearing gloves, or moving between work and the app, so they need to finish a task in seconds.
- Office and operations teammates who receive the resulting operational communication and report, without asking the worker to manage its routing.

ByeByeDPR is the field-worker counterpart to SVC’s office and operations modules. Its primary audience is the crew, not managers using a dashboard.

## How it works

The worker opens a focused home screen and starts one task: clock in, clock out, or complete a daily report.

To clock in, the worker selects a job site. The app can suggest a nearby site when location is available, or the worker can search, select a recent job, or add the first job when none exist. Clocking out records the elapsed session and can capture location when available; a forgotten clock-out can be corrected.

For a daily report, the worker dictates or types what happened. AI transcribes and structures the input into editable sections: work completed, issues or delays, attendance notes, next steps, and additional notes. The worker reviews and edits that draft, can add photos, and submits it. The system then creates the report document and publishes the operational communication automatically using the job’s existing configuration.

## Main flows and screens

1. **Home.** Shows the current clock state, current or last job when available, and the direct actions for Clock In, Clock Out, and Daily Report.
2. **Choose job site.** Offers a location-based suggestion, suggested and recent jobs, search, and a simple first-job creation path when the list is empty.
3. **Clock in and clock out.** Starts or closes a job-site session, confirms the result briefly, and offers a correction path for a missed clock-out.
4. **Daily Report capture.** Lets the worker speak or type a short account of the day and add supporting photos.
5. **Review and submit.** Shows the AI-organized report as an editable draft before it becomes final and is shared.
6. **About ByeByeDPR.** Explains the tool’s focused field-work purpose.

There is intentionally no attendance dashboard or separate attendance-report flow. The product stays centered on the immediate field action.

## Current functionality

- Real job-site selection, including optional current-location suggestions and a first-job creation path.
- Clock-in and clock-out sessions, including a way to correct a forgotten clock-out.
- Daily reports captured by typing or voice, with AI transcription and structured editable sections.
- Photo attachments during report preparation.
- A generated daily-report document and an automatic post to Communications when a report is submitted.
- A simple shared SVC access model: the module is not yet divided into separate company or role workspaces.
- A mobile-first, single-purpose interface that keeps internal routing, tags, recipients, and document generation out of the worker’s decisions.

## Key decisions

- **One fast action at a time.** This is a field utility, not a dashboard or an administrative workspace.
- **Voice is first-class.** Speaking a report is an equal path to typing because hands-free input matters on a job site.
- **AI prepares a draft; the worker remains in control.** Structured AI output must be visible and editable before submission.
- **Infrastructure stays invisible.** Workers do not choose tags, recipients, business context, Communications routing, or document generation.
- **One shared access model for now.** Authenticated SVC users work in the same data space; company-level partitioning and roles were deliberately not retained.
- **No separate attendance product.** Clocking supports the daily-work flow, but ByeByeDPR does not add attendance analytics or an attendance report.

## How it connects to other modules

| Module | Product connection |
|---|---|
| **Communications** | A submitted daily report automatically creates an operational post. A job can define specific recipients; without that configuration, the current fallback can notify all registered SVC users. |
| **Directory** | A job may keep an optional Directory reference, but job records and Directory knowledge are not automatically synchronized today. |
| **Applications** | There is no functional integration. Candidate hiring and onboarding do not affect field clock records or daily reports. |
| **Quest Coral** | There is no direct automatic integration yet. A Quest Coral project can track a ByeByeDPR rollout or operational initiative, but it does not automatically consume individual clock records or daily reports. |

## Current status, open items and risks

**Status.** As documented on August 10, 2026, the connected clocking and daily-report workflow, supporting production rules, and job-location flow are in place. The core behavior has been checked with type and focused automated tests, but a controlled end-to-end field-worker trial with real data is still needed before treating the rollout as fully proven.

**Priority open items.**

- Make local end-to-end testing safe by wiring the server-side Firebase access to the emulator, or define a deliberate production-test protocol with a disposable test job.
- Run a real end-to-end trial: create or select a job, clock in and out, dictate or type a report, review it, submit it, and confirm the resulting document and Communications post.
- Confirm the intended notification policy when a job has no explicit recipient list; notifying every registered user may become noisy or inappropriate as the team grows.
- Add ongoing job management beyond first-job creation: edit, deactivate, correct a location, and create additional jobs from the module.
- Persist a real activity and report history beyond the current device session.
- Make attachment removal delete the stored file and record, not only remove it from the draft screen.
- Decide the retention and privacy policy for location data, voice input, photos, and generated reports.
- Decide whether ByeByeDPR should remain a focused standalone route or become a fully embedded screen in the shared SVC shell.

**Risks to manage.**

- Current shared access can be too broad for sensitive job, worker, location, or report information.
- The fallback Communications broadcast may create noise or expose job activity too widely.
- AI transcription or structuring can be incomplete or inaccurate, which is why worker review is a required product step.
- Until the emulator gap is fixed, an apparently local full-flow test can write production records and publish a real Communications post.
- Photos, voice notes, location, and reports need clear retention and access expectations before wider adoption.

## What AI can answer about ByeByeDPR

Within Quest Coral, Ask AI can use this written Project Context together with the ByeByeDPR project’s own details and updates. It can answer product-orientation questions such as:

- “What field workflow does ByeByeDPR support?”
- “How does a worker turn a voice note into a daily report?”
- “What does the worker need to review before a report is final?”
- “What risks should we address before rolling it out more widely?”
- “How does ByeByeDPR connect to Communications and Directory?”
- “Why does the product not include an attendance dashboard?”

It must not claim to know actual clock hours, job history, individual report content, audio, photos, or generated documents unless that information has explicitly been added to the Quest Coral project details or updates. It must not infer that a worker was present, that a report is correct, or that a Communications notice was received.
