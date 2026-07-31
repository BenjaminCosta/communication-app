# SVC Communications — product context

_Updated: 2026-07-31. This document explains the product for Joseph and the team; it is not technical documentation._

## One-sentence summary

**Communications** —the experience called **Stream** inside SVC— turns operational conversations into directed, searchable messages connected to the people, topics, contexts, and dates that give them meaning.

## Problem it solves

In day-to-day operations, an update can get lost in general chats, fail to reach the right person, or become disconnected from the work it concerns. Communications keeps the message and its context in one place.

It answers: **“What was communicated, to whom, about what, and what needs follow-up?”**

## Who uses it

- The SVC internal team, to send updates, requests, decisions, issues, and feedback.
- Project, job, and operations owners, to follow conversations related to their work.
- People who choose to receive notifications on their phone or computer when something needs their attention.

It is not a public channel: a message is shared with explicit recipients. Associating a contact, tag, or context helps organize it, but does not automatically make that person a reader.

## How it works

A person writes a message and can:

- choose registered recipients;
- link contacts who have not registered yet, without granting them access by itself;
- classify it as progress, issue, feedback, or decision;
- associate one or more tags/projects, contexts, and dates;
- reply to another message and attach an image.

Stream gathers the messages a person is allowed to see in chronological order. They can then find them by people, tags, contexts, and dates. Messages with dates also appear in Calendar and can trigger push reminders on the selected date.

## Main flows and screens

1. **Compose / quick message.** Write the message, choose recipients and relationships, then send it. Several places in SVC can open Compose with context already filled in.
2. **Stream.** The main chronological feed. It supports reviewing conversations, replying, favoriting, copying, deleting one’s own messages, and filtering.
3. **Message detail and tags.** Opening a message or tag shows its context and lets people navigate related messages. The Tags screen supports finding and managing the conversational classification.
4. **Calendar.** Groups messages by date, makes it easier to add dates to new communications, and exposes reminders.
5. **People, Contexts, and global search.** Supporting surfaces for locating people, tags, and contexts before communicating, or for navigating existing knowledge.

## Current functionality

- Directed messaging with recipient-based visibility.
- Replies with a preview of the original conversation.
- Classification by type, tags/projects, and contexts.
- Combined filters for people, tags, contexts, and dates.
- Image attachments and expanded viewing; some flows can attach SVC-generated documents, such as an Outlook PDF.
- A calendar for messages with one or more dates and reminders.
- Favorites, search, and progressive history loading.
- Push notifications for new messages and reminders, respecting each person’s preference.
- Designed to work like an app on your phone (you can add it to your home screen), and it remembers which part of SVC you were last using.

## Key decisions

- **Privacy first:** only the author and explicit recipients receive access. Membership in a tag or project does not grant implicit access.
- **Classification is not sharing:** tags, contexts, and contacts make messages easier to find and understand; they are not permissions.
- **Historical compatibility is protected:** messages from older models still exist. The product retains additional controls to avoid accidentally expanding their audience.
- **Communications “Projects” are conversational tags.** They are not Quest Coral execution projects, even if names can look similar.
- **Dates are communicated commitments, not a full corporate calendar.** The module remembers the message but does not replace an external scheduling tool.

## How it connects to other modules

| Module | Product connection |
|---|---|
| **Directory** | Provides people and contexts for choosing recipients and relating conversations. Directory can show information that helps explain an entity, but must preserve the original visibility of every message. |
| **Applications** | Hiring-process updates can be communicated to the team manually, but there is no complete automation from application events to Stream. |
| **Quest Coral** | Shares the same people foundation. Quest Coral does not automatically publish updates to Communications today, and its projects are not Stream’s historical tags/projects. |
| **3-Week Outlook** | A published Outlook can prepare a Compose message with the PDF and context prefilled; a person reviews and confirms before sending. |

## Current status, open items and risks

**Status.** This is the most mature, most-used part of SVC today: writing messages, the main feed, filters, the calendar, photos, and notifications all work. It's built as one continuous app experience rather than separate pages you'd bookmark individually.

**Product open items.** Stream doesn't have its own AI assistant yet, and there's no broad automation connecting messages to the other modules. It also doesn't yet separate data between different companies or teams, if SVC ever needs that.

**Risks to manage.**

- Message visibility is sensitive information. Any change to recipients, migrations, or search must preserve the explicit-recipient principle.
- Older messages need special care: they must not be assumed to follow today's sharing rules just because they look similar.
- If someone loses their internet connection, they may briefly see slightly old information until it reconnects — screens should make it clear when they're showing saved information versus freshly updated information.
- Global contexts enrich a message but must not become a shortcut for exposing conversations to more people.

## What AI can answer about Communications

**There is no dedicated AI assistant for Communications today.** If one is enabled, it should answer only from messages the person can already see and should make the source of each claim clear.

Appropriate questions include:

- “What decisions were communicated this week about this tag or context?”
- “What open issues did the team mention about this job?”
- “Who received the most recent update and which next steps remained?”
- “Summarize today’s dated messages and their associated reminders.”
- “What feedback and decisions were recorded about this person or company?”

It must not infer access from tags, contacts, or memberships, or answer about messages outside the authorized audience.
