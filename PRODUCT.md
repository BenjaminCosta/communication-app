# Product

## Register

product

## Users

Field crew workers (carpenters, electricians, laborers, foremen) using ByeByeDPR on their own phone while physically on a job site — often outdoors, hands dirty or gloved, attention split between the app and the work itself. They open the app to do exactly one thing (clock in, clock out, or submit a report) and want to close it again in seconds. This is the worker-facing counterpart to SVC's other internal ops modules (Communications/Stream, Directory, Applications, Quest Coral) — same company, same backend, a completely different audience (field crew vs. office/ops staff).

## Product Purpose

ByeByeDPR replaces paper daily-progress-reports and manual timesheets with a near-zero-friction mobile flow: confirm a job site, clock in/out, and dictate or type a daily report that AI structures into a submittable document. Success is a worker completing the entire task in well under a minute without ever seeing or deciding on tags, recipients, business context, Communications routing, or PDF generation — all of that happens invisibly, server-side, from what the backend already knows about their company and job.

## Brand Personality

Quiet, immediate, trustworthy. Not playful, not corporate, not gamified — the opposite of a dashboard. It should feel like a single well-made tool that does one job and gets out of the way.

## Anti-references

- No dashboards, stat tiles, KPI rows, or admin-panel chrome anywhere in this module.
- No multi-field form presented as a single dense wall — one decision/action visible at a time.
- No dark glassmorphism — that is Stream/Directory's visual language (see docs/svc-design-system.md), not this module's. Glass is reserved for transient sheets/overlays only, never the base surface.
- Never expose internal plumbing (tags, contexts, recipients, Comms routing, PDF generation) to the worker as something to choose or configure.
- No loud/mixed color use — one accent color carries the module's identity; state colors (green/amber/red) are used sparingly and only for status.

## Design Principles

1. One primary action per screen, reachable in at most two taps from Home.
2. Infrastructure is invisible: the worker never chooses tags, recipients, context, or how something gets posted/generated.
3. AI output is always an editable draft the worker visibly controls before it's final, never a silent black box.
4. Voice is a first-class input, not a fallback — hands-free matters on a job site.
5. Confirm briefly, don't celebrate loudly: short inline confirmations, not modals, for routine success.

## Accessibility & Inclusion

Large tap targets for one-handed, possibly-gloved mobile use. Status states (clocked in vs. out) must stay legible in bright outdoor sunlight — contrast, not just hue, carries meaning. Voice input is an equal alternative to typing everywhere text is captured. Respect `prefers-reduced-motion` (matches the rest of this app's convention — see docs/svc-design-system.md §4).
