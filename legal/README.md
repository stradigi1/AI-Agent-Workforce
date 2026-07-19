# Legal documents — read this before doing anything else with this folder

`tos-draft.md` and `privacy-draft.md` are **structural placeholders only**. They exist so the
product has *something* to show at signup and so the acceptance-tracking mechanism (Section 10
of the project brief) has real content to version and log against. **They are not attorney-reviewed
legal language and must not be treated as final.**

Per the brief: the priority for these documents is protecting Stradigi (and Jason personally),
with indemnification running from tenants/users toward Stradigi. That's exactly the kind of
asymmetric, liability-defining language that needs a licensed attorney to draft or review for
your governing jurisdiction — enforceability of indemnification/liability-limitation clauses
varies by state and country, you're selling B2B to businesses who may have their own legal
review, and these documents intersect with real regulatory obligations (GDPR/CCPA) that carry
actual penalties.

## What's actually built (works today, independent of the final legal wording)

- Versioned storage of ToS/Privacy Policy content (`legal_doc_versions` table)
- Timestamped, per-user acceptance tracking (`legal_acceptances` table) — captured at signup
  and invite-acceptance
- A re-prompt mechanism: `GET /api/legal/status/acceptance` tells the frontend when a logged-in
  user's accepted version is behind the current one, so the portal can force re-acceptance
- Data export (`POST /api/legal/data-request/export`) and a deletion request queue
  (`POST /api/legal/data-request/deletion`), per the "must actually exist in the product, not
  just be promised in the policy" requirement

## To go live

1. Give your attorney the checklist embedded as comments in `tos-draft.md` and
   `privacy-draft.md` — it's the product-specific brief from Section 10 of the project doc.
2. Once you have final language, run:
   ```
   node server/db/seedLegal.js --docType=tos --version=1.0 --file=path/to/final-tos.md
   node server/db/seedLegal.js --docType=privacy --version=1.0 --file=path/to/final-privacy.md
   ```
   This inserts a new version row. Every existing user's `acceptedVersion` will now be stale,
   and the portal will re-prompt them to accept on next login — this is the "re-prompt
   acceptance when terms change materially" requirement working as intended, not a bug.
