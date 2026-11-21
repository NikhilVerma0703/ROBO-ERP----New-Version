-- 0156: Chromia, the round of 7-8 Nov 2026 — the schema Nikhil's changes 1-12
-- read. The Prisma side is in prisma/schema.prisma: ChromiaDisposition gains
-- TRIMMING, the new enum ChromiaTrimmingSource and model ChromiaTrimming (with
-- ChromiaSlab.trimming), and AttendanceDay.shiftNo with
-- @@unique([date, operatorId, shiftNo]). docs/CHROMIA-CHANGES-2026-11-10.md
-- lists the twelve changes, and which of them need which part.
--
-- WHY. Worked out on the standalone Chromia app (its migrations 0006, 0008 and
-- 0007) and folded here into one numbered script, the ERP's way:
--   1. Grade C → Trimming (changes 1-3): a second QC Outcome for Grade C beside
--      Recalibration, chosen on Slab Entry. The slab stays GRADED with
--      current_disposition TRIMMING and is listed on the new Trimming page.
--   2. The Trimming section (change 4): chromia_trimming, one record per slab
--      sent to trimming — how much it is trimmed (From → To, mm), when it went
--      out and came back, and the QC Report after it. Two sources share it:
--        PRODUCTION        graded C → Trimming on Slab Entry; points at its slab.
--        WITHOUT_PRINTING  entered on the Trimming page for a slab that never
--                          went on the line; holds its own details until its
--                          QC Report makes it a Chromia slab.
--      Every slab already graded C → Trimming gets its (empty) record. On a
--      database where TRIMMING is new (production) there is none.
--   3. More than one shift for an operator on one date (the attendance
--      change): attendance_day held ONE row per (date, operator), so an
--      operator called back the same day could not be entered. Each shift is
--      now its own row, numbered within its date by "shiftNo".
--
-- ATTENDANCE IS SHARED — READ THIS BEFORE PART 3. attendance_day is the ONE
-- register Robo and Chromia both keep (lib/attendance/server.ts, mounted at
-- /api/robo/attendance and /api/chromia/attendance; on production it is
-- written by the CHROMIA login, the ROBO login and the Plant In-Charge every
-- day), and the twice-daily attendance email (lib/attendance/reportEmail.ts)
-- reads it. HR's attendance (office/hr/attendance) does not: it reads the
-- sign-in log. Part 3 is built so that nothing that does not know about
-- shifts sees or relies on anything different:
--   * "shiftNo" is NOT NULL DEFAULT 1. Every row already there becomes shift 1,
--     and every save that does not name a shift — the code live today, until
--     the deploy — writes shift 1. ADD COLUMN with a constant default changes
--     no row on disk and takes a moment.
--   * The unique index moves from (date, "operatorId") to
--     (date, "operatorId", "shiftNo"). For shift 1 — every row any code has
--     ever written — the new index IS the old rule: one row per operator per
--     date, the same refusal on a duplicate. The upsert the live code runs
--     (findUnique, then create or update, on date + operatorId) needs no index
--     to find its row, and its create is still refused on a duplicate by the
--     new index. So running this BEFORE the deploy changes nothing a user sees.
--   * The old index is dropped only once the new one exists, in the same
--     transaction, so the table is never without the rule. It has to go:
--     while it stands, a second shift cannot be stored.
--   * The email reads shift 1 only (reportEmail.ts), so it is the email it was.
--   * Nothing is removed: no table, no column, no row.
--
-- WHAT.
--   "chromia_disposition" gains 'TRIMMING' (ADD VALUE IF NOT EXISTS, before
--     BEGIN; nothing below compares against it but as text, so the script also
--     runs whole in one transaction, as the Neon SQL tool runs it).
--   type chromia_trimming_source ('PRODUCTION', 'WITHOUT_PRINTING').
--   table chromia_trimming, its unique indexes chromia_trimming_slab_id_key
--     and chromia_trimming_slab_no_key, indexes chromia_trimming_source_idx and
--     chromia_trimming_created_at_idx, foreign key chromia_trimming_slab_id_fkey
--     (to chromia_slab, on delete cascade).
--   attendance_day."shiftNo" integer NOT NULL DEFAULT 1, unique index
--     "attendance_day_date_operatorId_shiftNo_key" in place of
--     "attendance_day_date_operatorId_key".
--
-- Applied with:
--   npx prisma db execute --schema prisma/schema.prisma --file scripts/0156-chromia-round-2026-11.sql
--   npx prisma generate
-- (NOT `prisma db push`.)
--
-- WHEN: BEFORE the code that reads these is deployed, or with it. Until it
-- runs, the Chromia pages and BOTH attendance registers fail (P2022, column
-- does not exist). Running it FIRST is safe: see the attendance note above;
-- the Chromia objects are new and nothing live reads them.
--
-- IDEMPOTENT. Every object is added only when missing; the backfill only gives
-- a record to a slab without one; the old attendance index is dropped only
-- while it exists. Safe to run twice: the second run changes nothing and logs
-- nothing. The rest in one transaction: all of it or none. If a lock it needs
-- is held for more than 5 s (lock_timeout), it rolls back whole and changes
-- nothing; run it again later.
--
-- REFUSES, changing nothing, when what is there is not what it expects: a
-- chromia_trimming or "shiftNo" already present in another shape, or rows the
-- new attendance index would refuse. (A re-run of scripts/0123 after this one
-- refuses on the new column, as it already does after 0139 and 0140 — it
-- cannot put the old index back.)
--
-- Logged: one action_log row on the first run, naming what it did.

ALTER TYPE "chromia_disposition" ADD VALUE IF NOT EXISTS 'TRIMMING';

BEGIN;

-- Never queue the live ERP behind this script; if a lock it needs is held,
-- give up after 5 s and roll back whole rather than wait. Run it again later.
-- (The foreign key to chromia_slab holds a lock on it until COMMIT, and the
-- new column needs attendance_day to itself: without this, one open
-- transaction on either would stall the attendance tablets and every slab
-- save behind the script.)
SET LOCAL lock_timeout = '5s';

CREATE TEMP TABLE added (what text, kind text) ON COMMIT DROP;

-- ── refusals first: nothing is written unless all of it can be ─────────────
DO $$
DECLARE hit text;
BEGIN
  IF to_regclass('chromia_slab') IS NULL OR to_regclass('attendance_day') IS NULL THEN
    RAISE EXCEPTION '0156 refused: chromia_slab or attendance_day is missing (scripts/0045 and 0123 come first). Nothing was changed.';
  END IF;

  -- chromia_trimming, if it is already here, must be the table this script makes.
  IF to_regclass('chromia_trimming') IS NOT NULL THEN
    SELECT string_agg(e.col, ', ' ORDER BY e.col) INTO hit
      FROM (VALUES ('id'), ('source'), ('slab_id'), ('slab_no'), ('batch_no'), ('base_material'), ('file_name'),
                   ('production_date'), ('in_time'), ('thickness_mm'), ('remarks'), ('trim_from_mm'), ('trim_to_mm'),
                   ('sent_date'), ('received_date'), ('qc_grade'), ('qc_disposition'), ('qc_at'),
                   ('created_by_id'), ('updated_by_id'), ('created_at'), ('updated_at')) AS e(col)
     WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns c
                        WHERE c.table_schema = current_schema() AND c.table_name = 'chromia_trimming' AND c.column_name = e.col);
    IF hit IS NOT NULL THEN
      RAISE EXCEPTION '0156 refused: chromia_trimming is already here without the column(s) %. Nothing was changed; model what is there before going on.', hit;
    END IF;
  END IF;

  -- "shiftNo", if it is already here, must be an integer, NOT NULL, default 1.
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = current_schema() AND table_name = 'attendance_day' AND column_name = 'shiftNo')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                      WHERE table_schema = current_schema() AND table_name = 'attendance_day' AND column_name = 'shiftNo'
                        AND data_type = 'integer' AND is_nullable = 'NO' AND column_default = '1') THEN
    RAISE EXCEPTION '0156 refused: attendance_day."shiftNo" is already here, but not as integer NOT NULL DEFAULT 1. Nothing was changed.';
  END IF;

  -- An index already under the new name must be the unique btree it names.
  IF to_regclass('"attendance_day_date_operatorId_shiftNo_key"') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_index i
         JOIN pg_class x ON x.oid = i.indexrelid
         JOIN pg_am m ON m.oid = x.relam
        WHERE i.indexrelid = to_regclass('"attendance_day_date_operatorId_shiftNo_key"')
          AND i.indrelid = to_regclass('attendance_day')
          AND i.indisunique AND i.indisvalid AND m.amname = 'btree'
          AND i.indpred IS NULL AND i.indexprs IS NULL
          AND (SELECT string_agg(a.attname, ',' ORDER BY k)
                 FROM generate_series(0, i.indnatts - 1) AS k
                 JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = i.indkey[k]) = 'date,operatorId,shiftNo') THEN
    RAISE EXCEPTION '0156 refused: "attendance_day_date_operatorId_shiftNo_key" is already here but is not a valid unique btree on (date, "operatorId", "shiftNo"). Nothing was changed.';
  END IF;

  -- Rows the new unique index would refuse. Only possible where the column is
  -- already here and the old index is not; counted and named, never deleted.
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = current_schema() AND table_name = 'attendance_day' AND column_name = 'shiftNo') THEN
    EXECUTE $q$
      SELECT string_agg(format('%s / %s / shift %s (%s rows)', dt, op, sh, n), ', ' ORDER BY dt, op, sh)
        FROM (SELECT "date" AS dt, "operatorId" AS op, "shiftNo" AS sh, count(*) AS n FROM attendance_day
               GROUP BY 1, 2, 3 HAVING count(*) > 1) d
    $q$ INTO hit;
    IF hit IS NOT NULL THEN
      RAISE EXCEPTION '0156 refused: attendance_day holds the same shift of an operator twice on one date: %. Nothing was changed; a person decides which row to keep.', hit;
    END IF;
  END IF;
END
$$;

-- ── 1 · Grade C → Trimming ──────────────────────────────────────────────────
-- The enum value is added above, before BEGIN (ADD VALUE IF NOT EXISTS: a
-- second run adds nothing). Named in the log on the first run only.
INSERT INTO added
SELECT 'chromia_disposition has TRIMMING', 'type'
WHERE NOT EXISTS (SELECT 1 FROM action_log WHERE payload->>'action' = '0156-chromia-round-2026-11');

-- ── 2 · the Trimming section ────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'chromia_trimming_source') THEN
    CREATE TYPE "chromia_trimming_source" AS ENUM ('PRODUCTION', 'WITHOUT_PRINTING');
    INSERT INTO added VALUES ('type chromia_trimming_source', 'type');
  END IF;

  IF to_regclass('chromia_trimming') IS NULL THEN
    CREATE TABLE "chromia_trimming" (
        "id" TEXT NOT NULL,
        "source" "chromia_trimming_source" NOT NULL,
        "slab_id" TEXT,
        "slab_no" TEXT,
        "batch_no" TEXT,
        "base_material" TEXT,
        "file_name" TEXT,
        "production_date" TIMESTAMP(3),
        "in_time" TEXT,
        "thickness_mm" DECIMAL(18,3),
        "remarks" TEXT,
        "trim_from_mm" DECIMAL(18,3),
        "trim_to_mm" DECIMAL(18,3),
        "sent_date" TIMESTAMP(3),
        "received_date" TIMESTAMP(3),
        "qc_grade" "chromia_slab_grade",
        "qc_disposition" "chromia_disposition",
        "qc_at" TIMESTAMP(3),
        "created_by_id" TEXT,
        "updated_by_id" TEXT,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL,

        CONSTRAINT "chromia_trimming_pkey" PRIMARY KEY ("id")
    );
    INSERT INTO added VALUES ('table chromia_trimming', 'table');
  END IF;

  IF to_regclass('chromia_trimming_slab_id_key') IS NULL THEN
    CREATE UNIQUE INDEX "chromia_trimming_slab_id_key" ON "chromia_trimming"("slab_id");
    INSERT INTO added VALUES ('index chromia_trimming_slab_id_key', 'index');
  END IF;
  IF to_regclass('chromia_trimming_slab_no_key') IS NULL THEN
    CREATE UNIQUE INDEX "chromia_trimming_slab_no_key" ON "chromia_trimming"("slab_no");
    INSERT INTO added VALUES ('index chromia_trimming_slab_no_key', 'index');
  END IF;
  IF to_regclass('chromia_trimming_source_idx') IS NULL THEN
    CREATE INDEX "chromia_trimming_source_idx" ON "chromia_trimming"("source");
    INSERT INTO added VALUES ('index chromia_trimming_source_idx', 'index');
  END IF;
  IF to_regclass('chromia_trimming_created_at_idx') IS NULL THEN
    CREATE INDEX "chromia_trimming_created_at_idx" ON "chromia_trimming"("created_at");
    INSERT INTO added VALUES ('index chromia_trimming_created_at_idx', 'index');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chromia_trimming_slab_id_fkey') THEN
    ALTER TABLE "chromia_trimming" ADD CONSTRAINT "chromia_trimming_slab_id_fkey"
      FOREIGN KEY ("slab_id") REFERENCES "chromia_slab"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    INSERT INTO added VALUES ('foreign key chromia_trimming_slab_id_fkey', 'constraint');
  END IF;
END
$$;

-- Every slab already graded C → Trimming gets its (empty) record. Compared as
-- text: the value is new in this run, and a new enum value may not be used in
-- the transaction that added it.
WITH opened AS (
  INSERT INTO "chromia_trimming" ("id", "source", "slab_id", "created_at", "updated_at")
  SELECT gen_random_uuid()::text, 'PRODUCTION', s."id", s."updated_at", NOW()
  FROM "chromia_slab" s
  WHERE s."deleted_at" IS NULL
    AND s."status"::text = 'GRADED'
    AND s."current_disposition"::text = 'TRIMMING'
    AND NOT EXISTS (SELECT 1 FROM "chromia_trimming" t WHERE t."slab_id" = s."id")
  RETURNING "id"
)
INSERT INTO added SELECT format('%s slabs graded C → Trimming given their Trimming record', count(*)), 'data'
FROM opened HAVING count(*) > 0;

-- ── 3 · more than one shift on a date (the shared attendance register) ──────
-- LAST in the table, as the model declares it (ADD COLUMN appends); the form
-- scripts/0139 and 0140 use, which tests/roboShiftAttendance0123.test.ts reads.
INSERT INTO added
SELECT 'attendance_day."shiftNo" (every existing row is shift 1)', 'column'
WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = current_schema() AND table_name = 'attendance_day' AND column_name = 'shiftNo');

ALTER TABLE attendance_day
  ADD COLUMN IF NOT EXISTS "shiftNo" INTEGER NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF to_regclass('"attendance_day_date_operatorId_shiftNo_key"') IS NULL THEN
    CREATE UNIQUE INDEX "attendance_day_date_operatorId_shiftNo_key"
      ON "attendance_day"("date", "operatorId", "shiftNo");
    INSERT INTO added VALUES ('index attendance_day_date_operatorId_shiftNo_key', 'index');
  END IF;

  -- Only now, with the new rule in place, does the old one go.
  IF to_regclass('"attendance_day_date_operatorId_key"') IS NOT NULL THEN
    DROP INDEX "attendance_day_date_operatorId_key";
    INSERT INTO added VALUES ('index attendance_day_date_operatorId_key dropped (replaced by the shift index)', 'index');
  END IF;
END
$$;

COMMENT ON COLUMN attendance_day."shiftNo" IS
  'Which shift of the date this row is: 1, then 2 for an operator called back the same day (scripts/0156, 7 Nov 2026). Every row before 0156, and every save that names no shift, is shift 1.';

-- ── the log row ─────────────────────────────────────────────────────────────
INSERT INTO action_log (id, actor, kind, model, summary, payload)
SELECT gen_random_uuid()::text, 'schema change (scripts/0156)', 'edit', 'ChromiaSlab',
       format('Chromia, the round of 7-8 Nov 2026 (scripts/0156): %s.',
              CASE WHEN count(*) = 0 THEN 'all of it already in place'
                   ELSE string_agg(what, '; ' ORDER BY kind, what) END),
       jsonb_build_object('action', '0156-chromia-round-2026-11',
                          'added', COALESCE(jsonb_agg(what ORDER BY kind, what), '[]'::jsonb))
FROM added
HAVING count(*) > 0
    OR NOT EXISTS (SELECT 1 FROM action_log WHERE payload->>'action' = '0156-chromia-round-2026-11');

COMMIT;

-- ───────────────────────────────── UNDO ─────────────────────────────────────────
-- By hand, in this order: steps 1 and 2 while this round's code still runs,
-- then the code rollback, then step 4.
--
-- 1 · Attendance: ONE ROW PER OPERATOR PER DATE again, BEFORE the code goes
-- back. The code before this round reads one row per operator per date: its
-- register is keyed by operator (a second shift silently drops off both
-- tablets), and its save looks the row up and updates it by (date,
-- operatorId) — rehearsed on a local copy (10 Nov 2026), its save of an
-- operator's day OVERWROTE that operator's shift-2 row with the shift-1
-- values. So no shift above 1 may exist when it runs. Find them, and let a
-- person decide each (fold it into shift 1, or delete it):
--
--   SELECT "date", "operatorId", "shiftNo", "lines", "inTime", "outTime"
--     FROM attendance_day WHERE "shiftNo" > 1 ORDER BY "date";
--
-- then, at once (a second shift saved in between makes the index refuse;
-- settle it and run this again), put the old index back BESIDE the shift one:
--
-- BEGIN;
-- SET LOCAL lock_timeout = '5s';
-- CREATE UNIQUE INDEX "attendance_day_date_operatorId_key" ON attendance_day ("date", "operatorId");
-- COMMIT;
--
-- From here this round's code still saves shift 1 as before and only has a
-- new second shift refused (P2002, rehearsed), so no second shift can come
-- back before the rollback; and the old code works against both indexes.
--
-- 2 · Trimming, also BEFORE the code goes back. A slab graded C → Trimming
-- (status GRADED, current_disposition TRIMMING) has no page to go to in the
-- code before this round: re-grade each one (Grade C → Recalibration) while
-- the Trimming pages are still there, or move it by hand.
--
-- 3 · Roll the code back.
--
-- 4 · AFTER the code is rolled back (this round's code reads all of these):
--
-- BEGIN;
-- SET LOCAL lock_timeout = '5s';
-- DROP INDEX IF EXISTS "attendance_day_date_operatorId_shiftNo_key";
-- DROP TABLE IF EXISTS "chromia_trimming";
-- DROP TYPE IF EXISTS "chromia_trimming_source";
-- COMMIT;
--
-- "shiftNo" itself can stay: the code before this round never names it, and
-- its default is the shift that code writes. PostgreSQL has no DROP VALUE for
-- an enum: an unused 'TRIMMING' is inert.
