export const leadStatuses = [
  "new",
  "processing",
  "needs_review",
  "approved",
  "sending",
  "sent",
  "failed",
  "discarded",
] as const;

export type LeadStatus = (typeof leadStatuses)[number];
export type Priority = "low" | "medium" | "high" | "urgent";
export type Service = "wordpress" | "woocommerce" | "shopify" | "other";
export type PreferredLanguage = "es" | "en";

export interface LeadInput {
  name: string;
  email: string;
  company?: string;
  service: Service;
  budget: string;
  timeline: string;
  description: string;
  preferredLanguage?: PreferredLanguage;
  idempotencyKey: string;
}

export interface Activity {
  id: string;
  type: string;
  title: string;
  detail: string;
  createdAt: string;
  tone: "neutral" | "success" | "warning" | "danger";
}

export interface Execution {
  id: string;
  attempt: number;
  status: "running" | "succeeded" | "failed";
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  latencyMs: number;
  error?: string;
  createdAt: string;
}

export interface Assessment {
  classification: "qualified" | "nurture" | "unqualified";
  priority: Priority;
  detectedService: Service;
  missingFields: string[];
  summary: string;
  confidence: number;
}

export interface Draft {
  subject: string;
  body: string;
  version: number;
  updatedAt: string;
}

export interface Lead extends Omit<LeadInput, "idempotencyKey"> {
  id: string;
  reference: string;
  status: LeadStatus;
  createdAt: string;
  updatedAt: string;
  assessment?: Assessment;
  draft?: Draft;
  activities: Activity[];
  executions: Execution[];
  approvedAt?: string;
  sentAt?: string;
  providerMessageId?: string;
}

