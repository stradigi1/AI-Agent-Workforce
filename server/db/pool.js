const { Pool } = require('pg');

// Replit's Postgres add-on auto-injects DATABASE_URL. Neon/most managed
// Postgres providers require SSL; allow it to be disabled for local dev
// against a plain postgres instance via PGSSLMODE=disable.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
});

module.exports = pool;
