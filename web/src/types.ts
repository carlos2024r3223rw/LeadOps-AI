export type LeadStatus = "new" | "processing" | "needs_review" | "approved" | "sending" | "sent" | "failed" | "discarded";
export type Service = "wordpress" | "woocommerce" | "shopify" | "other";

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

export interface Lead {
  id: string;
  reference: string;
  name: string;
  email: string;
  company?: string;
  service: Service;
  budget: string;
  timeline: string;
  description: string;
  preferredLanguage?: "es" | "en";
  status: LeadStatus;
  createdAt: string;
  updatedAt: string;
  assessment?: {
    classification: "qualified" | "nurture" | "unqualified";
    priority: "low" | "medium" | "high" | "urgent";
    detectedService: Service;
    missingFields: string[];
    summary: string;
    confidence: number;
  };
  draft?: { subject: string; body: string; version: number; updatedAt: string };
  activities: Activity[];
  executions: Execution[];
  approvedAt?: string;
  sentAt?: string;
  providerMessageId?: string;
}

