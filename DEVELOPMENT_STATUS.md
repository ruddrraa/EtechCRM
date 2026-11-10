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
## Phase 3.4.2 — Notification Verification, Session Security QA & Private File Streaming

### 1. Real Notification System Audit & Implementation
- **Separated Delivery Layers**:
  - **In-App Notifications**: Backed by MongoDB `Notification` collection with dynamic polling and real-time read/unread management. Added `DELETE /api/notifications` (clear all) and `DELETE /api/notifications/:id` (delete individual item).
  - **Desktop Browser Notifications**: Integrated native HTML5 `Notification` API with explicit user action gating (`requestDesktopNotificationPermission()`) and navigation on click.
  - **Desktop & Mobile Web Push Notifications**: Integrated W3C Push API with standard VAPID authentication (`web-push`). Created MongoDB `PushSubscription` model storing endpoints, `p256dh`, and `auth` credentials. Added background `sendPushToUser` dispatching with automated cleanup of expired endpoints (HTTP 404/410).
  - **PWA Manifest & Service Worker**: Added `public/manifest.json` with `display: standalone`, high-res icons, and `theme_color: #dc2626`. Added `public/sw.js` with `push` and `notificationclick` listeners capable of waking background windows and navigating to target URLs. Configured Apple Web Push meta tags (`apple-mobile-web-app-capable`) for iOS Safari 16.4+ Home Screen support.
- **Persistent Notification Preferences**:
  - Added `User.notificationPreferences` schema in MongoDB storing booleans for `dailyProductivity`, `newEventCreated`, `mobilePush`, `desktopAlerts`, and `emailSummary`.
  - Added `PATCH /api/users/me/preferences` endpoint. Connected switch toggles in `SettingsPage.tsx` General tab to real API mutations.

### 2. Session & Token Security QA
- **HTTP-Only Cookie Architecture**: JWT tokens stored exclusively in `httpOnly`, `sameSite: 'lax'`, `secure: production` cookies.
- **Token Versioning & Revocation**: Token version checked on every authenticated request (`payload.tokenVersion === user.tokenVersion`).
- **Global Session Revocation**: Implemented `POST /api/auth/logout-all` endpoint which atomically increments `tokenVersion` in MongoDB and clears the browser cookie, immediately invalidating all active sessions across all devices. Added "Sign out of all devices" button in the Settings > Security tab.

### 3. Global Search UI Refinement
- **Bounded Dropdown Layout**: Refined `.search-results-dropdown` with `max-width: min(420px, calc(100vw - 32px))` and `overflow-x: hidden`, preventing horizontal scrollbars on mobile and desktop.
- **Single-Line Truncation & Native Tooltip**: Client search entries display prominent organization names with single-line addresses truncated using `text-overflow: ellipsis; white-space: nowrap; overflow: hidden;` and full text preserved in `title` attributes for native hover tooltips.

### 4. Private CRM File Viewer & Modal Integration (`GET /api/files/:id/view`)
- **Direct Streaming Proxy**: Implemented `streamFileAsset` in `server/src/services/storage/storage.service.ts` and mounted `GET /api/files/:id/view`.
- **Complete Elimination of Raw Cloudinary Navigation**: Persisted and returned URLs strictly use the `/api/files/:id/view` route. Never returns raw Cloudinary delivery URLs or HTTP 301/302 redirects to client browsers.
- **Strict Access Control**: Enforces authentication (401) and strict entity/team RBAC (403 for unauthorized or cross-team access).
- **Security & Caching Headers**: Sets `Content-Disposition: inline; filename="..."` (or `attachment` when `?download=1`), MIME type, `X-Content-Type-Options: nosniff`, and `Cache-Control: private, no-cache, no-store, must-revalidate`.
- **Serverless-Compliant Pipelining**: Cloudinary assets are streamed directly via `Readable.fromWeb(upstream.body).pipe(res)` without RAM buffering, complying with Vercel serverless execution constraints.
- **In-App Modal File Viewer (`FileUpload.tsx`)**: Clicking "View" opens an internal CRM modal with loading and error states, native `<img>` or `<iframe>` rendering, and an explicit "Download" button (`?download=1`).

### 5. VAPID Configuration & Web Push Verification
- **Environment Diagnostics**: Backend validates `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT` (`mailto:...`), logging `[WebPush] VAPID configured: true/false` on startup without leaking secrets.
- **Public Key Endpoint**: Mounted `GET /api/notifications/push/vapid-key` publicly without requiring pre-authentication cookies, resolving the `"VAPID public key is not configured on the server"` frontend alert.
- **Push Client**: `src/lib/pushClient.ts` fetches `/api/notifications/push/vapid-key` with credentials included, registers service worker subscriptions, and saves them to MongoDB `PushSubscription`.
- **Preference Guard**: Push notifications verify `recipient.notificationPreferences?.mobilePush !== false` before dispatching.

### 6. Foreground Desktop Notification Pipeline & Duplicate Suppression
- **Pipeline Implementation (`useForegroundNotifications.ts`)**:
  - Connected React Query notifications polling in `Topbar.tsx` to the native HTML5 `Notification` API.
  - **Polling Frequency & Window Focus**: Adjusted query interval to `10000ms` (10 seconds) with `refetchOnWindowFocus: true` for near-instant notification detection upon returning to the window.
  - **Historical Snapshot Suppression**: Upon initial mount or user login, seeds all existing notifications into `seenIdsRef` and `sessionStorage`, ensuring old unread notifications never re-fire as spam upon page load or refresh.
  - **Duplicate Suppression**: Tracks seen notification IDs across renders and sessions, and supplies deterministic OS-level tags (`crm-notif-${item._id}`) to `new Notification()` so the OS notification center replaces existing alerts rather than stacking duplicates.
  - **Preference Enforcement**: Checks `user.notificationPreferences.desktopAlerts !== false` and `user.notificationPreferences.newEventCreated !== false` before firing.
  - **Interactive Click Navigation**: Clicking the notification focuses the window, closes the notification, and smoothly navigates the user directly to the target module (`/visits` for `VISIT_ASSIGNED`).
- **Test Trigger**: Added "Send Test Desktop Notification" button in `Settings > General` with `POST /api/notifications/test` backend endpoint, allowing administrators to verify foreground notification delivery directly on Microsoft Edge / Chrome.
- **Visit Assignment Verification**: Verified that assigning a visit generates an unread `VISIT_ASSIGNED` notification delivered to the assigned marketing executive's polling stream and native desktop alert.

### 7. Automated Verification & Quality Gates
- **Automated Test Suite**: **77 / 77 tests passing** across 5 test suites (`organization-audit.test.ts`, `storage.test.ts`, `category-maps-report.test.ts`, `security.test.ts`, `geofence.test.ts`).
- **TypeScript & Lint Gates**:
  - `npm run build:server`: 0 errors.
  - `npm run build`: 0 errors.
  - `npm run lint`: 0 errors.

### 7. Cloudinary Provider Activation & Mock URL Remediation
- **Explicit Provider Selection**: Enforced strict provider selection logic. When valid Cloudinary credentials (`CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`) are present, `CloudinaryStorageProvider` is instantiated. Silent fallback to `MockStorageProvider` is forbidden; mock storage is only permitted when explicitly configured via `STORAGE_PROVIDER=mock` or in automated test environments (`NODE_ENV=test`).
- **Startup Connectivity Verification**: Added `verifyStorageConnectivity()` which executes authenticated `cloudinary.api.ping()` upon server boot. Logs provider status and cloud name (`[Storage] Active Provider: CloudinaryStorageProvider (Cloud: <cloud_name>)`) without exposing sensitive API secrets.
- **Signed CDN Delivery**: Configured authenticated short-lived delivery URLs via `cloudinary.url(..., { type: 'authenticated', sign_url: true, secure: true })`, verified returning HTTP 200 with Content-Type `image/png` directly from `res.cloudinary.com`.
- **Legacy Mock Asset Remediation**: 
  - Frontend `FileUpload` safely detects legacy mock assets (`mock-storage.local`), displays a clear informational amber warning (`Local mock asset detected. Please click Replace below to upload to Cloudinary`), and intercepts broken view clicks with guidance instead of triggering browser `DNS_PROBE_FINISHED_NXDOMAIN`.
  - Topbar and profile cards guard against unresolvable `mock-storage.local` images, rendering clean user initials until the user replaces the avatar.
  - End-to-end verified live upload, signed URL delivery, and deletion against the running server.

## Completed - Phase 3.4.1: CRM UI/UX Revamp & Organization Settings

### 1. Design Direction & Mobile-First Usability
- **Modern Enterprise SaaS Aesthetic**: Standardized on clean white and soft-neutral surfaces (`#f9fafb`, `#ffffff`), crisp 1px borders (`#e5e7eb`), clear typographic hierarchy, subtle shadows, and selective Excel red branding accents (`#dc2626`). Removed all unnecessary gradients and glassmorphism.
- **Mobile-First Responsive Layouts**: Redesigned all workspace modules (Dashboard, Clients, Visits, Staff, Reports, Audit Logs, Settings). At viewports `<= 768px`, data tables automatically adapt into card-based layouts with stacked data fields, avoiding horizontal table clipping. All touch targets meet or exceed 44px.
- **Sidebar & Viewport Architecture**: Pinned the root application layout to `100dvh` (`overflow: hidden`). Configured the sidebar as a flex-column with scrollable middle navigation (`overflow-y: auto`) and anchored bottom controls ("Collapse menu" and "Need help?") that stay firmly positioned at the bottom of the viewport without jumping when page content expands. Main workspace content scrolls independently (`overflow-y: auto`).

### 2. Global Modal Architecture & Dialog Rendering Fix
- **React Portal Implementation**: Rewrote `Modal.tsx` to mount directly into `document.body` via `ReactDOM.createPortal()`, with Escape key dismiss, backdrop click handling, internal scrollable modal body (`max-height: calc(85vh - 120px)`), and background scroll lock (`overflow: hidden` on body).
- **Settings Modal Bug Remediation**: Fixed the bug in `ModulePage.tsx` where clicking "Edit profile" or "Change password" on `/settings` failed to display the dialog until navigating away. Replaced ternary conditionals with clean route handling and dedicated `SettingsPage.tsx`.

### 3. Dedicated Tabbed Settings Experience
- Created `SettingsPage.tsx` featuring an intuitive vertical tab layout:
  1. **My Profile**: Identity card, avatar upload via Cloudinary, inline edit profile dialog, and change password modal.
  2. **Organization** (Super Admin): Company name, contact email, phone, physical address, expanded & collapsed logo upload zones, and live workspace branding preview.
  3. **Categories** (Super Admin): Business category master manager.
  4. **GPS & Geofencing** (Super Admin): Configurable geofence radius and accuracy tolerances.
  5. **File & Media Management** (Super Admin): Storage quota, asset counts, and storage status metrics.
  6. **Security**: Password reset controls and role badge indicator.

### 4. Dynamic Organization Branding & Data Model
- **Mongoose `Organization` Model**: Singleton collection storing `name`, `email`, `phone`, `address`, `expandedLogo`, `expandedLogoAsset`, `collapsedLogo`, `collapsedLogoAsset`, and `updatedBy`.
- **API Endpoints**:
  - `GET /api/organization`: Returns current organization profile (authenticated).
  - `PATCH /api/organization`: Updates organization profile, restricted to `SUPER_ADMIN`, with Zod input validation and full audit logging (`ORGANIZATION_UPDATED`).
- **Dynamic Frontend Branding**: Implemented `OrganizationContext` and `BrandLogo.tsx`. The CRM sidebar dynamically renders custom expanded and collapsed logos (or fallbacks to dynamic organization name text), while the unauthenticated login portal securely preserves the vendor's Excel Technologies branding.
- **Dynamic Report & Export Titles**: Updated `server/src/services/report.ts` so that PDF headers/footers, CSV exports, XLSX workbooks, and print views dynamically fetch the organization name from the database rather than using hardcoded company strings.

### 5. Audit Log Management
- Added `DELETE /api/audit-logs` endpoint strictly restricted to `SUPER_ADMIN`.
- Integrated a prominent "Clear audit logs" button in the Audit Logs interface with a double-confirmation modal, clearing database records and invalidating query cache instantly.

### 6. Neutralized Vendor Text
- Removed all developer/infrastructure vendor names ("Cloudinary", "MongoDB", "Cloud Storage & Media Overview") from end-user viewports, replacing them with professional SaaS labels ("File & Media Management", "File Storage Active", "system asset records").

### 7. Verification & Test Suite
- Created `server/tests/organization-audit.test.ts` (7 automated tests):
  1. `GET /api/organization` returns default profile to authenticated users.
  2. `PATCH /api/organization` enforces Super Admin restriction (HTTP 403 for Marketing Head/Executive).
  3. `PATCH /api/organization` validates and updates organization name and profile.
  4. Generated PDF report dynamically incorporates custom organization name.
  5. Logo upload updates organization branding references.
  6. `DELETE /api/audit-logs` is restricted to Super Admin.
  7. `DELETE /api/audit-logs` wipes audit records and logs deletion event.
- **Test Suite Status**: **69 / 69 passing** across 5 test suites.
- **Build & Quality Gates**: `npm run build:server` (0 errors), `npm run build` (0 errors), `npm run lint` (0 errors).

### 8. Settings UI Visual Redesign & Oversized Logo Overflow Fix
- **Two-Column Settings Architecture**: Redesigned `SettingsPage.tsx` to match the two-column enterprise layout from the second reference design.
  - **Left Column (Navigation)**: Fixed-width (240px) secondary settings navigation grouped into `Account` (My Profile, General, Security) and `Workspace` (Organization, Categories, GPS & Geofencing, File & Media Management). Active items display an Excel red left accent border (`border-left: 3px solid #dc2626`), subtle neutral background (`#f3f4f6`), and bold text.
  - **Right Column (Content)**: Clean header breadcrumb (`Settings > Section Name`), thin section dividers (`1px solid var(--border)`), inline form fields, switch toggles for notification preferences, and no oversized cards or excess whitespace.
  - **Mobile Responsiveness**: On viewports `<= 768px`, secondary navigation smoothly collapses into a touch-friendly horizontally scrollable pill bar (`min-height: 44px`), with full-width inputs and vertical layout.
- **Oversized Logo & Avatar Containment**:
  - Identified root cause of topbar avatar overflow: flex image resolution expanded unbounded `<img>` elements to natural dimensions (800px+).
  - Wrapped `Topbar` avatar in an explicit `.avatar` container and locked `.avatar`, `.profile-trigger img`, and `.avatar img` with `width: 32px !important; height: 32px !important; object-fit: cover !important; border-radius: 50%; overflow: hidden; flex-shrink: 0;`.
  - Added `.profile-avatar-box` enforcing strict `96px × 96px` dimensions for profile photo displays.
  - Enforced strict preview constraints for workspace logos: `.logo-preview-expanded-box` (max `220px × 64px`, `object-fit: contain`) and `.logo-preview-collapsed-box` (max `64px × 64px`, `object-fit: contain`).
## Phase 3.4.2 — Notification Verification, Session Security QA & Private File Streaming

### 1. Real Notification System Audit & Implementation
- **Separated Delivery Layers**:
  - **In-App Notifications**: Backed by MongoDB `Notification` collection with dynamic polling and real-time read/unread management. Added `DELETE /api/notifications` (clear all) and `DELETE /api/notifications/:id` (delete individual item).
  - **Desktop Browser Notifications**: Integrated native HTML5 `Notification` API with explicit user action gating (`requestDesktopNotificationPermission()`) and navigation on click.
  - **Desktop & Mobile Web Push Notifications**: Integrated W3C Push API with standard VAPID authentication (`web-push`). Created MongoDB `PushSubscription` model storing endpoints, `p256dh`, and `auth` credentials. Added background `sendPushToUser` dispatching with automated cleanup of expired endpoints (HTTP 404/410).
  - **PWA Manifest & Service Worker**: Added `public/manifest.json` with `display: standalone`, high-res icons, and `theme_color: #dc2626`. Added `public/sw.js` with `push` and `notificationclick` listeners capable of waking background windows and navigating to target URLs. Configured Apple Web Push meta tags (`apple-mobile-web-app-capable`) for iOS Safari 16.4+ Home Screen support.
- **Persistent Notification Preferences**:
  - Added `User.notificationPreferences` schema in MongoDB storing booleans for `dailyProductivity`, `newEventCreated`, `mobilePush`, `desktopAlerts`, and `emailSummary`.
  - Added `PATCH /api/users/me/preferences` endpoint. Connected switch toggles in `SettingsPage.tsx` General tab to real API mutations.

### 2. Session & Token Security QA
- **HTTP-Only Cookie Architecture**: JWT tokens stored exclusively in `httpOnly`, `sameSite: 'lax'`, `secure: production` cookies.
- **Token Versioning & Revocation**: Token version checked on every authenticated request (`payload.tokenVersion === user.tokenVersion`).
- **Global Session Revocation**: Implemented `POST /api/auth/logout-all` endpoint which atomically increments `tokenVersion` in MongoDB and clears the browser cookie, immediately invalidating all active sessions across all devices. Added "Sign out of all devices" button in the Settings > Security tab.

### 3. Global Search UI Refinement
- **Bounded Dropdown Layout**: Refined `.search-results-dropdown` with `max-width: min(420px, calc(100vw - 32px))` and `overflow-x: hidden`, preventing horizontal scrollbars on mobile and desktop.
- **Single-Line Truncation & Native Tooltip**: Client search entries display prominent organization names with single-line addresses truncated using `text-overflow: ellipsis; white-space: nowrap; overflow: hidden;` and full text preserved in `title` attributes for native hover tooltips.

### 4. Private CRM File Viewer & Modal Integration (`GET /api/files/:id/view`)
- **Direct Streaming Proxy**: Implemented `streamFileAsset` in `server/src/services/storage/storage.service.ts` and mounted `GET /api/files/:id/view`.
- **Complete Elimination of Raw Cloudinary Navigation**: Persisted and returned URLs strictly use the `/api/files/:id/view` route. Never returns raw Cloudinary delivery URLs or HTTP 301/302 redirects to client browsers.
- **Strict Access Control**: Enforces authentication (401) and strict entity/team RBAC (403 for unauthorized or cross-team access).
- **Security & Caching Headers**: Sets `Content-Disposition: inline; filename="..."` (or `attachment` when `?download=1`), MIME type, `X-Content-Type-Options: nosniff`, and `Cache-Control: private, no-cache, no-store, must-revalidate`.
- **Serverless-Compliant Pipelining**: Cloudinary assets are streamed directly via `Readable.fromWeb(upstream.body).pipe(res)` without RAM buffering, complying with Vercel serverless execution constraints.
- **In-App Modal File Viewer (`FileUpload.tsx`)**: Clicking "View" opens an internal CRM modal with loading and error states, native `<img>` or `<iframe>` rendering, and an explicit "Download" button (`?download=1`).

### 5. VAPID Configuration & Web Push Verification
- **Environment Diagnostics**: Backend validates `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT` (`mailto:...`), logging `[WebPush] VAPID configured: true/false` on startup without leaking secrets.
- **Public Key Endpoint**: Mounted `GET /api/notifications/push/vapid-key` publicly without requiring pre-authentication cookies, resolving the `"VAPID public key is not configured on the server"` frontend alert.
- **Push Client**: `src/lib/pushClient.ts` fetches `/api/notifications/push/vapid-key` with credentials included, registers service worker subscriptions, and saves them to MongoDB `PushSubscription`.
- **Preference Guard**: Push notifications verify `recipient.notificationPreferences?.mobilePush !== false` before dispatching.

### 6. Foreground Desktop Notification Pipeline & Duplicate Suppression
- **Pipeline Implementation (`useForegroundNotifications.ts`)**:
  - Connected React Query notifications polling in `Topbar.tsx` to the native HTML5 `Notification` API.
  - **Polling Frequency & Window Focus**: Adjusted query interval to `10000ms` (10 seconds) with `refetchOnWindowFocus: true` for near-instant notification detection upon returning to the window.
  - **Historical Snapshot Suppression**: Upon initial mount or user login, seeds all existing notifications into `seenIdsRef` and `sessionStorage`, ensuring old unread notifications never re-fire as spam upon page load or refresh.
  - **Duplicate Suppression**: Tracks seen notification IDs across renders and sessions, and supplies deterministic OS-level tags (`crm-notif-${item._id}`) to `new Notification()` so the OS notification center replaces existing alerts rather than stacking duplicates.
  - **Preference Enforcement**: Checks `user.notificationPreferences.desktopAlerts !== false` and `user.notificationPreferences.newEventCreated !== false` before firing.
  - **Interactive Click Navigation**: Clicking the notification focuses the window, closes the notification, and smoothly navigates the user directly to the target module (`/visits` for `VISIT_ASSIGNED`).
- **Test Trigger**: Added "Send Test Desktop Notification" button in `Settings > General` with `POST /api/notifications/test` backend endpoint, allowing administrators to verify foreground notification delivery directly on Microsoft Edge / Chrome.
- **Visit Assignment Verification**: Verified that assigning a visit generates an unread `VISIT_ASSIGNED` notification delivered to the assigned marketing executive's polling stream and native desktop alert.

### 7. Automated Verification & Quality Gates
- **Automated Test Suite**: **77 / 77 tests passing** across 5 test suites (`organization-audit.test.ts`, `storage.test.ts`, `category-maps-report.test.ts`, `security.test.ts`, `geofence.test.ts`).
- **TypeScript & Lint Gates**:
  - `npm run build:server`: 0 errors.
  - `npm run build`: 0 errors.
  - `npm run lint`: 0 errors.

## Phase 3.5 — Production Readiness, Security & Deployment Hardening

### Step 1 — Vercel Serverless Architecture & MongoDB Atlas M0 Optimization (Completed & Locally Verified)
- **Serverless Entrypoint (`api/index.ts`)**:
  - Created Vercel Node Serverless handler wrapping cached `createApp()` Express instance without invoking `app.listen()`.
  - Connects to MongoDB cleanly via `await connectDatabase()` before dispatching `(req, res)`, awaits response completion, and handles DB/config errors with sanitized JSON `503` (never leaking connection credentials).
- **Vercel Deployment Configuration (`vercel.json`)**:
  - Configured `/api/(.*)` -> `/api` serverless rewrites, SPA fallback excluding `/api/`, `/assets/`, `/sw.js`, `/manifest.json`, `maxDuration: 10` for Hobby tier compatibility, `Cache-Control: no-store` for `/api/(.*)`, and `Cache-Control: no-cache` + `Service-Worker-Allowed: /` for `/sw.js`.
- **Atlas M0 Connection Reuse (`server/src/config/db.ts`)**:
  - Added `globalThis` connection & promise caching with Atlas M0 conservative pool limits (`maxPoolSize: 5`, `minPoolSize: 0`, `serverSelectionTimeoutMS: 5000`, `socketTimeoutMS: 20000`) and automatic clearing of rejected/disconnected promises.
- **Migration Safety (`server/src/services/migration.ts`, `server/src/server.ts`)**:
  - Removed unconditional `migrateLegacyRoles()` writes from `connectDatabase()`. Added read-only `User.exists()` guard inside `migrateLegacyRoles()`, kept explicit local startup invocation in `server.ts`, and added `npm run migrate:roles` CLI script (`server/src/scripts/migrateRoles.ts`).
- **Reverse Proxy & CORS Origin Support (`server/src/app.ts`, `server/src/middleware/auth.ts`, `server/src/config/env.ts`)**:
  - Enabled `app.set('trust proxy', 1)`, default API `no-store` headers, comma-separated `CLIENT_URL` validation, and exact `VERCEL_URL` / `VERCEL_PROJECT_PRODUCTION_URL` HTTPS origin allowlisting.
- **Verification**:
  - `api/index.ts` strict TypeScript check: **0 errors**.
  - `npm run build:server`, `npm run build`, `npm run lint`: **0 errors**.
  - `npm run test:server`: **89 / 89 tests passing** across 7 suites (including `server/tests/serverless-db.test.ts`).

### Step 2 — Security & Authorization Hardening (Completed & Locally Verified)
- **RBAC & IDOR Fixes**:
  - `PATCH /api/clients/:id` (`server/src/controllers/client.ts`, `server/src/services/client.ts`): Enforces Marketing Head team ownership (`createdBy` must be actor or actor's team member), rejects Executives (`403`), and preserves Super Admin org-wide access.
  - `GET /api/audit-logs` (`server/src/routes/audit.ts`): Scoped Marketing Head visibility to own + current team actor IDs while keeping Super Admin org-wide access.
  - `ownVisit` & `authorizeException` (`server/src/services/visit.ts`): Enforced strict current-team `reportingTo` verification for Marketing Heads (preventing post-reassignment stale `assignedBy` access) while preserving historical `marketingHeadAtAssignment`.
- **Auth, Sessions & URL Injection Hardening**:
  - `server/src/middleware/auth.ts` & `server/src/services/auth.ts`: Pinned `HS256` in `jwt.sign` / `jwt.verify`, added strict ObjectId + numeric `tokenVersion` claims validation, unified `clearCookieOptions`, and preserved two-session invalidation (`logout-all` and `change-password`).
  - `server/src/validators/auth.ts` & `server/src/validators/organization.ts`: Restricted `avatar`, `expandedLogo`, and `collapsedLogo` to valid `/api/files/<24hex>/view` CRM paths (or `""`) and added Zod `preferencesSchema` on `PATCH /api/users/me/preferences`.
- **Serverless Distributed Rate Limiting (`RateLimitBucket.ts`, `server/src/middleware/rateLimit.ts`)**:
  - Replaced in-memory limiters on auth and uploads with a MongoDB TTL-backed atomic `findOneAndUpdate` store (`expiresAt` TTL index) using SHA-256 hashed bucket keys and Atlas M0 write restraint (only security-sensitive endpoints write).
  - Separated limiters: `loginAccountLimiter` (15/15m per IP+email), `loginIpLimiter` (150/15m), `passwordSessionLimiter` (20/15m), `uploadRateLimiter` (60/15m), `mapsRateLimiter` (120/15m), `pushRateLimiter` (60/15m). Enforces **fail-closed `503`** if store is unreachable.
- **API Security, CSRF, ReDoS, XSS & Error Masking**:
  - `requireSameOrigin` checks `Sec-Fetch-Site: cross-site`, `Origin`, and `Referer` fallback on state-changing requests.
  - Added global `sanitizeRequestInputs` stripping `$` / `.` / prototype-pollution keys from `req.body` and `req.query`.
  - Escaped regex metacharacters in `server/src/services/category.ts`, XML-escaped mock SVG previews in `storage.service.ts`, tuned Helmet policies, mapped Mongoose `CastError` -> `422` & Multer size limit -> `413`, and masked DB URIs/API keys in error logs.
- **Verification**:
  - `npm run lint`, `npm run build:server`, `npm run build`: **0 errors**.
  - `npm run test:server`: **98 / 98 tests passing** across 8 suites (including 9 new regression tests in `server/tests/step2-security-hardening.test.ts`).

### Step 3 — MongoDB Atlas M0 Query & Index Optimization (Completed & Locally Verified)
- **Single-Pass `$facet` Report Aggregation (`server/src/services/report.ts`)**:
  - Eliminated duplicate `Visit.aggregate` calls in `getReport()` by calculating `items`, `all` total count, and `statuses` summary (`COMPLETED` / `CANCELLED` / `pending`) in a single `$facet` pipeline.
- **Bounded Queries & Guardrails (`server/src/services/report.ts`, `server/src/services/dashboard.ts`, `server/src/controllers/user.ts`)**:
  - Enforced `MAX_VISIT_DETAILS_ROWS` (`500`) on `getVisitDetails()`, `MAX_EXPORT_ROWS` (`5000`) guardrail on `exportReport()` (throwing clear HTTP `422` if exceeded instead of crashing serverless memory), `$limit` (`50` / `366`) on dashboard `headPerformance` / `trend` pipelines, and `MAX_USERS_LIST_LIMIT` (`500`) on `listUsers`.
- **Atlas M0 Index Hygiene & Compound Indexes**:
  - Removed duplicate `index: true` declarations already covered by `unique: true` or compound prefix indexes across `User.ts`, `Category.ts`, `Setting.ts`, `AuditEvent.ts`, `Notification.ts`, `PushSubscription.ts`, `FileAsset.ts`, and `Visit.ts`.
  - Added justified compound indexes for production access patterns:
    - `Visit`: `{ plannedDate: -1, status: 1 }`, `{ assignedTo: 1, status: 1, plannedDate: -1 }`, `{ followUpDate: 1, status: 1 }`.
    - `Notification`: `{ recipient: 1, readAt: 1 }`.
    - `Client`: `{ isActive: 1, createdAt: -1 }`.
    - `AuditEvent`: `{ actor: 1, timestamp: -1 }`.
- **Known Limitations & Pending Verification**:
  - Query execution plans and index hit ratios are locally validated against `MongoMemoryServer`; production explain plans against populated MongoDB Atlas M0 data await live deployment verification.
- **Verification**:
  - `npm run lint`, `npm run build:server`, `npm run build`: **0 errors**.
  - `npm run test:server`: **101 / 101 tests passing** across 9 suites (including 3 new optimization/index tests in `server/tests/step3-atlas-optimization.test.ts`).

### Step 4 — Cloudinary Upload Ceiling & Replacement/Orphan Safety (Completed & Locally Verified)
- **Signed Direct Upload Flow (Bypassing Vercel 4.5 MB Request Body Ceiling)**:
  - Added `POST /api/files/sign-upload` (`server/src/routes/file.ts`, `server/src/controllers/file.ts`, `server/src/services/storage/storage.service.ts`) validating entity write access (`verifyEntityAccess`), MIME allowlists, per-category size caps (`5MB` avatars/logos, `10MB` visiting cards/visit photos, `25MB` documents/attachments), sanitized filenames, and file magic bytes (`headerHex`), then returning a short-lived `HS256` `uploadIntentToken` (10 min TTL) and signed upload parameters (`type: 'authenticated'`, folder-scoped `etech_crm/<ownerType>/<ownerId>/...`). `CLOUDINARY_API_SECRET` and `JWT_SECRET` never leave the backend.
  - Added `POST /api/files/register` validating the `uploadIntentToken` signature/ownership/folder prefix, verifying the uploaded object directly against the storage provider via `getAssetMetadata` (`cloudinary.api.resource` in production, `MockStorageProvider` in local/test mock mode), rejecting and deleting mismatched resource types, formats (`ALLOWED_FORMATS_FOR_MIME`), or oversized uploads, and registering the asset idempotently (safe retries return HTTP `200` with `idempotent: true` without duplicating `FileAsset` rows).
  - Updated `src/components/ui/FileUpload.tsx` to read the first 16 bytes for `headerHex`, obtain signed parameters from `POST /api/files/sign-upload`, upload binaries directly to Cloudinary when `mode === 'cloudinary'`, finalize via `POST /api/files/register`, and fall back to `/api/files/upload` only in local mock mode (`mode === 'mock'`). Preserved `/api/files/:id/view` authenticated proxy streaming.
- **Safe Single-Slot Replacement & Rollback Isolation**:
  - Extracted shared `finalizeAssetPersistence()` so single-slot assets (`USER_AVATAR`, `CLIENT_VISITING_CARD`, `ORGANIZATION_EXPANDED_LOGO`, `ORGANIZATION_COLLAPSED_LOGO`) read their previous asset pointer before writing, persist the new `FileAsset` and update the owner entity pointer first, and retire/archive/delete the previous asset **only after** new persistence succeeds.
  - On MongoDB persistence or reference-update failure, rolls back **only** the newly uploaded asset (logging `FILE_UPLOAD_ROLLBACK_FAILED` if cleanup throws) while leaving prior single-slot references and cloud objects intact. If deleting a retired old asset fails, marks it `isArchived: true` with `metadata.pendingCloudDelete: true` and writes `FILE_ORPHAN_CLEANUP_PENDING` audit logs without failing the new upload.
  - Fixed `handleDelete` in `src/components/ui/FileUpload.tsx` to call `DELETE /api/files/:id` when `currentAssetId` exists instead of clearing local React state alone, and synced `avatarAsset` state in `src/features/settings/SettingsPage.tsx`. Multi-asset history (`CLIENT_DOCUMENT`, `VISIT_PHOTO`, `VISIT_ATTACHMENT`) remains preserved.
- **Super Admin Orphan Detection & Safe Cleanup**:
  - Added `GET /api/files/storage/orphans` (dry-run scan) and `POST /api/files/storage/orphans/cleanup` (Super Admin only), plus a UI scan/cleanup panel in `src/features/settings/StorageDashboard.tsx`.
  - Enforces a strict minimum age threshold (`minAgeHours >= 1`, default `24`), folder/ownership boundary matching (`VALID_PREFIX_PATTERN`), idempotent cleanup of deferred `pendingCloudDelete` records, unregistered cloud uploads under `etech_crm/`, and optional (`verifyCloud: true`) archival of stale DB records missing from cloud storage — writing `FILE_ORPHAN_AUDIT` / `FILE_ORPHAN_CLEANUP` audit events while leaving active and recent (`< minAgeHours`) uploads untouched.
- **Local Verification Results vs Pending Live Production Verification**:
  - **Local Verification (Passed against MockStorageProvider & MongoMemoryServer)**:
    - `npm run lint`, `npm run build:server`, `npm run build`: **0 errors**.
    - `npm run test:server`: **105 / 105 tests passing** across 10 suites (including 4 new regression tests in `server/tests/step4-cloudinary-upload.test.ts` covering RBAC/secret isolation, oversized >4.5MB intent signing, token/metadata verification, idempotent retry, rollback isolation, safe replacement, deferred deletion flagging, and age-guarded orphan cleanup).
  - **Pending Live Cloud / Vercel Verification (Not Executed Locally)**:
    - End-to-end browser-to-live-Cloudinary CORS / FormData upload of a >4.5MB file through deployed Vercel frontend & serverless backend (`POST /api/files/sign-upload` → Cloudinary → `POST /api/files/register` → `/api/files/:id/view`).
    - Live `cloudinary.api.resource` and `cloudinary.api.resources` pagination latency against populated Cloudinary account within Vercel's 10s serverless execution budget.

### Step 5 — Serverless Push Notification Reliability & Daily Follow-up Automation (Completed & Locally Verified)
- **Serverless-Safe Web Push Delivery (`server/src/services/push.ts`, `server/src/services/notification.ts`, `server/src/models/Notification.ts`)**:
  - Eliminated unawaited fire-and-forget `void sendPushToUser(...)` calls in `createNotification()` / `createIdempotentNotification()`; push delivery is now explicitly `await`ed before the serverless handler returns, wrapped in error-safe isolation so push failures never crash parent CRM workflows.
  - Implemented `sendPushToUserDetailed()` (preserving `sendPushToUser()` `{ sent, failed }` return shape for existing callers) with bounded per-user subscription queries (`MAX_SUBSCRIPTIONS_PER_USER = 10`), explicit socket + promise race timeout (`PUSH_REQUEST_TIMEOUT_MS = 3000`), bounded retry logic (`PUSH_MAX_RETRIES = 1`, `PUSH_RETRY_DELAY_MS = 150`) only on transient `408`/`429`/`>=500`/network timeout failures, `Promise.allSettled` device isolation, and automatic deletion of expired/unsubscribed endpoints returning HTTP `410`/`404`.
  - Added idempotent notification ledger fields on `Notification` (`deliveryKey` unique sparse index, `pushStatus`, `pushAttemptedAt`, `pushStats`) and atomic claim transition (`PENDING` -> `IN_PROGRESS`) before dispatch so retried requests never send duplicate push alerts for the same notification or `deliveryKey`. Sensitive values (`endpoint`, `keys`, `VAPID_PRIVATE_KEY`, `JWT_SECRET`, `CRON_SECRET`) are never logged.
- **Independent Checkout Follow-Up Task Workflow (`FollowUpTask.ts`, `visit.ts`, `followupTask.ts`, `routes/followup.ts`)**:
  - Updated `visit.ts:complete()` so setting `followUpDate` during checkout preserves the original visit permanently as `COMPLETED` (never reopening its historical status) and idempotently upserts an independently trackable `FollowUpTask` (`unique` on `sourceVisit`) linked to `sourceVisit`, `client`, `assignedTo`, `marketingHeadAtCreation` (historical Marketing Head attribution), `dueDate`, `remarks`, and lifecycle states (`PENDING`, `COMPLETED`, `CANCELLED`).
  - Added RBAC-scoped API endpoints `GET /api/follow-ups`, `POST /api/follow-ups/:id/complete`, and `POST /api/follow-ups/:id/cancel`: Super Admin has org-wide access, Marketing Head has operational access scoped to current team members (via `User.reportingTo`), and Executives see/complete only their own follow-up tasks, while `FollowUpTask.marketingHeadAtCreation` and `Visit.marketingHeadAtAssignment` preserve historical attribution across team reassignments.
- **Vercel Cron-Compatible Daily Follow-up Automation (`server/src/services/followup.ts`, `server/src/controllers/cron.ts`, `server/src/routes/cron.ts`, `server/src/models/CronJobRun.ts`)**:
  - Implemented `GET /api/cron/follow-ups` and `POST /api/cron/follow-ups` secured by `requireCronSecret` checking `Authorization: Bearer <CRON_SECRET>` or `x-cron-secret` using constant-time SHA-256 `crypto.timingSafeEqual` (fail-closed HTTP `503` if unconfigured or `< 32` chars; HTTP `401` on missing/invalid secret; `env.ts` also rejects non-empty `CRON_SECRET < 32` chars outside test mode).
  - Resolved timezone-aware business-day boundaries cleanly in Node `Intl.DateTimeFormat` (`resolveBusinessDayWindow`, defaulting to `FOLLOWUP_TIMEZONE=Asia/Kolkata`) without external packages or exact-second assumptions.
  - Queries bounded due `PENDING` `FollowUpTask` items (via `{ dueDate: 1, status: 1 }` index, covering checkout follow-ups from `COMPLETED` visits while excluding `COMPLETED`/`CANCELLED` tasks and cancelled source visits) plus any open active visits (`PLANNED`, `ASSIGNED`, `ARRIVED`, `CHECKED_IN` via `{ followUpDate: 1, status: 1 }`), bounded to `MAX_CRON_VISITS_PER_RUN = 200` and `DEFAULT_CRON_TIME_BUDGET_MS = 7500`.
  - Respects user `isActive`, `isArchived`, `notificationPreferences.dailyProductivity`, and `notificationPreferences.mobilePush`.
  - Enforces overlapping-run lease locking (`CronJobRun` with unique sparse `lockKey` and 30-day TTL index `expiresAt`), canonical `deliveryKey` deduplication (`followup:<dateKey>:<visitId>:<recipientId>`) across both `FollowUpTask` and `Visit` sources, and structured execution counters.
  - Added `'FOLLOW_UP_REMINDER'` support in `Notification.ts`, `src/types/index.ts`, and `src/lib/useForegroundNotifications.ts` (`dailyProductivity` banner preference enforcement) while preserving existing polling, Service Worker duplicate-tag suppression, and read/delete APIs.
- **Vercel Scheduling & Environment Requirements (`vercel.json`, `.env.example`, `server/src/config/env.ts`)**:
  - Configured daily cron schedule in `vercel.json` (`"path": "/api/cron/follow-ups"`, `"schedule": "30 3 * * *"` -> 03:30 UTC / 09:00 IST, once daily, compatible with Vercel Hobby tier limits; `app.ts` `requireSameOrigin` skips `GET` and allows Vercel Cron bearer calls).
  - Required Vercel Environment Variables: `CRON_SECRET` (`>= 32` chars, automatically sent by Vercel Cron in `Authorization: Bearer`), `FOLLOWUP_TIMEZONE` (default `Asia/Kolkata`), `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT`.
- **Known Limitations & Pending Live Verification**:
  - **Live Vercel & Push Service Verification Pending**: Vercel Cron execution in deployed Vercel production (Hobby tier timing window), live browser push delivery via FCM/Mozilla/Apple endpoints with production VAPID keys, and live Atlas M0 query telemetry have **not** been executed locally; all Step 5 tests used `MongoMemoryServer` and an injected `PushSender` transport mock.
- **Local Verification Results**:
  - `npm run lint`: **0 errors**.
  - `npm run build:server`: **0 errors**.
  - `npm run build`: **0 errors**.
  - `npm run test:server`: **112 / 112 tests passing** across **11 suites** (including 7 comprehensive regression tests in `server/tests/step5-push-cron.test.ts`).

### Step 6 — Observability, Readiness Diagnostics & Frontend Performance/Resilience (Completed & Locally Verified)
- **Backend Observability & Request Correlation (`server/src/middleware/requestContext.ts`, `server/src/middleware/error.ts`, `server/src/app.ts`)**:
  - Implemented `requestContextMiddleware` validating inbound `X-Request-Id` against `^[A-Za-z0-9_-]{8,64}$`, generating a fresh `crypto.randomUUID()` when missing/invalid, and echoing `X-Request-Id` on every API response.
  - Propagated `requestId` into structured `[API Error]` logs and JSON error responses (`error.requestId`), enhanced `maskSensitiveText` to strip `mongodb(+srv)://`, `cloudinary://`, `api_key`, `api_secret`, `token`, `password`, `cron_secret`, and `Bearer` credentials, and added bounded `[Slow Request]` telemetry warnings (`>= 2500ms`) logging only method, path, statusCode, durationMs, and requestId.
- **Health & Super Admin Diagnostics (`server/src/controllers/health.ts`, `server/src/controllers/cron.ts`, `server/src/routes/cron.ts`)**:
  - Upgraded `GET /api/health` (`handleHealthCheck`) to verify live MongoDB connectivity (`mongoose.connection.readyState === 1` + bounded `2000ms` `db.admin().ping()`), returning HTTP `200` (`{ status: 'ok', database: 'connected' }`) when ready and HTTP `503` (`{ status: 'degraded', database: 'disconnected' }`) when disconnected/failing, exposing zero secrets, URIs, or stack traces.
  - Added `GET /api/cron/runs` (`requireAuth` + `requireRoles('SUPER_ADMIN')`, moving `requireCronSecret` specifically onto `/follow-ups`) returning at most the latest 10 `CronJobRun` entries (`status`, `durationMs`, timestamps, safe `counters`, masked `errorMessage`, excluding lock fields) plus boolean readiness `diagnostics` (`cronSecretConfigured`, `vapidConfigured`, `followUpTimezone`).
- **Frontend Route Splitting & Bundle Optimization (`src/app/App.tsx`, `vite.config.ts`)**:
  - Converted `LoginPage`, `DashboardPage`, `ModulePage`, `ReportsPage`, and `SettingsPage` to route-level `React.lazy()` imports wrapped in `<Suspense fallback={<LoadingState />}>`, preserving all existing route role guards, login flow, React Query behavior, and navigation.
  - Configured `manualChunks` in `vite.config.ts` (`react-vendor`, `charts-vendor`, `query-vendor`, `icons-vendor`) without altering Vite's default 500 kB warning limit.
  - Reduced initial entry JS bundle from **1,288.58 kB** (`330.55 kB` gzip) to **58.42 kB** (`13.05 kB` gzip), eliminating all Vite `> 500 kB` chunk warnings (`react-vendor`: 476.62 kB / 145.74 kB gzip, `charts-vendor`: 421.41 kB / 116.24 kB gzip, `SettingsPage`: 112.44 kB, `ModulePage`: 90.31 kB, `DashboardPage`: 21.19 kB, `ReportsPage`: 20.77 kB, `LoginPage`: 4.82 kB).
- **Frontend Error Resilience (`src/components/ui/ErrorBoundary.tsx`, `src/lib/api.ts`, `src/features/auth/AuthProvider.tsx`, `src/main.tsx`)**:
  - Added reusable `ErrorBoundary` wrapping root `<App />` (`src/main.tsx`) and route outlets (`resetKey={location.pathname}` in `src/app/App.tsx`), displaying safe recovery controls ("Try again", "Return to Dashboard") without ever showing raw stack traces.
  - Added `AbortController` timeout support (`DEFAULT_API_TIMEOUT_MS = 15000`) to `apiFetch`, preserving external `AbortSignal` and custom `RequestInit` options, cleaning up timers/listeners in `finally`, distinguishing `TIMEOUT` vs `ABORTED` vs `NETWORK` errors, and subscribing `AuthProvider` via `onUnauthorizedResponse` for protected-route `401` expiry cleanup without triggering redirect loops on `/auth/login`, `/auth/me`, `/auth/logout`, or `/auth/bootstrap`.
- **Remaining Production Gaps (Deferred to Step 7 / Post-Step 6)**:
  - Automated/documented MongoDB Atlas M0 backup & restore verification runbook (M0 free tier lacks Atlas continuous cloud backup).
  - Documentation synchronization (`README.md` phase status update) and live production smoke verification across deployed Vercel + Atlas M0 + Cloudinary + Web Push + Vercel Cron infrastructure.
- **Local Verification Results vs Live Production Verification**:
  - **Local Verification**:
    - `npm run lint`: **0 errors**.
    - `npm run build:server`: **0 errors**.
    - `npm run build`: **0 errors**, **0 Vite chunk size warnings**.
    - `npm run test:server`: **117 / 117 tests passing** across **12 suites** (including 5 new regression suites in `server/tests/step6-observability-readiness.test.ts` testing `/api/health`, `X-Request-Id`/masking/slow-request telemetry, `GET /api/cron/runs` RBAC, `apiFetch` timeout/`AbortSignal`/`401` handling, and `ErrorBoundary`/lazy route guards).
  - **Pending Live Cloud Verification (Not Executed Locally)**:
    - Deployed `https://<prod-domain>/api/health` check against live Atlas M0, Vercel runtime log correlation checks, and real-browser cold-start chunk loading telemetry.

### Step 7 — Backup, Disaster Recovery & Production Go-Live Readiness (Implemented & Locally Verified)
- **Encrypted MongoDB Logical Backup (`server/src/services/backup.ts`, `server/src/scripts/backupDb.ts`, `server/src/scripts/verifyBackup.ts`)**:
  - Implemented `createEncryptedBackup` & `decryptAndVerifyBackup` using **BSON EJSON** (`mongoose.mongo.BSON.EJSON` with `{ relaxed: false }`) preserving exact `ObjectId`, `Date`, `number`, and `boolean` types across all durable CRM collections (`users` including `passwordHash`, `organizations`, `categories`, `settings`, `clients`, `visits`, `followuptasks`, `notifications`, `pushsubscriptions`, `fileassets`, `auditevents`, `cronjobruns`) while explicitly excluding ephemeral `ratelimitbuckets`.
  - Encrypted with `AES-256-GCM` requiring an exact 64-character hex `BACKUP_ENCRYPTION_KEY` (32 bytes, never stored in git or hardcoded), 12-byte random IV, authenticated header `AAD`, inner SHA-256 integrity checksum inside the compressed payload, and ciphertext binary format `ETECHBK1` exposing zero plaintext hashes, collection names, or counts outside the encrypted envelope. Added `npm run backup:db` and `npm run backup:verify` scripts.
- **Strictly Non-Destructive Restore & Cross-Reference Verification (`server/src/scripts/restoreVerifyDb.ts`)**:
  - `assertSafeRestoreTargetUri` & `restoreEncryptedBackupToIsolatedTarget` reject production `MONGODB_URI` targets (`403`) regardless of any flags and reject non-empty targets (`409`) without dropping collections or overwriting existing records.
  - Restores safely into an isolated `RESTORE_TARGET_MONGODB_URI` database, creates indexes via `collection.createIndex` (**never `syncIndexes()`**, preserving unrelated/custom indexes), and executes `verifyRestoredDatabaseIntegrity` validating collection counts, `User.passwordHash`, `PushSubscription`, historical Marketing Head attribution (`Visit.marketingHeadAtAssignment`, `FollowUpTask.marketingHeadAtCreation`), cross-collection references, and logical snapshot skew warnings (since Atlas M0 has no PITR snapshots). Added `npm run restore:db:verify`.
- **Cloudinary Metadata-to-Cloud Reconciliation (`reconcileCloudinaryMetadata`)**:
  - Added read-only cross-checking of restored `FileAsset` records against Cloudinary assets under `etech_crm/` to flag `missingInCloud`, `unregisteredInDb`, and `archivedPendingCloudDelete` without modifying or deleting any live Cloudinary media. Documented off-cloud media backup boundaries cleanly.
- **Scheduled GitHub Actions Backup Workflow (`.github/workflows/atlas-m0-backup.yml`)**:
  - Implemented daily (`0 21 * * *` UTC / 02:30 IST) + manual `workflow_dispatch` workflow using GitHub Secrets (`MONGODB_URI`, `BACKUP_ENCRYPTION_KEY`, optional `BACKUP_ALERT_WEBHOOK_URL`), verifying every backup immediately after creation, uploading only encrypted `.enc` artifacts (`retention-days: 30`), masking secrets, and documenting GitHub-hosted dynamic IP constraints against Atlas M0 (recommending self-hosted static-IP runners or scoped temporary Atlas Admin API allowlisting instead of `0.0.0.0/0`).
- **Deployment Checklist & Documentation (`docs/PRODUCTION_DEPLOYMENT.md`, `README.md`, `.env.example`)**:
  - Created comprehensive go-live runbook covering Vercel, custom HTTPS domain, Atlas M0 pooling/network controls, Cloudinary CORS & media backup limits, VAPID, `CRON_SECRET`, `BACKUP_ENCRYPTION_KEY`, `npm run migrate:roles`, and an 11-area end-to-end post-deployment smoke test playbook. Synced `README.md` and `.env.example` cleanly.
- **Verification Matrix (Local vs. Live Infrastructure)**:
  - **Locally Verified (Executed cleanly)**:
    - `npm run lint`: **0 errors**.
    - `npm run build:server`: **0 errors**.
    - `npm run build`: **0 errors**, **0 Vite chunk size warnings**.
    - `npm run test:server`: **120 / 120 tests passing** across **13 suites** (including `server/tests/step7-backup-readiness.test.ts` testing encrypted roundtrip, weak/wrong/tampered key rejection, `ObjectId`/`Date`/`passwordHash`/`PushSubscription` preservation, `RateLimitBucket` exclusion, isolated `MongoMemoryServer` restore, production-target & non-empty target guards, unrelated custom index preservation, unchanged source DB, and read-only Cloudinary metadata reconciliation).
  - **GitHub Actions Workflow Implementation**:
    - `.github/workflows/atlas-m0-backup.yml` authored and validated structurally in repo; live runner execution awaits repository push + GitHub Secrets setup.
  - **Pending Live Infrastructure Verification (Not Executed Locally)**:
    - Actual scheduled GitHub Actions backup run against live MongoDB Atlas M0.
    - Actual restore verification test into a live staging Atlas M0 database (`RESTORE_TARGET_MONGODB_URI`).
    - Live Vercel deployment smoke checks across custom HTTPS domain, live Cloudinary >4.5 MB browser upload, live FCM/Mozilla/Apple Web Push notifications, and live Vercel Hobby Cron invocation (`GET /api/cron/follow-ups` / `GET /api/cron/runs`).

### Step 7.1 — Backup & Disaster Recovery Audit Remediation (Completed & Locally Verified)
- **Production Restore Target Identity Protection (`server/src/services/backup.ts`, `server/src/scripts/restoreVerifyDb.ts`)**:
  - Replaced `new URL()` host parsing with dedicated `normalizeMongoTargetIdentity` parser handling `mongodb://`, `mongodb+srv://`, comma-separated replica-set seedlists, explicit ports/loopback normalization (`127.0.0.1` / `localhost` / `::1`), `replicaSet` parameters, `.mongodb.net` cluster suffixes, and database names cleanly.
  - Made `assertSafeRestoreTargetUri` **fail closed** (`422`) when either `MONGODB_URI` or `RESTORE_TARGET_MONGODB_URI` is unset/missing an explicit database name, and fail closed (`403`) on overlapping hosts, matching Atlas cluster suffixes, matching replica sets, or uncertain cross-scheme identities without any bypass flags.
  - Embedded keyed HMAC `sourceDbFingerprint` strictly inside the encrypted `LogicalBackupPayload` and verified target identity against the decrypted fingerprint before touching any target collection.
- **Complete Cloudinary Reconciliation Pagination (`server/src/services/storage/cloudinary.provider.ts`, `mock.provider.ts`, `storage.interface.ts`, `backup.ts`)**:
  - Added `listAllAssetsByPrefix` supporting complete multi-page `next_cursor` enumeration for both `'image'` and `'raw'` assets (preserving bounded `listAssetsByPrefix` for HTTP/cron contexts).
  - Removed silent `.limit(500)` / `.limit(2000)` DB caps in `reconcileCloudinaryMetadata`, scanning `fileassets` via cursor batching (`.batchSize(250)`), adding `complete`, `truncated`, and `scanError` fields to `CloudinaryReconciliationReport`, and strictly guaranteeing `missingInCloud: []` whenever enumeration is truncated or errors.
- **Complete Post-Restore Integrity Validation (`verifyRestoredDatabaseIntegrity` in `server/src/services/backup.ts`)**:
  - Expanded integrity validation across `User.reportingTo`, `User.avatarAsset`, `Organization.expandedLogoAsset` / `collapsedLogoAsset`, `Client.createdBy`, `Client.categoryId`, `Client.visitingCardAsset`, `Client.documentAssets[]`, `Visit.photoAssets[]` / `attachmentAssets[]`, `FileAsset.uploadedBy`, and `FileAsset.ownerId` per `ownerType` (`USER_AVATAR`, `CLIENT_*`, `VISIT_*`, `ORGANIZATION_*_LOGO`), handling nullable/optional fields and archived `FileAsset` records without false positives and reporting structured `IntegrityViolation` entries (`collection`, `documentId`, `field`, `missingRef`).
- **Backup Memory Batching & Safeguards (`createEncryptedBackup`, `restoreEncryptedBackupToIsolatedTarget`)**:
  - Replaced unbounded `.toArray()` / single-call `insertMany()` with `BACKUP_CURSOR_BATCH_SIZE = 500` cursor iteration, chunked inserts, and explicit `MAX_BACKUP_TOTAL_DOCUMENTS` (`500,000`) / `MAX_BACKUP_SERIALIZED_BYTES` (`256 MB`) guardrails.
- **CI Alert Workflow, CLI Hardening & Operational Docs (`.github/workflows/atlas-m0-backup.yml`, `backupDb.ts`, `verifyBackup.ts`, `package.json`, `docs/PRODUCTION_DEPLOYMENT.md`)**:
  - Removed invalid `secrets.*` reference from workflow `if: failure()`, checking `BACKUP_ALERT_WEBHOOK_URL` cleanly inside Node via `env:` with timeout and redacted failure logs that never mask original backup failures.
  - Added cross-platform `npm run backup:db:verified` (`--verify`), minimized default `verifyBackup.ts` stdout metadata (optional `--verbose`), warned/failed exit status in `restoreVerifyDb.ts` when Cloudinary reconciliation is incomplete, and documented **Encryption Key Recovery & Rotation**, **12-Step Staging Restore Drill**, **Interrupted Restore Manual Recovery**, and **Windows NTFS ACLs vs POSIX `0o600`**.
- **Local Verification Results**:
  - `npm run lint`: **0 errors**.
  - `npm run build:server`: **0 errors**.
  - `npm run build`: **0 errors**, **0 Vite chunk warnings**.
  - `npm run test:server`: **123 / 123 tests passing** across **13 suites** (adding Step 7.1 regression tests 4–6 in `server/tests/step7-backup-readiness.test.ts`).

### Step 7.3 — Final Backup Security & Integrity Remediation (Completed & Locally Verified)
- **Cloudinary Repeated-Cursor & Pagination Protection (`server/src/services/storage/cloudinary.provider.ts`, `storage.interface.ts`, `mock.provider.ts`, `server/src/services/backup.ts`)**:
  - Added `seenCursors` repeated-cursor detection, `maxPages` (`DEFAULT_CLOUDINARY_LIST_MAX_PAGES = 100`), and `maxDurationMs` (`DEFAULT_CLOUDINARY_LIST_MAX_RUNTIME_MS = 60000`) guards in `CloudinaryStorageProvider.listAllAssetsByPrefix` and `MockStorageProvider.listAllAssetsByPrefix`, returning explicit `truncated: true` + `terminationReason` (`MAX_PAGES`, `MAX_RUNTIME_MS`, `REPEATED_CURSOR`).
  - Updated `reconcileCloudinaryMetadata` to track assets by canonical `${resourceType}:${deliveryType}:${publicId}` key, deduplicate `unregisteredInDb` across pages, treat `listAssetsByPrefix`-only fallbacks strictly as `complete: false, truncated: true`, and enforce `missingInCloud: []` on any incomplete scan without calling deletion APIs.
- **Organization Branding Logo Ownership Lifecycle (`server/src/services/storage/storage.service.ts`, `server/src/services/organization.ts`, `src/features/settings/OrganizationSettings.tsx`)**:
  - Defined explicit `PENDING_ORGANIZATION_OWNER_ID` (`000000000000000000000001`) placeholder lifecycle handling: uploads resolve existing `Organization._id` immediately when present, mark pre-organization uploads explicitly as `metadata.ownershipStatus = 'PENDING_ORGANIZATION'` (rejecting arbitrary unknown IDs with `404`), and rebind `FileAsset.ownerId` -> real `Organization._id` (`ownershipStatus = 'ASSIGNED'`) once created/updated while rolling back failed uploads safely.
  - Updated `verifyRestoredDatabaseIntegrity` to distinguish assigned org logos, explicitly pending unassigned logos (`pendingOrganizationLogosCount`), invalid/missing organization references, and archived cleanup records.
- **Strengthened MongoDB Target & Connection Verification (`server/src/services/backup.ts`, `server/src/scripts/restoreVerifyDb.ts`)**:
  - Added `extractConnectionIdentity` + `validateTargetConnectionMatchesUriAndNotProdOrSource` checking actual driver host(s), `.mongodb.net` cluster suffix, `replicaSet`, and connected `databaseName` against `RESTORE_TARGET_MONGODB_URI`, production `MONGODB_URI` (including empty production DBs), and encrypted `sourceDbFingerprint` (preventing programmatic URI/connection mismatch bypasses).
  - Hardened URI parsing for encoded credentials (rejecting unescaped `/` before `@`), bare/bracketed IPv6 literals via `net.isIPv6`, IPv6-safe `extractAtlasClusterSuffix`, and non-Atlas same-scheme `mongodb://` ambiguity (refusing restores sharing a `dbName` unless distinct explicit `replicaSet` names exist).
- **Streaming V2 Encrypted Backup & Restore Pipeline (`server/src/services/backup.ts`, `backupDb.ts`, `verifyBackup.ts`)**:
  - Implemented **V2 (`ETECHBK1`, version `2`)** streaming ND-EJSON (`HEADER` -> single-pass 500-doc cursor `DOC` lines -> `FOOTER` + trailing 16-byte GCM authTag) piped through `zlib.createGzip()` and `AES-256-GCM`, written atomically via `.tmp-*` -> `fs.rename` in `createEncryptedBackupToFile` and verified/restored via 2-pass `verifyBackupFile` / `restoreEncryptedBackupFromFile` / `restoreEncryptedBackupToIsolatedTarget` without accumulating source `collections` maps in memory or double-serializing EJSON, while retaining V1 backward compatibility and incremental `413` doc/byte enforcement.
- **Complete Cross-Reference Integrity & Programmatic Consistency Enforcement (`verifyRestoredDatabaseIntegrity`, `RestoreConsistencyError`)**:
  - Added validation for `PushSubscription.user`, `Organization.updatedBy`, `Visit.cancelledBy`, `Visit.exceptionAuthorizedBy`, `Visit.checkIn.exceptionApprovedBy`, `Visit.checkOut.exceptionApprovedBy`, `FollowUpTask.completedBy`, and `FollowUpTask.cancelledBy`, plus explicit violation reporting on unknown `FileAsset.ownerType`.
  - Updated `restoreEncryptedBackupToIsolatedTarget` and `restoreEncryptedBackupFromFile` to throw `RestoreConsistencyError` (`422`) when counts/integrity checks fail, matching CLI failure semantics.
- **Local Verification Results**:
  - `npm run lint`: **0 errors**.
  - `npm run build:server`: **0 errors**.
  - `npm run build`: **0 errors**, **0 Vite chunk warnings**.
  - `npm run test:server`: **129 / 129 tests passing** across **13 suites** (tests 1–12 in `server/tests/step7-backup-readiness.test.ts`).






