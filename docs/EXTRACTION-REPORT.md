# Robo ERP: Extraction Report (Phase 3)

**Source:** `Pacific-ERP-main (4).zip`, the same tree as GitHub `vmundra-pacific/Pacific-ERP` `main` (Nov 2026).
**Target:** `C:\Users\User\Desktop\Robo-ERP-New Version\`
**Original ZIP and repository:** not modified.

## 1. Result in one table

| Check | Result |
|---|---|
| Robo module files copied (pages, API routes, components, domain logic) | **130 of 130, byte-identical** (18 + 37 + 21 + 54) |
| All files carried | 261: 240 unchanged, 19 modified (listed in §3), 2 new |
| `npm install` | OK (203 packages; dependency versions pinned to the ERP lockfile's) |
| `npm run typecheck` (`tsc --noEmit`) | **0 errors** |
| `npm test` | **743 / 743 pass** |
| `npm run build` | **OK**, 54 routes |
| `prisma validate` | OK |
| Migration `0001_init` on an empty PostgreSQL, then `migrate diff` DB ↔ schema | Applied; **no drift** |
| `npm run db:seed` | OK: 4 machines, tools/liquids/powders, designs/programs, delay codes, 12-operator roster |
| Browser smoke test (temporary local DB) | `/` → `/robo` with no login. All 14 pages and 9 API reads returned 200, with no console errors. The sidebar is exactly the 7 sections of the production Robo login |

The ESLint step was not run: the main ERP has no lint configuration or `lint` script, so there was nothing to preserve.

> Correction to the plan: the plan said "151 Robo files". The real count is **130**. The 151 came from double-counting in the first import trace.

## 2. What was replaced, and why (no Robo file was edited)

| File | Main ERP | Standalone |
|---|---|---|
| `src/lib/rbac.ts` | next-auth session layer, 559 lines | **Same function names** (`roboGate`, `currentUser`, `isAdmin`, `canDeleteRoboSlab`, `canEditRoboSetup`, `roboSlabExportGate`) with the ERP's own bodies. `currentUser()` returns one local **ADMIN** user. Optional `ROBO_LOCAL_ROLE` lets you see the tablet or In-Charge view |
| `src/components/Shell.tsx` | Whole-ERP sidebar, user card, sign-out, role switcher, idle logout, view-as | Same markup and classes. Robo sidebar only, plus a "Local · no sign-in" card |
| `src/lib/navModel.ts` | Every login's sidebar, 794 lines | ERP's `NAV_ICON`, types and `ROBO_ITEMS`, unchanged, plus the ERP's `role === "ROBO"` arm as `roboNav()` |
| `src/components/MobileNav.tsx` | Includes the two-jobs RoleSwitcher | RoleSwitcher removed (one user, one job). Otherwise identical (same as the Chromia extraction) |
| `src/lib/prisma.ts` | Client wrapped in the view-as write guard; Neon pooled URL | Plain singleton |
| `src/lib/actionLog.ts` | ERP-wide audit trail and global Undo, 661 lines | Keeps **unchanged** `logActionTx`, `lastUndoableFor`, `restoreRoboSlabDelete`, `dismissRoboSlabDelete` and the full ROBO-9 restore logic. Drops the generic Undo for other modules |
| `src/lib/plantSync/ingest-store.ts` | Plant PC ingest writer, 290 lines | Only `plantTablesReady()`, unchanged |
| `src/lib/plantSync/machine/slabs-server.ts` | Machine Overview slab reader | Only the `TS_FMT` constant Robo uses |
| `src/lib/viewAs.ts`, `viewAsClient.ts`, `viewAsServer.ts` | "View as" (an auth feature) | No-op versions with the same signatures |
| `src/app/page.tsx` | Per-login home page | Redirects `/` to `/robo` |
| `prisma/schema.prisma` | 12,801 lines, ~300 models | 31 models, **each byte-identical** to the ERP's (checked by script): 14 `Robo*`, 3 `Attendance*`, `ActionLog`, and the read-only `Mis`, `PolishQc`, `SyncLineOrderBatch` and 10 `Plant*` tables. The Robo and Attendance banners are kept verbatim |
| `package.json`, `next.config.mjs` | Whole ERP | Trimmed to Robo's needs. Security headers kept; HSTS, Vercel tracing and PDF externals dropped |

**Not copied:** middleware, login page, next-auth, users table, provisioning script and workflow (`provision-robo-user.ts`, `provision-robo-account.yml`), Docker, `vercel.json`, `setup*.bat`, `.claude/settings.json`, `claude/claude-mem-export.json`, `automation/`. There was no `.env` in the ZIP, and no secrets were copied.

## 3. Tests adapted (4 files; every change is marked `STANDALONE` in the file)

| File | What changed | Why |
|---|---|---|
| `tests/attendance.test.ts` | Removed the Chromia halves of 3 tests and the test "the Chromia swipe order ends on Orders" | Chromia is not part of Robo ERP. The Robo assertions are unchanged |
| `tests/plantAccess.test.ts` | Removed 13 tests of the main ERP's edge middleware (`routeCaps`, `middleware.ts`), `chromiaTierOf`, the ERP-wide sidebar, the users `Role` enum and `scripts/0141`. Added 2: the rank/label half of the Role test, and "the Robo sidebar is the seven Robo rows" | No sign-in, middleware or users table by design. The rights table, route gates and screen checks are kept unchanged |
| `tests/roboSlabRestore.test.ts` | Removed 5 tests of the main ERP's **global** Undo bar (`lastUndoable`/`undoLastAction` on `/batch`) | That bar is not part of Robo. Every test of Robo's own Slab Records restore and "Keep it deleted" is kept |
| `tests/roboShiftAttendance0123.test.ts` | The attendance block now ends at an `END ATTENDANCE MODULE` banner instead of the `ACCOUNTS MODULE` banner | The Accounts module is not part of Robo ERP |

In total, 19 tests were removed (all checking main-ERP wiring) and 2 were added; nothing else changed. Robo's own 49 test files are unchanged and all pass.

## 4. Database

- `prisma/migrations/0001_init/migration.sql` is a real Prisma baseline, generated from the schema with `prisma migrate diff --from-empty` (31 tables).
- `scripts/` holds the 8 historical SQL scripts behind these tables, kept for reference and read by the tests: `0047` ×2, `0123`, `0131`, `0139`, `0140`, plus `0156` and `0158`, which added `attendance_day.shiftNo` and `outDate` during the Chromia rounds. **Do not run them**; the baseline already includes their effect.
- Table and column names are identical to the main ERP's. Robo data exported from the main ERP can be loaded through **Setup → Import**.

## 5. Preserved features and historical changes

All items in `ROBO-EXTRACTION-PLAN.md` §6 (rows 1–18) are carried, because the code is the main ERP's unchanged:

- **PR #11 to #37** (Aug–Oct 2026): every itemised Robo change.
- The 20 Oct code review, **ROBO-1 to ROBO-9**.
- The 27 Oct E2E audit fixes.
- The **17 Nov plant-fill** round.
- The **attendance rounds** (10-minute In-Time window, stamped Out-Time, roster order, Leave Taken and leave type, night-shift Out date, previous-day hold, multiple shifts per day).

The 13 `.mbox` patch sets on your Desktop are copied to `docs/change-requests/patches/`. Every Robo patch in them matches a commit on `main`. The 6 Chromia patches in those files are not part of Robo.

## 6. Missing or incomplete changes

None found in the Robo module. Two were **removed on purpose upstream** and are not gaps:

- The Operators master (24 Aug, `87fb474`).
- About 10 unused API routes (28 Sep, `a9868f1`; 20 Oct, `2e10bf5`).

## 7. Dependencies that still need the main ERP

1. **Plant data** (17 Nov features) comes from the plant PC → main ERP `/api/plant/ingest`, plus the ERP's `mis` and `sync_line_order_batch`. Standalone, these screens show "no plant data".
2. **Polish QC** data feeds QC Rejection Analysis. Standalone it shows no rejections.
3. **Shared attendance register with Chromia.** Standalone Robo has its own copy.
4. **Attendance email** at 07:00/19:00 (Vercel cron + SMTP). Not included.
5. **User attribution**: audit rows record the one local user.

## 8. Not verified yet (Phase 4)

> **Update (Phase 4 done):** see `docs/VERIFICATION-REPORT.md`. The list below is what stood after Phase 3.

- End-to-end workflows with data: shift → setup → slabs with delays → range edit → delete/restore → reports → each Excel download → import round-trip → masters CRUD → attendance in/out/leave.
- Running against your own PostgreSQL. Phase 3 used a temporary password-less instance, because your PostgreSQL needs a password I don't have.
- A side-by-side comparison of screens with the live main ERP.

## Appendix: file map

**Unchanged (240):**

| Area | Files |
|---|---|
| `src/app/robo` | 18 |
| `src/app/api/robo` | 37 |
| `src/components/robo` | 21 |
| `src/lib/robo` | 54 |
| `src/lib/attendance` (attendance, clock, filters, server) | 4 |
| `src/components/attendance/AttendanceClient.tsx` | 1 |
| `src/components`: ui, Toast, ClientTime, Nav, CollapsibleSidebar, Skeleton | 6 |
| `src/components/commercial/invoices/ui.ts` | 1 |
| `src/lib`: normalizeBatch, shiftScoreMath, sheetShape, branchNames, slabAddedBy, secretEqual, plantAccess, roles, actionLogKinds | 9 |
| `src/lib/chromia/plant-time.ts` | 1 |
| `src/lib/plantSync`: ingest-rules, match/{match-rules, press-map, line-head-rules, mixer-contract}, machine/{machines, plant-clock, opening-rules, opening-scope-rules} | 9 |
| `src/app`: layout, globals.css, error, global-error, loading | 5 |
| `tests` (49 Robo, 3 attendance, fixtures) | 52 |
| `prisma`: seed-robo, seed-attendance | 2 |
| `scripts` (SQL history) | 8 |
| `public` | 7 |
| `vendor/xlsx-0.20.3.tgz` | 1 |
| Config: tsconfig, tailwind, postcss, next-env.d.ts | 4 |

**Modified (19):** the files in §2 and §3, plus `package.json` and `next.config.mjs`.
**New (2):** `prisma/migrations/0001_init/migration.sql` and `migration_lock.toml`.
**Docs:** `docs/change-requests/` (10 PR descriptions, the Robo commit history, the 13 patch files) and `docs/history/` (the 3 Aug Robo handover doc, the CLAUDE.md Robo excerpt, the Airtable "Roy Mixer Robot Slab link" automation script).
