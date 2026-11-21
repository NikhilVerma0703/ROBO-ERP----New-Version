-- 0158: Chromia, the round of 17 Nov 2026 — the schema two of Nikhil's six
-- changes read. The Prisma side is in prisma/schema.prisma: model ChromiaOrder
-- (table chromia_order) and AttendanceDay.outDate. docs/CHROMIA-CHANGES-2026-11-17.md
-- lists the six changes and which of them need which part.
--
-- WHY. Worked out on the standalone Chromia app (its migrations 0009 and 0010)
-- and folded here into one numbered script, the ERP's way:
--   1. Orders (change 1): chromia_order, one row per customer order, recorded
--      on /chromia/orders. STANDALONE: no foreign key to any table, and no
--      slab page, count, KPI, report or download reads it. Its Reference
--      Photo is two rows of the existing entry_photo table (model
--      'ChromiaOrder'), the original and the marked-up copy, kept by id.
--   2. Attendance (change 2): a shift may now run past the next morning (the
--      owner: "operator can work continously for 35 hours also"), and 08:00 →
--      19:00 alone cannot say whether that was eleven hours or thirty-five.
--      attendance_day."outDate" records the yyyy-mm-dd the Out fell on, from
--      the deploy on. NULLABLE: no row is changed, and a row without it is read
--      from its times exactly as before (an Out earlier than the In is the next
--      date).
--
-- ATTENDANCE IS SHARED. attendance_day is the ONE register Robo and Chromia
-- both keep (lib/attendance/server.ts at /api/robo/attendance and
-- /api/chromia/attendance) and the twice-daily attendance email reads it. The
-- new column is nullable with no default: ADD COLUMN changes no row on disk,
-- takes a moment, and the code live today never names it. Running this BEFORE
-- the deploy changes nothing anyone sees.
--
-- WHAT.
--   table chromia_order, indexes chromia_order_created_at_idx and
--     chromia_order_actual_delivery_date_idx (no foreign key).
--   attendance_day."outDate" text NULL.
--
-- Applied with:
--   npx prisma db execute --schema prisma/schema.prisma --file scripts/0158-chromia-round-2026-11-17.sql
--   npx prisma generate
-- (NOT `prisma db push`.)
--
-- WHEN: BEFORE the code that reads these is deployed. Until it runs, BOTH
-- attendance registers (Robo's and Chromia's) and the attendance email fail
-- (P2022, column does not exist), and so does the Orders page. Running it
-- FIRST is safe: the table is new and nothing live reads it, and the column is
-- one the live code never names.
--
-- IDEMPOTENT. Every object is added only when missing. Safe to run twice: the
-- second run changes nothing and logs nothing. One transaction: all of it or
-- none. If a lock it needs is held for more than 5 s (lock_timeout), it rolls
-- back whole and changes nothing; run it again later.
--
-- REFUSES, changing nothing, when what is there is not what it expects: a
-- chromia_order or "outDate" already present in another shape.
--
-- Logged: one action_log row on the first run, naming what it did.
BEGIN;
-- Never queue the live ERP behind this script: the new column needs
-- attendance_day to itself for a moment, and one open transaction on it would
-- otherwise stall both attendance tablets behind the script.
SET LOCAL lock_timeout = '5s';

CREATE TEMP TABLE added (what text, kind text) ON COMMIT DROP;

-- ── refusals first: nothing is written unless all of it can be ─────────────
DO $$
DECLARE hit text;
BEGIN
  IF to_regclass('attendance_day') IS NULL OR to_regclass('entry_photo') IS NULL THEN
    RAISE EXCEPTION '0158 refused: attendance_day or entry_photo is missing (scripts/0123 and the photo script come first). Nothing was changed.';
  END IF;
  -- chromia_order, if it is already here, must be the table this script makes.
  IF to_regclass('chromia_order') IS NOT NULL THEN
    SELECT string_agg(e.col, ', ' ORDER BY e.col) INTO hit
      FROM (VALUES ('id'), ('customer_name'), ('requested_by'), ('design_name'), ('base_material_name'),
                   ('printing_file_name'), ('quantity'), ('thickness_mm'), ('finishing_type'),
                   ('requested_delivery_date'), ('actual_delivery_date'), ('person_in_charge'), ('remarks'),
                   ('photo_original_id'), ('photo_edited_id'), ('created_by_id'), ('updated_by_id'),
                   ('created_at'), ('updated_at')) AS e(col)
     WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns c
                        WHERE c.table_schema = current_schema() AND c.table_name = 'chromia_order' AND c.column_name = e.col);
    IF hit IS NOT NULL THEN
      RAISE EXCEPTION '0158 refused: chromia_order is already here without the column(s) %. Nothing was changed; model what is there before going on.', hit;
    END IF;
  END IF;
  -- "outDate", if it is already here, must be nullable text.
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = current_schema() AND table_name = 'attendance_day' AND column_name = 'outDate')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                      WHERE table_schema = current_schema() AND table_name = 'attendance_day' AND column_name = 'outDate'
                        AND data_type = 'text' AND is_nullable = 'YES') THEN
    RAISE EXCEPTION '0158 refused: attendance_day."outDate" is already here, but not as nullable text. Nothing was changed.';
  END IF;
END
$$;

-- ── 1 · Orders ───────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('chromia_order') IS NULL THEN
    CREATE TABLE "chromia_order" (
        "id" TEXT NOT NULL,
        "customer_name" TEXT NOT NULL,
        "requested_by" TEXT,
        "design_name" TEXT,
        "base_material_name" TEXT,
        "printing_file_name" TEXT,
        "quantity" INTEGER,
        "thickness_mm" DECIMAL(18,3),
        "finishing_type" TEXT,
        "requested_delivery_date" TIMESTAMP(3),
        "actual_delivery_date" TIMESTAMP(3),
        "person_in_charge" TEXT,
        "remarks" TEXT,
        "photo_original_id" TEXT,
        "photo_edited_id" TEXT,
        "created_by_id" TEXT,
        "updated_by_id" TEXT,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL,
        CONSTRAINT "chromia_order_pkey" PRIMARY KEY ("id")
    );
    INSERT INTO added VALUES ('table chromia_order', 'table');
  END IF;
  IF to_regclass('chromia_order_created_at_idx') IS NULL THEN
    CREATE INDEX "chromia_order_created_at_idx" ON "chromia_order"("created_at");
    INSERT INTO added VALUES ('index chromia_order_created_at_idx', 'index');
  END IF;
  IF to_regclass('chromia_order_actual_delivery_date_idx') IS NULL THEN
    CREATE INDEX "chromia_order_actual_delivery_date_idx" ON "chromia_order"("actual_delivery_date");
    INSERT INTO added VALUES ('index chromia_order_actual_delivery_date_idx', 'index');
  END IF;
END
$$;

-- ── 2 · Attendance: the date an Out-Time fell on ──────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = current_schema() AND table_name = 'attendance_day' AND column_name = 'outDate') THEN
    ALTER TABLE "attendance_day" ADD COLUMN "outDate" TEXT;
    INSERT INTO added VALUES ('column attendance_day."outDate"', 'column');
  END IF;
END
$$;

INSERT INTO action_log (id, actor, kind, model, summary, payload)
SELECT gen_random_uuid()::text, 'schema change (scripts/0158)', 'edit', 'ChromiaOrder',
       format('Chromia, the round of 17 Nov 2026 (scripts/0158): %s.',
              CASE WHEN count(*) = 0 THEN 'all of it already in place'
                   ELSE string_agg(what, '; ' ORDER BY kind, what) END),
       jsonb_build_object('action', '0158-chromia-round-2026-11-17',
                          'added', COALESCE(jsonb_agg(what ORDER BY kind, what), '[]'::jsonb))
FROM added
HAVING count(*) > 0
    OR NOT EXISTS (SELECT 1 FROM action_log WHERE payload->>'action' = '0158-chromia-round-2026-11-17');

COMMIT;

-- ───────────────────────────────── UNDO ─────────────────────────────────────────
-- By hand, AFTER the code is rolled back (this round's code reads both):
--
-- 1 · Orders. Every order and its photos go with it: export them first if they
--     are wanted.
--
-- BEGIN;
-- SET LOCAL lock_timeout = '5s';
-- DELETE FROM entry_photo WHERE model = 'ChromiaOrder';
-- DROP TABLE IF EXISTS "chromia_order";
-- COMMIT;
--
-- 2 · Attendance. "outDate" can simply stay: the code before this round never
--     names it. Dropping it loses the date of every Out saved since the
--     deploy, and a shift of a day or more then reads from its times alone
--     (wrongly, for those):
--
-- ALTER TABLE "attendance_day" DROP COLUMN IF EXISTS "outDate";
