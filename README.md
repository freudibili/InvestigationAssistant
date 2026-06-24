# Investigation Assistant

An MVP SaaS tool that helps workplace investigators **organize and extract
information** from interview transcripts (mobbing, harassment, discrimination,
racism, retaliation).

> **It does not generate legal conclusions.** It extracts and structures what is
> explicitly present in a transcript so investigators can review it faster.

## Core workflow

```
Create case → Upload interview PDFs → (manually) Extract → Review structured results
```

- PDF text is extracted **on upload** and stored as `rawText`.
- AI extraction runs **only when the investigator clicks “Extract Interview Data”.**
- Running AI extraction can be canceled from the document row; canceled documents
  can be retried.
- The LLM response is validated with Zod; invalid output marks the document `failed`.

## Tech stack

| Concern        | Choice |
| -------------- | ------ |
| Framework      | Next.js 16 (App Router) + TypeScript |
| Styling        | Tailwind CSS v4 + shadcn/ui |
| Data store     | Supabase (PostgreSQL) |
| File storage   | Supabase Storage |
| Client data    | TanStack React Query v5 |
| Validation     | Zod v4 |
| AI             | OpenAI SDK |
| PDF text       | unpdf |

## Project structure

```
app/
  page.tsx                                  # Cases list
  cases/[caseId]/page.tsx                   # Case detail: upload + documents
  cases/[caseId]/documents/[documentId]/    # Extraction result page
  actions/                                  # Server actions (create case, upload, extract)
  api/                                      # Route handlers consumed by React Query
components/
  cases/                                    # Case list, create dialog, detail
  documents/                                # Upload, rows, status badge, result view
  ui/                                       # shadcn primitives
hooks/                                      # React Query hooks
lib/
  db/                                       # Data-access layer (Supabase + row mappers)
  supabase/                                 # Admin client + DB types
  openai.ts                                 # AI extraction service
  pdf.ts                                    # PDF text extraction (unpdf)
  validation.ts                            # Zod schemas
  types.ts                                  # Domain types
supabase/migrations/0001_init.sql          # Schema, enums, RLS, storage bucket
```

## Data model

**cases**: `id`, `title`, `companyName`, `caseType`, `createdAt`

**documents**: `id`, `caseId`, `fileName`, `fileUrl`, `status`
(`uploaded | extracting | extracted | canceled | failed`), `rawText`,
`extractedData`, `createdAt`, `extractedAt`

## Getting started

### 1. Install

```bash
npm install
```

### 2. Configure environment

Copy `.env.example` to `.env.local` and fill in your keys:

```bash
cp .env.example .env.local
```

| Variable | Where to find it |
| -------- | ---------------- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Project Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API (server-only secret) |
| `SUPABASE_STORAGE_BUCKET` | defaults to `case-documents` |
| `OPENAI_API_KEY` | OpenAI dashboard |
| `OPENAI_MODEL` | defaults to `gpt-4o-mini` |

### 3. Set up the database

Run the migration in the **Supabase SQL Editor**, or with the Supabase CLI:

```bash
supabase db push   # or paste supabase/migrations/0001_init.sql into the SQL editor
```

This creates the `cases` and `documents` tables, the enums, indexes, enables RLS,
and creates the private `case-documents` storage bucket.

### 4. Run

```bash
npm run dev
```

Open http://localhost:3000.

## Security notes

- The MVP has **no authentication yet**. All access goes through a server-side
  client using the Supabase **service-role key**, which never reaches the browser
  (enforced by `server-only` imports). The storage bucket is private; the
  service-role key bypasses RLS.
- RLS is enabled with **no anon policies**, so direct anon/public access is
  denied. When you add auth, define per-user policies in a new migration.

## Intentionally out of scope (future phases)

Dashboards · analytics · timelines · collaboration · permissions · report
generation · audio processing · legal recommendations.
