# Robo ERP — Phase 1 Audit & Phase 2 Extraction Plan

Source: `Pacific-ERP-main (4).zip` (4,047 files). I checked it against GitHub `vmundra-pacific/Pacific-ERP` `main`, all 209 branches and every Robo PR.
Status: **audit only. Nothing has been copied or created on the Desktop yet.**

---

## 1. What the main ERP is

| Item | Value |
|---|---|
| Framework | Next.js 15 (App Router), React 19, TypeScript, Tailwind 3 |
| DB | PostgreSQL via Prisma 6. One schema file of 12,801 lines and ~300 models |
| Auth | next-auth v5 beta, `src/lib/rbac.ts` and an edge `src/middleware.ts` (~1,000 lines) |
| Migrations | **None in Prisma form.** Schema changes are hand-numbered SQL files in `scripts/NNNN-*.sql`; `db push` is only for local databases |
| Tests | `node --test tests/*.test.ts` (Robo's tests use this runner) |
| Package manager | npm (`package-lock.json`), Node >= 22.13 |

## 2. Robo inventory (what belongs to the module)

**Robo's own code is 151 files, and it uses 36 shared ERP files.**

| Area | Path | Files |
|---|---|---|
| Pages | `src/app/robo/**`: entry, slabs (+ `[id]`, `[id]/edit`, undo), reports, downloads, import, masters (6 lists), attendance | 20 |
| API routes | `src/app/api/robo/**`: attendance, batch-numbers, batch-recipes (+ plant-batches), delay-codes, designs, exports (production, delays), imports (+ preview), liquids, machines, powders, production (+ check-slab, next-number, plant-slabs, `[id]`), programs, qc-rejections, reference/summary, reports (coverage, hourly, summary, trends), shifts (+ active, operators), tools | 37 |
| Components | `src/components/robo/**`: RoboEntryForm, SlabsBrowser, PlantSlabList, PlantBatchPicker, reports/*, masters/*, Downloads, Import, TimeInput, etc. | 27 |
| Domain logic | `src/lib/robo/**`: 67 files covering batch no., delays, hourly axis, exports, import, plant fill, slab sequence, reference sheet, QC rejection, and more | 67 |
| Prisma models | `RoboMachine, RoboDesign, RoboProgram, RoboTool, RoboLiquid, RoboPowder, RoboOperator, RoboDelayCode, RoboShift, RoboBatchRecipe, RoboBatchRecipeEntry, RoboProductionRecord, RoboDelayLog, RoboImportLog` | 14 |
| Shared attendance (Robo and Chromia use the same register) | `AttendanceOperator, AttendanceDay, AttendanceLeave`; `src/lib/attendance/*`; `src/components/attendance/AttendanceClient.tsx` | 3 models, 7 files |
| Seeds | `prisma/seed-robo.ts` (machines, tools, liquids, powders, designs/programs, delay codes), `prisma/seed-attendance.ts` (the 12-operator roster in the owner's order) | 2 |
| SQL history | `0047-robo-batch-setup-fields`, `0047-robo-slab-production-date`, `0123-robo-shift-attendance`, `0131-robo-shift-date-unique`, `0139-attendance-roster-order`, `0140-attendance-leave-type` | 6 |
| Tests | `tests/robo*.test.ts` (48), `tests/review1026Robo.test.ts`, fixtures `roboD1432.ts`, `robo-register-d1448-d1449.json`; attendance tests `attendance*.test.ts` (4), `plantAccess.test.ts`, `roboShiftAttendance0123` | ~57 |
| Auth-only (will NOT be copied) | `scripts/provision-robo-user.ts`, `.github/workflows/provision-robo-account.yml` | 2 |

### The 7 sections (from `src/lib/navModel.ts` `ROBO_ITEMS`, matching your screenshot)
**Production:** Robo Entry `/robo` · Slab Records `/robo/slabs`
**Reports:** Reports `/robo/reports` · Downloads `/robo/downloads`
**Setup:** Import `/robo/import` · Master Lists `/robo/masters` (Designs, Programs, Tools, Liquids, Powders, Delay Codes)
**Attendance:** Attendance `/robo/attendance`

The standalone sidebar will copy these groups, labels, icons and order exactly.

## 3. Shared ERP dependencies Robo uses

| Shared file | What Robo uses it for | Plan |
|---|---|---|
| `lib/rbac.ts` (559 lines, pulls in next-auth and ~130 files) | `roboGate`, `currentUser`, `isAdmin`, `canDeleteRoboSlab`, `canEditRoboSetup`, `roboSlabExportGate`. Used in 44 places | **Replace** with a small local `rbac.ts` that keeps the **same function names**. Gates always allow; `currentUser()` returns a fixed local user with ADMIN rights (see Q1). No call site changes. |
| `components/Shell.tsx` → `Nav`, `navModel` (every module's nav), RoleSwitcher, view-as, IdleLogout | Sidebar around all 14 Robo pages | **Recreate** a small local `Shell` with the same look and the 7 Robo sections. No user card, sign-out or idle logout. |
| `lib/plantAccess.ts` | `plantRightsOfUser`, which decides who sees slab exports, Leave Taken, attendance on other days and roster edits | **Copy**. With the ADMIN local user it returns In-Charge rights, so everything is visible. |
| `lib/actionLog.ts` (661 lines; pulls in silo, tables, backfill) | `logActionTx` (audit row in the same transaction as a slab edit or delete), `lastUndoableFor`, `restoreRoboSlabDelete`, `dismissRoboSlabDelete` (Undo delete on Slab Records), and attendance audit rows | **Trim**: keep only the functions above and the `ActionLog` model. The Undo/restore logic stays exactly as written. |
| `lib/attendance/*`, `components/attendance/AttendanceClient.tsx` | The Attendance section | **Copy** as is. The email cron (`report.ts`/`reportEmail.ts`) is covered in Q4. |
| `lib/plantSync/ingest-store.ts`, `plantSync/match/{match-rules,press-map,line-head-rules,mixer-contract}.ts`, `machine/{machines,plant-clock,opening-*}.ts`, `machine/slabs-server.ts` (Robo only uses the `TS_FMT` constant) | 17 Nov "plant fill" features: the From the plant card, plant slab list, setup batch picker, coverage report, import auto-fill | **Copy the pure files; trim `ingest-store` to `plantTablesReady()`** and inline `TS_FMT`. See §7 and Q2. |
| `components/ui.tsx`, `Toast.tsx`, `ClientTime.tsx`, `commercial/invoices/ui.ts` | Card, Badge, Empty, toast, formatting | Copy |
| `lib/normalizeBatch.ts`, `shiftScoreMath.ts` (`MAX_SLABS_PER_HOUR`), `sheetShape.ts`, `chromia/plant-time.ts`, `branchNames.ts`, `slabAddedBy.ts`, `secretEqual.ts` | Batch matching (D1372 = D-1372), import sheet checks, plant clock | Copy (trimmed only if they import something that is not copied) |
| `lib/prisma.ts`, `prismaReads.ts`, `viewAs*`, `roleContext.ts` | Prisma client. The "view as" read-only guard wraps writes | **Simplify** `prisma.ts` to a plain singleton. Drop view-as (it is an auth feature). |
| `app/globals.css`, `tailwind.config.ts`, `public/` logos and icons | Styling and branding | Copy (only Robo-relevant CSS kept if separable; otherwise whole file, unchanged) |

**npm packages needed:** next, react, react-dom, @prisma/client, prisma, recharts (Reports charts), xlsx (vendored `vendor/xlsx-0.20.3.tgz`), xlsx-js-style (styled Excel exports), zod, clsx, tailwind-merge, server-only, tailwind, postcss, autoprefixer, tsx, typescript, @types/*.
**Not needed:** next-auth, bcryptjs, nodemailer (unless Q4 = keep), pdf-lib, pdfjs, pdfmake, @react-pdf, sharp, tesseract, exceljs, jspdf, jszip, vitest, Inngest.

## 4. Database

**Models to carry, copied byte for byte from `schema.prisma`:**
- The 14 `Robo*` models and 3 `Attendance*` models (with `sortOrder` and `leaveType`), plus `ActionLog`.
- **Read-only main-ERP tables Robo queries.** These keep the code compiling and running: `Mis` (`mis`: production hours per batch), `PolishQc` (`polish_qc`: QC Rejection Analysis), `SyncLineOrderBatch`, and the plant-sync tables (`plant_slab`, `plant_press_slab`, `plant_sync_post`, `plant_sync_state` and the other tables `plantTablesReady()` checks). I'll confirm the exact list by reading `ingest-rules.ts` FEEDS. **Robo never writes to these.** In a standalone database they start empty (see §7).
- No relation from any Robo model to `User` or another main-ERP model, so nothing has to be cut.

**Migrations:** I'll create a real Prisma baseline `prisma/migrations/0001_init/migration.sql` with `prisma migrate diff --from-empty`, as I did for Chromia. A fresh local database is then created with `npm run db:migrate`, followed by `npm run db:seed` (Robo masters + attendance roster). The 6 historical Robo SQL scripts go to `docs/history/sql/` as reference (their effect is already in the baseline).

**Local PostgreSQL, no Docker:** a native PostgreSQL install on Windows and a database named `robo_erp`.

## 5. Environment variables

`DATABASE_URL` (required). `DATABASE_URL_POOLED` is Neon-only, so it's dropped. `NODE_ENV`/`NEXT_RUNTIME` are set by Next. `ATTENDANCE_REPORT_EMAILS` + SMTP settings only if Q4 = keep.
**The ZIP has no `.env` file and no secrets.** I will not copy `.claude/settings.json`, `claude/claude-mem-export.json`, `automation/` (finance data), `db-archives`, `vercel.json`, `docker-compose.yml`, `setup*.bat`, or the provisioning script/workflow.

## 6. Change history: documented vs. implemented

**No standalone Robo change-request files exist** in the ZIP or on any of the 209 GitHub branches. The change requests are recorded in the **merged PR descriptions** (#11, #13, #15, #16, #17, #20, #28, #37; #18 and #36 were closed and re-cut into #17 and #37), in the 20 Oct code-review IDs (ROBO-1 … ROBO-9), the 27 Oct E2E audit (E2E-24/78/82) and the 17 Nov plant-fill commits. I saved all of them and will put them in `docs/change-requests/`. I checked each item against today's source:

| # | Change (date, PR) | Evidence in current code | Status |
|---|---|---|---|
| 1 | Module created: one entry form, ROBO role, `Robo*` schema (30 Jul) | schema, `app/robo` | Implemented |
| 2 | Slabs, reports, imports, masters added (11 Aug) | all 7 sections | Implemented |
| 3 | Machines renamed to Robo1–Robo4 for display (13–14 Aug) | display labels; DB names stay `Roycut-1/2/3`, `Roymix` (design-presets mapping) | Implemented (display only, by design) |
| 4 | Tablet delete + admin restore; Setup correction; typed-time inputs (14 Aug) | `undoActions.ts`, `TimeInput.tsx`, `canEditRoboSetup` | Implemented |
| 5 | **PR #11, 14 Robo changes** (20 Aug): wrap dropdowns, cursor advance, design presets, Edit Setup any slab, S.No. from register, Batch Information, Excel rebuild, Production Date meaning, real remark | `useFieldAdvance`, `advanceFocus`, `design-presets`, `nextNumbers` | Implemented |
| 6 | **PR #13, 8 Robo changes** (28 Aug): next numbers from last saved row, delay picker reset, iPad layout, **Operators master removed**, sheets grouped by date, Slab Records columns, S.No. header, empty new-batch form | no `OperatorsMaster` on main (removed deliberately in `87fb474`); model and seed kept | Implemented |
| 7 | **PR #15, 9 changes** (2 Sep): batch matching, Date Range/Date Wise, batch filter, per-slab productionDate (0047), batch dropdown, reports redesign (Machine Performance pie removed), hourly chart, styled Excel | `batchNo.ts`, `batchFilter.ts`, `exportStyle.ts`, `report-charts.tsx` comment confirms the pie was removed | Implemented |
| 8 | **PR #16, 13 changes** (7 Sep): range edit, editable delay log, multiple Robos per delay, no "+ Add", filters persist, no 200-row cap, **Close Batch**, Total Production Time, Avg Slabs/hour, cross-midnight chart, D-1432 fix, chart readability | `rangeUpdate.ts`, `delayMachines.ts`, "Close Batch" in RoboEntryForm | Implemented |
| 9 | **PR #17** (9 Sep): Reference Sheet, phantom-day fix, S.No. 1..N per batch | `referenceSheet.ts`, `slabSequence.ts` | Implemented |
| 10 | 16 Sep: stored date wins, inline batch fields on slab Edit, S.No. under every filter | `productionDate.ts`, `batchSplit.ts` | Implemented |
| 11 | 21 Sep: Downloads in three sections; Reference Sheet numbers corrected | DownloadsClient | Implemented |
| 12 | **PR #20, 6 changes** (25 Sep): QC Rejection = Spillage + Pattern Problem only; Reference Sheet uses Reports' figures; slabs drawn where made; Daily Slabs/Hour by date; next S.No. stays in sequence; delay layout | `qcRejection.ts`, `reportSummary.ts`, `slabPlacement.ts`, `dailyRate.ts` | Implemented |
| 13 | 28 Sep cleanup: unused routes retired (`delays/*`, `operators/*`, `machines/[id]`, `exports/reference`, `delay-codes/lookup`) | these exist on old branches only, and were deleted deliberately in `a9868f1` / `2e10bf5` | Removed by decision (**not** missing) |
| 14 | **PR #28, 4 changes** (18–20 Oct): Shift A/B/C on every slab (`productionShift`), shift-coloured hourly line, hour tooltip delays, shared Attendance register | `productionShift.ts`, `hourlyShifts.ts`, attendance module | Implemented |
| 15 | 20 Oct code review ROBO-1 to ROBO-9 (apply-forward by slab number, one-record-per-slab import, restore refusals, 0131 unique shift/date, plant dates) | `rangeUpdate`, `registerImport*`, `slabRestore.ts`, `roboShift0131.test.ts` | Implemented |
| 16 | **PR #37, 9 changes** (26 Oct): 10-minute In-Time window + stamped Out-Time, roster sortOrder, shift slab count band, Leave Taken + Informed/Uninformed, design-space folding, delays cut at the hour, plant-day/night shift/previous-day rule, **07:00/19:00 email**, Plant In-Charge vs operator access, design beside batch | strings "Invalid entry/time", "Previous day's attendance entry is incomplete", "Mark out now", "Informed Leave", "no batch on record"; `delayAxis.ts`; `api/attendance/cron/report` | Implemented. The role split becomes moot without auth; the email is covered in Q4 |
| 17 | 27 Oct E2E audit: import no longer rolls back when one design ran two batches on a date (E2E-24); oversized sheets refused (E2E-78/82); no link prefetch (E2E-13) | `registerImport*`, `sheetShape.ts` | Implemented |
| 18 | **17 Nov, plant fill**: setup batch picked from the plant, each slab's own thickness from the plant, In/Out warning, import fills blank batch/thickness, From the plant card on the slab page, plant slab list on entry, Reports "made by the plant vs entered in Robo" | `importPlantFill`, `plantSlabs`, `slabPlantJourney`, `coverage.ts`, `PlantSlabList`, `CoverageCard` | Implemented in code. **Needs main-ERP plant data to show anything** (§7) |

**Partially implemented or unimplemented items found:** none in the Robo module itself. Every item listed in the merged PRs is present in code. Two items are documented-but-inactive by design: the In-Charge/operator split (auth) and plant data (external feed). PR #28 calls the attendance unique key `(date, operator)`; the code has since become `(date, operatorId, shiftNo)`. That is a later deliberate change, not a gap. Phase 4 will re-check each row by running the app, not just by grepping.

## 7. What will NOT fully work standalone (by necessity)

1. **Plant-fill features (item 18)** read tables the Breton plant PC posts into the **main ERP** (`/api/plant/ingest`) plus the main ERP's `mis` and `sync_line_order_batch`. Every one of them is guarded by `plantTablesReady()` and shows its built-in "plant data off" state when those tables are empty. Manual entry, import, reports and exports are unaffected.
2. **QC Rejection Analysis** (Downloads) reads the main ERP's Polish QC table (`polish_qc`). Standalone it will show 0 rejections until that data exists.
3. **Attendance register is shared with Chromia in the main ERP.** Standalone Robo gets its own copy, so it won't stay in step with the standalone Chromia database unless both point at the same DB (Q3).
4. **Real user attribution.** Audit rows and import logs will name one local user.
5. **Operator-tier limits** (today-only attendance, hidden exports and Leave Taken for the tablet): everything runs at In-Charge/Admin level (Q1).

## 8. Phase 3 plan (only after your approval)

Target: `C:\Users\User\Desktop\Robo-ERP-New Version\`. This is a new folder. The ZIP and the original repo are not touched.

**A. Copied unchanged:** all 151 Robo files (paths kept: `src/app/robo`, `src/app/api/robo`, `src/components/robo`, `src/lib/robo`), the attendance module, the shared helpers in §3, the Robo/attendance/plantAccess tests and fixtures, `seed-robo.ts`, `seed-attendance.ts`, `globals.css`, `public/` icons and logos, `vendor/xlsx-0.20.3.tgz`.
**B. Recreated small (same exported names, so no Robo file changes):** `lib/rbac.ts`, `components/Shell.tsx` (7 sections), `lib/prisma.ts`, a trimmed `lib/actionLog.ts`, a trimmed `plantSync/ingest-store.ts`, `slabs-server.ts` reduced to `TS_FMT`.
**C. New:** `src/app/page.tsx` redirects `/` to `/robo` (Robo Entry), so localhost opens straight into Robo. `src/app/layout.tsx` is a trimmed version of the ERP's. **No middleware, no login page.**
**D. Prisma:** trimmed `schema.prisma` (§4), migration baseline `0001_init`, seeds.
**E. Config:** `package.json` (trimmed deps; scripts `dev`, `build`, `start`, `typecheck`, `test`, `db:migrate`, `db:seed`, `db:seed:robo`, `db:seed:attendance`, `db:studio`), `tsconfig.json`, `next.config.mjs` (security headers kept, Vercel/PWA bits dropped), `tailwind.config.ts`, `postcss.config.js`, `.gitignore`, `.env.example`, `.claude/launch.json`, `README.md`. **No Docker, no auth, no deployment config.**
**F. Tests:** pure Robo/attendance tests copied unchanged. The 3 source-reading gate tests (`roboGateSweep`, `roboMasterRoutes`, the gate parts of `review1026Robo`) assert next-auth/middleware wiring that no longer exists. I'll adapt them to assert that the local gates are still called on every route, and record exactly what changed.
**G. Docs:** `docs/change-requests/` (the 10 PR descriptions + Robo commit history), `docs/history/` (the 6 SQL scripts, the Robo excerpts of CLAUDE.md and the 03 Aug/08 Oct context docs), `docs/EXTRACTION-REPORT.md` (file-by-file summary, results, limitations).

**Phase 4:** `npm install`, `tsc --noEmit`, `npm test`, `next build`, `prisma validate` + `migrate diff` (schema = migration), then a local Postgres run: open every section in the browser, create a shift → setup → slabs with delays → edit/range edit → delete/undo → reports → each download → import the round-trip export → masters CRUD → attendance mark-in/out and leave. Then a file-by-file diff of each copied file against the ZIP to prove nothing changed except the files listed in B.

## 9. Questions before Phase 3

**Q1. Local user's rights.** With no login, should the app act as **Admin / Plant In-Charge** (every control visible: delete slab, Undo, Download Slab Records, Leave Taken, attendance on any date, roster edits)? *Recommended: yes.* The alternative is the line-tablet (operator) view, which hides those.
**Q2. Plant-fill features.** Keep the code and the empty plant/MIS/QC tables so these screens show their "plant data off" state (*recommended*)? Or should I also copy the main ERP's plant ingest endpoint? That is a large non-Robo subsystem, and it only makes sense if the plant PC will post to this app.
**Q3. Attendance database.** Use Robo's own local DB `robo_erp` (*recommended*, independent)? Or point at the same local DB as the standalone Chromia so the shared register stays one register?
**Q4. Attendance 07:00/19:00 email** (Vercel cron + SMTP). Chromia's extraction left it out. Leave it out here too (*recommended*: no scheduler locally, no SMTP secrets)? Or keep the route so it can be triggered by hand with SMTP settings in `.env`?
