import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type Row = Record<string, any>;

export interface GmailStatus {
  mode: "real" | "simulated";
  configured: boolean;
  connected: boolean;
  accountEmail?: string;
  connectedAt?: string;
}

export interface GmailSendInput {
  ownerUserId: string;
  to: string;
  subject: string;
  body: string;
  messageId: string;
}

export interface GmailSendResult {
  id: string;
  threadId?: string;
}

const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";

function hasGmailSendScope(scopes: unknown) {
  return Array.isArray(scopes) && scopes.includes(GMAIL_SEND_SCOPE);
}

export class GmailDeliveryError extends Error {
  constructor(public readonly code: string, message: string, public readonly retryable = false, public readonly deliveryUnknown = false) {
    super(message);
  }
}

function encodeHeader(value: string) {
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value).toString("base64")}?=`;
}

function base64Url(value: Buffer | string) {
  return Buffer.from(value).toString("base64url");
}

export function createRawMessage(input: GmailSendInput, from: string) {
  const normalizedBody = input.body.replace(/\r?\n/g, "\r\n");
  const headers = [
    `From: ${from}`,
    `To: ${input.to}`,
    `Subject: ${encodeHeader(input.subject)}`,
    `Message-ID: <${input.messageId}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
  ];
  const encodedBody = Buffer.from(normalizedBody, "utf8").toString("base64").match(/.{1,76}/g)?.join("\r\n") ?? "";
  return base64Url(`${headers.join("\r\n")}\r\n\r\n${encodedBody}`);
}

function requiredEncryptionKey(value?: string) {
  if (!value) throw new GmailDeliveryError("GMAIL_ENCRYPTION_KEY_MISSING", "Gmail token encryption is not configured.");
  const key = Buffer.from(value, "base64");
  if (key.length !== 32) throw new GmailDeliveryError("GMAIL_ENCRYPTION_KEY_INVALID", "GMAIL_TOKEN_ENCRYPTION_KEY must be 32 bytes encoded as base64.");
  return key;
}

function encryptToken(value: string, keyValue?: string) {
  const key = requiredEncryptionKey(keyValue);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ["v1", base64Url(iv), base64Url(cipher.getAuthTag()), base64Url(encrypted)].join(".");
}

function decryptToken(value: string, keyValue?: string) {
  const key = requiredEncryptionKey(keyValue);
  const [version, iv, tag, encrypted] = value.split(".");
  if (version !== "v1" || !iv || !tag || !encrypted) throw new GmailDeliveryError("GMAIL_TOKEN_INVALID", "Stored Gmail credentials are invalid.");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
}

function hashState(state: string) {
  return createHash("sha256").update(state).digest("hex");
}

function safeErrorMessage(payload: unknown, fallback: string) {
  if (payload && typeof payload === "object" && "error_description" in payload && typeof payload.error_description === "string") return payload.error_description;
  if (payload && typeof payload === "object" && "error" in payload) {
    const error = payload.error;
    if (typeof error === "string") return error;
    if (error && typeof error === "object" && "message" in error && typeof error.message === "string") return error.message;
  }
  return fallback;
}

export class GmailService {
  readonly mode = process.env.GMAIL_DELIVERY_MODE?.toLowerCase() === "real" ? "real" : "simulated";
  private readonly client: SupabaseClient;
  private readonly clientId = process.env.GMAIL_CLIENT_ID;
  private readonly clientSecret = process.env.GMAIL_CLIENT_SECRET;
  private readonly redirectUri = process.env.GMAIL_REDIRECT_URI;
  private readonly encryptionKey = process.env.GMAIL_TOKEN_ENCRYPTION_KEY;

  constructor(url: string, secretKey: string) {
    this.client = createClient(url, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { "X-Client-Info": "leadops-gmail/0.1" } },
    });
  }

  get configured() {
    return Boolean(this.clientId && this.clientSecret && this.redirectUri && this.encryptionKey);
  }

  private publicWebOrigin() {
    return (process.env.GMAIL_OAUTH_SUCCESS_URL || process.env.WEB_ORIGIN || "http://localhost:5173").split(",")[0]?.trim() || "http://localhost:5173";
  }

  callbackRedirect(result: "connected" | "error", detail?: string) {
    const url = new URL(this.publicWebOrigin());
    url.searchParams.set("gmail", result);
    if (detail) url.searchParams.set("reason", detail.slice(0, 120));
    return url.toString();
  }

  async status(ownerUserId: string): Promise<GmailStatus> {
    const base: GmailStatus = { mode: this.mode, configured: this.configured, connected: false };
    if (!this.configured) return base;
    const result = await this.client.from("gmail_integrations").select("account_email, connected_at, revoked_at, encrypted_refresh_token, scopes").eq("owner_user_id", ownerUserId).maybeSingle();
    if (result.error) throw new GmailDeliveryError("GMAIL_STATUS_FAILED", result.error.message);
    if (!result.data || result.data.revoked_at || !result.data.encrypted_refresh_token || !hasGmailSendScope(result.data.scopes)) return base;
    return { ...base, connected: true, accountEmail: result.data.account_email, connectedAt: result.data.connected_at };
  }

  async createAuthorizationUrl(ownerUserId: string) {
    if (!this.configured) throw new GmailDeliveryError("GMAIL_NOT_CONFIGURED", "Gmail OAuth is not configured on the API.");
    const state = base64Url(randomBytes(32));
    const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
    const pending = await this.client.from("gmail_integrations").upsert({
      owner_user_id: ownerUserId,
      pending_state_hash: hashState(state),
      pending_state_expires_at: expiresAt,
      revoked_at: null,
    }, { onConflict: "owner_user_id" });
    if (pending.error) throw new GmailDeliveryError("GMAIL_STATE_SAVE_FAILED", pending.error.message);

    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", this.clientId!);
    url.searchParams.set("redirect_uri", this.redirectUri!);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", `openid email ${GMAIL_SEND_SCOPE}`);
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("state", state);
    return url.toString();
  }

  async completeAuthorization(code: string, state: string) {
    if (!this.configured) throw new GmailDeliveryError("GMAIL_NOT_CONFIGURED", "Gmail OAuth is not configured on the API.");
    const pending = await this.client.from("gmail_integrations").select("*").eq("pending_state_hash", hashState(state)).maybeSingle();
    if (pending.error) throw new GmailDeliveryError("GMAIL_STATE_READ_FAILED", pending.error.message);
    const row = pending.data as Row | null;
    if (!row || !row.pending_state_expires_at || Date.parse(row.pending_state_expires_at) < Date.now()) {
      throw new GmailDeliveryError("GMAIL_STATE_INVALID", "The Gmail authorization request expired or is invalid.");
    }

    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code, client_id: this.clientId!, client_secret: this.clientSecret!, redirect_uri: this.redirectUri!, grant_type: "authorization_code" }),
    });
    const tokens = await response.json() as Row;
    if (!response.ok || !tokens.access_token) throw new GmailDeliveryError("GMAIL_TOKEN_EXCHANGE_FAILED", safeErrorMessage(tokens, "Google rejected the authorization code."));
    const grantedScopes = String(tokens.scope ?? "").split(" ").filter(Boolean);
    if (!hasGmailSendScope(grantedScopes)) {
      throw new GmailDeliveryError("GMAIL_SCOPE_MISSING", "Google did not grant permission to send email. Reconnect Gmail and enable the send permission.");
    }

    const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${tokens.access_token}` } });
    const profile = await profileResponse.json() as Row;
    if (!profileResponse.ok || !profile.email) throw new GmailDeliveryError("GMAIL_PROFILE_FAILED", safeErrorMessage(profile, "Could not read the connected Google account."));

    const refreshToken = tokens.refresh_token ? encryptToken(tokens.refresh_token, this.encryptionKey) : row.encrypted_refresh_token;
    if (!refreshToken) throw new GmailDeliveryError("GMAIL_REFRESH_TOKEN_MISSING", "Google did not return an offline refresh token. Reconnect and grant consent again.");
    const saved = await this.client.from("gmail_integrations").update({
      account_email: profile.email,
      encrypted_access_token: encryptToken(tokens.access_token, this.encryptionKey),
      encrypted_refresh_token: refreshToken,
      access_token_expires_at: new Date(Date.now() + Number(tokens.expires_in ?? 3600) * 1000).toISOString(),
      scopes: grantedScopes,
      connected_at: new Date().toISOString(),
      revoked_at: null,
      pending_state_hash: null,
      pending_state_expires_at: null,
    }).eq("id", row.id);
    if (saved.error) throw new GmailDeliveryError("GMAIL_CONNECTION_SAVE_FAILED", saved.error.message);
    return { accountEmail: profile.email as string };
  }

  async disconnect(ownerUserId: string) {
    const result = await this.client.from("gmail_integrations").update({
      encrypted_access_token: null,
      encrypted_refresh_token: null,
      access_token_expires_at: null,
      revoked_at: new Date().toISOString(),
    }).eq("owner_user_id", ownerUserId);
    if (result.error) throw new GmailDeliveryError("GMAIL_DISCONNECT_FAILED", result.error.message);
  }

  private async accessToken(row: Row) {
    if (row.encrypted_access_token && row.access_token_expires_at && Date.parse(row.access_token_expires_at) > Date.now() + 60_000) {
      return decryptToken(row.encrypted_access_token, this.encryptionKey);
    }
    if (!row.encrypted_refresh_token) throw new GmailDeliveryError("GMAIL_NOT_CONNECTED", "Connect a Gmail account before sending real email.");
    const refreshToken = decryptToken(row.encrypted_refresh_token, this.encryptionKey);
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: this.clientId!, client_secret: this.clientSecret!, refresh_token: refreshToken, grant_type: "refresh_token" }),
    });
    const tokens = await response.json() as Row;
    if (!response.ok || !tokens.access_token) throw new GmailDeliveryError("GMAIL_REFRESH_FAILED", safeErrorMessage(tokens, "Google rejected the saved Gmail connection."));
    const updated = await this.client.from("gmail_integrations").update({
      encrypted_access_token: encryptToken(tokens.access_token, this.encryptionKey),
      access_token_expires_at: new Date(Date.now() + Number(tokens.expires_in ?? 3600) * 1000).toISOString(),
    }).eq("id", row.id);
    if (updated.error) throw new GmailDeliveryError("GMAIL_TOKEN_SAVE_FAILED", updated.error.message);
    return tokens.access_token as string;
  }

  async send(input: GmailSendInput): Promise<GmailSendResult> {
    if (this.mode !== "real") throw new GmailDeliveryError("GMAIL_REAL_DELIVERY_DISABLED", "Real Gmail delivery is disabled.");
    if (!this.configured) throw new GmailDeliveryError("GMAIL_NOT_CONFIGURED", "Gmail OAuth is not configured on the API.");
    const integration = await this.client.from("gmail_integrations").select("*").eq("owner_user_id", input.ownerUserId).is("revoked_at", null).maybeSingle();
    if (integration.error) throw new GmailDeliveryError("GMAIL_CONNECTION_READ_FAILED", integration.error.message);
    const row = integration.data as Row | null;
    if (!row?.encrypted_refresh_token || !row.account_email) throw new GmailDeliveryError("GMAIL_NOT_CONNECTED", "Connect a Gmail account before sending real email.");
    if (!hasGmailSendScope(row.scopes)) throw new GmailDeliveryError("GMAIL_SCOPE_MISSING", "Reconnect Gmail and grant permission to send email.");
    const accessToken = await this.accessToken(row);
    const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ raw: createRawMessage(input, row.account_email) }),
    });
    const payload = await response.json() as Row;
    if (!response.ok || !payload.id) {
      const retryable = response.status === 429;
      throw new GmailDeliveryError(`GMAIL_HTTP_${response.status}`, safeErrorMessage(payload, "Gmail rejected the message."), retryable, response.status >= 500);
    }
    return { id: payload.id, threadId: payload.threadId };
  }
}

export function createConfiguredGmailService() {
  const url = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  return url && secretKey ? new GmailService(url, secretKey) : undefined;
}
