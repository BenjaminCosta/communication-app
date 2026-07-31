# SVC Applications — product context

_Updated: 2026-07-31. This document describes the product for Joseph and the team; it is neither technical documentation nor a legal certification of the workflow._

## One-sentence summary

**Applications** manages the hiring journey from inviting a candidate through agreement signing, payroll handoff, and final hiring confirmation.

## Problem it solves

Hiring through scattered messages, photos, and documents makes it hard to know who is ready, what information is missing, and what evidence supports each decision. Applications brings that journey into one clear, phone-friendly pipeline.

It answers: **“Which stage is each candidate in, what is needed to move forward, and what evidence do we have?”**

## Who uses it

- **Internal reviewers:** SVC staff who invite, review, request information, approve, and close applications.
- **Candidates:** external people who complete an application from a secure link, normally on a phone, without creating a conventional account.
- **Operations/payroll:** receives an application after signing; there is not yet an automatic integration with a payroll provider.

There is currently no detailed role hierarchy within Applications: anyone on the internal team who's logged in is treated as staff. This decision must be revisited before expanding operational use.

## How it works

A reviewer creates an invitation with a candidate, trade, and job. SVC generates a secure link that the candidate can open to complete the application. The candidate can save progress, provide their information, record or upload a video, upload documents, and submit the application.

The team then reviews the profile, files, and activity. It can request additional information or approve the application. Approval enables a temporary link to sign the Operating Agreement. Signing generates timestamped evidence and moves the case to payroll; once that work is complete, the reviewer marks the person as `hired`.

## Main flows and screens

1. **Applications dashboard.** Candidate list, metrics, search, filters by status, job, and trade, plus the primary “Invite a candidate” action.
2. **Invitation and secure link.** The reviewer creates the link and can share it through the available channel, copy it, regenerate it, or revoke it.
3. **Candidate flow.** Welcome → general details → video → documents → review → submission. The form saves progress and is designed to be straightforward on mobile.
4. **Internal candidate detail.** Brings together identity, job, progress, documents, video, extracted data where available, agreement, and activity. From here, reviewers request information, approve, mark hired, or archive.
5. **Agreement signing.** The candidate reads and consents, types their name, and draws their signature. They then see confirmation that the agreement was signed.
6. **Application PDF.** The reviewer can download a consolidated profile for review or recordkeeping.

## Current functionality

- Candidate invitations and links with defined purpose and expiration.
- Application, requested-step, and agreement links; revoking or expiring a link removes its access.
- Mobile form with saved progress, personal/work details, video, and documents.
- Photo or PDF document upload and video upload with progress and retry.
- Internal review of files, video, data, and activity timeline.
- Requests for additional information through a link directed to the required step.
- Pipeline stages: draft, submitted, ready for review, needs information, approved, payroll in progress, hired, and archived.
- Agreement signing with a sealed PDF and an evidence record.
- Consolidated application PDF with available data, documents, video, agreement, and activity.
- Search, filters, sorting, and metrics to prioritize the pipeline.

## Key decisions

- **A candidate does not need a staff account.** Their access is limited to their application and an active link.
- **Links are not permanent permissions.** They have an expiration, a specific purpose, and can be revoked; access is checked again during use.
- **A candidate can never approve their own case.** Only SVC staff can approve an application or mark someone as hired — that check happens securely behind the scenes and can't be bypassed from the candidate's side.
- **Approved does not mean hired.** Approval enables the agreement; signing moves the case to payroll; `hired` is the later closeout.
- **Evidence matters.** Documents, activity, agreement, and PDF make it possible to review what happened rather than only seeing the current state.
- **Highly sensitive data.** Licenses, videos, documents, and signatures need retention, permission, and legal review before operating at scale.

## How it connects to other modules

| Module | Product connection |
|---|---|
| **Directory** | The job selected during invitation can come from Directory. The automatic connection that creates or links a hired candidate as a Directory person is still missing. |
| **Communications** | An application or agreement link can be shared through the reviewer’s available channels; there is no complete automation of Applications milestones into Stream. |
| **Quest Coral** | There is no direct integration today. A Quest Coral project can track a hiring objective, but it does not automatically receive applications or their statuses. |

## Current status, open items and risks

**Status.** The entire hiring journey — from invite to signed agreement — works from start to finish once it's turned on for real, shared use. Right now, in this preview version, it isn't yet connected to the shared system: what you see on the dashboard is sample/practice data, not real candidates. Turning this on for real hiring still needs a final review and setup before anyone treats it as live.

**Priority open items.**

- Add protection so the public candidate link can't be spammed or abused by bots.
- Connect real video transcription and summarization; the interface can display these results, but the operational processing is still missing.
- Allow reassignment of a job after invitation, ideally through a Directory picker.
- Integrate payroll and automatically create or link the hired person in Directory.
- Define and automate how long personal information is kept, and when it gets deleted, for archived or rejected cases.
- Legally validate the agreement template and signature-evidence model.
- Finish everything needed to safely turn this on for real hiring: final setup, security checks, and testing on real phones.

**Risks to manage.**

- Exposure of personal data, documents, videos, and signatures if permissions, storage, or retention are not governed well.
- A mistakenly shared link, or a step that doesn't limit how many times it can be used, can increase risk even when the link itself is otherwise handled safely.
- The lack of specific Applications roles can give more review capability than necessary.
- The `hired` state alone does not prove that payroll or Directory was updated: it is currently a manual milestone.

## What AI can answer about Applications

**There is no AI assistant for Applications turned on today.** Video transcription and summarization are still being worked on — the team can't rely on them yet.

Once a carefully limited AI feature exists, it could answer questions such as:

- “Which candidates need action today, and why?”
- “Which documents or details are missing before this application can be reviewed?”
- “Summarize this candidate’s experience, video, and activity, distinguishing facts from observations.”
- “Which cases are approved but still awaiting signing or payroll?”
- “What information did the reviewer request, and has the candidate provided it?”

It should answer only for authorized staff, stay within the relevant application, and never make hiring, legal, or payroll decisions on its own.
