# AI Agent Workforce Portal

A multi-tenant, white-labeled SaaS platform where a human CEO issues directives that flow through a chain of AI agents — Director of Operations → Managers → Specialists — with revision loops, escalation, and human approval gates.

## Stack

- **Backend**: Node.js / Express (`server/index.js`)
- **Database**: PostgreSQL (Replit built-in — `DATABASE_URL` is auto-set)
- **AI**: Anthropic Claude API (`server/services/agentOrchestrator.js`, `server/services/claude.js`)
- **Frontend**: Vanilla HTML/CSS/JS, no build step (`public/`)
- **Auth**: JWT (`server/routes/auth.js`)
- **Billing**: Stripe (`server/services/stripeService.js`, `server/routes/billing.js`)
- **Email**: Nodemailer/SMTP — logs to console if SMTP is not configured

## How to run

```
npm start
```

Runs on port 3000. First-time setup:

```
npm install
npm run setup          # runs migrations + seeds legal doc placeholders
```

## Required secrets (Replit Secrets)

| Secret | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Claude API — required for the agent chain |
| `JWT_SECRET` | Signs login tokens — any long random string |
| `SESSION_SECRET` | Express session signing |

## Optional secrets

| Secret | Purpose |
|---|---|
| `STRIPE_SECRET_KEY` | Billing (app starts without it; billing routes error gracefully) |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signature verification |
| `SMTP_HOST/PORT/USER/PASS` | Transactional email (without these, emails are logged to console) |

## Environment variables

| Variable | Purpose |
|---|---|
| `APP_URL` | Public base URL — used in email links and Stripe redirect URLs |

## First-time account setup

Create the first Stradigi admin (platform staff):
```
node server/db/seedStradigiAdmin.js --email=you@example.com --password=yourpassword --name="Your Name"
```

Then visit `/signup.html` to create a tenant, or `/stradigi-login.html` to sign in as the Stradigi admin.

## Key directories

| Path | What's there |
|---|---|
| `server/routes/` | Express route handlers (auth, tasks, billing, admin, etc.) |
| `server/services/` | Agent orchestration, Claude client, Stripe, email |
| `server/db/repo/` | Tenant-scoped data access layer |
| `server/db/schema.sql` | Full DB schema (safe to re-run — all `IF NOT EXISTS`) |
| `public/` | Frontend HTML/CSS/JS |
| `legal/` | ToS and privacy policy placeholders (see `legal/README.md` before launch) |

## User preferences

_Nothing recorded yet._
