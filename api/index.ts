import { buildApp } from "./src/app.js";

let appPromise: ReturnType<typeof buildApp> | undefined;

function healthPayload() {
  return {
    status: "ok",
    mode: process.env.GEMINI_API_KEY && process.env.DEMO_MODE?.toLowerCase() !== "true" ? "gemini" : "demo",
    storage: process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY ? "supabase" : "memory",
    delivery: "simulated",
  };
}

export default async function handler(request: any, response: any) {
  try {
    const pathname = String(request.url ?? "/").split("?")[0];
    if (request.method === "GET" && pathname === "/health") {
      response.statusCode = 200;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(healthPayload()));
      return;
    }

    appPromise ??= buildApp();
    const app = await appPromise;
    await app.ready();
    app.server.emit("request", request, response);
  } catch (error) {
    console.error("Vercel handler failure", error);
    response.statusCode = 500;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ error: "Internal server error" }));
  }
}
