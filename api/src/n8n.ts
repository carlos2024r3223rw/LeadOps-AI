import { timingSafeEqual } from "node:crypto";

export interface LeadWorkflowEvent {
  leadId: string;
  idempotencyKey: string;
}

export interface LeadWorkflowDispatcher {
  readonly configured: boolean;
  readonly required: boolean;
  dispatchLeadCreated(event: LeadWorkflowEvent): Promise<void>;
  authorizeInternalRequest(secret: string | undefined): boolean;
}

type FetchLike = typeof fetch;

function secureEqual(actual: string | undefined, expected: string) {
  if (!actual) return false;
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

export class N8nDispatcher implements LeadWorkflowDispatcher {
  readonly configured: boolean;
  readonly required: boolean;

  constructor(
    private readonly webhookUrl: string | undefined,
    private readonly sharedSecret: string | undefined,
    required = false,
    private readonly fetcher: FetchLike = fetch,
  ) {
    this.configured = Boolean(webhookUrl && sharedSecret && sharedSecret.length >= 32);
    this.required = required;
  }

  authorizeInternalRequest(secret: string | undefined) {
    return Boolean(this.sharedSecret && secureEqual(secret, this.sharedSecret));
  }

  async dispatchLeadCreated(event: LeadWorkflowEvent) {
    if (!this.configured || !this.webhookUrl || !this.sharedSecret) {
      throw new Error("N8N_NOT_CONFIGURED");
    }

    const response = await this.fetcher(this.webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-LeadOps-Workflow-Secret": this.sharedSecret,
      },
      body: JSON.stringify({
        version: 1,
        event: "lead.received",
        leadId: event.leadId,
        idempotencyKey: event.idempotencyKey,
        occurredAt: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(8_000),
    });

    if (!response.ok) {
      throw new Error(`N8N_WEBHOOK_HTTP_${response.status}`);
    }
  }
}

export function createConfiguredN8nDispatcher() {
  return new N8nDispatcher(
    process.env.N8N_WEBHOOK_URL,
    process.env.N8N_SHARED_SECRET,
    process.env.N8N_REQUIRED?.toLowerCase() === "true",
  );
}
