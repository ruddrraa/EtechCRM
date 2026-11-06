# Excel Technologies and Services CRM

Client Management & Field Visit Tracking System for Excel Technologies and Services.

## Stack

React 19, Vite, TypeScript, Tailwind CSS v4, React Router, Recharts, Lucide React, Framer Motion, React Hook Form, Zod, TanStack Query, Node.js, Express, Mongoose, MongoDB Atlas, JWT cookies, bcryptjs, and Zod.

## Development

```bash
npm install
npm run dev
npm run dev:server
# Alias for starting the backend during local development
npm run dev:start
npm run build
npm run build:server
npm run test:server
```

## Project structure

- `src/app` - application composition and routes
- `src/components` - reusable UI, layout, and chart primitives
- `src/features` - authenticated dashboard and module-specific UI
- `src/styles` - global design tokens and responsive styles
- `src/types` and `src/lib` - shared types and utilities
- `server/src` - Express routes, controllers, services, models, validation, and middleware

## Design system

The global tokens in `src/styles/globals.css` use the approved monochrome palette: warm grey background, white surfaces, charcoal primary actions, and green/amber/red operational status colours. The interface uses restrained borders, compact tables, tabular metrics, and responsive layouts inspired by the supplied CRM reference without copying its branding or layout.

## Routes

`/`, `/clients`, `/staff`, `/visits`, `/reports`, `/audit-logs`, and `/settings` are authenticated application routes. The backend API is exposed under `/api`.

Authentication uses an HTTP-only `accessToken` cookie. The frontend role is derived from `/api/auth/me`; there is no production-facing development role selector.

## API endpoints

- `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`
- `POST /api/auth/change-password`
- `POST /api/auth/users` (Super Admin/Admin policy enforced)
- `GET/POST /api/clients`, `PATCH /api/clients/:id` (Admin/Super Admin), `DELETE /api/clients/:id` (Super Admin archive)
- `GET/POST /api/visits`
- `GET /api/visits/:id`
- `POST /api/visits/:id/check-in`
- `POST /api/visits/:id/arrived`
- `POST /api/visits/:id/complete`
- `POST /api/visits/:id/cancel`
- `POST /api/visits/:id/reschedule`
- `GET /api/dashboard`
- `GET /api/users`, `GET/PATCH /api/users/me`, `PATCH /api/users/:id/status`
- `GET /api/reports/overview`, `GET /api/reports/clients`, `GET /api/reports/staff`, `GET /api/reports/client/:clientId`, `GET /api/reports/staff/:userId`
- `GET /api/audit-logs`

The authenticated module pages now use these APIs for client, staff, visit, profile, report, and audit workflows. Visit check-in and check-out request browser geolocation only after the user activates the action; denied or unavailable location is recorded as `LOCATION_UNAVAILABLE`.

Copy `.env.example` to `.env` and provide real MongoDB and JWT values before starting the API. Database persistence has not been tested against a live Atlas deployment in this environment.

If the database has no users yet, set a randomly generated `BOOTSTRAP_TOKEN` of at least 32 characters in `.env`, restart the API, and create the first Super Admin once:

```powershell
$token = '<the same bootstrap token from .env>'
$body = @{ name = 'Your Name'; email = 'you@example.com'; password = '<your new password>' } | ConvertTo-Json
Invoke-RestMethod -Uri 'http://localhost:3001/api/auth/bootstrap' -Method Post -Headers @{ 'x-bootstrap-token' = $token } -ContentType 'application/json' -Body $body
```

The endpoint accepts the password only in the request, never stores it in plaintext, and refuses to run after the first user exists. Then open `/login` and sign in with the email and password you chose. Do not put the bootstrap token or password in source control.

During local development, Vite proxies `/api` requests to `http://localhost:3001`, so run the frontend and backend in separate terminals. The API health check is available at `/api/health`.

## Scope

Cloudinary avatar uploads, exports, notifications, and deployment operations remain deferred to Phase 3.
