# n8n workflows

This directory will contain exported, secret-free n8n JSON workflows.

## Planned workflows

### 01 — Qualify lead

Trigger: signed webhook from the API containing `lead_id`, `execution_id`, and `idempotency_key`.

Nodes: verify signature → claim execution → load lead → structured AI call → validate result → save assessment and draft → append event → mark `needs_review`. The error branch records the redacted error and moves the lead to `failed` when retries are exhausted.

### 02 — Send approved reply

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

Credentials must be configured in n8n's credential store and never embedded in exported workflow JSON.

