import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

try {
  loadEnvFile(fileURLToPath(new URL("../../.env", import.meta.url)));
} catch (error) {
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  if (code !== "ENOENT") throw error;
}

const { buildApp } = await import("./app.js");

const app = await buildApp();
const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? "127.0.0.1";

try {
  await app.listen({ port, host });
  const aiMode = process.env.GEMINI_API_KEY && process.env.DEMO_MODE?.toLowerCase() !== "true" ? "Gemini" : "safe demo";
  const storageMode = process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY ? "Supabase" : "memory";
  console.log(`LeadOps API ready at http://${host}:${port} (${aiMode}, ${storageMode})`);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

