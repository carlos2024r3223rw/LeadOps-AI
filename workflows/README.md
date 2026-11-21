# n8n workflows

This directory contains importable, secret-free n8n JSON workflows.

## Implemented workflow

### 01 — Qualify lead

File: `01-qualify-lead.json`

Trigger: header-authenticated webhook from the API containing only `leadId`, `idempotencyKey`, event name, version, and timestamp. Lead PII remains in Supabase.

Nodes: protected webhook → authenticated internal API callback. The API atomically claims the execution, runs Gemini structured analysis, stores tokens/cost/latency and creates the review draft. Repeated callbacks with the same idempotency key return the existing result.

### Import and configure

The self-hosted Render deployment is defined in the repository root `render.yaml`; production setup details are in `docs/deployment.md`.

1. Import `01-qualify-lead.json` into n8n.
2. Create an **Header Auth** credential named `LeadOps Shared Secret`:
   - Name: `X-LeadOps-Workflow-Secret`
   - Value: the same strong value configured as `N8N_SHARED_SECRET` in the API.
3. Assign that credential to both nodes in the imported workflow.
4. Activate the workflow and copy its production webhook URL into `N8N_WEBHOOK_URL`.
5. Redeploy the API. `/health` will then report `"orchestration":"n8n"`.

The production API URL is intentionally visible in the workflow. No API key, Supabase key, Gemini key, Gmail token, or customer data is included in the export.

## Next workflow

### 02 — Reconcile approved reply

Trigger: approved outbound message ID. Nodes: claim unsent message atomically → re-check immutable approval → Gmail send → persist provider ID → mark lead `sent` → append event. A repeated trigger returns the stored delivery result.

## Structured AI result

```json
{
  "classification": "qualified",
  "priority": "high",
  "detected_service": "woocommerce",
  "missing_fields": ["number_of_products"],
  "summary": "Short factual summary",
  "reply_subject": "Next steps for your project",
  "reply_body": "Plain-text draft for human review"
}
```

Gmail delivery already runs behind the API's immutable approval and outbox barrier. The next n8n block will monitor ambiguous `sending` deliveries and request reconciliation; it will not send a second message blindly.

Credentials must be configured in n8n's credential store and are never embedded in exported workflow JSON.

