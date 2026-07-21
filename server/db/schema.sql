-- Stradigi AI Agent Workforce Portal — multi-tenant schema
-- Run once via `npm run migrate`. Safe to re-run (all statements are IF NOT EXISTS).

-- =========================================================================
-- Tenants (one row per customer business)
-- =========================================================================
CREATE TABLE IF NOT EXISTS tenants (
  id                          SERIAL PRIMARY KEY,
  name                        TEXT NOT NULL,
  slug                        TEXT UNIQUE NOT NULL,
  logo_url                    TEXT,
  brand_primary_color         TEXT DEFAULT '#005CB9', -- Stradigi's official brand blue
  brand_secondary_color       TEXT DEFAULT '#5B8FA8',
  plan                        TEXT DEFAULT 'trial',
  stripe_customer_id          TEXT,
  stripe_subscription_id      TEXT,
  subscription_status         TEXT DEFAULT 'trialing'
                              CHECK (subscription_status IN ('trialing','active','past_due','canceled','incomplete')),
  usage_cap_monthly_tokens    BIGINT DEFAULT 2000000,
  usage_cap_warned_at         TIMESTAMP,
  specialist_concurrency_cap  INT DEFAULT 4,
  status                      TEXT DEFAULT 'active' CHECK (status IN ('active','suspended','pending_deletion')),
  created_at                  TIMESTAMP DEFAULT NOW(),
  updated_at                  TIMESTAMP DEFAULT NOW()
);

-- =========================================================================
-- Users — both tenant-side (Owner/Admin/Member) and Stradigi-side
-- (StradigiAdmin/StradigiSupport). tenant_id is NULL for Stradigi staff.
-- =========================================================================
CREATE TABLE IF NOT EXISTS users (
  id                        SERIAL PRIMARY KEY,
  tenant_id                 INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
  user_type                 TEXT NOT NULL CHECK (user_type IN ('tenant','stradigi')),
  email                     TEXT NOT NULL,
  password_hash             TEXT,
  name                      TEXT,
  role                      TEXT NOT NULL, -- tenant: Owner|Admin|Member ; stradigi: StradigiAdmin|StradigiSupport
  active                    BOOLEAN DEFAULT TRUE,
  can_approve               BOOLEAN DEFAULT FALSE, -- Owners always true; Admin configurable per tenant
  invite_token              TEXT,
  invite_expires_at         TIMESTAMP,
  password_reset_token      TEXT,
  password_reset_expires_at TIMESTAMP,
  failed_login_attempts     INT DEFAULT 0,
  locked_until              TIMESTAMP,
  created_at                TIMESTAMP DEFAULT NOW(),
  updated_at                TIMESTAMP DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_tenant_email ON users (tenant_id, email) WHERE user_type = 'tenant';
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_stradigi_email ON users (email) WHERE user_type = 'stradigi';
CREATE INDEX IF NOT EXISTS idx_users_tenant_id ON users(tenant_id);

-- =========================================================================
-- Departments & specialist roles — per-tenant configurable (Section 11)
-- =========================================================================
CREATE TABLE IF NOT EXISTS departments (
  id          SERIAL PRIMARY KEY,
  tenant_id   INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  key         TEXT NOT NULL, -- marketing | development | legal | hr | operations | it | custom keys
  name        TEXT NOT NULL,
  created_at  TIMESTAMP DEFAULT NOW(),
  UNIQUE (tenant_id, key)
);

CREATE TABLE IF NOT EXISTS specialist_roles (
  id             SERIAL PRIMARY KEY,
  tenant_id      INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  department_id  INTEGER NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  created_at     TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_specialist_roles_dept ON specialist_roles(department_id);

-- Agent system prompts, stored in the DB (not hardcoded) so they're editable
-- per tenant without a redeploy. department_id is NULL for DOO/Chatbot rows
-- (tenant-wide), populated for Manager/Specialist rows.
CREATE TABLE IF NOT EXISTS agent_prompts (
  id             SERIAL PRIMARY KEY,
  tenant_id      INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  tier           TEXT NOT NULL CHECK (tier IN ('DOO','Manager','Specialist','Chatbot')),
  department_id  INTEGER REFERENCES departments(id) ON DELETE CASCADE,
  system_prompt  TEXT NOT NULL,
  updated_at     TIMESTAMP DEFAULT NOW()
);

-- A plain UNIQUE(tenant_id, tier, department_id) constraint would NOT work
-- here: standard SQL/Postgres treats NULL <> NULL, so it would silently
-- allow duplicate rows for DOO/Chatbot prompts (department_id IS NULL by
-- design, tenant-wide). COALESCE-ing NULL to a sentinel makes those rows
-- collide correctly, and this is also the exact conflict target
-- repo/prompts.js's upsertPrompt() uses.
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_prompts_unique
  ON agent_prompts (tenant_id, tier, COALESCE(department_id, -1));

-- =========================================================================
-- Tasks — one row per node in the DOO -> Manager -> Specialist chain.
-- The root task (parent_id NULL) carries the original directive + the DOO's
-- project spec, which is the source of truth used for later validation.
-- =========================================================================
CREATE TABLE IF NOT EXISTS tasks (
  id                    SERIAL PRIMARY KEY,
  tenant_id             INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  parent_id             INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  root_id               INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  tier                  TEXT NOT NULL CHECK (tier IN ('DOO','Manager','Specialist')),
  department_id         INTEGER REFERENCES departments(id),
  agent_role            TEXT,
  task_name             TEXT NOT NULL,
  objective             TEXT,
  directive             TEXT, -- original CEO directive text (root task only)
  spec                  TEXT, -- DOO's project spec / definition of done (root task only)
  priority              TEXT DEFAULT 'Medium' CHECK (priority IN ('Low','Medium','High','Urgent')),
  status                TEXT NOT NULL DEFAULT 'DOO' CHECK (status IN (
                          'DOO','Manager','Specialist','Manager_Review','DOO_Review',
                          'Approval_Queue','Approved','Denied','Stuck','Error','Cancelled'
                        )),
  revision_round        INT DEFAULT 0,
  revision_history      JSONB DEFAULT '[]'::jsonb,
  stuck_notes           TEXT,
  error_detail          TEXT,
  doo_validation_notes  TEXT,
  denial_reason         TEXT,
  created_by_user_id    INTEGER REFERENCES users(id),
  approved_by_user_id   INTEGER REFERENCES users(id),
  approved_at           TIMESTAMP,
  output                TEXT,
  created_at            TIMESTAMP DEFAULT NOW(),
  updated_at            TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tasks_tenant_id ON tasks(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tasks_root_id ON tasks(root_id);
CREATE INDEX IF NOT EXISTS idx_tasks_parent_id ON tasks(parent_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);

-- =========================================================================
-- Activity log — "who did what" for tenant Owner/Admin visibility (Section 5)
-- =========================================================================
CREATE TABLE IF NOT EXISTS activity_log (
  id          SERIAL PRIMARY KEY,
  tenant_id   INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     INTEGER REFERENCES users(id),
  action      TEXT NOT NULL,
  detail      TEXT,
  created_at  TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activity_log_tenant ON activity_log(tenant_id, created_at DESC);

-- =========================================================================
-- Impersonation log (Section 6) — every session logged, start/end timestamps
-- =========================================================================
CREATE TABLE IF NOT EXISTS impersonation_log (
  id                 SERIAL PRIMARY KEY,
  stradigi_user_id   INTEGER NOT NULL REFERENCES users(id),
  tenant_id          INTEGER NOT NULL REFERENCES tenants(id),
  target_user_id     INTEGER NOT NULL REFERENCES users(id),
  started_at         TIMESTAMP DEFAULT NOW(),
  ended_at           TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_impersonation_tenant ON impersonation_log(tenant_id);

-- =========================================================================
-- Support tickets (Section 7)
-- =========================================================================
CREATE TABLE IF NOT EXISTS support_tickets (
  id           SERIAL PRIMARY KEY,
  tenant_id    INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id      INTEGER NOT NULL REFERENCES users(id),
  subject      TEXT NOT NULL,
  description  TEXT NOT NULL,
  category     TEXT DEFAULT 'general' CHECK (category IN ('bug','billing','general')),
  severity     TEXT DEFAULT 'normal' CHECK (severity IN ('low','normal','high','urgent')),
  status       TEXT DEFAULT 'Open' CHECK (status IN ('Open','In Progress','Resolved')),
  created_at   TIMESTAMP DEFAULT NOW(),
  updated_at   TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tickets_tenant ON support_tickets(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON support_tickets(status);

CREATE TABLE IF NOT EXISTS support_ticket_messages (
  id               SERIAL PRIMARY KEY,
  ticket_id        INTEGER NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  sender_user_id   INTEGER REFERENCES users(id),
  sender_type      TEXT NOT NULL CHECK (sender_type IN ('tenant','stradigi')),
  message          TEXT NOT NULL,
  created_at       TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ticket_messages_ticket ON support_ticket_messages(ticket_id);

-- =========================================================================
-- Usage / cost tracking (Section 12)
-- =========================================================================
CREATE TABLE IF NOT EXISTS usage_log (
  id                   SERIAL PRIMARY KEY,
  tenant_id            INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  task_id              INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  tier                 TEXT,
  model                TEXT,
  input_tokens         INT DEFAULT 0,
  output_tokens        INT DEFAULT 0,
  estimated_cost_usd   NUMERIC(10,4) DEFAULT 0,
  created_at           TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_usage_log_tenant_date ON usage_log(tenant_id, created_at);

-- =========================================================================
-- DOO idle-mode workforce-improvement proposals — kept separate from tasks
-- =========================================================================
CREATE TABLE IF NOT EXISTS improvement_log (
  id          SERIAL PRIMARY KEY,
  tenant_id   INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  proposal    TEXT NOT NULL,
  created_at  TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_improvement_log_tenant ON improvement_log(tenant_id, created_at DESC);

-- =========================================================================
-- Legal docs — versioned ToS/Privacy Policy content + timestamped acceptance
-- (Section 10). NOTE: seeded content is a structural placeholder only —
-- see legal/README.md. Not attorney-reviewed language.
-- =========================================================================
CREATE TABLE IF NOT EXISTS legal_doc_versions (
  id            SERIAL PRIMARY KEY,
  doc_type      TEXT NOT NULL CHECK (doc_type IN ('tos','privacy')),
  version       TEXT NOT NULL,
  content       TEXT NOT NULL,
  effective_at  TIMESTAMP DEFAULT NOW(),
  UNIQUE (doc_type, version)
);

CREATE TABLE IF NOT EXISTS legal_acceptances (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  doc_type      TEXT NOT NULL,
  version       TEXT NOT NULL,
  accepted_at   TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_legal_acceptances_user ON legal_acceptances(user_id);

-- =========================================================================
-- Data export / deletion requests (Sections 10 & 20)
-- =========================================================================
CREATE TABLE IF NOT EXISTS data_requests (
  id                     SERIAL PRIMARY KEY,
  tenant_id              INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  requested_by_user_id   INTEGER REFERENCES users(id),
  type                   TEXT NOT NULL CHECK (type IN ('export','deletion')),
  status                 TEXT DEFAULT 'Pending' CHECK (status IN ('Pending','Processing','Completed','Failed')),
  file_url               TEXT,
  created_at             TIMESTAMP DEFAULT NOW(),
  completed_at           TIMESTAMP
);

-- =========================================================================
-- In-app notifications (Section 13)
-- =========================================================================
CREATE TABLE IF NOT EXISTS notifications (
  id          SERIAL PRIMARY KEY,
  tenant_id   INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     INTEGER REFERENCES users(id) ON DELETE CASCADE, -- NULL = broadcast to all Owners/Admins of the tenant
  type        TEXT NOT NULL, -- approval_needed | task_stuck | task_error | ticket_reply | billing_failed | ...
  message     TEXT NOT NULL,
  link        TEXT,
  read        BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read);
CREATE INDEX IF NOT EXISTS idx_notifications_tenant ON notifications(tenant_id, read);

-- =========================================================================
-- Chatbot (Section 9) — deliberately separate from the task chain
-- =========================================================================
CREATE TABLE IF NOT EXISTS chatbot_conversations (
  id          SERIAL PRIMARY KEY,
  tenant_id   INTEGER REFERENCES tenants(id) ON DELETE CASCADE, -- NULL for anonymous public/sales visitors
  user_id     INTEGER REFERENCES users(id),
  session_id  TEXT NOT NULL,
  mode        TEXT DEFAULT 'sales' CHECK (mode IN ('sales','support','billing')),
  created_at  TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chatbot_conversations_session ON chatbot_conversations(session_id);

CREATE TABLE IF NOT EXISTS chatbot_messages (
  id                SERIAL PRIMARY KEY,
  conversation_id   INTEGER NOT NULL REFERENCES chatbot_conversations(id) ON DELETE CASCADE,
  role              TEXT NOT NULL CHECK (role IN ('user','assistant')),
  message           TEXT NOT NULL,
  created_at        TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chatbot_messages_conv ON chatbot_messages(conversation_id);
