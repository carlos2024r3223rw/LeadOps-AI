import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { z } from "zod";
import { createConfiguredStore } from "./supabase-store.js";
import type { LeadStore } from "./store-contract.js";
import { authorizeAdmin } from "./auth.js";
import { DemoSessions } from "./demo-sessions.js";

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

export async function buildApp(store: LeadStore = createConfiguredStore()) {
  const app = Fastify({ logger: false });
  const demoSessions = new DemoSessions();
  const allowedOrigins = (process.env.WEB_ORIGIN ?? "http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  await app.register(cors, { origin: allowedOrigins });
  await app.register(rateLimit, { global: false });

  async function protectedStore(request: FastifyRequest, reply: FastifyReply): Promise<LeadStore | undefined> {
    const demoSessionId = request.headers["x-demo-session"];
    if (typeof demoSessionId === "string") {
      const demoStore = await demoSessions.get(demoSessionId);
      if (demoStore) return demoStore;
      await reply.code(401).send({ error: "Demo session expired" });
      return undefined;
    }
    const user = await authorizeAdmin(request.headers.authorization);
    if (user) return store;
    await reply.code(401).send({ error: "Authentication required" });
    return undefined;
  }

  app.get("/health", async () => {
    const geminiEnabled = Boolean(process.env.GEMINI_API_KEY) && process.env.DEMO_MODE?.toLowerCase() !== "true";
    const persistentStorage = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);
    return { status: "ok", mode: geminiEnabled ? "gemini" : "demo", storage: persistentStorage ? "supabase" : "memory", delivery: "simulated" };
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
    const selectedStore = await protectedStore(request, reply);
    return selectedStore ? { data: await selectedStore.list() } : undefined;
  });
  app.get<{ Params: { id: string } }>("/v1/leads/:id", async (request, reply) => {
    const selectedStore = await protectedStore(request, reply);
    if (!selectedStore) return;
    const lead = await selectedStore.get(request.params.id);
    return lead ? { data: lead } : reply.code(404).send({ error: "Lead not found" });
  });
  app.post("/v1/public/leads", { config: { rateLimit: { max: 5, timeWindow: "1 hour" } } }, async (request, reply) => {
    const parsed = leadSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid lead", issues: parsed.error.issues });
    const result = await store.create(parsed.data);
    const lead = result.duplicate ? result.lead : (await store.process(result.lead.id) ?? result.lead);
    return reply.code(result.duplicate ? 200 : 201).send({ data: lead, duplicate: result.duplicate });
  });
  app.post("/v1/leads", async (request, reply) => {
    const selectedStore = await protectedStore(request, reply);
    if (!selectedStore) return;
    const parsed = leadSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid lead", issues: parsed.error.issues });
    const result = await selectedStore.create(parsed.data);
    return reply.code(result.duplicate ? 200 : 201).send({ data: result.lead, duplicate: result.duplicate });
  });
  app.post<{ Params: { id: string } }>("/v1/leads/:id/process", async (request, reply) => {
    const selectedStore = await protectedStore(request, reply);
    if (!selectedStore) return;
    const lead = await selectedStore.process(request.params.id);
    return lead ? { data: lead } : reply.code(404).send({ error: "Lead not found" });
  });
  app.patch<{ Params: { id: string } }>("/v1/leads/:id/draft", async (request, reply) => {
    const selectedStore = await protectedStore(request, reply);
    if (!selectedStore) return;
    const parsed = draftSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid draft", issues: parsed.error.issues });
    const lead = await selectedStore.updateDraft(request.params.id, parsed.data.subject, parsed.data.body);
    return lead ? { data: lead } : reply.code(409).send({ error: "Draft is not editable" });
  });
  app.post<{ Params: { id: string } }>("/v1/leads/:id/approve", async (request, reply) => {
    const selectedStore = await protectedStore(request, reply);
    if (!selectedStore) return;
    const result = await selectedStore.approveAndSend(request.params.id);
    if (!result.lead) return reply.code(409).send({ error: "Lead cannot be approved" });
    return { data: result.lead, duplicate: result.duplicate };
  });
  app.post<{ Params: { id: string } }>("/v1/leads/:id/discard", async (request, reply) => {
    const selectedStore = await protectedStore(request, reply);
    if (!selectedStore) return;
    const lead = await selectedStore.discard(request.params.id);
    return lead ? { data: lead } : reply.code(409).send({ error: "Lead cannot be discarded" });
  });

  return app;
}

