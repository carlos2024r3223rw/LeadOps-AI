import type { Lead } from "./types";

export interface GmailStatus {
  mode: "real" | "simulated";
  configured: boolean;
  connected: boolean;
  accountEmail?: string;
  connectedAt?: string;
}

const API_URL = import.meta.env.VITE_API_URL ?? (import.meta.env.PROD ? "" : "http://localhost:3001");
let accessToken: string | undefined;
let demoSessionId: string | undefined;

export function useAdminToken(token?: string) {
  accessToken = token;
  demoSessionId = undefined;
}

export function useDemoSession(sessionId?: string) {
  demoSessionId = sessionId;
  accessToken = undefined;
}

export function clearApiAccess() {
  accessToken = undefined;
  demoSessionId = undefined;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(demoSessionId ? { "X-Demo-Session": demoSessionId } : {}),
      ...init?.headers,
    },
  });

  const raw = await response.text();
  let payload: { error?: string };
  try {
    payload = raw ? JSON.parse(raw) as { error?: string } : {};
  } catch {
    throw new Error(`La API devolvió una respuesta inválida (HTTP ${response.status}).`);
  }
  if (!response.ok) throw new Error(payload.error ?? `No se pudo completar la solicitud (HTTP ${response.status}).`);
  return payload as T;
}

export const api = {
  startDemo: () => request<{ data: { sessionId: string; expiresAt: string; mode: "isolated_demo" } }>("/v1/demo/session", { method: "POST" }),
  currentAccess: () => request<{ data: { mode: "admin" | "demo"; role: string; email?: string } }>("/v1/auth/me"),
  listLeads: () => request<{ data: Lead[] }>("/v1/leads"),
  getLead: (id: string) => request<{ data: Lead }>(`/v1/leads/${id}`),
  createPublicLead: (body: Record<string, string>) => request<{ data: Lead; duplicate: boolean }>("/v1/public/leads", { method: "POST", body: JSON.stringify(body) }),
  createLead: (body: Record<string, string>) => request<{ data: Lead; duplicate: boolean }>("/v1/leads", { method: "POST", body: JSON.stringify(body) }),
  processLead: (id: string) => request<{ data: Lead }>(`/v1/leads/${id}/process`, { method: "POST" }),
  updateDraft: (id: string, subject: string, body: string) => request<{ data: Lead }>(`/v1/leads/${id}/draft`, { method: "PATCH", body: JSON.stringify({ subject, body }) }),
  approveLead: (id: string) => request<{ data: Lead; duplicate: boolean }>(`/v1/leads/${id}/approve`, { method: "POST" }),
  discardLead: (id: string) => request<{ data: Lead }>(`/v1/leads/${id}/discard`, { method: "POST" }),
  gmailStatus: () => request<{ data: GmailStatus }>("/v1/integrations/gmail/status"),
  connectGmail: () => request<{ data: { authorizationUrl: string } }>("/v1/integrations/gmail/connect", { method: "POST" }),
  disconnectGmail: () => request<{ data: { connected: false } }>("/v1/integrations/gmail", { method: "DELETE" }),
};
