# Production deployment

LeadOps AI is designed as two Vercel projects from the same repository:

- `web/`: Vite SPA and PWA.
- `api/`: Fastify application deployed as one Vercel Function.

This follows Vercel's native monorepo model and keeps server-only secrets out of the frontend build.

## 1. Repository safety gate

Before every first public push:

```bash
git check-ignore .env
npm run check
```

The result of `git check-ignore .env` must identify `.gitignore`. Never add `.env`, Supabase secret keys, Gemini keys, Gmail credentials, or n8n secrets to Git.

## 2. API project

Create a Vercel project with **Root Directory** set to `api` and configure:

- `DEMO_MODE=false`
- `WEB_ORIGIN=https://<web-project>.vercel.app`
- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SECRET_KEY`
- `GEMINI_API_KEY`
- `GEMINI_MODEL=gemini-3.1-flash-lite`

Do not create any `VITE_*` copy of a server secret. Vercel detects `api/src/server.ts` as the Fastify entrypoint.

## 3. Web project

Create another Vercel project with **Root Directory** set to `web` and configure:

- `VITE_API_URL=https://<api-project>.vercel.app`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_DEMO_MODE=true`

`web/vercel.json` enables SPA deep links.

## 4. Supabase Auth

In **Authentication → URL Configuration**:

- Set Site URL to the final web HTTPS origin.
- Add the production web origin to Redirect URLs.
- Keep `http://localhost:5173` only for local development.

The administrator must have `app_metadata.role` set to `portfolio_admin` or `lead_operator`. Do not use `user_metadata` for authorization.

## 5. CORS and public verification

Set the API `WEB_ORIGIN` to the exact web origin. It accepts a comma-separated list when local and production origins are both needed.

Verify from the public URL:

1. Landing page and mobile layout.
2. Isolated demo start, edit, approval, retry, and simulated send.
3. Public lead submission and Gemini analysis.
4. Administrator email/password login.
5. Unauthorized private API request returns `401`.
6. Duplicate submission and duplicate approval do not create duplicate effects.

## 6. Optional Supabase health signal

Add GitHub repository secrets `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`. The scheduled workflow calls only `keepalive_ping()` approximately every three days. It is a health signal, not a guarantee that a Free project will never pause.
