# Development status

## Completed - Phase 1

- Vite + React 19 + TypeScript frontend foundation
- Global monochrome design tokens and responsive styling
- Responsive sidebar with desktop collapse and mobile drawer
- Top navigation with breadcrumbs, search UI, notification placeholder, profile/role preview
- Static role previews for Super Admin, Admin, and Marketing Executive
- Dashboard metrics, activity chart, upcoming visits, staff pulse, and recent activity previews
- Client, staff, visit, report, audit log, and settings page layouts
- Reusable buttons, cards, badges, page headers, tables, chart, loading, empty, and error states
- README and project structure documentation
- Final Phase 1 visual polish: conditional state components retained without permanent client-page rendering, responsive reports cards, readable visit date/time labels, and role-consistent preview identity

## Final Phase 1 verification

- `npm run build` passed after the polish pass
- `npm run lint` passed after the polish pass
- Dashboard, clients, visits, staff, reports, audit logs, and settings routes checked
- Desktop, tablet, and mobile layouts checked
- Recharts dashboard visualization and role previews checked
- Clean browser smoke test confirmed no console errors and no page-level horizontal overflow

## Completed - Phase 2 implementation

- Express TypeScript API with centralized error handling, secure headers, CORS, rate limiting, same-origin state-change protection, and consistent responses
- Mongoose User, Client, Visit, and AuditEvent models with indexes
- HTTP-only JWT cookie authentication, logout, current-user endpoint, password hashing, and role authorization
- Backend-enforced client visibility, visit ownership, cancellation, rescheduling, check-in, checkout, completion, and audit rules
- Zod validation for authentication, clients, visits, location, cancellation, and rescheduling
- Dashboard, client, visit, staff, reports, audit-log, and profile API routes
- TanStack Query authentication and API integration for the dashboard, clients, and visits
- Production-facing role selector removed; navigation and routes are derived from authenticated user role
- Security tests for unauthenticated access, executive visit isolation, ID access, cancellation boundaries, and client validation

## Deferred from Phase 1 / remaining Phase 2 work

- Live Atlas persistence acceptance test with three real accounts
- Browser acceptance test of geolocation permission and unavailable-location paths
- Session expiry redirect and refresh-token/session invalidation strategy beyond JWT expiry

## Deferred to Phase 3

- Production deployment configuration and operational hardening
- Approved exports and notification integrations, if still in scope
- Final policy decisions and acceptance testing against live data

## Known limitations

- Client field policy is documented from the current decision: organisation name, category, and address are required; contact person and notes are optional; phone or email is required.
- Live MongoDB Atlas persistence cannot be claimed until a real `MONGODB_URI` is supplied and tested.
- `npm` reports dependency audit findings that require separate dependency review.

## Phase 2 verification

- `npm run build` passed
- `npm run build:server` passed
- `npm run lint` passed
- `npm run test:server` passed: 5 security, validation, and lifecycle tests
- Local `.env` keys were verified without exposing values
- Running API health check passed at `http://localhost:3001/api/health`
- Frontend entry point passed at `http://localhost:5173/`
- Vite `/api` proxy passed through the frontend origin at `http://localhost:5173/api/health`
- Added `npm run dev:start` as an alias for `npm run dev:server`
- Restored the Phase 1 login presentation with responsive centered card styling, accessible fields, password visibility toggle, validation messaging, and authenticated API submission
- Added a one-time, environment-token-protected Super Admin bootstrap endpoint for empty databases; no default credentials are created
- Login smoke-tested at 1440px, 768px, and 390px: centered card rendered at each width with no horizontal overflow
- Password visibility toggle verified in the browser
- Unauthenticated `/api/auth/me` responses remain expected 401 responses; no React or application error was observed

## Phase 2 workflow completion

- Added real client create/edit forms with server validation, duplicate-name confirmation, creator attribution, and query refresh
- Added staff invitation, permitted role selection, active/inactive management, and profile editing
- Added client-backed Admin assignment and Marketing Executive self-assignment forms
- Added visit action details with explicit browser geolocation for check-in/check-out, unavailable-location handling, mandatory remarks, optional follow-up dates, cancellation, and rescheduling
- Connected staff, client-wise/staff-wise reports, and audit-log pages to protected API data
- Added report overview aggregation endpoints and staff status authorization tests
- Marketing Executives now have access to their own Settings profile while retaining restricted reports, audit logs, and staff access
- Added server-enforced ARRIVED -> CHECKED_IN -> COMPLETED state sequencing with separate arrival, check-in, and checkout records
- Added server-side token-version invalidation for logout and password changes without affecting other user accounts
- Added legacy token-version compatibility so users created before token-version persistence remain authenticated after browser refresh
- Added development origin support for `localhost` and `127.0.0.1` on Vite ports 5173/5174 while keeping production CORS restricted to the configured origin
- Added `/dashboard` as an explicit protected route alias and surfaced dashboard API errors instead of a generic preview-only message
- Added Super Admin client archiving that preserves visits, locations, and audit history
- Added profile password-change validation and detailed report visit records with arrival/check-in/checkout/location/remarks/follow-up data
- `npm run build`, `npm run build:server`, and `npm run lint` passed after workflow integration
- `npm run test:server` passed: 8 security and workflow tests, including legacy session restoration

## Phase 2 acceptance limitations

- Automated tests use MongoDB Memory Server; live MongoDB Atlas persistence across logout/login and server restart still requires environment-specific acceptance testing
- Browser geolocation permission prompts and real three-account workflow testing were not reproducible from the automated test runner
- Existing Atlas records created before this change may not have `tokenVersion` or `createdByName`; new writes populate both, and legacy records remain readable
- The production bundle retains the existing non-blocking chunk-size warning
- Browser-profile refresh, direct `/dashboard` navigation, and live Atlas acceptance still require environment-specific browser testing

## Phase 2 final polish

Completed:

- Replaced the reports overview placeholder with Client Wise and Staff Wise operational reports.
- Added searchable single-record filters, persisted visit history, local timestamp formatting, status badges, coordinate/location-unavailable handling, sticky Excel-style headers, sorting, pagination, loading, empty, and error states.
- Added backend-paginated report detail aggregation with role protection and historical visit preservation.
- Added persisted, user-scoped notifications for assignment, cancellation, arrival, check-in, and completion events.
- Added notification unread counts, mark-read, mark-all-read, outside-click/Escape dismissal, navigation to visit records, polling refresh, and responsive mobile presentation.
- Redesigned the navbar profile control with avatar fallback, role subtitle, profile dropdown, profile navigation, password-change navigation, and secure sign-out.

Changed files:

- `server/src/models/Notification.ts`
- `server/src/services/notification.ts`
- `server/src/services/visit.ts`
- `server/src/controllers/notification.ts`
- `server/src/routes/notification.ts`
- `server/src/routes/report.ts`
- `server/src/app.ts`
- `server/tests/security.test.ts`
- `src/features/reports/ReportsPage.tsx`
- `src/components/layout/Topbar.tsx`
- `src/features/module/ModulePage.tsx`
- `src/app/App.tsx`
- `src/styles/globals.css`

Verification:

- `npm run build` passed; existing non-blocking chunk-size warning remains.
- `npm run build:server` passed.
- `npm run lint` passed.
- `npm run test:server` passed: 9 tests, including private notification visibility and read-state behavior.

Pending environment acceptance:

- Live browser testing of desktop/mobile dropdown positioning and report interactions.
- Three-account notification acceptance against live MongoDB Atlas.

## Targeted reports, modal, and branding fixes

Completed:

- Fixed the Staff modal bug caused by shared `selected` state: closing a staff detail dialog no longer leaves a staff record eligible for the Visits-only actions modal.
- Added valid visit gating for ID, status, and planned date, preventing invalid staff data from rendering as a visit or displaying `Invalid Date`.
- Added event propagation protection to staff actions and preserved activation/deactivation and visit reschedule/cancellation behavior.
- Added unfiltered Client Wise and Staff Wise report endpoints with optional client/staff filters, database-level pagination, sorting, and accurate totals.
- Reports now load all permitted records by default with `All Clients` and `All Staff` options; selecting a record applies the corresponding filter.
- Added the supplied official logo at `public/assets/excel-technologies-logo.png` and reused it through `BrandLogo` in the sidebar and login branding.

Changed files:

- `src/components/ui/BrandLogo.tsx`
- `src/components/layout/Sidebar.tsx`
- `src/features/auth/LoginPage.tsx`
- `src/features/module/ModulePage.tsx`
- `src/features/reports/ReportsPage.tsx`
- `src/styles/globals.css`
- `server/src/routes/report.ts`
- `server/tests/security.test.ts`
- `public/assets/excel-technologies-logo.png`

Verification:

- `npm run build` passed.
- `npm run build:server` passed.
- `npm run lint` passed.
- `npm run test:server` passed: 10 tests, including all-record report pagination/filtering and role restriction checks.
- `npm run test` is not defined in `package.json`; the configured server suite was run instead.
- Existing non-blocking frontend chunk-size warning remains.

## Final Phase 2 staff lifecycle and branding polish

Completed:

- Root cause: staff lifecycle previously exposed only a status mutation and had no separate archive operation, so account lifecycle actions were not represented independently.
- Added explicit Deactivate Account and Activate Account confirmation flows.
- Added a separate Delete Staff destructive confirmation that performs soft archive only.
- Archived users are excluded from staff listings, cannot log in, and retain historical visit/report/client/audit references.
- Root cause of the RBAC issue: target-role authorization was incomplete around staff account management and there was no archive endpoint with explicit hierarchy checks.
- Added backend checks preventing Admins and Marketing Executives from managing Super Admin accounts; Admins can manage only Marketing Executives.
- Added Super Admin management coverage for Admin and Executive accounts and preserved lifecycle audit events.
- Added regression coverage for Super Admin protection, role-promotion rejection, deactivated/archived login rejection, and historical visit preservation.
- Added the supplied collapsed sidebar logo asset and smooth expanded/collapsed wordmark switching using the reusable `BrandLogo` component.

Changed files:

- `server/src/models/User.ts`
- `server/src/middleware/auth.ts`
- `server/src/controllers/user.ts`
- `server/src/routes/user.ts`
- `server/tests/security.test.ts`
- `src/features/module/ModulePage.tsx`
- `src/components/ui/BrandLogo.tsx`
- `src/components/layout/Sidebar.tsx`
- `src/styles/globals.css`
- `public/assets/excel-collapsed-logo.png`

Verification:

- `npm run build` passed.
- `npm run build:server` passed.
- `npm run lint` passed.
- `npm run test:server` passed: 11 tests.
- `npm run test` remains unavailable because no `test` script exists in `package.json`.

Remaining limitations:

- Live browser-profile acceptance and live Atlas persistence still require environment-specific accounts and database configuration.
- The production bundle retains the existing non-blocking chunk-size warning.

## Visit assignment persistence verification

- Verified the Admin `POST /api/visits` endpoint persists `clientId`, `assignedTo`, `plannedDate`, `instructions`, and `ASSIGNED` status in MongoDB.
- Added a regression test covering the exact assignment payload produced by the UI, including the `datetime-local` planned date format.
- The assignment modal now displays the backend validation/authentication error instead of appearing to do nothing, and clears its selected state when closed.
- `npm run test:server` passed: 12 tests.

## Marketing Head hierarchy alignment

Completed:

- Added the final `MARKETING_HEAD` and `MARKETING_EXECUTIVE` roles with `designation` and nullable `reportingTo` user references.
- Added an idempotent startup migration: legacy `ADMIN` records become Marketing Heads and legacy `USER` records become Marketing Executives; IDs, password hashes, statuses, token history, visits, audits, and other references are preserved.
- Applied the approved Option B policy: legacy executives receive `reportingTo: null` and are never automatically assigned to a Marketing Head.
- Added Super Admin reassignment at `PATCH /api/users/:id/reporting`, including an audit event with previous and new manager IDs.
- Added the Super Admin Staff interface Unassigned Executives section with active Marketing Head selection.
- Enforced team-scoped staff listing, visit listing/detail access, visit assignment, cancellation/rescheduling, dashboards, reports, and report filters for Marketing Heads.
- Prevented cross-team assignment and direct record access; unassigned executives retain login, profile, and own historical visit access but cannot receive Marketing Head team assignments.
- Added `marketingHeadAtAssignment` to visits so reassignment does not rewrite historical report attribution.
- Added Marketing Head report fields and Super Admin team-assignment notifications.
- Updated frontend routes, navigation, role labels, staff creation fields, reporting-manager selection, report staff options, and dashboard copy.

Changed files:

- `server/src/models/User.ts`
- `server/src/models/Visit.ts`
- `server/src/middleware/auth.ts`
- `server/src/config/db.ts`
- `server/src/services/migration.ts`
- `server/src/services/auth.ts`
- `server/src/services/dashboard.ts`
- `server/src/services/visit.ts`
- `server/src/controllers/auth.ts`
- `server/src/controllers/user.ts`
- `server/src/routes/auth.ts`
- `server/src/routes/user.ts`
- `server/src/routes/visit.ts`
- `server/src/routes/client.ts`
- `server/src/routes/report.ts`
- `server/src/routes/audit.ts`
- `server/src/validators/auth.ts`
- `server/tests/security.test.ts`
- `src/types/index.ts`
- `src/app/App.tsx`
- `src/components/layout/Sidebar.tsx`
- `src/features/dashboard/DashboardPage.tsx`
- `src/features/dashboard/mockData.ts`
- `src/features/module/ModulePage.tsx`
- `src/features/reports/ReportsPage.tsx`

Verification:

- `npm run build` passed; the existing non-blocking chunk-size warning remains.
- `npm run build:server` passed.
- `npm run lint` passed after the final import cleanup.
- `npm run test:server` passed: 14 tests, including migration preservation, unassigned executives, team isolation, cross-team assignment rejection, and Super Admin reassignment.

Remaining limitations:

- Automated tests use MongoDB Memory Server; live Atlas migration, simultaneous browser-profile sessions, and real mobile/browser acceptance remain environment-specific.
- Legacy role enum values remain readable only as a compatibility bridge for records/tests; the startup migration converts persisted legacy records to the final roles.
- The project has no `npm run test` script; `npm run test:server` is the configured test command.

## Profile update fix

- Fixed Settings profile mutations so the authenticated profile cache is updated immediately from the successful `/api/users/me` response.
- Removed the follow-up auth-query invalidation that could replace the newly saved Settings values with stale session data.
- Added an explicit authenticated-user update path in `AuthContext`, ensuring Settings and the top bar use the saved profile response immediately even when query observers are stale.
- Updated `AppShell` and `Topbar` to consume the current authenticated context directly, preventing layout components from retaining the initial profile prop after navigation.
- Made the Settings panel fetch and render `/users/me` through its own `profile/me` query, so Settings cannot display stale profile data from another component cache.
- Added regression coverage confirming name and phone changes persist while email and role remain protected.
- Verification: `npm run build`, `npm run lint`, and `npm run test:server` passed; the server suite now contains 15 tests.
