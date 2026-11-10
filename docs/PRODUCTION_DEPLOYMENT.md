# Production Deployment, Backup & Disaster Recovery Runbook

Architecture: **Vercel (React + Vite SPA & Node Serverless Express API)** + **MongoDB Atlas M0** + **Cloudinary (Authenticated Media Storage)** + **GitHub Actions (Encrypted Logical Backups)**

---

## 1. Environment Variables Checklist (Vercel Project Settings)

Configure all production variables in **Vercel Dashboard -> Project Settings -> Environment Variables** (never commit values to git):

| Variable | Required | Requirements / Notes |
| --- | --- | --- |
| `MONGODB_URI` | Yes | Production Atlas M0 SRV connection string (`mongodb+srv://...`) using a dedicated least-privilege database user. |
| `JWT_SECRET` | Yes | Minimum 32 random characters (`openssl rand -hex 32`). Never reuse across environments. |
| `JWT_EXPIRES_IN` | Yes | Session lifetime (default `1d`). Paired with `tokenVersion` revocation (`logout-all` / `change-password`). |
| `CLIENT_URL` | Yes | Exact HTTPS origin(s), comma-separated (e.g., `https://crm.yourdomain.com`). Required for CORS and CSRF `requireSameOrigin`. |
| `NODE_ENV` | Yes | Set to `production` in Vercel Production. Ensures `Secure` cookies and HSTS headers. |
| `BOOTSTRAP_TOKEN` | Bootstrap only | Minimum 32 random chars. Remove or rotate immediately after creating the initial `SUPER_ADMIN` user. |
| `CLOUDINARY_CLOUD_NAME` | Yes | Live Cloudinary cloud name. |
| `CLOUDINARY_API_KEY` | Yes | Live Cloudinary API key (server-side signing & Admin API checks). |
| `CLOUDINARY_API_SECRET` | Yes | Live Cloudinary API secret (**server-only**; never prefixed `VITE_`). |
| `STORAGE_PROVIDER` | Yes | Set to `cloudinary` in production. |
| `VAPID_PUBLIC_KEY` | Yes | Generated via `npx web-push generate-vapid-keys`. Served via `/api/notifications/push/vapid-key`. |
| `VAPID_PRIVATE_KEY` | Yes | Matching private VAPID key (**server-only**). |
| `VAPID_SUBJECT` | Yes | Valid `mailto:` or `https:` contact URI (e.g., `mailto:admin@exceltechnologies.in`). |
| `CRON_SECRET` | Yes | Minimum 32 random characters (`openssl rand -hex 32`). Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`. |
| `FOLLOWUP_TIMEZONE` | Recommended | Valid IANA timezone (default `Asia/Kolkata`). |
| `OLA_MAPS_API_KEY` | Optional | Server-side proxy key for client address autocomplete (`/api/maps/autocomplete`). |

> **Off-Vercel Backup Secrets (GitHub Repository Secrets / Operator Shell Only):**
> - `BACKUP_ENCRYPTION_KEY`: Exact 64-character hex string (32 bytes for `AES-256-GCM`), generated via `openssl rand -hex 32`.
> - `RESTORE_TARGET_MONGODB_URI`: Staging/recovery MongoDB URI pointing strictly to a separate database from `MONGODB_URI`.
> - `BACKUP_ALERT_WEBHOOK_URL` *(optional)*: HTTPS webhook URL for sanitized backup failure notifications.

---

## 2. Platform Configuration

### A. Vercel & Custom HTTPS Domain
1. Keep Hobby-safe configuration in [vercel.json](../vercel.json): `maxDuration: 10`, `/api/(.*)` -> `/api` rewrite (`api/index.ts`), `Cache-Control: no-store` on `/api/*`, `Service-Worker-Allowed: /` and `no-cache` on `/sw.js`.
2. Attach your custom domain under **Vercel -> Domains** with HTTPS enforced (required for Service Workers, Web Push `PushManager`, `Geolocation`, and `httpOnly; Secure; SameSite=Lax` cookies).
3. Ensure `CLIENT_URL` matches the exact custom HTTPS origin (`https://crm.example.com`).
4. Initial deployment setup:
   - Run `npm run migrate:roles` once if migrating legacy `'ADMIN'`/`'USER'` records before/after cutover.
   - Bootstrap initial `SUPER_ADMIN` once via `POST /api/auth/bootstrap` with header `x-bootstrap-token`, then delete `BOOTSTRAP_TOKEN` from Vercel env vars.

### B. MongoDB Atlas M0 Configuration & Network Access
1. **Connection Pooling**: [db.ts](../server/src/config/db.ts) caches Mongoose connections per serverless isolate (`maxPoolSize: 5`, `minPoolSize: 0`, `serverSelectionTimeoutMS: 5000`, `socketTimeoutMS: 20000`) to protect Atlas M0's 500-connection shared limit.
2. **Vercel Serverless Egress**: Vercel Hobby serverless functions do not have static egress IPs unless on Pro/Enterprise Static IPs. Configure Atlas Network Access carefully per your Vercel plan tier and restrict database user permissions (`readWrite` on CRM DB only, never Atlas admin roles).
3. **GitHub Actions Runner IP Limitation**:
   - Standard GitHub-hosted runners (`ubuntu-latest`) have dynamic IPs. **Do not default to permanent `0.0.0.0/0` Atlas access solely for backups.**
   - Recommended options:
     1. Use a **self-hosted GitHub Actions runner** behind a static NAT IP allowlisted in Atlas M0.
     2. Or acquire Atlas M0 temporary `/32` CIDR via Atlas Admin API in a pre-backup step and revoke it in an `always()` post-step.
     3. Or run `npm run backup:db` from an authorized operator workstation whose static/current IP is temporarily allowlisted.

### C. Cloudinary Configuration
1. All assets are uploaded directly from browser to Cloudinary via signed upload parameters (`type: 'authenticated'`, folder-scoped `etech_crm/<ownerType>/<ownerId>/...`), bypassing Vercel's 4.5 MB request payload ceiling.
2. End-user CRM viewing always proxies through authenticated `GET /api/files/:id/view` — direct Cloudinary URLs are never exposed to the frontend.
3. Verify Cloudinary CORS allows your Vercel domain origin for direct `POST https://api.cloudinary.com/v1_1/<cloud>/upload` form uploads.

### D. Vercel Cron (`CRON_SECRET` & Daily Follow-ups)
1. [vercel.json](../vercel.json) defines `"path": "/api/cron/follow-ups"` with `"schedule": "30 3 * * *"` (03:30 UTC / 09:00 IST, once daily, compatible with Vercel Hobby).
2. Vercel automatically attaches `Authorization: Bearer <CRON_SECRET>` when `CRON_SECRET` is configured in Vercel Environment Variables. Endpoints fail closed (`503`) if `CRON_SECRET` is unset or `< 32` chars.
3. **Important**: Vercel Cron scheduling cannot be verified locally and is **not active** until deployed to Vercel and confirmed under **Vercel Dashboard -> Cron Jobs** and `GET /api/cron/runs` (Super Admin).

---

## 3. Encrypted Backup, Limitations & Non-Destructive Restore

### A. Atlas M0 Logical Backup Limitations
- **MongoDB Atlas M0 provides NO automated Cloud Backups and NO Point-in-Time Recovery (PITR) / oplog snapshots.**
- `npm run backup:db` performs a **multi-collection logical EJSON export** (`users` including `passwordHash`, `organizations`, `categories`, `settings`, `clients`, `visits`, `followuptasks`, `notifications`, `pushsubscriptions`, `fileassets`, `auditevents`, `cronjobruns`; excluding ephemeral `ratelimitbuckets`).
- Because it is a logical export rather than a frozen PITR snapshot, records created or modified across different collections *while the backup is running* may exhibit minor cross-collection skew (for example, a visit created mid-backup referencing a client created slightly later). Run backups during low-traffic hours (02:30 IST scheduled in `.github/workflows/atlas-m0-backup.yml`) and review consistency warnings on restore.
- Alternative manual native backup (if MongoDB Database Tools are installed locally): `mongodump --uri="$MONGODB_URI" --archive=dump.gz --gzip`, then encrypt externally before storing.

### B. Encryption, Retention & Verification Commands
- Generate a 32-byte key (store only in Password Manager / GitHub Secrets):
  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```
- Create & verify an encrypted backup (`AES-256-GCM`, BSON EJSON preserved, inner SHA-256 checksum inside ciphertext):
  ```bash
  # Recommended combined create + verify command (cross-platform):
  npm run backup:db:verified

  # Or step-by-step:
  npm run backup:db
  npm run backup:verify
  ```
- **Local File Permissions (POSIX vs Windows NTFS)**:
  - On Linux/macOS, `backupDb.ts` enforces `0o600` (owner read/write only) on `.enc` files.
  - **Windows note**: NTFS ignores POSIX `0o600` mode bits. Restrict access to the local `backups/` directory manually so only authorized operator accounts can read `.enc` archives:
    ```powershell
    icacls .\backups /inheritance:r /grant:r "$($env:USERNAME):(OI)(CI)F" "SYSTEM:(OI)(CI)F"
    ```
- Retention policy: Daily GitHub Actions `.enc` artifacts retained for **30 days** (`retention-days: 30`); retain weekly milestone archives externally in encrypted vault storage for 90+ days.

### C. Encryption Key Recovery & Rotation
- **WARNING — Key Loss = Permanent Data Loss**: All backups use authenticated `AES-256-GCM` encryption with no backdoor or key escrow inside the `.enc` archive. If `BACKUP_ENCRYPTION_KEY` is lost, all existing encrypted backups become **permanently unrecoverable**.
- **Storage & Multi-Custodian Escrow Rules**:
  1. Never commit `BACKUP_ENCRYPTION_KEY` to Git, print it in CI/server logs, or store it in the same artifact bucket/folder as `.enc` backups.
  2. Store the active 64-character hex key in **at least two independent places**:
     - Your team Password Manager / Secrets Vault (shared organization vault with MFA + audit log).
     - An **offline break-glass copy** (e.g., encrypted hardware drive or printed split custodian sealed envelope kept securely by two senior principals).
  3. Record the key fingerprint (`SHA-256` prefix of the public key identifier / rotation date—never the key itself) alongside milestone backups when rotating keys.
- **Key Rotation Procedure**:
  1. Generate a new 64-hex key and save both old (`BACKUP_ENCRYPTION_KEY_PREV`) and new (`BACKUP_ENCRYPTION_KEY`) keys in the team vault.
  2. Update GitHub Actions secret `BACKUP_ENCRYPTION_KEY` to the new key and immediately trigger a manual `workflow_dispatch` backup + `npm run backup:verify`.
  3. Optionally re-encrypt archival milestone `.enc` backups (decrypt with old key, re-encrypt with new key in an isolated directory, verify checksums before securely shredding plaintext temp buffers if ever needed—avoid writing unencrypted files to disk).
  4. Keep the previous key in vault escrow until every retention archive encrypted under that key has expired.

### D. Backup Memory Limits, Streaming Pipeline & Interrupted Restore Recovery
- **Streaming V2 Pipeline & Memory Profile**:
  - `npm run backup:db` (`createEncryptedBackupToFile`) and `npm run restore:db:verify` (`restoreEncryptedBackupFromFile`) now stream **V2 ND-EJSON** records (`HEADER` -> 500-doc batched `DOC` cursor lines -> `FOOTER`) single-pass through `zlib.createGzip()` -> `AES-256-GCM` directly to/from a temporary `.tmp-*` file finalized via atomic `fs.rename()`. Collections are **never** accumulated in one in-memory JS object map or double-serialized during CLI disk backup/restore.
  - Incremental single-process limits (`500,000` documents / `256 MB` serialized uncompressed ND-EJSON) abort with HTTP `413` before exhausting CI runner memory, and interrupted backups delete temporary `.tmp-*` files without leaving partial `.enc` archives.
  - Programmatic buffer APIs (`createEncryptedBackup` / `decryptAndVerifyBackup` supporting both V1 and V2) naturally hold only the final returned `Buffer` in memory rather than full source JS object maps.
  - Atlas M0 itself is capped at **512 MB** total storage. If graduating to a dedicated tier (`M10+`), enable MongoDB Atlas Cloud Backups alongside streaming `mongodump --archive --gzip`.
- **Recovering From an Interrupted Partial Staging Restore**:
  - `restore:db:verify` and programmatic `restoreEncryptedBackupToIsolatedTarget` are strictly **non-destructive**: if a network glitch or mid-restore failure leaves partial documents in `RESTORE_TARGET_MONGODB_URI`, retries immediately fail closed (`409 Refusing non-destructive restore`) and post-restore integrity failures fail programmatically with `RestoreConsistencyError` (`422`). Tooling **never** auto-drops collections or databases.
  - **Manual operator recovery (staging/verification database ONLY)**:
    1. Double-check that your shell `RESTORE_TARGET_MONGODB_URI` points strictly to your **isolated staging/verification** database (NEVER `MONGODB_URI`).
    2. Connect to that staging database using MongoDB Compass or `mongosh "$RESTORE_TARGET_MONGODB_URI"` and inspect collections.
    3. Explicitly drop **only** the incomplete staging database: `db.dropDatabase()`.
    4. Confirm `show collections` returns empty, then re-run `npm run restore:db:verify -- backups/<filename>.enc`.

### E. Full End-to-End Staging Restore Drill (12 Steps)
Run this periodic recovery drill against an **isolated empty staging database** (never production `MONGODB_URI`):

1. **Provision Isolated Staging Target**: Create an empty database (e.g., `etechcrm_restore_drill`) on a non-production cluster/instance or isolated staging user with permissions restricted to that staging database only.
2. **Download Encrypted Backup Archive**: Retrieve the target `etechcrm-backup-*.enc` file from GitHub Actions Artifacts or encrypted vault storage into a protected local directory.
3. **Verify Integrity & Authenticity First**: Set `BACKUP_ENCRYPTION_KEY` (matching the key active when the archive was created) and run `npm run backup:verify -- backups/<file>.enc` to verify `AES-256-GCM` auth tag and inner SHA-256 checksum before touching any database.
4. **Set Production Safety Guard Variables**: Export BOTH `MONGODB_URI` (production identity guard—required so restore refuses any accidental production target match) AND `RESTORE_TARGET_MONGODB_URI` (pointing explicitly to your empty staging DB).
5. **Execute Non-Destructive Restore Verification**: Run `npm run restore:db:verify -- backups/<file>.enc`. Confirm `countsMatched: true` and `consistencyWarningsCount: 0`.
6. **Verify Cross-Collection Referential Integrity**: Confirm the report passes all checks (`User.passwordHash`, `User.reportingTo`, `User.avatarAsset`, `Client.createdBy`, `Client.categoryId`, `Client.visitingCardAsset`, `Client.documentAssets`, `Visit.photoAssets`/`attachmentAssets`, `FollowUpTask` historical attribution, `Organization` logos, `FileAsset.uploadedBy`, `FileAsset.ownerId`, `Notification`, `AuditEvent`, and `PushSubscription`).
7. **Reconcile MongoDB Metadata vs Cloudinary Binary Assets**: Remember MongoDB contains only `FileAsset` metadata—**NOT** Cloudinary media binaries. Review the `cloudinaryReconciliation` section (`complete: true`, `truncated: false`):
   - `missingInCloud`: `FileAsset` rows present at backup time whose Cloudinary objects no longer exist in Cloudinary.
   - `unregisteredInDb`: Assets uploaded to Cloudinary *after* the backup snapshot.
   - **Never** automatically delete `unregisteredInDb` assets during a drill.
8. **Boot Application Against Staging Database**: Configure a staging server/preview environment using `RESTORE_TARGET_MONGODB_URI` as its `MONGODB_URI`, keeping production secrets/cron disabled or isolated so staging does not fire live user push/cron jobs unintentionally.
9. **Test Real User Authentication**: Log in with restored user credentials (verifying `passwordHash` and `tokenVersion` round-trip) and verify RBAC roles (`SUPER_ADMIN`, `MARKETING_HEAD`, `MARKETING_EXECUTIVE`) render expected screens.
10. **Verify Historical CRM Records & Exports**: Open existing clients, visits (including `COMPLETED` visits and pending checkout `FollowUpTask` entries), historical reports, and generate a PDF/XLSX export.
11. **Verify Private File Streaming**: Open an existing client visiting card or visit photo (`GET /api/files/:id/view`) to confirm restored `FileAsset` metadata streams the corresponding authenticated asset cleanly.
12. **Document Drill Outcome & Tear Down**: Record drill date, archive timestamp, restore duration, and any warnings in your ops log; then explicitly wipe the temporary staging DB (`db.dropDatabase()`) and remove any decrypted/temporary terminal env vars.

### F. Strictly Non-Destructive Restore Quick Reference
- **Never** run restore commands against `MONGODB_URI`. Restore tooling **fails closed** if `MONGODB_URI` is unset OR if `RESTORE_TARGET_MONGODB_URI` resolves to the production cluster/database (including `mongodb+srv://` vs multi-host replica-set `mongodb://` URIs) OR matches the encrypted source database fingerprint stored inside the backup.
- Quick CLI invocation:
  ```powershell
  $env:MONGODB_URI = "mongodb+srv://<prod-check-uri>/<prod-db>"
  $env:RESTORE_TARGET_MONGODB_URI = "mongodb+srv://<staging-user>:<pass>@<staging-cluster>/etechcrm_restore_verify"
  $env:BACKUP_ENCRYPTION_KEY = "<64-hex-key>"
  npm run restore:db:verify -- backups/<filename>.enc
  ```
- Restore creates schema indexes safely (`createIndex`, **never `syncIndexes()`**, avoiding accidental removal of custom indexes) and validates all counts, credentials, indexes, and cross-collection references.

### G. Cloudinary Media Backup & Metadata Reconciliation
- **Critical Distinction**: MongoDB backups protect **metadata** (`FileAsset`), **NOT** the binary image/PDF files stored inside Cloudinary. Deleting an object in Cloudinary cannot be undone by restoring MongoDB alone.
- **Recommended Cloudinary Safeguards**:
  1. Enable Cloudinary **Backup** add-on / secondary cloud replication or periodic media sync for compliance-critical documents.
  2. Never delete production Cloudinary assets during restore verification.
  3. After restoring a MongoDB backup, run `npm run restore:db:verify` (with `CLOUDINARY_*` configured) or call Super Admin `GET /api/files/storage/orphans?verifyCloud=true`. Full CLI reconciliation uses complete cursor pagination (`complete: true`) so missing/unregistered reports never silently drop items above 500 or 2000 entries.

---

## 4. End-to-End Post-Deployment Production Smoke Test Checklist

Run against the **live deployed HTTPS URL** after every production release (record `X-Request-Id` on any error):

1. **Health & Readiness**: `GET https://<domain>/api/health` returns HTTP `200` with `{ status: "ok", database: "connected" }` and an `X-Request-Id` response header.
2. **Authentication & Session Revocation**: Login (`POST /api/auth/login`) sets `httpOnly; Secure; SameSite=Lax` cookie; `/auth/me` returns profile; `POST /api/auth/logout-all` invalidates prior device sessions and redirects gracefully to `/login` without redirect loops.
3. **RBAC Isolation**: Verify `MARKETING_EXECUTIVE` cannot view `/staff`, `/audit-logs`, or `/api/cron/runs` (`403`); `MARKETING_HEAD` sees only current team records while historical report attribution remains intact.
4. **Clients (Category & Ola Maps)**: Create and edit a client using Category dropdown and Ola Maps autocomplete; verify coordinates persist cleanly.
5. **Visits Lifecycle & Checkout Follow-up Task**: Assign visit -> Mark Arrived -> GPS Check-in -> Checkout with remarks + `followUpDate`. Confirm original visit stays `COMPLETED` and `GET /api/follow-ups` shows the linked `PENDING` task (`POST /api/follow-ups/:id/complete` / `cancel` work cleanly).
6. **Reports & Exports**: Filter Client-wise & Staff-wise reports; download CSV, XLSX, and PDF exports cleanly with dynamic Organization branding.
7. **Direct Cloudinary Upload (>4.5 MB Bypass)**: Upload a PDF > 5 MB on a client/visit; confirm `/api/files/sign-upload` -> direct `api.cloudinary.com` upload -> `/api/files/register` succeeds without HTTP `413` from Vercel.
8. **Private File Streaming & Replacement**: Click "View" in CRM (`GET /api/files/:id/view`) confirms binary streams inline cleanly without direct Cloudinary URLs; upload replacement avatar and verify old avatar is archived/deleted safely.
9. **Notifications & Live Web Push**: Trigger "Send Test Desktop Notification" and a real visit assignment; verify in-app bell notification, foreground browser banner, and background Web Push toast when subscribed.
10. **Daily Follow-up Cron & Diagnostics**: Verify `GET /api/cron/follow-ups` rejects unauthorized calls (`401`) and accepts `Authorization: Bearer <CRON_SECRET>` (`200`, idempotent repeat); confirm `GET /api/cron/runs` shows latest bounded run logs as `SUPER_ADMIN`.
11. **Frontend Bundle & Error Boundary**: Confirm cold-load downloads only entry + active route chunks, offline/timeout shows clean network error, and invalid/missing routes recover cleanly.

