# Architecture and delivery design

## Runtime flow

1. The public React form posts to the rate-limited `POST /v1/public/leads` endpoint with an idempotency key.
2. Fastify validates and persists the request. When configured, it triggers an authenticated n8n webhook with the lead ID and an idempotency key, not the lead's PII.
3. n8n acknowledges immediately and calls the protected internal Fastify workflow endpoint. The API claims the execution, calls Gemini with a strict structured-output schema, and writes the assessment and draft.
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

## Integration status

- Supabase Auth, protected API routes, structured Gemini analysis, and isolated demo sessions are implemented.
- Gmail OAuth and approval-gated real delivery are implemented. OAuth tokens are encrypted before persistence and are never exposed to the browser.
- The database outbox claims a draft once. A deterministic RFC 2822 `Message-ID` and the unique draft/idempotency constraints prevent normal repeated approvals from creating duplicate sends.
- Ambiguous transport/server failures remain in `sending` for reconciliation instead of being retried automatically, because retrying an unknown Gmail outcome could duplicate a message.
- n8n lead-analysis orchestration is implemented with shared-secret authentication, inline fallback, and callback idempotency. Provider reconciliation is the next integration block.

