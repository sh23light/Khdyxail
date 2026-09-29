Outlook Webmail Client
A full-featured Outlook webmail interface that proxies Microsoft Graph API calls, with AI email analysis powered by OpenAI.

Run & Operate
pnpm --filter @workspace/api-server run dev — run the API server locally on port 8080
pnpm --filter @workspace/webmail run dev — run the frontend locally
pnpm run typecheck — build shared declarations, then typecheck API and frontend
pnpm run build — build the API bundle and frontend static assets
pnpm --filter @workspace/api-spec run codegen — regenerate API hooks and Zod schemas from the OpenAPI spec
Production API: pnpm --filter @workspace/api-server run start (Railway supplies PORT)
Production frontend: pnpm --filter @workspace/webmail run start (static SPA server, Railway supplies PORT)
Required production env: API_ORIGIN, INTERNAL_API_SECRET, SSO_SHARED_SECRET, and exactly one of SSO_ALLOWED_SUBJECT or SSO_ALLOWED_EMAIL
Optional env: SSO_LOGIN_URL, SSO_ISSUER, SSO_AUDIENCE, and OPENAI_API_KEY — server-side fallback for AI email analysis
Stack
pnpm workspaces, Node.js 24, TypeScript 5.9
Frontend: React + Vite + Tailwind CSS + shadcn/ui + Wouter + TanStack Query
API: Express 5 (proxy to Microsoft Graph API)
Validation: Zod (zod/v4), drizzle-zod
API codegen: Orval (from OpenAPI spec)
Build: esbuild (CJS bundle)
Where things live
lib/lib/api-spec/openapi.yaml — OpenAPI spec (source of truth for API contract)
artifacts/artifacts/webmail/src/ — React frontend
App.tsx — router setup
components/layout/ — sidebar + main layout
components/email/ — MessageList, ReadingPane, ComposeModal, AiAnalysisPanel
pages/ — FolderPage (inbox/sent/drafts/etc), ContactsPage, ConversationsPage
artifacts/artifacts/api-server/src/routes/email.ts — email proxy routes
artifacts/artifacts/api-server/src/routes/contacts.ts — contacts proxy routes
artifacts/artifacts/api-server/src/routes/rules.ts — inbox rules proxy routes
artifacts/web-app/ — unused placeholder artifact; excluded from root build and Railway services
Architecture decisions
Token forwarding: The API server reads Authorization: Bearer <token> from each authenticated request and forwards it to Microsoft Graph API.
Single-user SSO: The main auth server signs a short-lived HS256 JWT assertion for the configured Webmail audience. The API validates it with SSO_SHARED_SECRET, accepts only the configured subject/email, and creates an HTTP-only session. The Webmail server proxies same-origin /api calls to the API with INTERNAL_API_SECRET; browser code never contains either server secret.
The deployed frontend must use same-origin /api requests through the Webmail server. Set API_ORIGIN on Webmail to the API service URL; do not set a public VITE_API_BASE_URL.
Contract-first: OpenAPI spec in lib/api-spec/openapi.yaml gates both the Zod server validators and React Query hooks via Orval codegen.
Proxy pattern: The backend is a thin proxy to Graph API — no local DB is needed for core email features. AI analysis supports configured providers and bounded request inputs.
Folder navigation: All folder views (inbox, sent, drafts, outbox, archive, deleted, junk) use the same FolderPage component, parameterized by folder name.
Product
Email management: View, send, reply, forward, delete, archive, and move emails across all Outlook folders
Reading pane: 3-column layout (sidebar → message list → reading pane)
Compose: Full compose with To/CC/BCC, subject, importance selector
AI Analysis: Per-email analysis panel (summary, sentiment, action items, suggested reply, key topics)
Contacts: View and create contacts
Conversations: Search and browse threaded conversation history
Stats: Sidebar shows live unread counts per folder
User preferences
Populate as you build.

Gotchas
Bearer token must be passed in Authorization header by the client for Microsoft Graph access.
The main auth server must issue a JWT with sub, aud, iat, and exp; email and name are optional. Use the exact configured SSO_SHARED_SECRET on both servers. New Webmail users cannot self-register.
An AI provider key must be configured in the client or OPENAI_API_KEY must be set for AI analysis to work
The /email/messages endpoint uses $search which requires ConsistencyLevel: eventual in some Graph tenants
Body schema naming: never use <OperationIdPascal>Body for component names — causes TS2308 collision in lib/api-zod
Pointers
See the pnpm-workspace skill for workspace structure, TypeScript setup, and package details