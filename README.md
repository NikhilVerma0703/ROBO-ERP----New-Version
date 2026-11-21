# Robo ERP (standalone)

The Robo production-line module of Pacific ERP, extracted on 20 Nov 2026 from the
main ERP (`vmundra-pacific/Pacific-ERP`, `main`) into its own project for local
development and manual testing.

- **Same code, same screens.** At extraction, all 130 Robo module files were
  byte-for-byte the main ERP's. Only the login layer, sidebar shell, Prisma client
  and audit-log helper were replaced with small local versions (see
  `docs/EXTRACTION-REPORT.md`).
- **Changes since extraction** are recorded in `docs/change-requests/CR-*.md`.
  So far: CR-001 (re-import keeps the machine setup of Shift B/C slabs),
  CR-002 (a duplicate master-list name gets a clear message instead of an error)
  and CR-003 (Robo Entry renamed Slab Entry, and the new Trial Slab Entry page).
- **No sign-in.** Opening http://localhost:3000 goes straight to **Slab Entry**.
  Every request runs as one local admin user, so every control is visible.
- **No Docker.** You need Node.js and a local PostgreSQL.

## Sections (sidebar)

| Group | Section | Path |
|---|---|---|
| Production | Slab Entry | `/robo` |
| Production | Trial Slab Entry | `/robo/trial` |
| Production | Slab Records | `/robo/slabs` |
| Reports | Reports | `/robo/reports` |
| Reports | Downloads | `/robo/downloads` |
| Setup | Import | `/robo/import` |
| Setup | Master Lists (Designs, Programs, Tools, Liquids, Powders, Delay Codes) | `/robo/masters` |
| Attendance | Attendance | `/robo/attendance` |

## Prerequisites (once)

1. **Node.js 22.13 or newer** (`node -v`).
2. **PostgreSQL 16+** installed natively on Windows (the EDB installer). You need the
   `postgres` user's password, which you chose during installation.

## First-time setup

```bash
npm install
```

Create the database (psql asks for the postgres password):

```bash
"C:\Program Files\PostgreSQL\16\bin\createdb.exe" -U postgres robo_erp
```

Copy `.env.example` to `.env` and put your password in `DATABASE_URL`:

```bash
copy .env.example .env
```

Create the tables, then load the master lists (machines, tools, liquids, powders,
designs/programs, delay codes) and the attendance roster:

```bash
npx prisma migrate deploy
```

```bash
npm run db:seed
```

Start the app, then open http://localhost:3000:

```bash
npm run dev
```

## Everyday commands

| Command | What it does |
|---|---|
| `npm run dev` | Start the app on http://localhost:3000 |
| `npm run build` / `npm start` | Production build / run it |
| `npm run typecheck` | TypeScript check |
| `npm test` | The Robo + attendance test suite (`node --test`, 778 tests) |
| `npm run db:migrate -- --name <change>` | After editing `prisma/schema.prisma`: create and apply a migration |
| `npx prisma migrate deploy` | Apply existing migrations to a fresh database |
| `npm run db:seed` | Seed masters + attendance roster (safe to re-run; upserts only) |
| `npm run db:studio` | Browse the database |

**The app runs on UTC.** `dev`, `build`, `start`, `test` and the seeds set `TZ=UTC`
through `cross-env`, as production does on Vercel. Screens still show plant time
(Asia/Kolkata). Start the app with these npm scripts rather than `next dev` directly.

## Loading real data

The database starts empty apart from the seeds. To bring in the existing register,
download it from the main ERP's **Robo → Downloads → Download Slab Records**
(Complete Production sheet). Then load it here with **Setup → Import**, which is
the module's own register importer.

## What does not work on its own

- **Plant data**: "Fill from the plant", the plant slab list, the "From the plant"
  card, Reports "made by the plant vs entered in Robo", and import auto-fill. These
  read tables that the Breton plant PC posts into the main ERP. The tables exist
  here but stay empty, so these screens show their built-in "no plant data" state.
- **QC Rejection Analysis** (Downloads) reads the main ERP's Polish QC table, so
  it shows no rejections.
- **Attendance** is Robo's own register here. In the main ERP it is shared with
  Chromia.
- **The 07:00 / 19:00 attendance email** is not included (it was a Vercel cron
  with SMTP).

Full details: `docs/EXTRACTION-REPORT.md`. Test results and known ERP issues: `docs/VERIFICATION-REPORT.md`. The audit and plan that preceded the
extraction: `ROBO-EXTRACTION-PLAN.md`. Change history: `docs/change-requests/`.
