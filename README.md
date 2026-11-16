# LeadOps AI

LeadOps AI is a portfolio-ready, human-in-the-loop lead operations platform for WordPress, WooCommerce, and Shopify agencies. It captures a request, enriches it with structured AI output, places the reply in a private review queue, and sends email only after explicit approval.

## What works now

- Responsive public intake form with duplicate protection.
- Private-style operations dashboard with pipeline metrics and filters.
- Deterministic development AI that classifies leads and drafts a reply.
- Optional Gemini integration with strict JSON Schema, token accounting, bounded output, and safe retries.
- Editable review panel, approval, discard, simulated sending, errors, and retries.
- Activity timeline with attempts, token counts, and estimated AI cost.
- Idempotent API operations that prevent duplicate leads and duplicate sends.
- Installable PWA manifest and offline application shell.
- Production-oriented Supabase schema with RLS, audit events, executions, approvals, and outbound messages.
- Optional Supabase persistence adapter for leads, AI results, drafts, decisions, messages, and activity history.
- Private dashboard access with Supabase email/password authentication and server-side role authorization.
- Registration-free demo sessions with isolated fictitious data and simulated AI/email actions.
- Public intake separated from dashboard APIs and limited to five submissions per IP per hour.

Without `SUPABASE_SECRET_KEY`, the API safely falls back to in-memory data. With `SUPABASE_URL` and `SUPABASE_SECRET_KEY`, the same workflow persists in Supabase. Email delivery remains simulated in both modes.

When `DEMO_MODE=false` and `GEMINI_API_KEY` is configured on the API server, lead analysis uses `gemini-3.1-flash-lite`. The key must never be placed in the browser or committed to Git.

## Quick start

Requirements: Node.js 22+ and npm 10+.

```bash
npm install
npm run dev
```

Open `http://localhost:5173`. The API runs at `http://localhost:3001`. The landing page offers a public intake form, private access, and an isolated portfolio demo.

Choose **Explore demo** to receive a two-hour isolated session with seeded fictitious leads. New demo leads use a deterministic simulated analyzer and never write to Supabase. Approving a draft records the decision in that temporary session, then simulates a Gmail delivery.

## Private administrator access

The private login uses a Supabase Auth user created by an administrator. Create the user in Supabase Auth with email/password, then assign `app_metadata.role` to `portfolio_admin` (or `lead_operator`). Authorization never trusts user-editable metadata.

Production must configure the final HTTPS Site URL and redirect allow list in Supabase Auth. The browser receives only the publishable key; passwords and sessions are handled by Supabase Auth.

## Commands

```bash
npm run dev        # API + web app
npm run check      # types, API tests, and production builds
npm run test       # API behavior and idempotency tests
npm run health:supabase # Read-only database health check
```

## Supabase availability monitor

Free Supabase projects with insufficient database activity can be paused. The repository includes a read-only health check and a scheduled GitHub Actions workflow at `.github/workflows/supabase-healthcheck.yml`.

After applying `supabase/schema.sql`, add these GitHub Actions repository secrets:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`

The workflow runs approximately every three calendar days at 09:15 Guatemala time and can also be run manually. It calls only the `keepalive_ping()` function, returns no business data, and never uses the secret/service-role key. A paid Supabase plan is the only guaranteed way to prevent automatic pausing; this workflow is an operational health check, not a platform guarantee.

## Repository map

- `web/` — React, TypeScript, Vite, responsive PWA.
- `api/` — Fastify API with Supabase persistence and safe in-memory fallback.
- `supabase/schema.sql` — PostgreSQL model, constraints, RLS, and policies.
- `workflows/README.md` — n8n workflow contract and implementation stages.
- `docs/architecture.md` — system boundaries, state machine, and idempotency design.
- `docs/deployment.md` — production deployment, environment, Auth, and verification checklist.

## Environment and security

Copy `.env.example` to `.env` when connecting services. Never expose the Supabase secret key, Gmail refresh token, n8n secret, or AI key through `VITE_*` variables. The Supabase secret key belongs only in the API environment and bypasses RLS; it must never be shipped to the browser or committed to Git. In production, the browser talks only to Fastify; Fastify validates the user session and performs privileged operations server-side.

The current API intentionally refuses real email delivery. Supabase persistence, structured Gemini analysis, protected administrator routes, and isolated demo sessions are implemented; n8n orchestration and Gmail OAuth are the next integration blocks documented in `docs/architecture.md`.

The portfolio demo stores only fictitious, expiring session state in `demo_sessions`. This keeps the demo reliable when the API runs across multiple serverless instances while preserving separation from real leads.

## Portfolio demo (3 minutes)

1. Submit a request from **New lead**.
2. Return to **Inbox** and watch it move from `processing` to `needs_review`.
3. Open the lead, inspect the AI assessment and edit the reply.
4. Approve and send; the timeline records both actions and a simulated Gmail message ID.
5. Open the seeded failed lead and retry it to demonstrate recovery.

