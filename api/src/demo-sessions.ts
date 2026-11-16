import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { DemoStore, type DemoStoreState } from "./store.js";
import type { LeadStore } from "./store-contract.js";
import type { Lead, LeadInput } from "./types.js";

const sessionLifetimeMs = 2 * 60 * 60 * 1000;

interface DemoSession {
  store: DemoStore;
  expiresAt: number;
}

export class DemoSessions {
  private readonly sessions = new Map<string, DemoSession>();
  private readonly client?: SupabaseClient;

  constructor() {
    const url = process.env.SUPABASE_URL;
    const secretKey = process.env.SUPABASE_SECRET_KEY;
    if (url && secretKey) {
      this.client = createClient(url, secretKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
    }
  }

  async create() {
    this.prune();
    const id = randomUUID();
    const expiresAt = Date.now() + sessionLifetimeMs;
    const store = new DemoStore({ forceSimulation: true });
    if (this.client) {
      const { error } = await this.client.from("demo_sessions").insert({
        id,
        state: store.snapshot(),
        expires_at: new Date(expiresAt).toISOString(),
      });
      if (error) throw new Error(`DEMO_SESSION_CREATE_FAILED:${error.code}`);
    } else {
      this.sessions.set(id, { store, expiresAt });
    }
    return { id, expiresAt: new Date(expiresAt).toISOString() };
  }

  async get(id: string | undefined): Promise<LeadStore | undefined> {
    if (!id) return undefined;
    if (this.client) {
      const { data, error } = await this.client
        .from("demo_sessions")
        .select("state, expires_at")
        .eq("id", id)
        .maybeSingle();
      if (error || !data || new Date(data.expires_at).getTime() <= Date.now()) return undefined;
      const store = new DemoStore({ forceSimulation: true, state: data.state as DemoStoreState });
      return new PersistedDemoStore(store, async () => {
        const { error: saveError } = await this.client!
          .from("demo_sessions")
          .update({ state: store.snapshot(), updated_at: new Date().toISOString() })
          .eq("id", id)
          .gt("expires_at", new Date().toISOString());
        if (saveError) throw new Error(`DEMO_SESSION_SAVE_FAILED:${saveError.code}`);
      });
    }
    const session = this.sessions.get(id);
    if (!session) return undefined;
    if (session.expiresAt <= Date.now()) {
      this.sessions.delete(id);
      return undefined;
    }
    return session.store;
  }

  private prune() {
    const now = Date.now();
    for (const [id, session] of this.sessions) if (session.expiresAt <= now) this.sessions.delete(id);
  }
}

class PersistedDemoStore implements LeadStore {
  constructor(private readonly store: DemoStore, private readonly save: () => Promise<void>) {}

  list() { return this.store.list(); }
  get(id: string) { return this.store.get(id); }
  async create(input: LeadInput) {
    const result = this.store.create(input);
    if (!result.duplicate) await this.save();
    return result;
  }
  async process(id: string) {
    const lead = await this.store.process(id);
    if (lead) await this.save();
    return lead;
  }
  async updateDraft(id: string, subject: string, body: string): Promise<Lead | undefined> {
    const lead = this.store.updateDraft(id, subject, body);
    if (lead) await this.save();
    return lead;
  }
  async approveAndSend(id: string) {
    const result = this.store.approveAndSend(id);
    if (result.lead && !result.duplicate) await this.save();
    return result;
  }
  async discard(id: string) {
    const lead = this.store.discard(id);
    if (lead) await this.save();
    return lead;
  }
}
