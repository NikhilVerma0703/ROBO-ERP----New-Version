# Robo ERP: Verification Report (Phase 4)

**Date:** 20 Nov 2026.
**Setup:** the app was run as a production build (`next start`) against a temporary, password-less local PostgreSQL 18 (port 5433), created fresh by following the README steps. The test database and the temporary `.env` were removed afterwards. Your own PostgreSQL was not used, because it needs a password I don't have.

## 1. Install, build, tests, schema

| Check | Result |
|---|---|
| `npm ci` (clean install from the lockfile) | OK, 203 packages |
| `npm run typecheck` | 0 errors |
| `npm test` | **743 / 743 pass** |
| `npm run build` | OK |
| Lint | Not run: the main ERP has no lint configuration to preserve |
| `npx prisma migrate deploy` on an empty DB | `0001_init` applied |
| `npx prisma migrate status` | "Database schema is up to date" |
| Schema vs DB drift (`migrate diff`) | None |
| `npm run db:seed`, run twice | OK both times (it only upserts, so re-running is safe) |
| Each of the 31 models compared with the ERP's `schema.prisma` | Identical |
| The 130 Robo module files compared with the ZIP | Identical |

## 2. Workflows tested (✔ = behaved as the change history says)

Unless marked API, each step was done through the UI.

**Robo Entry**
- ✔ `/` opens Robo Entry directly. No login, and all 7 sidebar sections are present in your screenshot's order.
- ✔ Batch setup: picking design CALACATTA GOLD auto-filled each Robo's tool and liquid (design presets). The batch saved as D-9001.
- ✔ The "Fill from the plant" picker and the plant slab list show their "no MIS / no plant data" states (expected standalone).
- ✔ Slab entry: typed times `0910` became `09:10`. A robot delay code (C10) opened the Machine(s) picker. One delay on Robo1 + Robo3 was saved as **one** record. Recent Slabs shows "C10 Robo1 + Robo3 3m [09:11-09:14]".
- ✔ The next S.No. and slab number count on (2 / 900102, later 13 / 900113).
- ✔ A slab with no Out time saves as In-Processing.
- ✔ A duplicate slab number is refused (409, "Duplicate Slab No.").
- ✔ New batch opens an empty setup form.
- ✔ API: 16 more slabs across Shift A/B/C and across midnight, plus a second batch (D-9002, "Taj vein").

**Slab Records**
- ✔ Lists all slabs, with S.No. 1…N per batch and the Shift column.
- ✔ Batch filter `d9001` matches D-9001 only.
- ✔ Complete Details shows all 4 sections, the machine configuration, the delay with both Robos, and the "From the plant" card (no record).
- ✔ **Range edit:** thickness changed to 3 cm on slab 900106 with "apply forward". 900106–900112 changed; 900101–900104 were untouched.
- ✔ Save returns to Slab Records with the filter kept.
- ✔ **Delete → restore:** deleting slab 900104 (API) shows the banner "Deleted robo slab 900104 … Restore it / Keep it deleted". Restore brought it back, and the audit row was marked undone.
- ✔ **Edit setup** (API PATCH): the program changed; each machine's notes and all 12 slab links were kept.

**Reports**
- ✔ Opens on the latest batch, with its design shown beside the batch number. KPIs, the delay analysis, the hourly chart and the trends all render.
- ✔ Figures checked by hand:
  - D-9001: 12 slabs, 09:10 → 01:10 = 16 h, 0.8/hr, 23 min of delays.
  - D-9002: 5 slabs, 4 h 40 m, 1.1/hr.
- ✔ The hourly series files each delay in its hour.

**Downloads**
- ✔ Complete Production (by batch, all, and by date range) and the Delay List come back as styled `.xlsx`. Read back cell by cell:
  - columns are correct, with Shift right after Production Date;
  - the date-only export groups by batch with per-batch totals;
  - the Delay List shows "Robo1 + Robo3" and the 23-minute total;
  - the range-edited thickness is reflected.
- ✔ Reference Sheet: `tajvein` found "Taj vein" (space folding). It shows the Robo programs used and the robot delays.
- ✔ QC Rejection Analysis lists Spillage and Pattern Problem in QC Line, both 0 (no Polish QC data standalone).
- ✔ All three sections are visible to the local user.

**Import**
- ✔ Deleted D-9002's 5 slabs, then imported the "all" export. The preview said 17 rows: 5 to import, 12 skip (duplicates). The import result was "Imported 5, skipped 12". The re-exported D-9002 rows are **identical** to the original export, and the import log was written.

**Master Lists**
- ✔ Adding a tool works through the UI.
- ✔ API: liquids, powders, designs, programs and delay codes can be created and deleted.
- ✔ Deleting a design that still has a program is refused (409, with the reason).
- ✔ Deleting a delay code that is in use is refused (409, "logged 1 time").

**Attendance** (API, then the page)
- ✔ Night shift 22:00 → 06:00 = 8 h, with the Out date recorded.
- ✔ A future date is refused with "Invalid entry/time."
- ✔ An unfinished previous day blocks a new entry.
- ✔ An In-Time later than the plant clock is refused.
- ✔ The two-line label reads "Robo Line + Chromia Line".
- ✔ Leave needs a leave type; "Uninformed Leave" saves.
- ✔ Records and both Excel exports (Attendance, Leave) work.
- ✔ The page shows Daily Attendance, Leave Taken, Downloads and + Add Operator. Rights = In-Charge, all six true.

## 3. Comparison with the main ERP's Robo module

- **Code:** all 130 Robo files, the attendance module and the shared helpers are byte-identical to the ZIP. Only the 19 files listed in `EXTRACTION-REPORT.md` §2–3 differ, and none of them is a Robo file.
- **Data model:** all 31 models are identical, so table and column names match the main ERP's database.
- **Behaviour:** because the code is the same, every workflow above runs the ERP's own logic. A screen-by-screen comparison with the live main ERP was not done (I have no access to it).

## 4. Findings (existing ERP behaviour, not caused by the extraction; not changed)

> **Update, 20 Nov 2026:** both findings are now **fixed and verified**, as CR-001 and CR-002. See `docs/change-requests/CR-001-002-2026-11-20.md`. The text below describes them as they were found.

Both are in files that are byte-identical to the main ERP, so the live ERP behaves the same way. Per your instructions, nothing was fixed. Each is a candidate for your first change request.

1. **Re-importing an export loses the machine setup for Shift B/C slabs.**
   - *What happens:* the Production Setup sheet has no Shift column, so on import its rows are keyed as shift 1 (`importRegister.ts`). Slabs from Shift B or C then match no setup row. They are attached to a new setup with no machine details, no production date and no target slabs.
   - *What survives:* the slab rows themselves come back intact. Re-exporting them gives identical rows.
   - *Seen with:* batch D-9002, Shift C.
2. **Adding a duplicate name in Tools / Liquids / Powders / Designs / Programs returns HTTP 500** instead of a clear message.
   - Those routes have no duplicate check; only Delay Codes has one ("Delay code already exists", 409).
   - Nothing is written, but the screen shows a generic failure.

## 5. Not verified

- Running against **your** PostgreSQL (needs your password: follow the README).
- The **operator (tablet) view.** It can be tried with `ROBO_LOCAL_ROLE=ROBO` in `.env`; the rules are covered by the unit tests (`plantAccess`, `attendance`).
- **Plant-fill features with real plant data**, and QC Rejection Analysis with real Polish QC data. Both need data from the main ERP.
- Buttons that open browser confirm dialogs (UI Delete on slabs and masters, Close Batch). The same actions were exercised through their APIs instead.
- Phone/tablet layout beyond what the narrow browser pane showed during testing.
