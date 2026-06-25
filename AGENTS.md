# Agents

Project rules for agents working in this repository.

## When to use

Treat this as the default operating guide on every task in this repository, unless the user explicitly asks to override a rule for a specific change.

## Role

You are assisting a **Senior TypeScript / React / Next.js Developer**.
Your goal is to produce **production-ready, clean, and maintainable code**.

## Absolute Rules (Must Follow)

- Do not over-complicate
- Do not do more than asked
- Keep solutions simple and effective
- Think clean code first
- Think performance by default
- Always auto-review before responding

## Comments

- Do not add comments. Write self-explanatory code with clear names instead.
- Only add a comment when the code cannot be made clear on its own (a non-obvious "why").

## Core Stack

- TypeScript 5 with `strict: true`
- Next.js 16 App Router
- React 19
- Tailwind CSS 4 via `app/globals.css`
- Supabase with `@supabase/supabase-js`
- Zod for request, form, and payload validation
- React Query (`@tanstack/react-query`) for client-side server state
- OpenAI for extraction and analysis
- Document parsing: `unpdf`, `pdf-lib`, `mammoth`, `word-extractor`
- shadcn/Radix UI primitives (`components/ui/`)
- Server Actions and Route Handlers

## Architecture & Patterns

- Clear separation of concerns
- Modular and reusable code
- Predictable data flow
- `app/` is the delivery layer, not the business layer
- Business logic belongs in `lib/` and `hooks/`, never in JSX
- Prefer server-first flows and thin client islands

## Current Structure

```txt
app/
  actions/        Server Actions
  api/            Route Handlers
  cases/          Case routes
  globals.css
  layout.tsx
  providers.tsx
  page.tsx

components/
  cases/
  documents/
  pdf/
  ui/             shadcn/Radix primitives

hooks/            Reusable React hooks

lib/
  api/
  db/
  supabase/
  documents.ts
  extract-text.ts
  pdf.ts
  validation.ts   Zod schemas
  query-keys.ts
  env.ts
  utils.ts
  types.ts

types/            Ambient/shared type declarations
```

## Folder Responsibilities

- `app/` defines routes, layouts, metadata, route handlers, and page composition
- `app/actions/` holds Server Actions; they delegate to `lib/` rather than owning business rules
- `app/api/` is the HTTP entry point; handlers delegate to `lib/` modules
- `components/<domain>/` contains UI for a domain (cases, documents, pdf)
- `components/ui/` contains shared shadcn/Radix primitives only
- `hooks/` contains reusable React hooks (data hooks wrap React Query)
- `lib/` contains business logic, services, integrations, parsing, and validation
- `lib/supabase/` owns shared Supabase client creation
- `lib/validation.ts` owns Zod schemas and boundary parsers
- `lib/query-keys.ts` is the single source of truth for React Query keys

## Rendering and Client Boundaries

- Prefer Server Components by default
- Add `"use client"` only when browser APIs, local state, transitions, or imperative navigation are required
- Keep client components thin and interaction-focused
- Never import server-only modules (`server-only`, secrets, OpenAI/Supabase admin) into client components
- Use the Node runtime for handlers that depend on Node APIs, PDF rendering, or document parsing

## Data and Mutations

- Reads live in server components, route handlers, or `lib/` query functions
- Writes live in Server Actions or `lib/` services called by route handlers
- Validate all incoming `FormData` and JSON with Zod at the boundary (`lib/validation.ts`)
- Revalidate affected paths after successful mutations
- Components never call services or fetch data directly
- Client components access data through hooks (React Query), never ad-hoc fetches
- Keep page files focused on composition, not mutation logic

## Supabase Rules

- Use request-scoped, cookie-aware clients for user auth and access
- Use the admin/service-role client only on the server
- Never expose service-role credentials to client code
- Respect schema, storage rules, and RLS policies in `supabase/`

## Services & Integrations

- Services handle API calls, external integrations (OpenAI, Supabase), normalization, and orchestration
- Services live in `lib/`, never contain UI logic, and never hold React state
- Document parsing and extraction stay in `lib/` (`documents.ts`, `extract-text.ts`, `pdf.ts`)

## Components & Styling

- Tailwind utilities are the default styling approach
- Reuse shared primitives from `components/ui/` before creating new ones
- No ad-hoc spacing or magic values
- Components must be small, focused, readable, and declarative
- One responsibility per component
- Only component-specific interfaces are allowed inside component files
- No business logic inside JSX — components orchestrate, they do not decide
- Prefer semantic, accessible HTML for forms, buttons, and links

## Types

- Shared types live in `lib/types.ts`; ambient declarations in `types/`
- Prefer `zod` schemas as the source of truth where validation exists (infer types from schemas)
- No duplicated or scattered types
- Explicit, descriptive naming
- No `any`

## Naming Conventions

- Names must be explicit and descriptive
- No abbreviations
- Function names describe intent
- Boolean names read naturally (`is`, `has`, `should`)
- Consistency is mandatory

## Performance Rules

- Avoid unnecessary re-renders
- Memoization only when it provides real value
- No premature optimization, no negligence
- Prefer simple server-first solutions before adding client-side state

## Data Sourcing

- Never hardcode domain data (statuses, categories, limits, options) directly in code
- Domain data must come from the database or be driven by database values
- If a value could change based on business needs, it must not be hardcoded

## Code Quality

- Small, focused functions
- No business logic hidden inside JSX
- No ad-hoc validation or data access scattered through components
- Run `npm run lint` and `npm run typecheck` after meaningful changes when feasible

## Target Architecture (Optional, when scaling)

If this project grows, move toward a feature-based structure mirroring the rest of the stack:

```txt
features/
  cases/
    components/ hooks/ services/ utils/ store/ actions.ts queries.ts schemas.ts types.ts
  documents/
    components/ hooks/ services/ utils/ store/ actions.ts queries.ts schemas.ts types.ts

common/
  components/ hooks/ utils/ services/ types.ts

lib/   shared infrastructure only (env, supabase, generic utils)
```

Migration guidance:

- Move domain logic out of root-level `lib/` into the owning feature; keep only true infrastructure in `lib/`
- `lib/documents.ts`, `lib/extract-text.ts`, `lib/pdf.ts` belong to a `documents` feature
- `components/cases/` and `components/documents/` belong to their respective features
- Keep refactors incremental; do not rewrite the whole app unless required

## Development Principles

- Keep routes thin and logic cohesive
- Follow the surrounding file's language and copy style
- Do only what is asked
- Review changes before delivery
