# AI Agent Workforce Portal

A multi-tenant, white-labeled SaaS product: a web portal that runs a simulated company org
chart made entirely of AI agents. A human CEO (or any tenant user) issues directives in plain
language; they flow down through a Director of Operations (DOO), department Managers, and
Specialists — each an AI agent — with revision loops, escalation, and human approval gates,
until the work is done and approved.

Built to run entirely on **Replit**: Node/Express + Postgres + the Claude API, with a
dependency-free vanilla-HTML/CSS/JS frontend (no build step, so there's nothing to compile or
misconfigure on Replit's Node runtime).

## What's in here

| Area | Where |
|---|---|
| DB schema (multi-tenant) | `server/db/schema.sql` |
| Data access layer (tenant-scoped) | `server/db/repo/*.js` |
| Auth (signup/login/invite/reset, JWT) | `server/routes/auth.js`, `server/routes/users.js` |
| Agent chain (DOO → Manager → Specialist) | `server/services/agentOrchestrator.js`, `server/services/claude.js` |
| Tasks, approvals, tenant/branding config | `server/routes/tasks.js`, `approvals.js`, `tenants.js`, `usage.js` |
| Stradigi admin + impersonation | `server/routes/admin.js` |
| Support tickets | `server/routes/tickets.js` (tenant side), `server/routes/admin.js` (cross-tenant queue) |
| Stripe billing | `server/services/stripeService.js`, `server/routes/billing.js` |
| Sales/support/billing chatbot | `server/routes/chatbot.js` |
| Legal doc acceptance tracking | `server/routes/legal.js`, `legal/*.md` (**placeholders — see `legal/README.md`**) |
| Frontend | `public/*.html`, `public/js/**` |

## Setup on Replit

1. **Create a new Repl** → Import from GitHub (push this folder to a GitHub repo first), or
   create a blank Node.js repl and upload this folder's contents.
2. **Enable Postgres**: in the Replit sidebar, open the "Database" tool and enable Postgres —
   this auto-sets `DATABASE_URL`.
3. **Set secrets** (Replit sidebar → "Secrets" — see `.env.example` for the full list and
   what each one is for):
   - `JWT_SECRET` — any long random string (`openssl rand -hex 32`)
   - `ANTHROPIC_API_KEY` — from console.anthropic.com
   - `APP_URL` — your repl's public URL (used to build email links)
   - `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` — from the Stripe dashboard (test-mode keys
     are fine to start)
   - `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` — optional; without these, emails are
     logged to the console instead of sent, so the app still runs end-to-end
4. **Install dependencies**:
   ```
   npm install
   ```
5. **Run migrations and seed the legal doc placeholders**:
   ```
   npm run setup
   ```
   (This runs `npm run migrate` then `npm run seed:legal`. Re-run `npm run migrate` any time
   after pulling schema changes — every statement is `IF NOT EXISTS`, so it's safe to re-run.)
6. **Create the first Stradigi admin account** (there's no public signup for Stradigi staff —
   see `server/db/seedStradigiAdmin.js` for why):
   ```
   node server/db/seedStradigiAdmin.js --email=you@stradigi.io --password=your-password --name="Your Name"
   ```
7. **Start the app**:
   ```
   npm start
   ```
8. Open the webview. Visit `/signup.html` to create your first tenant, or `/stradigi-login.html`
   to sign in as the Stradigi admin you just created and provision a tenant from there instead.
9. Enable **Autoscale** deployment (or Reserved VM) so the app stays live without the Repl
   needing to be open in your browser.

### Stripe webhook setup

In the Stripe dashboard → Developers → Webhooks, add an endpoint at
`https://<your-app-url>/api/billing/webhook` listening for at least:
`checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`,
`customer.subscription.deleted`, `invoice.payment_failed`. Copy the endpoint's signing secret
into `STRIPE_WEBHOOK_SECRET`.

## How the task flow works

1. A tenant user (any role) issues a **directive** from the dashboard.
2. The chain runs automatically in the background — DOO writes a project spec and picks a
   department, the Manager assigns 1-4 specialists, each specialist's work is reviewed by the
   Manager (up to 3 revision rounds before the task is flagged **Stuck**), the Manager compiles
   the accepted work, and the DOO validates it against the original spec.
3. If validation passes, the task lands in the **Approval Queue** for an Owner (or an Admin with
   approval authority) to approve or deny. Denial routes back to the DOO with the reason — the
   CEO never edits work directly.
4. Tasks that error out (agent call failed twice) or get Stuck surface in the portal with a
   manual **Retry** / **Resume** action.
5. When there's no open work anywhere, the DOO proposes a workforce improvement instead — see
   the Idle Mode panel on the dashboard.

## Multi-tenancy & white-labeling

Every tenant-scoped table carries a `tenant_id`, and the data-access layer in `server/db/repo/`
centralizes that scoping (see Section 11 of the original brief) rather than repeating filters
ad hoc in routes. Each tenant sets its own logo and brand colors under Settings → Branding,
applied via CSS custom properties (`public/css/style.css` `:root`). Department names,
specialist rosters, and every agent tier's system prompt are stored per-tenant in the DB and
editable from Settings → Departments / Agent Prompts, without a redeploy.

## Stradigi admin console (`/admin.html`, `/stradigi-login.html`)

Separate login and role system from tenant accounts (`StradigiAdmin` / `StradigiSupport`).
StradigiAdmins can provision new tenants and impersonate a specific tenant user for support —
every impersonation session is logged (who, whose account, start/end time) and the impersonated
session shows an unmistakable banner in the portal the whole time it's active.

## Legal documents

**`legal/tos-draft.md` and `legal/privacy-draft.md` are structural placeholders, not
attorney-reviewed legal text.** Read `legal/README.md` before launch — it explains exactly what
needs a lawyer's review and what's already built and working regardless (versioned acceptance
tracking, re-prompt on change, data export/deletion).

## Known MVP simplifications worth knowing about

- **Frontend has no build step by design** (plain HTML/CSS/JS, hash-based routing) — this was a
  deliberate choice to keep Replit's first run friction-free; it also means there's no
  TypeScript/JSX tooling to extend later without introducing a bundler.
- **Usage-cost estimates** (`server/services/claude.js`) are rough, configurable-via-env
  approximations for the soft usage-cap warning only — they are not wired into Stripe billing
  and shouldn't be treated as exact.
- **Data-request deletion** is queue-only (Stradigi staff process it manually), not instant
  self-service — see the comment in `server/routes/legal.js` for why.
- **Database-level row-level security is not implemented** — tenant isolation is enforced at the
  application layer only, per Section 11's MVP scoping. Section 19 of the original brief lists
  this and a few other things explicitly deferred to Phase 2.
