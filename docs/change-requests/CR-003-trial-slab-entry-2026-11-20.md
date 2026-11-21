# CR-003: Trial Slab Entry (20–21 Nov 2026)

**Status:** implemented and verified on a test database (details below).
**Database change:** yes, additive only. Run `npx prisma migrate deploy` once (see "Upgrading your database").

## What was asked, and what was built

| # | Requirement | What was built |
|---|---|---|
| 1 | Rename Robo Entry → **Slab Entry**; new **Trial Slab Entry** directly below it, cloned from Slab Entry | Sidebar: Production → Slab Entry, **Trial Slab Entry**, Slab Records. The page title is now "Slab entry". The trial page (`/robo/trial`) is a copy of the Slab Entry form (`components/robo/trial/TrialEntryForm.tsx`), with the same flow: Batch setup → Slab entry → Recent slabs · last 10. The regular form file was not changed. |
| 2 | Liquid and Powder: Setting (Normal / Define) + Name (typed by hand), + Reference Photo (required for Define), with camera/gallery and an editor | Each Liquid/Powder cell now holds **Setting · Name**, in the same cell as before, so the rows and the number of fields per row are unchanged. On a narrow tablet cell the Name drops under the Setting inside that cell. Choosing **Define** shows the required **Reference photo**, with **📷 Camera** and **🖼 Gallery**, and opens the editor. **Editor tools:** crop, resize (100/75/50/25 %), text, notes, rectangle, square, circle, arrow, highlight box, highlighter pen, 8 colours, 3 line widths, undo, redo and clear. The **original and the edited** image are both saved with the trial setup, and the editing steps are stored so the photo can be reopened and edited again. Robo2 has Liquid only, as before. |
| 3 | Batch Number optional; "--" in Recent Slabs when none; an existing production batch may be entered | Batch No. is optional. Recent Slabs on the trial page has a **Batch No.** column that shows `--` when there is none. Typing a bare number that matches exactly one existing production batch (e.g. **1506** → **D-1506**) stores that batch's own spelling, so the trial joins it everywhere. |
| 4 | Independent Batch Setup per trial slab; **Copy from previous record** | Every trial slab has its own setup. After a trial slab is saved, the page opens a fresh setup. **⧉ Copy from previous record** fills it from the last trial slab's setup: batch, design, thickness, target, notes, each robot's program, tool, liquid/powder settings and names, and the reference photos. The copy can be changed before saving. Saving creates a **new** setup with **copies** of the photos; editing a copied photo creates a new photo. The previous trial's setup and photos are never changed (verified). |
| 5 | Keep Slab Entry fields; much bigger Remarks; Recent Slabs · Last 10 | All slab fields, delays, shift and the plant list are as on Slab Entry. Remarks is a **6-row box** (about 4× taller) that keeps line breaks; Complete Details shows them too. |
| 6 | Trial slabs count everywhere: totals, Slab Records, search, reports, charts, downloads; labelled "D-1506 (Trial Slab)" | A trial slab is an ordinary production record, so every total, report, chart and download counts it. **Slab Records**, **Complete Details** and both **Excel downloads** show the batch as **"D-1506 (Trial Slab)"** (`"-- (Trial Slab)"` when there is no batch). Trial slabs are numbered S.No. 1…N among their batch's trial slabs; regular numbering is unchanged. |

**Safeguards:**
- **One slab per trial setup.** A second slab on a used trial setup is refused.
- **Slab numbers stay unique** across both pages. A duplicate is refused, exactly as before.
- **The regular Slab Entry is unchanged.** Trial setups and slabs are kept out of three things on that page:
  - its running batch;
  - its Recent Slabs;
  - its next S.No. / slab-number suggestion.
- **A trial slab's own edits stay on its own setup.** Editing its Batch No. or Design changes its setup in place, so the photos stay with it.
- **Regular slabs and imports never join a trial setup.** Neither a regular batch split nor an import can attach to one.
- **Editing a trial slab uses the trial editor.** From Slab Records, Edit slab and Edit setup open the trial form, so the settings and photos are shown and kept.
- **Imports read the trial label back.** The importer reads "D-1506 (Trial Slab)" in a downloaded sheet as D-1506.

## The worked example (verified)

Batch D-1506 was given **5 regular slabs** (Slab Entry) and **2 trial slabs** (Trial Slab Entry, typed as "1506"):

| Where | Result |
|---|---|
| Slab Records, search 1506 or D-1506 | **7 slabs**: regular S.No. 1–5 "D-1506", trial S.No. 1–2 "D-1506 (Trial Slab)" |
| Reports, batch 1506 / D-1506 | Total Slabs **7**; hourly chart adds up to 7 |
| Complete Production download (all records) | One **D-1506** group: 5 regular + 2 "(Trial Slab)" rows, **Total 7 records** |
| Regular Slab Entry | Running batch D-1506 (regular), Recent Slabs regular only, next number 6 / 150606, all as before |
| Trial Slab Entry | Next number 5 / 150654 (counted on from trial slabs) |

## Database

`prisma/migrations/0002_trial_slab_entry/migration.sql` (additive only):
- `RoboBatchRecipe.isTrial` (default false, so every existing setup stays regular);
- `RoboBatchRecipeEntry.liquidSetting`, `powderSetting` (null on regular setups);
- new table `RoboReferencePhoto`: original and edited image bytes, editing steps and notes, one per (setup, machine, Liquid/Powder).

Photos are kept in the database, so they persist after refresh and move with a database backup. Uploads are limited to 15 MB per photo. A photo uploaded but never saved with a setup is cleared after a day.

### Upgrading your database (once)

Stop `npm run dev` (Ctrl+C), then:

```
npx prisma migrate deploy
npm run dev
```

Verified on a database that already held data: the migration applied cleanly, existing setups stayed regular, and the schema check found no drift.

## Files

**New:**
- `src/app/robo/trial/page.tsx`;
- `src/components/robo/trial/{TrialEntryForm,TrialConsumableField,PhotoEditor}.tsx`;
- `src/lib/robo/{trial,trialDb}.ts`;
- `src/app/api/robo/trial/{active,setups,setups/[id],setups/latest,photos,photos/[id]}/route.ts`;
- the migration above;
- `tests/cr003TrialSlabEntry.test.ts`.

**Changed** (each change marked `CR-003` in the file):
- `prisma/schema.prisma`;
- `src/lib/navModel.ts`;
- `src/app/robo/page.tsx` (title);
- `src/app/api/robo/shifts/active/route.ts`;
- `src/lib/robo/registerOrderDb.ts`;
- `src/app/api/robo/production/{route.ts, next-number/route.ts, [id]/route.ts}`;
- `src/app/api/robo/batch-recipes/[id]/route.ts`;
- `src/app/api/robo/imports/route.ts`;
- `src/lib/robo/registerRows.ts`;
- `src/lib/robo/productionExport.ts`;
- `src/app/api/robo/exports/{production,delays}/route.ts`;
- `src/components/robo/SlabsBrowser.tsx`;
- `src/app/robo/slabs/[id]/page.tsx`;
- `src/app/robo/slabs/[id]/edit/page.tsx`.

**Tests updated:** `tests/plantAccess.test.ts` (sidebar order) and `tests/roboRegisterImport.test.ts` (allowed imports).

## Verification

- `tsc --noEmit` clean; **`npm test` 778 / 778** (19 new for CR-003); `next build` OK.
- **Done in the browser:**
  - the trial setup was refused without its Define photo;
  - a photo was picked through Gallery, then rectangle, circle, arrow, highlight, text, crop and a note were added, and it was saved (original 1200×800 and edited 1033×653 both stored);
  - setup and slab saved, and the page reopened a fresh setup;
  - Copy from previous record, then the copied photo was edited (it became a new photo; trial 1's was unchanged) and a copied liquid name was edited (saved on trial 2 only);
  - a trial with no batch shows `--`;
  - a second slab on a used trial setup was refused;
  - a duplicate slab number was refused;
  - Slab Records, Complete Details, Reports, the hourly chart and both downloads show the results in the table above.
- **Layout:** checked at desktop (1280), tablet (820) and phone (390) widths. Every Liquid/Powder control is clickable, with no sideways scrolling. One bug was found and fixed during this check: on tablet the Name box had been squeezed to 26 px.

## Not covered / notes

- **The camera button** opens the device camera on a phone or tablet. It could not be tested here, since there is no camera in the test browser; the Gallery path uses the same editor and upload.
- **HEIC photos** (some iPhones) are stored as taken, but a browser that cannot show HEIC cannot open them in the editor; the page says so.
- **The trial label repeats the batch as stored.** A bare number that matches no existing batch, or several series (e.g. both A-1200 and D-1200), is kept exactly as typed.
- **Downloads do not include the Liquid/Powder Setting** (Normal/Define) or the photos. They show in Complete Details and on the trial page.
