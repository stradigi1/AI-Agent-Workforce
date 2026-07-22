// Creates or updates the bootstrap Stradigi admin account. There is deliberately
// no public signup for Stradigi staff (Section 6 — impersonation is a privileged
// action), so this script is the only way to create the first one; every
// subsequent Stradigi staff account is created from within the admin console by
// an existing StradigiAdmin (POST /api/admin/staff).
//
// Idempotent — safe to re-run. If the account already exists the password is
// updated to match (so the build step can stay in place across re-deploys).
//
// CLI usage:
//   node server/db/seedStradigiAdmin.js --email=you@stradigi.io --password=... --name="Jason"
//
// Env-var usage (build step / CI):
//   STRADIGI_SEED_EMAIL / STRADIGI_SEED_PASSWORD / STRADIGI_SEED_NAME

require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('./pool');
const usersRepo = require('./repo/users');

function parseArgs() {
  const args = {};
  for (const arg of process.argv.slice(2)) {
    const match = arg.match(/^--([^=]+)=(.*)$/);
    if (match) args[match[1]] = match[2];
  }
  return args;
}

async function main() {
  const cliArgs = parseArgs();

  // CLI args take precedence; fall back to env vars so the build step works
  // without exposing credentials on the command line.
  const email    = cliArgs.email    || process.env.STRADIGI_SEED_EMAIL;
  const password = cliArgs.password || process.env.STRADIGI_SEED_PASSWORD;
  const name     = cliArgs.name     || process.env.STRADIGI_SEED_NAME || 'Stradigi Admin';

  if (!email || !password) {
    // No credentials provided — skip silently during builds where seeding is
    // optional (env vars simply not set).
    const required = process.argv.length > 2; // fail loudly only when called directly
    if (required) {
      console.error('Usage: node server/db/seedStradigiAdmin.js --email=you@stradigi.io --password=... [--name="Your Name"]');
      process.exit(1);
    }
    console.log('No STRADIGI_SEED_* env vars set — skipping admin seed.');
    await pool.end();
    return;
  }

  if (password.length < 8) {
    console.error('Password must be at least 8 characters.');
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const existing = await usersRepo.getStradigiUserByEmail(email);

  if (existing) {
    // usersRepo.resetPassword also clears failed_login_attempts/locked_until/
    // pending reset tokens — a raw "UPDATE password_hash" here would leave a
    // locked-out account still locked even after the password is "fixed" by
    // a redeploy, which defeats the point of this being the recovery path.
    await usersRepo.resetPassword(existing.id, passwordHash);
    await pool.query(`UPDATE users SET name = $2 WHERE id = $1`, [existing.id, name]);
    console.log(`Updated Stradigi Admin: ${email} (id ${existing.id}).`);
  } else {
    const user = await usersRepo.createStradigiUser({ email, passwordHash, name, role: 'StradigiAdmin' });
    console.log(`Created Stradigi Admin: ${user.email} (id ${user.id}). Sign in at /stradigi-login.html`);
  }

  await pool.end();
}

main().catch((err) => {
  console.error('Failed to seed Stradigi admin:', err);
  process.exit(1);
});
