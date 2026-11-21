import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { z } from "zod";
import { createConfiguredStore } from "./supabase-store.js";
import type { LeadStore } from "./store-contract.js";
import { authorizeAdmin } from "./auth.js";
import { DemoSessions } from "./demo-sessions.js";
import { createConfiguredGmailService, GmailDeliveryError, type GmailService } from "./gmail.js";
import { createConfiguredN8nDispatcher, type LeadWorkflowDispatcher } from "./n8n.js";

const leadSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.email().max(254),
  company: z.string().trim().max(160).optional(),
  service: z.enum(["wordpress", "woocommerce", "shopify", "other"]),
  budget: z.string().trim().min(2).max(80),
  timeline: z.string().trim().min(2).max(80),
  description: z.string().trim().min(20).max(4000),
  preferredLanguage: z.enum(["es", "en"]).default("es"),
  idempotencyKey: z.string().trim().min(8).max(200),
});

const draftSchema = z.object({
  subject: z.string().trim().min(3).max(180),
  body: z.string().trim().min(20).max(10000),
});

const workflowLeadSchema = z.object({
  leadId: z.uuid(),
  idempotencyKey: z.string().trim().min(8).max(240),
});

export async function buildApp(
  store?: LeadStore,
  gmail: GmailService | undefined = createConfiguredGmailService(),
  n8n: LeadWorkflowDispatcher = createConfiguredN8nDispatcher(),
) {
  const app = Fastify({ logger: false });
  const configuredStore = store ?? createConfiguredStore(gmail);
  const demoSessions = new DemoSessions();
  const allowedOrigins = (process.env.WEB_ORIGIN ?? "http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  await app.register(cors, { origin: allowedOrigins });
  await app.register(rateLimit, { global: false });

  async function protectedContext(request: FastifyRequest, reply: FastifyReply) {
    const demoSessionId = request.headers["x-demo-session"];
    if (typeof demoSessionId === "string") {
      const demoStore = await demoSessions.get(demoSessionId);
      if (demoStore) return { store: demoStore, mode: "demo" as const };
      await reply.code(401).send({ error: "Demo session expired" });
      return undefined;
    }
    const user = await authorizeAdmin(request.headers.authorization);
    if (user) return { store: configuredStore, mode: "admin" as const, user };
    await reply.code(401).send({ error: "Authentication required" });
    return undefined;
  }

  app.get("/health", async () => {
    const geminiEnabled = Boolean(process.env.GEMINI_API_KEY) && process.env.DEMO_MODE?.toLowerCase() !== "true";
    const persistentStorage = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);
    return {
      status: "ok",
      mode: geminiEnabled ? "gemini" : "demo",
      storage: persistentStorage ? "supabase" : "memory",
      delivery: gmail?.mode === "real" && gmail.configured ? "gmail" : "simulated",
      orchestration: n8n.configured ? "n8n" : "inline",
    };
  });
  app.post("/v1/demo/session", async () => {
    const session = await demoSessions.create();
    return { data: { sessionId: session.id, expiresAt: session.expiresAt, mode: "isolated_demo" } };
  });
  app.get("/v1/auth/me", async (request, reply) => {
    const demoSessionId = request.headers["x-demo-session"];
    if (typeof demoSessionId === "string" && await demoSessions.get(demoSessionId)) return { data: { mode: "demo", role: "demo_visitor" } };
    const user = await authorizeAdmin(request.headers.authorization);
    return user ? { data: { mode: "admin", ...user } } : reply.code(401).send({ error: "Authentication required" });
  });
  app.get("/v1/leads", async (request, reply) => {
    const context = await protectedContext(request, reply);
    return context ? { data: await context.store.list() } : undefined;
  });
  app.get<{ Params: { id: string } }>("/v1/leads/:id", async (request, reply) => {
    const context = await protectedContext(request, reply);
    if (!context) return;
    const lead = await context.store.get(request.params.id);
    return lead ? { data: lead } : reply.code(404).send({ error: "Lead not found" });
  });
  app.post("/v1/public/leads", { config: { rateLimit: { max: 5, timeWindow: "1 hour" } } }, async (request, reply) => {
    const parsed = leadSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid lead", issues: parsed.error.issues });
    const result = await configuredStore.create(parsed.data);
    const workflowKey = `lead-analysis:${result.lead.id}:${parsed.data.idempotencyKey.trim().toLowerCase()}`;
    if (result.duplicate) {
      if (n8n.configured && ["processing", "failed"].includes(result.lead.status)) {
        try {
          await n8n.dispatchLeadCreated({ leadId: result.lead.id, idempotencyKey: workflowKey });
          return reply.code(200).send({ data: result.lead, duplicate: true, orchestration: "n8n_retry" });
        } catch (error) {
          if (n8n.required) {
            const message = error instanceof Error ? error.message : "N8N_DISPATCH_FAILED";
            return reply.code(502).send({ error: "Workflow dispatch failed", code: message, data: result.lead, duplicate: true });
          }
        }
      }
      return reply.code(200).send({ data: result.lead, duplicate: true, orchestration: "duplicate" });
    }

    if (n8n.configured) {
      try {
        await n8n.dispatchLeadCreated({ leadId: result.lead.id, idempotencyKey: workflowKey });
        return reply.code(201).send({ data: result.lead, duplicate: false, orchestration: "n8n" });
      } catch (error) {
        if (n8n.required) {
          const message = error instanceof Error ? error.message : "N8N_DISPATCH_FAILED";
          return reply.code(502).send({ error: "Workflow dispatch failed", code: message, data: result.lead });
        }
      }
    }

    const lead = await configuredStore.process(result.lead.id, workflowKey) ?? result.lead;
    return reply.code(201).send({ data: lead, duplicate: false, orchestration: n8n.configured ? "inline_fallback" : "inline" });
  });

  app.post("/v1/internal/workflows/lead-analysis", async (request, reply) => {
    const secretHeader = request.headers["x-leadops-workflow-secret"];
    const secret = Array.isArray(secretHeader) ? secretHeader[0] : secretHeader;
    if (!n8n.configured || !n8n.authorizeInternalRequest(secret)) {
      return reply.code(401).send({ error: "Invalid workflow credentials" });
    }
    const parsed = workflowLeadSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid workflow event", issues: parsed.error.issues });
    const lead = await configuredStore.process(parsed.data.leadId, parsed.data.idempotencyKey);
    return lead ? { data: lead } : reply.code(404).send({ error: "Lead not found" });
  });
  app.post("/v1/leads", async (request, reply) => {
    const context = await protectedContext(request, reply);
    if (!context) return;
    const parsed = leadSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid lead", issues: parsed.error.issues });
    const result = await context.store.create(parsed.data);
    return reply.code(result.duplicate ? 200 : 201).send({ data: result.lead, duplicate: result.duplicate });
  });
  app.post<{ Params: { id: string } }>("/v1/leads/:id/process", async (request, reply) => {
    const context = await protectedContext(request, reply);
    if (!context) return;
    const lead = await context.store.process(request.params.id);
    return lead ? { data: lead } : reply.code(404).send({ error: "Lead not found" });
  });
  app.patch<{ Params: { id: string } }>("/v1/leads/:id/draft", async (request, reply) => {
    const context = await protectedContext(request, reply);
    if (!context) return;
    const parsed = draftSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid draft", issues: parsed.error.issues });
    const lead = await context.store.updateDraft(request.params.id, parsed.data.subject, parsed.data.body);
    return lead ? { data: lead } : reply.code(409).send({ error: "Draft is not editable" });
  });
  app.post<{ Params: { id: string } }>("/v1/leads/:id/approve", async (request, reply) => {
    const context = await protectedContext(request, reply);
    if (!context) return;
    const result = await context.store.approveAndSend(request.params.id, context.user);
    if (!result.lead) return reply.code(409).send({ error: "Lead cannot be approved" });
    return { data: result.lead, duplicate: result.duplicate };
  });
  app.post<{ Params: { id: string } }>("/v1/leads/:id/discard", async (request, reply) => {
    const context = await protectedContext(request, reply);
    if (!context) return;
    const lead = await context.store.discard(request.params.id);
    return lead ? { data: lead } : reply.code(409).send({ error: "Lead cannot be discarded" });
  });

  app.get("/v1/integrations/gmail/status", async (request, reply) => {
    const context = await protectedContext(request, reply);
    if (!context) return;
    if (context.mode === "demo") return { data: { mode: "simulated", configured: false, connected: false } };
    if (!gmail) return { data: { mode: "simulated", configured: false, connected: false } };
    return { data: await gmail.status(context.user.id) };
  });

  app.post("/v1/integrations/gmail/connect", async (request, reply) => {
    const context = await protectedContext(request, reply);
    if (!context) return;
    if (context.mode === "demo") return reply.code(403).send({ error: "Gmail cannot be connected from an isolated demo session." });
    if (!gmail) return reply.code(503).send({ error: "Gmail OAuth is not configured on the API." });
    try {
      return { data: { authorizationUrl: await gmail.createAuthorizationUrl(context.user.id) } };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not start Gmail authorization.";
      return reply.code(503).send({ error: message });
    }
  });

  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>("/v1/integrations/gmail/callback", async (request, reply) => {
    if (!gmail) return reply.redirect("http://localhost:5173?gmail=error&reason=not_configured");
    if (request.query.error) return reply.redirect(gmail.callbackRedirect("error", request.query.error));
    if (!request.query.code || !request.query.state) return reply.redirect(gmail.callbackRedirect("error", "missing_callback_parameters"));
    try {
      await gmail.completeAuthorization(request.query.code, request.query.state);
      return reply.redirect(gmail.callbackRedirect("connected"));
    } catch (error) {
      const code = error instanceof GmailDeliveryError ? error.code : "GMAIL_CALLBACK_FAILED";
      return reply.redirect(gmail.callbackRedirect("error", code));
    }
  });

  app.delete("/v1/integrations/gmail", async (request, reply) => {
    const context = await protectedContext(request, reply);
    if (!context) return;
    if (context.mode === "demo" || !gmail) return reply.code(403).send({ error: "No Gmail connection is available." });
    await gmail.disconnect(context.user.id);
    return { data: { connected: false } };
  });

  return app;
}

