import { buildApp } from "./src/app.js";

const appPromise = buildApp();

export default async function handler(request: any, response: any) {
  const app = await appPromise;
  await app.ready();
  app.server.emit("request", request, response);
}
