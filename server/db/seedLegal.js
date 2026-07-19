// Loads a legal document's content into legal_doc_versions as a new version.
// Run with no args to seed the initial 0.1-draft placeholders (see
// legal/README.md); pass --docType/--version/--file to load real,
// attorney-reviewed text later — that automatically triggers re-acceptance
// for every existing user, since their accepted version will now be stale.
//
// Usage:
//   node server/db/seedLegal.js
//   node server/db/seedLegal.js --docType=tos --version=1.0 --file=path/to/final-tos.md

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('./pool');
const legalRepo = require('./repo/legal');

function parseArgs() {
  const args = {};
  for (const arg of process.argv.slice(2)) {
    const match = arg.match(/^--([^=]+)=(.*)$/);
    if (match) args[match[1]] = match[2];
  }
  return args;
}

async function seedDefaults() {
  const tosContent = fs.readFileSync(path.join(__dirname, '..', '..', 'legal', 'tos-draft.md'), 'utf8');
  const privacyContent = fs.readFileSync(path.join(__dirname, '..', '..', 'legal', 'privacy-draft.md'), 'utf8');
  await legalRepo.createVersion('tos', '0.1-draft', tosContent);
  await legalRepo.createVersion('privacy', '0.1-draft', privacyContent);
  console.log('Seeded legal_doc_versions with 0.1-draft placeholders (tos, privacy).');
}

async function main() {
  const { docType, version, file } = parseArgs();

  if (docType && version && file) {
    if (!['tos', 'privacy'].includes(docType)) throw new Error('docType must be tos or privacy');
    const content = fs.readFileSync(file, 'utf8');
    await legalRepo.createVersion(docType, version, content);
    console.log(`Loaded ${docType} v${version} from ${file}.`);
  } else {
    await seedDefaults();
  }

  await pool.end();
}

main().catch((err) => {
  console.error('Legal seed failed:', err);
  process.exit(1);
});
