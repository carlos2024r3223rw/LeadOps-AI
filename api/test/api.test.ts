import assert from "node:assert/strict";
import { test } from "node:test";
import { buildApp } from "../src/app.js";
import { DemoStore } from "../src/store.js";
import { createRawMessage } from "../src/gmail.js";

const validLead = {
  name: "Carlos Méndez",
  email: "carlos@example.com",
  company: "Acme Labs",
  service: "wordpress",
  budget: "$5,000 – $10,000",
  timeline: "6 semanas",
  description: "Necesitamos un sitio corporativo bilingüe con integración al CRM.",
  idempotencyKey: "request-carlos-001",
};

async function createDemoAccess(app: Awaited<ReturnType<typeof buildApp>>) {
  const response = await app.inject({ method: "POST", url: "/v1/demo/session" });
  return { "x-demo-session": response.json().data.sessionId as string };
}

test("health confirms safe demo delivery", async () => {
  const app = await buildApp(new DemoStore());
  const response = await app.inject({ method: "GET", url: "/health" });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { status: "ok", mode: "demo", storage: "memory", delivery: "simulated" });
  await app.close();
});

test("repeated intake returns the same lead", async () => {
  const app = await buildApp(new DemoStore());
  const first = await app.inject({ method: "POST", url: "/v1/public/leads", payload: validLead });
  const second = await app.inject({ method: "POST", url: "/v1/public/leads", payload: validLead });
  assert.equal(first.statusCode, 201);
  assert.equal(second.statusCode, 200);
  assert.equal(first.json().data.id, second.json().data.id);
  assert.equal(second.json().duplicate, true);
  await app.close();
});

test("analysis, approval and sending are idempotent", async () => {
  const app = await buildApp(new DemoStore());
  const headers = await createDemoAccess(app);
  const created = await app.inject({ method: "POST", url: "/v1/leads", headers, payload: { ...validLead, idempotencyKey: "flow-unique-001" } });
  const id = created.json().data.id as string;
  const analyzed = await app.inject({ method: "POST", url: `/v1/leads/${id}/process`, headers });
  assert.equal(analyzed.json().data.status, "needs_review");
  const firstSend = await app.inject({ method: "POST", url: `/v1/leads/${id}/approve`, headers });
  const repeatedSend = await app.inject({ method: "POST", url: `/v1/leads/${id}/approve`, headers });
  assert.equal(firstSend.json().data.status, "sent");
  assert.equal(repeatedSend.json().duplicate, true);
  assert.equal(firstSend.json().data.providerMessageId, repeatedSend.json().data.providerMessageId);
  await app.close();
});

test("the selected reply language is preserved", async () => {
  const app = await buildApp(new DemoStore());
  const headers = await createDemoAccess(app);
  const created = await app.inject({
    method: "POST",
    url: "/v1/leads",
    headers,
    payload: { ...validLead, preferredLanguage: "en", idempotencyKey: "english-lead-001" },
  });
  const id = created.json().data.id as string;
  const analyzed = await app.inject({ method: "POST", url: `/v1/leads/${id}/process`, headers });
  assert.equal(analyzed.json().data.preferredLanguage, "en");
  assert.match(analyzed.json().data.draft.body, /^Hi Carlos,/);
  await app.close();
});

test("the private inbox rejects anonymous access", async () => {
  const app = await buildApp(new DemoStore());
  const response = await app.inject({ method: "GET", url: "/v1/leads" });
  assert.equal(response.statusCode, 401);
  await app.close();
});

test("demo sessions are isolated", async () => {
  const app = await buildApp(new DemoStore());
  const firstHeaders = await createDemoAccess(app);
  const secondHeaders = await createDemoAccess(app);
  const created = await app.inject({ method: "POST", url: "/v1/leads", headers: firstHeaders, payload: { ...validLead, idempotencyKey: "isolated-demo-001" } });
  const firstList = await app.inject({ method: "GET", url: "/v1/leads", headers: firstHeaders });
  const secondList = await app.inject({ method: "GET", url: "/v1/leads", headers: secondHeaders });
  assert.equal(firstList.json().data.some((lead: { id: string }) => lead.id === created.json().data.id), true);
  assert.equal(secondList.json().data.some((lead: { id: string }) => lead.id === created.json().data.id), false);
  await app.close();
});

test("demo sessions report simulated Gmail without exposing a connect flow", async () => {
  const app = await buildApp(new DemoStore(), undefined);
  const headers = await createDemoAccess(app);
  const status = await app.inject({ method: "GET", url: "/v1/integrations/gmail/status", headers });
  assert.equal(status.statusCode, 200);
  assert.deepEqual(status.json().data, { mode: "simulated", configured: false, connected: false });
  await app.close();
});

test("Gmail messages use deterministic Message-ID and base64url MIME", () => {
  const raw = createRawMessage({
    ownerUserId: "admin",
    to: "client@example.com",
    subject: "Propuesta para migración",
    body: "Hola,\n\nGracias por escribirnos.",
    messageId: "leadops-test@example.local",
  }, "sender@example.com");
  const mime = Buffer.from(raw, "base64url").toString("utf8");
  assert.match(mime, /Message-ID: <leadops-test@example\.local>/);
  assert.match(mime, /To: client@example\.com/);
  assert.match(mime, /Subject: =\?UTF-8\?B\?/);
  assert.match(mime, /Content-Transfer-Encoding: base64/);
});

