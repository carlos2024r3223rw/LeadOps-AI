import { buildApp } from "./src/app.js";

const appPromise = buildApp();

export default async function handler(request: any, response: any) {
  try {
    const app = await appPromise;
    const result = await app.inject({
      method: request.method ?? "GET",
      url: request.url ?? "/",
      headers: request.headers,
      payload: request.body,
    });

    response.statusCode = result.statusCode;
    for (const [key, value] of Object.entries(result.headers)) {
      if (value !== undefined) response.setHeader(key, String(value));
    }
    response.end(result.rawPayload);
  } catch (error) {
    console.error("Vercel handler failure", error);
    response.statusCode = 500;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ error: "Internal server error" }));
  }
}
