# Excel Technologies and Services CRM

Client Management & Field Visit Tracking System for Excel Technologies and Services, architected for **Vercel (SPA + Node Serverless Functions)**, **MongoDB Atlas M0**, and **Cloudinary**.

## Stack

- **Frontend**: React 19, TypeScript, Vite (route-level code splitting & `ErrorBoundary`), React Router, TanStack Query, React Hook Form, Zod, Recharts, Lucide React, Framer Motion, Tailwind CSS v4.
- **Backend**: Node.js, Express 5, TypeScript, Mongoose, MongoDB Atlas M0, HTTP-only `HS256` JWT cookies (`tokenVersion` revocation), bcryptjs, Cloudinary signed direct uploads & streaming proxy, Web Push (`web-push` + VAPID), PDFKit, XLSX, Vitest + Supertest + `mongodb-memory-server`.

## Development & Operations Scripts

```bash
npm install
npm run dev               # Start Vite frontend dev server (http://localhost:5173)
npm run dev:server        # Start Express backend dev server (http://localhost:3001)
npm run build             # Type-check & build production frontend bundle (dist/)
npm run build:server      # Compile backend TypeScript (dist-server/)
npm run lint              # Run ESLint across frontend & backend
npm run test:server       # Run complete server & integration test suite
npm run migrate:roles     # Explicit role migration check (reads before writing)
npm run backup:db         # Create AES-256-GCM encrypted EJSON logical DB backup
npm run backup:verify     # Verify latest (or specified) encrypted backup archive
npm run restore:db:verify # Non-destructive restore verification into isolated target DB
```

## Project Structure

- `api/index.ts` — Vercel Serverless entrypoint wrapping cached Express app and Atlas M0 DB connection
- `src/app`, `src/components`, `src/features`, `src/lib` — React SPA, route-lazy pages, ErrorBoundary, Push client, and foreground notifications
- `public/sw.js`, `public/manifest.json` — Service Worker & PWA manifest for background Web Push & notification click routing
- `server/src` — Express routes, controllers, services, Mongoose models, Zod validators, RBAC, storage & backup services, cron handlers
- `docs/PRODUCTION_DEPLOYMENT.md` — Full Vercel, Atlas M0, Cloudinary, VAPID, Cron, Backup/Restore, and E2E smoke test runbook
- `.github/workflows/atlas-m0-backup.yml` — Scheduled encrypted logical backup & verification workflow

## Key API Endpoints

- **Auth & Users**: `POST /api/auth/bootstrap`, `POST /api/auth/login`, `POST /api/auth/logout`, `POST /api/auth/logout-all`, `GET /api/auth/me`, `POST /api/auth/change-password`, `POST /api/auth/users`, `GET /api/users`, `PATCH /api/users/me`, `PATCH /api/users/me/preferences`, `PATCH /api/users/:id/status`, `PATCH /api/users/:id/reporting`
- **Clients, Categories & Maps**: `GET/POST /api/clients`, `PATCH /api/clients/:id`, `DELETE /api/clients/:id`, `GET/POST/PATCH/DELETE /api/categories`, `GET /api/maps/autocomplete`
- **Visits & Follow-up Tasks**: `GET/POST /api/visits`, `GET /api/visits/:id`, `POST /api/visits/:id/arrived`, `POST /api/visits/:id/check-in`, `POST /api/visits/:id/authorize-exception`, `POST /api/visits/:id/complete`, `POST /api/visits/:id/cancel`, `POST /api/visits/:id/reschedule`, `GET /api/follow-ups`, `POST /api/follow-ups/:id/complete`, `POST /api/follow-ups/:id/cancel`
- **Dashboard & Reports**: `GET /api/dashboard`, `GET /api/reports/overview`, `GET /api/reports/clients`, `GET /api/reports/staff`, `GET /api/reports/client/:clientId`, `GET /api/reports/staff/:userId` (with CSV/XLSX/PDF exports)
- **Media Storage (Cloudinary)**: `POST /api/files/sign-upload`, `POST /api/files/register`, `POST /api/files/upload`, `GET /api/files/:id/view`, `DELETE /api/files/:id`, `GET /api/files/storage/dashboard`, `GET /api/files/storage/orphans`, `POST /api/files/storage/orphans/cleanup`
- **Notifications & Web Push**: `GET /api/notifications`, `POST /api/notifications/test`, `POST /api/notifications/read-all`, `POST /api/notifications/:id/read`, `DELETE /api/notifications`, `DELETE /api/notifications/:id`, `GET /api/notifications/push/vapid-key`, `POST /api/notifications/push/subscribe`, `POST /api/notifications/push/unsubscribe`
- **Organization, Settings, Audit & Ops**: `GET/PATCH /api/organization`, `GET/PATCH /api/settings/geofence`, `GET/DELETE /api/audit-logs`, `GET/POST /api/cron/follow-ups`, `GET /api/cron/runs`, `GET /api/health`

## Quick Local Setup

1. Copy `.env.example` to `.env` and populate `MONGODB_URI`, `JWT_SECRET` (>= 32 chars), and provider credentials (`STORAGE_PROVIDER=mock` may be used for offline dev).
2. Create initial `SUPER_ADMIN` once when DB is empty using `BOOTSTRAP_TOKEN` (>= 32 chars):
   ```powershell
   $token = '<BOOTSTRAP_TOKEN>'
   $body = @{ name = 'Admin'; email = 'admin@example.com'; password = '<strong-password>' } | ConvertTo-Json
   Invoke-RestMethod -Uri 'http://localhost:3001/api/auth/bootstrap' -Method Post -Headers @{ 'x-bootstrap-token' = $token } -ContentType 'application/json' -Body $body
   ```
3. See [docs/PRODUCTION_DEPLOYMENT.md](docs/PRODUCTION_DEPLOYMENT.md) for Vercel deployment, Atlas M0 encrypted backups, and post-deployment smoke verification.
