# Gmail OAuth and controlled delivery

LeadOps requests only `openid`, `email`, and `https://www.googleapis.com/auth/gmail.send`. It cannot read the mailbox. Real delivery is disabled by default and demo sessions never use Gmail.

## 1. Google Cloud

1. Create or select a Google Cloud project and enable **Gmail API**.
2. Configure the OAuth consent screen. For a portfolio demo, use **External / Testing** and add only the Gmail account that will send test messages as a test user.
3. Add the `gmail.send` sensitive scope.
4. Create an OAuth client with application type **Web application**.
5. Add this exact authorized redirect URI:

   `https://lead-ops-ai-api.vercel.app/v1/integrations/gmail/callback`

Google requires an exact redirect match. A client secret belongs only in the API environment, never in `web/` or a `VITE_*` variable.

## 2. Vercel API variables

Configure these on the API project:

```text
GMAIL_DELIVERY_MODE=real
GMAIL_CLIENT_ID=<Google OAuth web client ID>
GMAIL_CLIENT_SECRET=<Google OAuth web client secret>
GMAIL_REDIRECT_URI=https://lead-ops-ai-api.vercel.app/v1/integrations/gmail/callback
GMAIL_OAUTH_SUCCESS_URL=https://leadops.webcarlos.dev
GMAIL_TOKEN_ENCRYPTION_KEY=<32 random bytes as base64>
```

Generate the encryption value locally and store only the result in Vercel:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Redeploy the API after saving the variables.

## 3. Connect and verify

1. Sign in to the LeadOps private workspace.
2. Open **Settings → Gmail → Connect**.
3. Choose the Google test account and grant send-only consent.
4. Submit a lead using an inbox you control, review its draft, and select **Approve and send**.
5. Confirm `Correo enviado / Email sent`, the Gmail message ID, and the audit events in the lead timeline.

An approval repeated for the same draft returns the existing outbox result. Known rejected requests can be retried against the same record. An ambiguous network or Gmail 5xx outcome is left in `sending` for manual reconciliation, not automatically retried.

## Testing-mode limitation

Google OAuth projects with publishing status **Testing** normally issue refresh tokens that expire after seven days when a Gmail scope is requested. That is acceptable for a portfolio demo: reconnect Gmail from Settings when needed. Move the consent screen to production and complete any Google verification requirements before treating the integration as a customer-facing product.
