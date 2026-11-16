import { createClient } from "@supabase/supabase-js";

export interface AuthorizedUser {
  id: string;
  email?: string;
  role: "portfolio_admin" | "lead_operator";
}

const allowedRoles = new Set(["portfolio_admin", "lead_operator"]);

export async function authorizeAdmin(authorization: string | undefined): Promise<AuthorizedUser | undefined> {
  if (!authorization?.startsWith("Bearer ")) return undefined;
  const url = process.env.SUPABASE_URL;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) return undefined;

  const token = authorization.slice("Bearer ".length).trim();
  if (!token) return undefined;
  const client = createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return undefined;
  const role = data.user.app_metadata?.role;
  if (typeof role !== "string" || !allowedRoles.has(role)) return undefined;
  return { id: data.user.id, email: data.user.email, role: role as AuthorizedUser["role"] };
}
