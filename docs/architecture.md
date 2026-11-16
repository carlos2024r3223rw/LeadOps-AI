# Architecture and delivery design

## Runtime flow

1. The public React form posts to the rate-limited `POST /v1/public/leads` endpoint with an idempotency key.
2. Fastify validates and persists the request. In production it triggers n8n with the lead ID, not the whole source of truth.
3. n8n claims an execution, calls the AI with a strict structured-output schema, and writes the assessment and draft.
4. An authenticated reviewer edits or discards the draft. Approval creates an immutable approval record.
5. The send worker claims one outbound message by its unique idempotency key, sends through Gmail, and stores the provider message ID.
6. Every transition appends an activity event; executions retain attempts, errors, tokens, model, latency, and estimated cost.

## State machine

`new → processing → needs_review → approved → sending → sent`

Failure paths transition to `failed`; a safe retry creates a new execution attempt. Reviewers can transition `needs_review` to `discarded`. State changes are validated by the API, not trusted from the browser.

## Idempotency

- Lead intake: normalized email plus a caller-provided request key is stored in `lead_requests.idempotency_key` with a unique constraint.
- AI execution: `workflow_executions.idempotency_key` is unique. A retry uses a new attempt key while retaining `root_execution_id`.
- Email: one `outbound_messages` row exists per approved draft version. Its idempotency key is unique and the provider message ID is recorded. Workers atomically claim only rows that are not already `sent`.
- Approval: immutable `approvals` records identify the reviewer and exact draft version.

The database is the final guard. n8n retries and repeated HTTP calls can return the existing result without creating another side effect.

## Data model

- `leads`: source request and current state.
- `lead_assessments`: versioned structured AI classification.
- `response_drafts`: versioned editable messages.
- `workflow_executions`: execution, attempt, errors, token usage, and cost.
- `approvals`: immutable human decision for a draft version.
- `outbound_messages`: Gmail delivery state and duplicate-send barrier.
- `activity_events`: append-only timeline for business and technical events.

## Security boundary

Public visitors can submit only through Fastify with validation and a five-per-hour IP limit. Dashboard reads and mutations require a valid Supabase session whose non-user-editable `app_metadata.role` is `portfolio_admin` or `lead_operator`. The browser uses a publishable key only for authentication; Fastify verifies the access token with Supabase Auth. Secret keys remain server-side. All public-schema tables enable RLS and explicitly revoke default privileges before granting the minimum authenticated access.

Portfolio visitors can call `POST /v1/demo/session` without registering. Each unguessable session ID owns separate, expiring fictitious state in `demo_sessions`, forces deterministic simulated AI, and never reads or writes persistent Supabase leads. The API returns `401` when a private route has neither an authorized bearer token nor a valid demo-session header. When Supabase is not configured locally, the same adapter safely falls back to in-memory sessions.

## Next integration block

1. Create the first Supabase Auth administrator and assign `app_metadata.role = portfolio_admin`.
2. Import the n8n workflows described in `workflows/README.md`.
3. Add Gmail OAuth, enqueue-on-approval, and provider reconciliation.
4. Deploy the web and API with separate public and server-only environment variables.
5. Add end-to-end tests against a disposable Supabase branch and an n8n test instance.

