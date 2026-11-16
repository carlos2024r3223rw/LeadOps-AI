const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
const key = process.env.SUPABASE_PUBLISHABLE_KEY;

if (!url || !key) {
  console.error("Missing SUPABASE_URL or SUPABASE_PUBLISHABLE_KEY.");
  process.exit(1);
}

const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 15_000);

try {
  const response = await fetch(`${url}/rest/v1/rpc/keepalive_ping`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: "{}",
    signal: controller.signal,
  });

  if (!response.ok) {
    throw new Error(`Supabase returned ${response.status}: ${await response.text()}`);
  }

  const result = await response.json();
  console.log(`LeadOps database is healthy: ${JSON.stringify(result)}`);
} catch (error) {
  console.error("LeadOps database health check failed.", error);
  process.exit(1);
} finally {
  clearTimeout(timeout);
}

