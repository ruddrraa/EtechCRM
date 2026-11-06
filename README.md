# Excel Technologies and Services CRM

Frontend foundation for the Client Management & Field Visit Tracking System.

## Stack

React 19, Vite, TypeScript, Tailwind CSS v4, React Router, Recharts, Lucide React, Framer Motion, React Hook Form, Zod, and TanStack Query (prepared for server state in Phase 2).

## Development

```bash
npm install
npm run dev
npm run build
```

## Project structure

- `src/app` - application composition and routes
- `src/components` - reusable UI, layout, and chart primitives
- `src/features` - dashboard and module-specific previews
- `src/styles` - global design tokens and responsive styles
- `src/types` and `src/lib` - shared types and utilities

## Design system

The global tokens in `src/styles/globals.css` use the approved monochrome palette: warm grey background, white surfaces, charcoal primary actions, and green/amber/red operational status colours. The interface uses restrained borders, compact tables, tabular metrics, and responsive layouts inspired by the supplied CRM reference without copying its branding or layout.

## Routes

`/`, `/clients`, `/staff`, `/visits`, `/reports`, `/audit-logs`, and `/settings` are available as frontend-only previews.

The role selector in the top navigation previews `SUPER_ADMIN`, `ADMIN`, and `USER` dashboard content. It is explicitly development-only and is not authentication or a security control.

## Scope

Phase 1 intentionally has no backend, database, authentication, persistent CRUD, GPS, check-in/check-out, Cloudinary, or production reports. Static demonstration data is isolated in `src/features/dashboard/mockData.ts`. Exports and connected workflows are deferred to later approved phases.
