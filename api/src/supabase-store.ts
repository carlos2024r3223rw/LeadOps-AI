import { createHash, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { analyzeLeadWithGemini, geminiIsConfigured } from "./ai/gemini.js";
import { DemoStore } from "./store.js";
import type { DeliveryActor, LeadStore } from "./store-contract.js";
import { createConfiguredGmailService, GmailDeliveryError, type GmailService } from "./gmail.js";
import type { Activity, Assessment, Draft, Execution, Lead, LeadInput, Service } from "./types.js";

type Row = Record<string, any>;

function databaseError(context: string, error: { message: string; code?: string }) {
  return new Error(`${context}: ${error.code ? `${error.code} ` : ""}${error.message}`);
}

function payloadHash(input: LeadInput) {
  return createHash("sha256").update(JSON.stringify({
    name: input.name.trim(),
    email: input.email.trim().toLowerCase(),
    company: input.company?.trim() || null,
    service: input.service,
    budget: input.budget,
    timeline: input.timeline,
    description: input.description.trim(),
    preferredLanguage: input.preferredLanguage ?? "es",
  })).digest("hex");
}

function tone(value: unknown): Activity["tone"] {
  return value === "success" || value === "warning" || value === "danger" ? value : "neutral";
}

export class SupabaseStore implements LeadStore {
  private readonly client: SupabaseClient;

  constructor(url: string, secretKey: string, private readonly gmail?: GmailService) {
    this.client = createClient(url, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { "X-Client-Info": "leadops-api/0.1" } },
    });
  }

  private async hydrate(rows: Row[]): Promise<Lead[]> {
    if (!rows.length) return [];
    const ids = rows.map((row) => row.id as string);
    const [eventsResult, executionsResult, assessmentsResult, draftsResult, approvalsResult, messagesResult] = await Promise.all([
      this.client.from("activity_events").select("*").in("lead_id", ids).order("created_at", { ascending: true }),
      this.client.from("workflow_executions").select("*").in("lead_id", ids).order("created_at", { ascending: true }),
      this.client.from("lead_assessments").select("*").in("lead_id", ids),
      this.client.from("response_drafts").select("*").in("lead_id", ids),
      this.client.from("approvals").select("*").in("lead_id", ids).order("created_at", { ascending: true }),
      this.client.from("outbound_messages").select("*").in("lead_id", ids).order("created_at", { ascending: true }),
    ]);
    for (const [context, result] of [
      ["load activity", eventsResult], ["load executions", executionsResult], ["load assessments", assessmentsResult],
      ["load drafts", draftsResult], ["load approvals", approvalsResult], ["load messages", messagesResult],
    ] as const) if (result.error) throw databaseError(context, result.error);

    const events = eventsResult.data as Row[];
    const executions = executionsResult.data as Row[];
    const assessments = assessmentsResult.data as Row[];
    const drafts = draftsResult.data as Row[];
    const approvals = approvalsResult.data as Row[];
    const messages = messagesResult.data as Row[];

    return rows.map((row): Lead => {
      const assessmentRow = assessments.find((item) => item.id === row.current_assessment_id);
      const draftRow = drafts.find((item) => item.id === row.current_draft_id);
      const approvalRow = approvals.findLast((item) => item.decision === "approved" && item.lead_id === row.id);
      const messageRow = messages.findLast((item) => item.lead_id === row.id);
      const assessment: Assessment | undefined = assessmentRow ? {
        classification: assessmentRow.classification,
        priority: assessmentRow.priority,
        detectedService: assessmentRow.detected_service,
        missingFields: assessmentRow.missing_fields ?? [],
        summary: assessmentRow.summary,
        confidence: Number(assessmentRow.confidence ?? 0),
      } : undefined;
      const draft: Draft | undefined = draftRow ? {
        subject: draftRow.subject,
        body: draftRow.body,
        version: draftRow.version,
        updatedAt: draftRow.created_at,
      } : undefined;
      return {
        id: row.id,
        reference: `LO-${row.reference}`,
        name: row.name,
        email: row.email,
        company: row.company ?? undefined,
        service: row.requested_service as Service,
        budget: row.budget,
        timeline: row.timeline,
        description: row.description,
        preferredLanguage: row.preferred_language ?? "es",
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        assessment,
        draft,
        approvedAt: approvalRow?.created_at,
        sentAt: row.sent_at ?? messageRow?.sent_at ?? undefined,
        providerMessageId: messageRow?.provider_message_id ?? undefined,
        activities: events.filter((item) => item.lead_id === row.id).map((item): Activity => ({
          id: item.id,
          type: item.event_type,
          title: item.title,
          detail: item.detail ?? "",
          tone: tone(item.metadata?.tone),
          createdAt: item.created_at,
        })),
        executions: executions.filter((item) => item.lead_id === row.id).map((item): Execution => ({
          id: item.id,
          attempt: item.attempt,
          status: item.status === "succeeded" || item.status === "failed" ? item.status : "running",
          model: item.model ?? "pending",
          inputTokens: item.input_tokens ?? 0,
          outputTokens: item.output_tokens ?? 0,
          estimatedCostUsd: Number(item.estimated_cost_usd ?? 0),
          latencyMs: item.latency_ms ?? 0,
          error: item.error_code ?? item.error_message ?? undefined,
          createdAt: item.created_at,
        })),
      };
    });
  }

  async list(): Promise<Lead[]> {
    const result = await this.client.from("leads").select("*").order("created_at", { ascending: false });
    if (result.error) throw databaseError("list leads", result.error);
    return this.hydrate(result.data as Row[]);
  }

  async get(id: string): Promise<Lead | undefined> {
    const result = await this.client.from("leads").select("*").eq("id", id).maybeSingle();
    if (result.error) throw databaseError("get lead", result.error);
    return result.data ? (await this.hydrate([result.data as Row]))[0] : undefined;
  }

  async create(input: LeadInput): Promise<{ lead: Lead; duplicate: boolean }> {
    const normalizedKey = input.idempotencyKey.trim().toLowerCase();
    const existing = await this.client.from("lead_requests").select("lead_id").eq("idempotency_key", normalizedKey).maybeSingle();
    if (existing.error) throw databaseError("check intake idempotency", existing.error);
    if (existing.data) return { lead: (await this.get(existing.data.lead_id))!, duplicate: true };

    const inserted = await this.client.from("leads").insert({
      status: "processing",
      name: input.name.trim(),
      email: input.email.trim().toLowerCase(),
      company: input.company?.trim() || null,
      requested_service: input.service,
      budget: input.budget,
      timeline: input.timeline,
      description: input.description.trim(),
      preferred_language: input.preferredLanguage ?? "es",
    }).select("*").single();
    if (inserted.error) throw databaseError("create lead", inserted.error);
    const row = inserted.data as Row;

    const envelope = await this.client.from("lead_requests").insert({
      lead_id: row.id,
      idempotency_key: normalizedKey,
      payload_hash: payloadHash(input),
    });
    if (envelope.error) {
      await this.client.from("leads").delete().eq("id", row.id);
      if (envelope.error.code === "23505") {
        const winner = await this.client.from("lead_requests").select("lead_id").eq("idempotency_key", normalizedKey).single();
        if (!winner.error) return { lead: (await this.get(winner.data.lead_id))!, duplicate: true };
      }
      throw databaseError("record intake idempotency", envelope.error);
    }

    const events = await this.client.from("activity_events").insert([
      { lead_id: row.id, event_type: "lead.created", title: "Lead recibido", detail: "Solicitud persistida en Supabase", metadata: { tone: "neutral" } },
      { lead_id: row.id, event_type: "ai.started", title: "Análisis iniciado", detail: `Respuesta solicitada en ${input.preferredLanguage === "en" ? "inglés" : "español"}`, metadata: { tone: "neutral" } },
    ]);
    if (events.error) throw databaseError("record intake activity", events.error);
    return { lead: (await this.get(row.id))!, duplicate: false };
  }

  async process(id: string): Promise<Lead | undefined> {
    const lead = await this.get(id);
    if (!lead) return undefined;
    if (lead.status === "needs_review" || lead.status === "sent" || lead.status === "discarded") return lead;
    const attempt = lead.executions.length + 1;
    const executionKey = `lead-analysis:${id}:attempt:${attempt}`;
    const executionResult = await this.client.from("workflow_executions").insert({
      lead_id: id,
      workflow_name: "lead-ai-analysis",
      idempotency_key: executionKey,
      attempt,
      status: "running",
      model: process.env.GEMINI_MODEL || "gemini-3.1-flash-lite",
      started_at: new Date().toISOString(),
    }).select("*").single();
    if (executionResult.error) {
      if (executionResult.error.code === "23505") return this.get(id);
      throw databaseError("start AI execution", executionResult.error);
    }
    const execution = executionResult.data as Row;

    try {
      if (!geminiIsConfigured()) throw new Error("GEMINI_API_KEY_MISSING");
      const result = await analyzeLeadWithGemini(lead);
      const versionResult = await this.client.from("lead_assessments").select("version").eq("lead_id", id).order("version", { ascending: false }).limit(1).maybeSingle();
      if (versionResult.error) throw databaseError("read assessment version", versionResult.error);
      const version = (versionResult.data?.version ?? 0) + 1;
      const assessmentResult = await this.client.from("lead_assessments").insert({
        lead_id: id,
        execution_id: execution.id,
        version,
        classification: result.assessment.classification,
        priority: result.assessment.priority,
        detected_service: result.assessment.detectedService,
        missing_fields: result.assessment.missingFields,
        summary: result.assessment.summary,
        confidence: result.assessment.confidence,
        raw_structured_output: result.assessment,
      }).select("*").single();
      if (assessmentResult.error) throw databaseError("save AI assessment", assessmentResult.error);
      const draftResult = await this.client.from("response_drafts").insert({
        lead_id: id,
        assessment_id: assessmentResult.data.id,
        version,
        subject: result.draft.subject,
        body: result.draft.body,
        authored_by: "ai",
      }).select("*").single();
      if (draftResult.error) throw databaseError("save AI draft", draftResult.error);
      const completedAt = new Date().toISOString();
      const [leadUpdate, executionUpdate, eventInsert] = await Promise.all([
        this.client.from("leads").update({ status: "needs_review", current_assessment_id: assessmentResult.data.id, current_draft_id: draftResult.data.id }).eq("id", id),
        this.client.from("workflow_executions").update({ status: "succeeded", model: result.model, input_tokens: result.inputTokens, output_tokens: result.outputTokens, estimated_cost_usd: result.estimatedCostUsd, latency_ms: result.latencyMs, completed_at: completedAt }).eq("id", execution.id),
        this.client.from("activity_events").insert({ lead_id: id, execution_id: execution.id, event_type: "ai.completed", title: "Análisis completado", detail: `Intento ${attempt} · borrador persistido`, metadata: { tone: "success" } }),
      ]);
      if (leadUpdate.error) throw databaseError("complete lead analysis", leadUpdate.error);
      if (executionUpdate.error) throw databaseError("complete AI execution", executionUpdate.error);
      if (eventInsert.error) throw databaseError("record AI completion", eventInsert.error);
    } catch (error) {
      const code = error instanceof Error ? error.message.slice(0, 200) : "GEMINI_UNKNOWN_ERROR";
      await Promise.all([
        this.client.from("leads").update({ status: "failed" }).eq("id", id),
        this.client.from("workflow_executions").update({ status: "failed", error_code: code, error_message: code, completed_at: new Date().toISOString() }).eq("id", execution.id),
        this.client.from("activity_events").insert({ lead_id: id, execution_id: execution.id, event_type: "ai.failed", title: "Falló el análisis", detail: `${code} · reintento seguro disponible`, metadata: { tone: "danger" } }),
      ]);
    }
    return this.get(id);
  }

  async updateDraft(id: string, subject: string, body: string): Promise<Lead | undefined> {
    const lead = await this.get(id);
    if (!lead?.draft || lead.status !== "needs_review") return undefined;
    const inserted = await this.client.from("response_drafts").insert({
      lead_id: id,
      assessment_id: lead.assessment ? (await this.client.from("leads").select("current_assessment_id").eq("id", id).single()).data?.current_assessment_id : null,
      version: lead.draft.version + 1,
      subject: subject.trim(),
      body: body.trim(),
      authored_by: "human",
      previous_draft_id: (await this.client.from("leads").select("current_draft_id").eq("id", id).single()).data?.current_draft_id,
    }).select("*").single();
    if (inserted.error) throw databaseError("save edited draft", inserted.error);
    const updated = await this.client.from("leads").update({ current_draft_id: inserted.data.id }).eq("id", id);
    if (updated.error) throw databaseError("activate edited draft", updated.error);
    await this.client.from("activity_events").insert({ lead_id: id, event_type: "draft.edited", title: "Borrador editado", detail: `Versión ${inserted.data.version} guardada`, metadata: { tone: "neutral" } });
    return this.get(id);
  }

  async approveAndSend(id: string, actor?: DeliveryActor): Promise<{ lead?: Lead; duplicate: boolean }> {
    const lead = await this.get(id);
    if (!lead?.draft) return { duplicate: false };
    if (lead.status === "sent") return { lead, duplicate: true };
    if (!["needs_review", "approved", "failed"].includes(lead.status)) return { duplicate: false };
    const current = await this.client.from("leads").select("current_draft_id").eq("id", id).single();
    if (current.error) throw databaseError("read current draft", current.error);
    const approval = await this.client.from("approvals").insert({
      lead_id: id,
      draft_id: current.data.current_draft_id,
      draft_version: lead.draft.version,
      decision: "approved",
      decided_by: actor?.id ?? null,
      decided_by_label: actor?.email || "LeadOps administrator",
    }).select("*").single();
    if (approval.error && approval.error.code !== "23505") throw databaseError("record approval", approval.error);
    const approvalRow = approval.data ?? (await this.client.from("approvals").select("*").eq("draft_id", current.data.current_draft_id).eq("decision", "approved").single()).data;
    if (!approvalRow) throw new Error("record approval: approval row unavailable");
    const sendKey = `send:${id}:draft:${lead.draft.version}`;
    const message = await this.client.from("outbound_messages").insert({
      lead_id: id,
      draft_id: current.data.current_draft_id,
      approval_id: approvalRow.id,
      idempotency_key: sendKey,
      recipient_email: lead.email,
      subject: lead.draft.subject,
      body: lead.draft.body,
      status: "pending",
    }).select("*").single();
    if (message.error && message.error.code !== "23505") throw databaseError("create email outbox message", message.error);
    const messageRow = message.data ?? (await this.client.from("outbound_messages").select("*").eq("idempotency_key", sendKey).single()).data;
    if (!messageRow) throw new Error("create email outbox message: message row unavailable");
    if (messageRow.status === "sent" || messageRow.status === "sending") return { lead: (await this.get(id))!, duplicate: true };

    if (!approval.error) {
      await this.client.from("leads").update({ status: "approved" }).eq("id", id);
      await this.client.from("activity_events").insert({
        lead_id: id,
        actor_user_id: actor?.id ?? null,
        event_type: "draft.approved",
        title: "Respuesta aprobada",
        detail: `Versión ${lead.draft.version} · ${actor?.email || "LeadOps administrator"}`,
        metadata: { tone: "success" },
      });
    }

    if (!this.gmail || this.gmail.mode !== "real") {
      const providerMessageId = `demo_gmail_${randomUUID().slice(0, 8)}`;
      const sentAt = new Date().toISOString();
      const simulated = await this.client.from("outbound_messages").update({ status: "sent", attempt_count: Number(messageRow.attempt_count ?? 0) + 1, provider_message_id: providerMessageId, sent_at: sentAt }).eq("id", messageRow.id).in("status", ["pending", "failed"]);
      if (simulated.error) throw databaseError("finish simulated send", simulated.error);
      await this.client.from("leads").update({ status: "sent", sent_at: sentAt }).eq("id", id);
      await this.client.from("activity_events").insert({ lead_id: id, event_type: "email.sent", title: "Envío simulado", detail: `No se envió un correo real · ${providerMessageId}`, metadata: { tone: "success", delivery: "simulated" } });
      return { lead: await this.get(id), duplicate: false };
    }

    if (!actor) throw new GmailDeliveryError("GMAIL_ACTOR_REQUIRED", "An authenticated administrator is required for real Gmail delivery.");
    const claimed = await this.client.from("outbound_messages").update({
      status: "sending",
      attempt_count: Number(messageRow.attempt_count ?? 0) + 1,
      claimed_at: new Date().toISOString(),
      claimed_by: actor.id,
      last_error_code: null,
      last_error_message: null,
    }).eq("id", messageRow.id).in("status", ["pending", "failed"]).select("*").maybeSingle();
    if (claimed.error) throw databaseError("claim Gmail message", claimed.error);
    if (!claimed.data) return { lead: (await this.get(id))!, duplicate: true };
    await this.client.from("leads").update({ status: "sending" }).eq("id", id);
    await this.client.from("activity_events").insert({ lead_id: id, actor_user_id: actor.id, event_type: "email.sending", title: "Envío iniciado", detail: "Entrega real mediante Gmail API", metadata: { tone: "neutral", delivery: "real" } });

    try {
      const provider = await this.gmail.send({
        ownerUserId: actor.id,
        to: lead.email,
        subject: lead.draft.subject,
        body: lead.draft.body,
        messageId: `leadops-${createHash("sha256").update(sendKey).digest("hex").slice(0, 32)}@leadops.local`,
      });
      const sentAt = new Date().toISOString();
      const [messageUpdate, leadUpdate, activity] = await Promise.all([
        this.client.from("outbound_messages").update({ status: "sent", provider_message_id: provider.id, sent_at: sentAt }).eq("id", messageRow.id).eq("status", "sending"),
        this.client.from("leads").update({ status: "sent", sent_at: sentAt }).eq("id", id),
        this.client.from("activity_events").insert({ lead_id: id, actor_user_id: actor.id, event_type: "email.sent", title: "Correo enviado", detail: `Gmail · ${provider.id}`, metadata: { tone: "success", delivery: "real", thread_id: provider.threadId } }),
      ]);
      if (messageUpdate.error) throw databaseError("record Gmail delivery", messageUpdate.error);
      if (leadUpdate.error) throw databaseError("finish Gmail delivery", leadUpdate.error);
      if (activity.error) throw databaseError("record Gmail activity", activity.error);
      return { lead: await this.get(id), duplicate: false };
    } catch (error) {
      const deliveryError = error instanceof GmailDeliveryError ? error : new GmailDeliveryError("GMAIL_DELIVERY_UNKNOWN", error instanceof Error ? error.message : "Unknown Gmail delivery error");
      const knownFailure = deliveryError.code !== "GMAIL_DELIVERY_UNKNOWN" && !deliveryError.deliveryUnknown;
      await Promise.all([
        this.client.from("outbound_messages").update({ status: knownFailure ? "failed" : "sending", last_error_code: deliveryError.code, last_error_message: deliveryError.message }).eq("id", messageRow.id),
        this.client.from("leads").update({ status: knownFailure ? "failed" : "sending" }).eq("id", id),
        this.client.from("activity_events").insert({ lead_id: id, actor_user_id: actor.id, event_type: "email.failed", title: knownFailure ? "Falló el envío" : "Entrega por confirmar", detail: `${deliveryError.code} · ${deliveryError.message}`, metadata: { tone: "danger", delivery: "real", retryable: knownFailure && deliveryError.retryable } }),
      ]);
      return { lead: await this.get(id), duplicate: false };
    }
  }

  async discard(id: string): Promise<Lead | undefined> {
    const lead = await this.get(id);
    if (!lead?.draft || lead.status !== "needs_review") return undefined;
    const current = await this.client.from("leads").select("current_draft_id").eq("id", id).single();
    if (current.error) throw databaseError("read current draft", current.error);
    const approval = await this.client.from("approvals").insert({ lead_id: id, draft_id: current.data.current_draft_id, draft_version: lead.draft.version, decision: "discarded", decided_by_label: "Admin Demo" });
    if (approval.error && approval.error.code !== "23505") throw databaseError("record discard", approval.error);
    const updated = await this.client.from("leads").update({ status: "discarded", discarded_at: new Date().toISOString() }).eq("id", id);
    if (updated.error) throw databaseError("discard lead", updated.error);
    await this.client.from("activity_events").insert({ lead_id: id, event_type: "lead.discarded", title: "Lead descartado", detail: "Decisión persistida por Admin Demo", metadata: { tone: "warning" } });
    return this.get(id);
  }
}

export function createConfiguredStore(gmail = createConfiguredGmailService()): LeadStore {
  const url = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  return url && secretKey ? new SupabaseStore(url, secretKey, gmail) : new DemoStore();
}
