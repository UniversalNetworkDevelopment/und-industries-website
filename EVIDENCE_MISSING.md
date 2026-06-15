# EVIDENCE & BOOKKEEPING AUDIT: MISSING COMPONENTS

## 1. Missing Zipping Mechanism (Severity: CRITICAL)
- **Missing:** Logic to compress and encrypt evidence packs.
- **Explanation:** The SOP requires a single zipped archive uploaded to Supabase. There is no `archiver` or `zlib` script written to handle this.
- **Required Fix:** Create `evidence_compiler.js`.

## 2. Missing Cryptographic Hashing (Severity: HIGH)
- **Missing:** SHA-256 hash generation for the evidence pack.
- **Explanation:** To legally prove the evidence pack hasn't been tampered with, Qwep needs to generate a hash and store it in `audit_logs`. This logic does not exist.
- **Required Fix:** Add `crypto.createHash('sha256')` logic to the evidence compiler.
