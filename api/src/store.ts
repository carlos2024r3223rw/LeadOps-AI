import { randomUUID } from "node:crypto";
import type { Activity, Assessment, Draft, Execution, Lead, LeadInput } from "./types.js";
import type { LeadStore } from "./store-contract.js";
import { analyzeLeadWithGemini, geminiIsConfigured } from "./ai/gemini.js";

const iso = (offsetMinutes = 0) => new Date(Date.now() + offsetMinutes * 60_000).toISOString();

const activity = (
  type: string,
  title: string,
  detail: string,
  tone: Activity["tone"] = "neutral",
  createdAt = iso(),
): Activity => ({ id: randomUUID(), type, title, detail, tone, createdAt });

const draftFor = (lead: Lead): Draft => ({
  subject: lead.preferredLanguage === "en" ? `Next steps for your ${lead.service} project` : `Siguientes pasos para su proyecto de ${lead.service}`,
  body: lead.preferredLanguage === "en"
    ? `Hi ${lead.name.split(" ")[0]},\n\nThank you for sharing the details of ${lead.company ? `${lead.company}'s project` : "your project"}. We can help with a ${lead.service} solution focused on your goals and timeline.\n\nBefore preparing an accurate proposal, we would like to confirm a few details in a brief call. What time works for you this week?\n\nBest,\nLeadOps Team`
    : `Hola ${lead.name.split(" ")[0]},\n\nGracias por compartir los detalles de ${lead.company ? `el proyecto de ${lead.company}` : "su proyecto"}. Por lo que nos cuenta, podemos ayudarle con una solución de ${lead.service} enfocada en sus objetivos y plazo.\n\nAntes de preparar una propuesta precisa, nos gustaría confirmar algunos detalles en una llamada breve. ¿Qué horario le funciona esta semana?\n\nSaludos,\nEquipo LeadOps`,
  version: 1,
  updatedAt: iso(),
});

const assessmentFor = (lead: Lead): Assessment => {
  const urgent = /urgente|inmediato|esta semana/i.test(`${lead.timeline} ${lead.description}`);
  const highBudget = /10,?000|15,?000|20,?000|25,?000|50,?000/i.test(lead.budget);
  const missingFields = [!lead.company && "company", lead.description.length < 45 && "project_scope"].filter(Boolean) as string[];
  return {
    classification: lead.budget.toLowerCase().includes("por definir") ? "nurture" : "qualified",
    priority: urgent ? "urgent" : highBudget ? "high" : "medium",
    detectedService: lead.service,
    missingFields,
    summary: `${lead.company || lead.name} busca un proyecto de ${lead.service} con presupuesto ${lead.budget.toLowerCase()} y plazo ${lead.timeline.toLowerCase()}.`,
    confidence: 0.94,
  };
};

const seedLeads = (): Lead[] => [
  {
    id: "lead_demo_001",
    reference: "LO-1048",
    name: "María Fernanda López",
    email: "maria@luma-studio.example",
    company: "Luma Studio",
    service: "shopify",
    budget: "$10,000 – $25,000",
    timeline: "4–6 semanas",
    description: "Migración de catálogo a Shopify, rediseño de tienda y configuración de mercados internacionales.",
    status: "needs_review",
    createdAt: iso(-24),
    updatedAt: iso(-21),
    assessment: {
      classification: "qualified",
      priority: "high",
      detectedService: "shopify",
      missingFields: ["catalog_size", "target_markets"],
      summary: "Marca de diseño lista para migrar su catálogo a Shopify y vender internacionalmente.",
      confidence: 0.96,
    },
    draft: {
      subject: "Plan de migración a Shopify para Luma Studio",
      body: "Hola María,\n\nGracias por contarnos sobre la expansión de Luma Studio. Podemos ayudarles con la migración del catálogo, el rediseño y la configuración de mercados internacionales.\n\nPara dimensionar la propuesta, ¿podrías compartir cuántos productos tienen y cuáles son sus mercados prioritarios? Con eso podemos preparar un plan y coordinar una llamada de 30 minutos.\n\nSaludos,\nEquipo LeadOps",
      version: 1,
      updatedAt: iso(-21),
    },
    activities: [
      activity("lead.created", "Lead recibido", "Formulario público · luma-studio.example", "neutral", iso(-24)),
      activity("ai.completed", "Análisis completado", "Clasificado como oportunidad de alta prioridad", "success", iso(-21)),
    ],
    executions: [{ id: "exec_demo_001", attempt: 1, status: "succeeded", model: "demo-structured-v1", inputTokens: 812, outputTokens: 286, estimatedCostUsd: 0.0046, latencyMs: 1840, createdAt: iso(-21) }],
  },
  {
    id: "lead_demo_002",
    reference: "LO-1047",
    name: "Diego Ramírez",
    email: "diego@northstar.example",
    company: "Northstar Foods",
    service: "woocommerce",
    budget: "$5,000 – $10,000",
    timeline: "8–12 semanas",
    description: "Tienda B2B con precios por distribuidor, pedidos recurrentes e integración con inventario.",
    status: "sent",
    createdAt: iso(-188),
    updatedAt: iso(-142),
    assessment: { classification: "qualified", priority: "medium", detectedService: "woocommerce", missingFields: [], summary: "Fabricante de alimentos necesita un portal B2B integrado con inventario.", confidence: 0.92 },
    draft: { subject: "Portal B2B para Northstar Foods", body: "Hola Diego,\n\nGracias por escribirnos. Su portal B2B encaja muy bien con nuestra experiencia en WooCommerce. Hemos registrado los requisitos de precios por distribuidor, recurrencia e inventario.\n\n¿Coordinamos una llamada para revisar la integración actual?\n\nSaludos,\nEquipo LeadOps", version: 2, updatedAt: iso(-170) },
    approvedAt: iso(-150),
    sentAt: iso(-149),
    providerMessageId: "demo_gmail_7cc2",
    activities: [
      activity("lead.created", "Lead recibido", "Formulario público", "neutral", iso(-188)),
      activity("ai.completed", "Análisis completado", "Borrador listo para revisión", "success", iso(-180)),
      activity("draft.approved", "Respuesta aprobada", "Aprobada por Admin Demo", "success", iso(-150)),
      activity("email.sent", "Correo enviado", "Gmail · demo_gmail_7cc2", "success", iso(-149)),
    ],
    executions: [{ id: "exec_demo_002", attempt: 1, status: "succeeded", model: "demo-structured-v1", inputTokens: 704, outputTokens: 241, estimatedCostUsd: 0.0039, latencyMs: 1630, createdAt: iso(-180) }],
  },
  {
    id: "lead_demo_003",
    reference: "LO-1046",
    name: "Ana Torres",
    email: "ana@casa-verde.example",
    company: "Casa Verde",
    service: "wordpress",
    budget: "$2,500 – $5,000",
    timeline: "4 semanas",
    description: "Nuevo sitio corporativo bilingüe para una firma de arquitectura sostenible.",
    status: "failed",
    createdAt: iso(-305),
    updatedAt: iso(-296),
    activities: [
      activity("lead.created", "Lead recibido", "Formulario público", "neutral", iso(-305)),
      activity("ai.failed", "Falló el análisis", "Tiempo de espera agotado en el proveedor de IA", "danger", iso(-296)),
    ],
    executions: [{ id: "exec_demo_003", attempt: 1, status: "failed", model: "demo-structured-v1", inputTokens: 644, outputTokens: 0, estimatedCostUsd: 0.001, latencyMs: 30000, error: "AI_PROVIDER_TIMEOUT", createdAt: iso(-296) }],
  },
];

export interface DemoStoreState {
  leads: Lead[];
  requestKeys: Array<[string, string]>;
  sendKeys: Array<[string, string]>;
  nextReference: number;
}

export class DemoStore implements LeadStore {
  private readonly forceSimulation: boolean;
  private leads: Map<string, Lead>;
  private requestKeys: Map<string, string>;
  private sendKeys: Map<string, string>;
  private nextReference: number;

  constructor(options: { forceSimulation?: boolean; state?: DemoStoreState } = {}) {
    this.forceSimulation = options.forceSimulation ?? false;
    const state = options.state;
    this.leads = new Map((state?.leads ?? seedLeads()).map((lead) => [lead.id, structuredClone(lead)]));
    this.requestKeys = new Map(state?.requestKeys ?? []);
    this.sendKeys = new Map(state?.sendKeys ?? []);
    this.nextReference = state?.nextReference ?? 1049;
  }

  snapshot(): DemoStoreState {
    return {
      leads: structuredClone([...this.leads.values()]),
      requestKeys: [...this.requestKeys.entries()],
      sendKeys: [...this.sendKeys.entries()],
      nextReference: this.nextReference,
    };
  }

  list(): Lead[] {
    return [...this.leads.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  get(id: string): Lead | undefined {
    return this.leads.get(id);
  }

  create(input: LeadInput): { lead: Lead; duplicate: boolean } {
    const normalizedKey = input.idempotencyKey.trim().toLowerCase();
    const existingId = this.requestKeys.get(normalizedKey);
    if (existingId) return { lead: this.leads.get(existingId)!, duplicate: true };

    const now = iso();
    const lead: Lead = {
      id: randomUUID(),
      reference: `LO-${this.nextReference++}`,
      name: input.name.trim(),
      email: input.email.trim().toLowerCase(),
      company: input.company?.trim(),
      service: input.service,
      budget: input.budget,
      timeline: input.timeline,
      description: input.description.trim(),
      preferredLanguage: input.preferredLanguage ?? "es",
      status: "processing",
      createdAt: now,
      updatedAt: now,
      activities: [
        activity("lead.created", "Lead recibido", "Solicitud validada y protegida contra duplicados"),
        activity("ai.started", "Análisis iniciado", `Respuesta solicitada en ${input.preferredLanguage === "en" ? "inglés" : "español"}`),
      ],
      executions: [],
    };
    this.leads.set(lead.id, lead);
    this.requestKeys.set(normalizedKey, lead.id);
    return { lead, duplicate: false };
  }

  async process(id: string): Promise<Lead | undefined> {
    const lead = this.leads.get(id);
    if (!lead) return undefined;
    if (lead.status === "needs_review") return lead;

    const attempt = lead.executions.length + 1;
    try {
      if (!this.forceSimulation && geminiIsConfigured()) {
        const result = await analyzeLeadWithGemini(lead);
        lead.assessment = result.assessment;
        lead.draft = { ...result.draft, version: 1, updatedAt: iso() };
        lead.executions.push({
          id: randomUUID(), attempt, status: "succeeded", model: result.model,
          inputTokens: result.inputTokens, outputTokens: result.outputTokens,
          estimatedCostUsd: result.estimatedCostUsd, latencyMs: result.latencyMs, createdAt: iso(),
        });
      } else {
        lead.assessment = assessmentFor(lead);
        lead.draft = draftFor(lead);
        lead.executions.push({
          id: randomUUID(), attempt, status: "succeeded", model: "demo-structured-v1",
          inputTokens: 720 + lead.description.length, outputTokens: 248,
          estimatedCostUsd: 0, latencyMs: 1260, createdAt: iso(),
        });
      }
      lead.status = "needs_review";
      lead.updatedAt = iso();
      lead.activities.push(activity("ai.completed", "Análisis completado", `Intento ${attempt} · borrador estructurado listo`, "success"));
    } catch (error) {
      const errorCode = error instanceof Error ? error.message : "GEMINI_UNKNOWN_ERROR";
      lead.status = "failed";
      lead.updatedAt = iso();
      lead.executions.push({
        id: randomUUID(), attempt, status: "failed", model: process.env.GEMINI_MODEL || "gemini-3.1-flash-lite",
        inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0,
        latencyMs: 0, error: errorCode, createdAt: iso(),
      });
      lead.activities.push(activity("ai.failed", "Falló el análisis", `${errorCode} · reintento seguro disponible`, "danger"));
    }
    return lead;
  }

  updateDraft(id: string, subject: string, body: string): Lead | undefined {
    const lead = this.leads.get(id);
    if (!lead?.draft || lead.status !== "needs_review") return undefined;
    lead.draft = { subject: subject.trim(), body: body.trim(), version: lead.draft.version + 1, updatedAt: iso() };
    lead.updatedAt = iso();
    lead.activities.push(activity("draft.edited", "Borrador editado", `Versión ${lead.draft.version} guardada`));
    return lead;
  }

  approveAndSend(id: string): { lead?: Lead; duplicate: boolean } {
    const lead = this.leads.get(id);
    if (!lead?.draft) return { duplicate: false };
    const key = `send:${lead.id}:draft:${lead.draft.version}`;
    if (this.sendKeys.has(key) || lead.status === "sent") return { lead, duplicate: true };
    if (lead.status !== "needs_review" && lead.status !== "approved") return { duplicate: false };

    lead.status = "approved";
    lead.approvedAt = iso();
    lead.activities.push(activity("draft.approved", "Respuesta aprobada", `Versión ${lead.draft.version} · Admin Demo`, "success"));
    lead.status = "sending";
    lead.activities.push(activity("email.sending", "Envío iniciado", "Gmail simulado · no se enviará correo real"));
    lead.providerMessageId = `demo_gmail_${randomUUID().slice(0, 8)}`;
    lead.sentAt = iso();
    lead.updatedAt = iso();
    lead.status = "sent";
    this.sendKeys.set(key, lead.providerMessageId);
    lead.activities.push(activity("email.sent", "Envío simulado", `No se envió un correo real · ${lead.providerMessageId}`, "success"));
    return { lead, duplicate: false };
  }

  discard(id: string): Lead | undefined {
    const lead = this.leads.get(id);
    if (!lead || lead.status !== "needs_review") return undefined;
    lead.status = "discarded";
    lead.updatedAt = iso();
    lead.activities.push(activity("lead.discarded", "Lead descartado", "Decisión registrada por Admin Demo", "warning"));
    return lead;
  }
}

