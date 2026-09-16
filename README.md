# Okta AI Agent Platform

A hosted console that demonstrates how **Okta secures, governs and manages AI Agents** — built on Okta for AI Agents (O4AA).

## What it does

- **Register AI Agents** — create agent identities in Okta's AI Agent directory
- **Assign Owners** — link agents to Okta users as responsible owners
- **Connect Resources** — attach MCP servers, SaaS apps, APIs and cloud AI services to agents
- **Console access** — the entire dashboard is protected by Okta OIDC login

## Architecture

```
GitHub (monorepo)
├── frontend/   (Next.js 14, NextAuth + Okta OIDC)
└── backend/    →  Render       (Express.js, Postgres, Okta Management API)
```

---

## Prerequisites

1. An **Okta org** (developer or production)
2. A **Render account** (free tier works, for the backend)
3. A Node.js host for the frontend (any platform that runs Next.js)
4. **O4AA enabled** on your Okta org (Admin Console → Settings → Features → AI Agents)

---

## Okta Setup

### 1. OIDC Web App (for console login)

In Okta Admin Console → Applications → Create App Integration:
- Type: **OIDC - Web Application**
- Grant type: **Authorization Code**
- Sign-in redirect URI: `https://your-frontend-host/api/auth/callback/okta`
  *(also add `http://localhost:3000/api/auth/callback/okta` for local dev)*
- Sign-out redirect URI: `https://your-frontend-host`
- Scopes: `openid`, `profile`, `email`

Note the **Client ID** and **Client Secret**.

### 2. API Services App (M2M — for Management API)

In Okta Admin Console → Applications → Create App Integration:
- Type: **API Services**
- Grant type: **Client Credentials**
- In the **Okta API Scopes** tab, grant:
  - `okta.users.read`
  - `okta.aiAgents.manage` *(requires O4AA to be enabled)*
  - `okta.apps.manage`
- Ensure **DPoP (Demonstrating Proof of Possession)** is *not* required on this app — the org authorization server's client_credentials flow needs `private_key_jwt`, which is separate from DPoP.
- On the **Public Keys** tab, generate a keypair. Okta shows the private key once — save it (see `OKTA_M2M_PRIVATE_JWK` below). The public half stays registered on the app; the org authorization server requires `private_key_jwt`, not a client secret, for client_credentials grants.

Note the **Client ID**.

> The backend's `OKTA_AUTH_MODE` env var selects which of the two Okta apps above it authenticates with:
> - `api_token` (default) — a static SSWS token via `OKTA_API_TOKEN`. Simplest option for local dev.
> - `client_credentials` — OAuth2 M2M via `private_key_jwt`, requesting `okta.users.read okta.aiAgents.manage okta.apps.manage` from the org authorization server. Closer to how a production deployment should run. Requires `OKTA_M2M_CLIENT_ID` and `OKTA_M2M_PRIVATE_JWK` (the private JWK from the Public Keys tab above).

---

## Deploy to Render (Backend)

1. Fork/clone this repo to GitHub
2. In [Render Dashboard](https://dashboard.render.com):
   - **New → PostgreSQL** — create a free Postgres database, copy the Internal Database URL
   - **New → Web Service** — connect your GitHub repo
     - Root directory: `backend`
     - Build command: `npm install && npm run build`
     - Start command: `npm start`
     - Add environment variables:

```
DATABASE_URL=<render-postgres-internal-url>
OKTA_ORG_URL=https://your-org.okta.com
OKTA_AUTH_MODE=client_credentials
OKTA_M2M_CLIENT_ID=<api-services-client-id>
OKTA_M2M_PRIVATE_JWK=<private-jwk-json-from-public-keys-tab>
FRONTEND_URL=https://your-frontend-host
PORT=3001
```

The backend will auto-migrate and seed default resources on first start.

---

## Deploy the Frontend

The `frontend/` app is a standard Next.js 14 app (`next build` / `next start`) and can be deployed to any Node.js host. Set these environment variables wherever it runs:

```
NEXTAUTH_URL=https://your-frontend-host
NEXTAUTH_SECRET=<run: openssl rand -base64 32>
OKTA_CLIENT_ID=<oidc-web-app-client-id>
OKTA_CLIENT_SECRET=<oidc-web-app-client-secret>
OKTA_ISSUER=https://your-org.okta.com/oauth2/default
BACKEND_URL=https://your-backend.onrender.com
```

---

## Local Development

```bash
# Backend
cd backend
cp .env.example .env   # fill in values
npm install
npm run dev            # starts on :3001

# Frontend (separate terminal)
cd frontend
cp .env.example .env.local   # fill in values
npm install
npm run dev            # starts on :3000
```

Open http://localhost:3000 → sign in with Okta → you're in.

---

## What you can demo

1. **Register an agent** — fill in name + description, the agent is created in Okta's AI Agent directory
2. **Assign an owner** — search your Okta org's users and assign one as the agent's owner
3. **Connect resources** — pick from AWS Bedrock, Slack MCP, GitHub MCP, Salesforce, and more
4. **View the agent in Okta** — go to Admin Console → Directory → AI Agents to see it listed

---

## Roadmap (Next Iteration)

- **Bedrock deployment** — spin up a real AWS Bedrock agent with Okta credentials embedded
- **Access requests** — users can request access to an agent (OIG integration)
- **Access certifications** — certify agent ownership via Okta OIG
- **Real MCP connections** — actually wire up the Okta MCP adapter for each resource
