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

## Phase 3.1 - Advanced dashboard analytics

- Added a server-side `/api/dashboard` analytics response with validated date presets: today, this week, this month, last month, and custom ranges.
- Added role-scoped KPIs for Super Admin, Marketing Head, and Marketing Executive users.
- Added visit trends, completion rates, pending/cancelled visits, follow-up status counts, top visited clients, upcoming visits, recent completed visits, and role-appropriate performance breakdowns.
- Super Admin Marketing Head performance uses `marketingHeadAtAssignment` with a legacy fallback to the executive's current reporting relationship.
- Added frontend date-range controls, KPI cards, trend/performance/coverage charts, schedule and completed-visit states, and empty/error/loading handling.
- Added regression coverage for organisation-wide metrics, Marketing Head team isolation, executive self-scope, and custom date filtering.

### Phase 3.1 verification

- `npm run build` passed
- `npm run build:server` passed
- `npm run lint` passed
- `npm run test:server` passed: 16 tests
- `npm run test` is not defined in `package.json`

### Phase 3.1 remaining limitations

- Historical visits created before `marketingHeadAtAssignment` existed can only use the current executive reporting relationship as a fallback; no historical manager can be inferred without an assignment audit record.
- Phase 3.2 exports, Phase 3.3 follow-up scheduling, Phase 3.4 Cloudinary media, and Phase 3.5 production hardening remain intentionally deferred.

## Phase 3.2 - Advanced reports and export

- Replaced the inline report query logic with a shared report service and validated Zod query schemas.
- Added date presets and custom date ranges, status, client, category, Marketing Head, and executive filters with pagination and sorting.
- Marketing Executives now receive only their own permitted report records; Marketing Heads remain restricted to their current team.
- Added client-wise and staff-wise summary reports with completion, pending, cancellation, follow-up, and last-visit metrics.
- Added expandable visit histories with historical Marketing Head attribution, lifecycle timestamps, GPS coordinates, unavailable-location display, remarks, and follow-up dates.
- Added secure complete-dataset CSV, XLSX, and PDF exports using the same server-side scope and filters as on-screen reports.
- Added CSV/XLSX formula-injection protection, UTF-8 CSV output, XLSX Summary and Report sheets, PDF branding/filter metadata, page numbering, and long-report page handling.
- Preserved compatibility endpoints for `/reports/overview`, `/reports/clients`, and `/reports/staff`.

### Phase 3.2 verification

- `npm run build` passed
- `npm run build:server` passed
- `npm run lint` passed
- `npm run test:server` passed: 18 tests
- `npm run test` remains unavailable because no `test` script exists in `package.json`

### Phase 3.2 dependencies

- Added `xlsx` for server-generated XLSX workbooks.
- Added `pdfkit` and `@types/pdfkit` for server-generated PDF reports.

### Phase 3.2 limitations

- PDF reports use a compact row layout rather than a multi-column visual table to remain readable on narrow pages.
- Historical attribution for legacy visits without `marketingHeadAtAssignment` still falls back to the executive's current manager because no historical assignment event exists.

## Phase 3.2 report correction

- Restored Client Wise and Staff Wise reports to individual visit-level rows with the original detailed columns and status badges.
- Kept advanced date, status, client, category, Marketing Head, executive, sorting, pagination, and reset filters.
- Changed CSV, XLSX, and PDF exports to use the exact complete filtered visit dataset rather than grouped client/staff summaries.
- PDF exports now use landscape A3 tables with wrapped cells, repeated headers, unavailable GPS em dashes, and page numbers.
- Added regression assertions preventing aggregated summary rows from replacing visit records.

## Completed — Category Master, Ola Maps Address Autocomplete & Report Filter Cleanup

### Category Master
- Created a separate Mongoose `Category` model and collection with `name`, `normalizedName` (case-insensitive unique index), `isActive` (boolean, default true), `createdBy` (ref User), `updatedBy` (ref User), and automatic timestamps.
- Enforced strict backend role-based permissions:
  - Super Admin only can create categories (`POST /api/categories`), edit category names (`PATCH /api/categories/:id`), toggle active/deactivate status, and delete unreferenced categories (`DELETE /api/categories/:id`).
  - Marketing Heads and Marketing Executives have read-only access to active categories (`GET /api/categories`).
  - Hard deletion is blocked with HTTP 400 if any existing client references the category.
- Added Category Management section in Settings for Super Admin users with active/inactive badges, real-time duplicate checks, edit modal, status toggle, and delete prevention.
- Added safe, idempotent category migration (`migrateCategories`) in `server/src/services/migration.ts` that detects distinct existing categories, groups case-insensitive duplicates, creates Category master records, maps clients to their canonical category ID, and preserves all client data.
- Client creation and editing forms now feature a searchable select dropdown sourced from `/api/categories?activeOnly=true`. Arbitrary categories are rejected on the server if categories exist. Inactive categories are rejected on client creation. When editing an existing client, their category is preserved.

### Ola Maps Address Autocomplete
- Integrated Ola Maps Places Autocomplete (`/places/v1/autocomplete`) and Place Details (`/places/v1/details`) via secure backend proxy endpoints (`/api/maps/autocomplete`, `/api/maps/details`).
- Backend security:
  - Stored `OLA_MAPS_API_KEY` exclusively in server environment variables; never exposed to Vite frontend or client builds.
  - Proxy endpoints require session authentication (`requireAuth`) and validate input parameters (minimum 2 characters, sanitization).
  - Outgoing requests use `AbortController` timeouts (5000ms) with error isolation; errors and 503s are caught and handled gracefully without crashing or leaking keys.
  - Response payloads are sanitized DTOs (`placeId`, `mainText`, `secondaryText`, `latitude`, `longitude`, `formattedAddress`).
- Frontend UX:
  - Implemented `AddressAutocomplete` component with 350ms input debouncing, loading spinner, clear no-results feedback, and keyboard navigation (ArrowUp, ArrowDown, Enter, Escape).
  - Selecting an autocomplete place populates formatted address and stores latitude, longitude, and placeId into Client records.
  - Full manual fallback: users can type any address directly without selecting a place, preserving offline and manual entry when the API key is not configured or network fails.
  - Visit check-in/checkout GPS coordinates remain completely separate from client address coordinates.

### Report Status Filter Cleanup
- Removed `ARRIVED` and `CHECKED_IN` options from report status filter dropdown on both Client Wise and Staff Wise views in `ReportsPage.tsx`.
- Kept `All statuses`, `ASSIGNED`, `COMPLETED`, and `CANCELLED`.
- Updated report query validation schema (`reportQuerySchema`) to reject `ARRIVED` and `CHECKED_IN` with validation error (HTTP 422).
- Visit model schema, visit state transitions, and visit execution lifecycles (`ASSIGNED -> ARRIVED -> CHECKED_IN -> COMPLETED`) remain completely unchanged and operational.
- Populated report category filter dropdown dynamically from `/api/categories`.

### New Environment Variables
- `OLA_MAPS_API_KEY`: API key for Ola Maps developer platform (`https://maps.olakrutrim.com/`). Optional in development; when omitted, address input operates in manual fallback mode without error.

### New API Endpoints
- `GET /api/categories`: List categories (Super Admin sees all or filtered by `activeOnly`; other roles receive active categories only).
- `POST /api/categories`: Create category (Super Admin only, case-insensitive uniqueness check).
- `PATCH /api/categories/:id`: Update category name or active status (Super Admin only).
- `DELETE /api/categories/:id`: Hard-delete category (Super Admin only; rejected if referenced by clients).
- `GET /api/maps/autocomplete`: Secure proxy for Ola Maps autocomplete query (`?input=...`).
- `GET /api/maps/details`: Secure proxy for Ola Maps place details query (`?placeId=...`).

### Verification & Testing
- Total passing tests: **36 tests** (18 existing security/lifecycle tests + 18 new regression tests).
- Regression test coverage in `server/tests/category-maps-report.test.ts`:
  1. Super Admin can create categories.
  2. Marketing Head cannot create categories (HTTP 403).
  3. Marketing Executive cannot create categories (HTTP 403).
  4. Duplicate category names rejected case-insensitively (HTTP 409).
  5. Inactive categories cannot be selected for new clients (HTTP 400).
  6. Existing clients retain their categories.
  7. Category migration is safe to rerun and idempotent.
  8. Categories referenced by clients cannot be deleted (HTTP 400).
  9. Backend maps proxy works with valid configuration.
  10. API key is never returned to frontend.
  11. Invalid/empty maps queries are rejected (HTTP 400).
  12. Provider errors handled gracefully.
  13. Manual address entry continues to work when provider is unavailable.
  14. Selecting a suggestion saves address and coordinates.
  15. ARRIVED is not available as a report filter (HTTP 422).
  16. CHECKED_IN is not available as a report filter (HTTP 422).
  17. ASSIGNED, COMPLETED and CANCELLED remain available (HTTP 200).
  18. Visit lifecycle functionality remains unchanged.
- `npm run build`: Passed with 0 errors.
- `npm run build:server`: Passed with 0 errors.
- `npm run lint`: Passed with 0 errors.
- `npm run test:server`: Passed with 36/36 tests passing.

### Remaining Limitations
- Live Ola Maps geocoding and autocomplete calls against `https://api.olamaps.io` require a valid, funded/active `OLA_MAPS_API_KEY` configured in the backend environment.

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

## Category Master, Ola Maps Autocomplete, Report Filter Cleanup & Staff Reinstatement

### 1. Category Master
- **Model**: Created `Category` collection (`server/src/models/Category.ts`) with `name`, `normalizedName` (lowercase unique index), `isActive` (boolean), `createdBy`, `updatedBy`, and timestamps.
- **Permissions**:
  - Super Admin: Full CRUD (create, update name, activate/deactivate, delete). Delete is blocked (400) if any client references the category.
  - Marketing Heads & Marketing Executives: Read-only access to active categories (`GET /api/categories?activeOnly=true`).
- **Client Integration**:
  - Updated `Client` model with `categoryId` (ObjectId ref to Category).
  - Searchable dropdown in client create/edit modal populated from active categories (`/api/categories?activeOnly=true`).
  - Server validation verifies category ID exists and is active.
- **Migration**:
  - Added idempotent `migrateCategories()` in `server/src/services/migration.ts`.
  - Migrates distinct client category strings to canonical `Category` records, normalizing case duplicates and updating clients with `categoryId`.
- **UI**: Added **Category Management** section under Settings for Super Admin (`src/features/settings/CategorySettings.tsx`).

### 2. Ola Maps Address Autocomplete
- **Architecture**:
  - Secure backend proxy at `GET /api/maps/autocomplete` and `GET /api/maps/details`.
  - Stores `OLA_MAPS_API_KEY` strictly on the backend; never exposed to Vite frontend.
  - 5-second timeout with `AbortController`, query parameter validation, and sanitized DTOs.
- **Frontend UX**:
  - Implemented `AddressAutocomplete.tsx` with 350ms debounce, loading indicator, keyboard navigation (Arrow Up/Down, Enter, Escape), clear empty state, and provider error fallback.
  - Full manual address entry fallback supported at all times.
  - Populates client `address`, `formattedAddress`, `latitude`, `longitude`, and `placeId`.

### 3. Report Filter Cleanup
- Removed `ARRIVED` and `CHECKED_IN` options from report status dropdowns in `ReportsPage.tsx` for both Client Wise and Staff Wise views.
- Preserved options: `All statuses`, `ASSIGNED`, `COMPLETED`, `CANCELLED`.
- Server-side validator (`server/src/validators/report.ts`) validates report status query parameters and rejects `ARRIVED` / `CHECKED_IN` with 422.
- The `Visit` model and visit execution lifecycle (`ASSIGNED -> ARRIVED -> CHECKED_IN -> COMPLETED`) remain completely unchanged.

### 4. Staff Reinstatement & Archival Conflict Resolution
- **Issue**: Soft-deleting staff via "Delete staff" set `isArchived: true`. Subsequent invitations with the same email threw MongoDB duplicate key errors (11000) due to the unique index on `email`.
- **Resolution**: Updated `createUser` in `server/src/controllers/auth.ts` to detect if an email belongs to an archived staff member. If archived, it reinstates and updates the account with new credentials, role, designation, and manager, preserving all historical visit references and immediately displaying them in the active staff directory.

### 5. Verification & Tests
- `npm run build`: Passed (0 errors).
- `npm run build:server`: Passed (0 errors).
- `npm run lint`: Passed (0 errors).
- `npm run test:server`: All 36 tests passed (18 security + 18 category/maps/report/staff-restoration tests).
- Phase 3.3 remains untouched as planned.

## GPS Geofencing & Visit Location Verification

### 1. Check-in Verification Policy
- **High-Accuracy GPS**: Captures device GPS coordinates (`latitude`, `longitude`, `accuracy`, and `recordedAt`).
- **Haversine Distance**: Server independently calculates great-circle distance between device GPS and registered client coordinates from Ola Maps. Frontend distance or verification claims are never trusted.
- **Allowed Radius**: Default 50 meters (Super Admin configurable). Can be overridden per client via `client.geofenceRadius`.
- **Enforcement Rules**:
  - Distance $\le$ allowed radius and accuracy $\le$ 100m: Allows check-in with `verificationStatus: 'VERIFIED'`.
  - Distance $>$ allowed radius: Rejects normal check-in with 422 error containing measured distance and allowed radius.
  - GPS accuracy $>$ 100m: Rejects check-in (`ACCURACY_INSUFFICIENT`).
  - Stale GPS ($>$ 5 minutes old) or invalid future timestamp: Rejects check-in (`STALE_GPS`).
  - Missing client coordinates: Rejects check-in (`MISSING_CLIENT_COORDINATES`) unless authorized exception exists.
  - Location unavailable: Rejects normal check-in without silent bypass (`LOCATION_UNAVAILABLE`).

### 2. Check-out Policy
- Captures departure GPS where available.
- Calculates distance from client location independently.
- Inside allowed radius: records `verificationStatus: 'VERIFIED'`.
- Outside allowed radius (e.g. 500m or 1km away): **Check-out is never blocked**; records `verificationStatus: 'OUTSIDE_GEOFENCE'` and actual distance.
- Location unavailable: records `verificationStatus: 'LOCATION_UNAVAILABLE'`.
- Coordinates and timestamps are strictly recorded without fabrication.

### 3. Database Schema Extensions
- Extended `locationSchema` in `server/src/models/Visit.ts`:
  - `accuracy`: number (in meters)
  - `distanceFromClient`: number (in meters)
  - `allowedRadius`: number (in meters, persisted at decision time)
  - `verificationStatus`: enum (`VERIFIED`, `OUTSIDE_GEOFENCE`, `LOCATION_UNAVAILABLE`, `ACCURACY_INSUFFICIENT`, `STALE_GPS`, `EXCEPTION_APPROVED`, `MISSING_CLIENT_COORDINATES`)
  - `exceptionReason`: string
  - `exceptionApprovedBy`: ObjectId ref User
- Preserved existing fields: `latitude`, `longitude`, `recordedAt`, `locationStatus`.
- Added `geofenceRadius` (min 10, max 2000) to `Client.ts` for client-specific overrides.
- Created `Setting` model (`server/src/models/Setting.ts`) for system-wide configuration.

### 4. Audited Exception Path
- Prevents silent bypass by Marketing Executives.
- Super Admin and Marketing Heads (for their assigned team members) can authorize exceptions at `POST /api/visits/:id/authorize-exception`.
- Executives check in with `allowException: true` only if pre-authorized; records `verificationStatus: 'EXCEPTION_APPROVED'`, `exceptionReason`, and `exceptionApprovedBy`.
- Audit logs record `VISIT_EXCEPTION_AUTHORIZED` and `VISIT_CHECKED_IN_EXCEPTION`.

### 5. UI Integration
- **Check-in Modal** (`CheckInModal.tsx`): Displays client registered location, current device GPS, accuracy badge, distance from client, live verification preview, refresh GPS action, and authorized exception banner.
- **Check-out Modal** (`CheckOutModal.tsx`): Displays departure distance, outside-geofence warning, location-unavailable fallback, meeting remarks, and non-blocking complete checkout button.
- **Geofence Settings** (`GeofenceSettings.tsx`): Super Admin panel under Settings to configure default geofence radius (meters) and maximum allowed GPS accuracy (meters).
- **Reports**: Displays coordinates, calculated distance, and verification status badges for check-in and check-out.

### 6. Regression Testing
- Added comprehensive test suite in `server/tests/geofence.test.ts` (14 tests):
  1. Inside 20m: Verified check-in.
  2. Inside 50m: Verified check-in at boundary.
  3. Outside 50m: Rejection with measured distance error.
  4. Poor GPS accuracy: Rejection when accuracy $>$ 100m.
  5. Stale GPS: Rejection when timestamp $>$ 5 minutes old.
  6. Missing client coordinates: Rejection when client has no GPS.
  7. GPS unavailable: Rejection without silent bypass.
  8. Checkout 500m away: Allowed with OUTSIDE_GEOFENCE and actual distance.
  9. Checkout 1km away: Allowed with OUTSIDE_GEOFENCE and actual distance.
  10. Tampered frontend distance: Recalculates true distance and rejects.
  11. Unauthorized bypass: 403 Forbidden on unapproved exception.
  12. Approved exception: Manager/Super Admin exception check-in and audit event.
  13. Historical visit data preservation: Legacy visits remain valid.
  14. Super Admin geofence radius configuration: Dynamic policy enforcement.
- Verification:
  - `npm run test:server`: **52/52 tests passed** (18 security + 18 category/maps/reports + 16 geofencing).
  - `npm run build:server`: Passed (0 errors).
  - `npm run lint`: Passed (0 errors).
  - `npm run build`: Passed (0 errors).

---

## Client GPS Coordinate Persistence & Check-in Verification Fixes

### 1. Root Cause Analysis
- **Missing Coordinates in Visit Check-In**: In `server/src/services/visit.ts`, `listVisits` and `getVisit` projected only `'organisationName category address'`, omitting `latitude`, `longitude`, `geofenceRadius`, `formattedAddress`, and `placeId`. Even when a client had valid coordinates in MongoDB, the visit client payload lacked them, triggering `"Client has no registered GPS coordinates"`.
- **GPS Accuracy Inconsistency**: High accuracy device GPS threshold is strictly 100m. When device GPS accuracy was poor (`±146m`), check-in could not reliably verify proximity within a 50m radius.
- **Client Edit Coordinate Invalidation**: When manually modifying an address without choosing a new suggestion, stale coordinates could remain or fail schema validation if cleared.

### 2. Implementation Details
- **Visit Client Population**:
  - Exported `CLIENT_POPULATE_FIELDS = 'organisationName category address latitude longitude geofenceRadius formattedAddress placeId'`.
  - Updated `listVisits`, `getVisit`, `markArrived`, `checkIn`, `complete`, and `authorizeException` in `server/src/services/visit.ts` to include full client location data.
- **Zod Validation & Coordinate Invalidation**:
  - Updated `server/src/validators/client.ts` to allow `latitude`, `longitude`, `placeId`, `formattedAddress`, and `geofenceRadius` to be `.nullable().optional()`.
  - Updated `ModulePage.tsx` client form handler: when address text changes manually without a suggestion, coordinates are explicitly set to `null` on submit to cleanly invalidate stale coordinates in MongoDB.
- **Ola Maps Autocomplete & Device Location**:
  - Added user-confirmed "Use current location" button in `AddressAutocomplete.tsx` with high-accuracy GPS capture.
  - Added manual address change warning notification (`ℹ️ Address entered manually...`).
- **Check-In Modal UX**:
  - Separated missing client coordinates banner from poor GPS accuracy banner in `CheckInModal.tsx`.
  - Added clear troubleshooting guidance for GPS accuracy ($> 100$m): step outdoors/near window, turn on high accuracy, and click Refresh GPS.
  - Added contextual disabled button states (`Client GPS Missing`, `Accuracy Insufficient`, `Outside Geofence`).
- **Staff Directory Display Fix**:
  - Corrected role formatting in `ModulePage.tsx` so `SUPER_ADMIN` accounts display as `Super Admin` rather than defaulting to `Marketing Head`.
- **Regression Tests**:
  - Added Test 15: Population of `latitude`, `longitude`, `geofenceRadius`, `placeId`, `formattedAddress` in `listVisits` and `getVisit`.
  - Added Test 16: Persistence on client creation, preservation on partial edit, and invalidation on manual edit.
  - Total test suite: **52/52 tests passing**.

---

## Phase 3.4 — Centralized Cloud File Storage & Media Management

### 1. Storage Architecture
- **Provider Abstraction**: Implemented `IStorageProvider` interface (`upload`, `delete`, `getSignedUrl`) backed by `CloudinaryStorageProvider` for production cloud storage and `MockStorageProvider` for automated offline test suites.
- **Strict Database Boundary**: MongoDB stores metadata and references only (`FileAsset`), never binary streams or base64 blobs.
- **Private by Default**: All file assets are uploaded under authenticated private delivery with short-lived signed URLs generated dynamically after validating user permissions.
- **Failure Cleanup & Resilience**: If MongoDB metadata persistence fails after a successful storage upload, the cloud asset is immediately deleted to prevent orphaned files.

### 2. Supported File Types & Ownership
- `USER_AVATAR`: Staff profile pictures (max 5MB, JPEG/PNG/WebP, magic bytes signature verified).
- `CLIENT_VISITING_CARD`: Client visiting cards (max 10MB, Images/PDF).
- `CLIENT_DOCUMENT`: Business documents & contracts (max 25MB, PDF/Images/Office docs).
- `VISIT_PHOTO`: Site visit photographs (max 10MB, Images).
- `VISIT_ATTACHMENT`: Visit meeting minutes & invoices (max 25MB, PDF/Images/Office docs).

### 3. Security, RBAC & Team Boundaries
- **Cross-Team Access Rejection**: Marketing Heads cannot access visit attachments or documents belonging to another Head's team (HTTP 403).
- **Executive Isolation**: Marketing Executives can only access attachments for visits assigned to themselves.
- **Filename Sanitization**: Path traversal and malicious characters are sanitized before storage.
- **Upload Rate Limiting**: 60 uploads per 15-minute window via `express-rate-limit`.
- **Full Audit Logging**: `FILE_UPLOADED`, `FILE_ACCESSED`, and `FILE_DELETED` events recorded in `auditevents`.

### 4. Database Schema
- Created Mongoose `FileAsset` model with indexes on `{ ownerType: 1, ownerId: 1, isArchived: 1 }`, `{ uploadedBy: 1, createdAt: -1 }`, and `{ cloudinaryPublicId: 1 }`.
- Linked parent entities: `User.avatarAsset`, `Client.visitingCardAsset`, `Client.documentAssets`, `Visit.photoAssets`, `Visit.attachmentAssets`.

### 5. Frontend & UI Integration
- **Reusable `FileUpload` Component**: Drag-and-drop zone, file picker, file size/MIME validation, secure upload state, thumbnail previews, view/replace actions, and delete confirmation.
- **Profile Modal**: Replaced text avatar input with drag-and-drop profile image upload.
- **Client Modal**: Integrated visiting card and document uploads.
- **Visit Detail**: Integrated site photo and meeting document uploads.
- **Storage Dashboard**: Added Super Admin overview displaying total files, volume, category breakdown, and recent uploads.

### 6. Verification & Test Coverage
- Added `server/tests/storage.test.ts` (10 tests):
  1. Unauthenticated upload rejection (HTTP 401).
  2. Authenticated upload & metadata persistence (HTTP 201).
  3. MIME type and magic bytes signature verification.
  4. File size limit enforcement (HTTP 422).
  5. Cross-team isolation between Marketing Heads (HTTP 403).
  6. Executive isolation on peer visit attachments (HTTP 403).
  7. Soft-deletion, storage removal, and audit recording.
  8. Storage cleanup on database write failure.
  9. Super Admin storage dashboard metrics and non-admin rejection.
  10. Client visiting card and document attachment listing.
- **Total Test Suite**: **62 / 62 tests passing** (18 security + 18 category/maps/reports + 16 geofencing + 10 storage).
- **TypeScript & Lint**: `npm run build:server` (0 errors), `npm run build` (0 errors), `npm run lint` (0 errors).
- Phase 3.5 remains intentionally deferred.

### 7. Cloudinary Provider Activation & Mock URL Remediation
- **Explicit Provider Selection**: Enforced strict provider selection logic. When valid Cloudinary credentials (`CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`) are present, `CloudinaryStorageProvider` is instantiated. Silent fallback to `MockStorageProvider` is forbidden; mock storage is only permitted when explicitly configured via `STORAGE_PROVIDER=mock` or in automated test environments (`NODE_ENV=test`).
- **Startup Connectivity Verification**: Added `verifyStorageConnectivity()` which executes authenticated `cloudinary.api.ping()` upon server boot. Logs provider status and cloud name (`[Storage] Active Provider: CloudinaryStorageProvider (Cloud: <cloud_name>)`) without exposing sensitive API secrets.
- **Signed CDN Delivery**: Configured authenticated short-lived delivery URLs via `cloudinary.url(..., { type: 'authenticated', sign_url: true, secure: true })`, verified returning HTTP 200 with Content-Type `image/png` directly from `res.cloudinary.com`.
- **Legacy Mock Asset Remediation**: 
  - Frontend `FileUpload` safely detects legacy mock assets (`mock-storage.local`), displays a clear informational amber warning (`Local mock asset detected. Please click Replace below to upload to Cloudinary`), and intercepts broken view clicks with guidance instead of triggering browser `DNS_PROBE_FINISHED_NXDOMAIN`.
  - Topbar and profile cards guard against unresolvable `mock-storage.local` images, rendering clean user initials until the user replaces the avatar.
  - End-to-end verified live upload, signed URL delivery, and deletion against the running server.



