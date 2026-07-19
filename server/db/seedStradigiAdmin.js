// Creates the first Stradigi admin account. There is deliberately no public
// signup for Stradigi staff (Section 6 — impersonation is a privileged
// action), so this bootstrap script is the only way to create the first one;
// every subsequent Stradigi staff account is created from within the admin
// console by an existing StradigiAdmin (POST /api/admin/staff).
//
// Usage:
//   node server/db/seedStradigiAdmin.js --email=you@stradigi.io --password=... --name="Jason"

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
  const { email, password, name } = parseArgs();
  if (!email || !password) {
    console.error('Usage: node server/db/seedStradigiAdmin.js --email=you@stradigi.io --password=... [--name="Your Name"]');
    process.exit(1);
  }
  if (password.length < 8) {
    console.error('Password must be at least 8 characters.');
    process.exit(1);
  }

  const existing = await usersRepo.getStradigiUserByEmail(email);
  if (existing) {
    console.error(`A Stradigi user with email ${email} already exists.`);
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await usersRepo.createStradigiUser({ email, passwordHash, name, role: 'StradigiAdmin' });
  console.log(`Created Stradigi Admin: ${user.email} (id ${user.id}). Sign in at /stradigi-login.html`);
  await pool.end();
}

main().catch((err) => {
  console.error('Failed to create Stradigi admin:', err);
  process.exit(1);
});
