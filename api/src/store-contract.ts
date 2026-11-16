import type { Lead, LeadInput } from "./types.js";

export type Awaitable<T> = T | Promise<T>;

export interface LeadStore {
  list(): Awaitable<Lead[]>;
  get(id: string): Awaitable<Lead | undefined>;
  create(input: LeadInput): Awaitable<{ lead: Lead; duplicate: boolean }>;
  process(id: string): Promise<Lead | undefined>;
  updateDraft(id: string, subject: string, body: string): Awaitable<Lead | undefined>;
  approveAndSend(id: string): Awaitable<{ lead?: Lead; duplicate: boolean }>;
  discard(id: string): Awaitable<Lead | undefined>;
}
