-- 0131: one Robo shift row per date and shift number — a unique index on
-- "RoboShift" ("date", "shiftNumber").
--
-- WHY. The code review of 20 Oct 2026, ROBO-8. The register import
-- (src/app/api/robo/imports) looks for the shift row of each date and shift
-- number in the workbook and makes one when there is none: a check, then a
-- create, and nothing in the database to stop two imports both finding none.
-- The same register imported twice at once — two tabs, two Robo users, or a
-- retry after a gateway timeout while the first run is still going — made two
-- "RoboShift" rows for one date and shift and recorded every slab on both, so
-- Robo production for those days counted twice. The code half of the fix is
-- in the same change: the import now runs in one transaction, under an
-- advisory lock that lets one import run at a time, and checks slab numbers
-- inside it (src/lib/robo/registerImportDb.ts). This index is the database
-- half: no writer at all — the import, the tablet, or SQL by hand — can make
-- a second shift row for a date and shift number that already has one.
-- prisma/schema.prisma declares it as @@unique([date, shiftNumber]) on model
-- RoboShift.
--
-- WHAT. One unique index, under the name and in the shape Prisma gives it:
--   "RoboShift_date_shiftNumber_key" ON "RoboShift" ("date", "shiftNumber")
-- A unique INDEX, as Prisma writes one, never a constraint, so `prisma
-- migrate diff` stays clean for this table; read its output all the same
-- (CLAUDE.md). The Robo tables are not mapped (no @@map), so the table and
-- its columns are the model's own names, quoted. tests/roboShift0131.test.ts
-- reads this file and the schema and holds the two to one another.
--
-- NO ROW IS CHANGED. Nothing is moved, merged, renumbered or deleted; no
-- column, no type, no other table, no other index. The slabs keep their
-- shifts; RoboProductionRecord gets no unique index on the slab number here
-- (the import's lock and its read of the recorded numbers stop the duplicate
-- slabs; slab entry and edit already refuse a number in use).
--
-- REFUSES, BEFORE CHANGING ANYTHING, when the index could not be built: if
-- two "RoboShift" rows already share a date and shift number it counts the
-- pairs and raises, and the transaction rolls back whole. It never merges
-- shift rows or moves slabs to make room. Two imports at once may already
-- have left such pairs (that is the bug), so list them before the first run:
--   SELECT "date", "shiftNumber", count(*) AS row_count,
--          string_agg("id" || ' (' || "status" || ')', ', ' ORDER BY "createdAt") AS shift_ids
--     FROM "RoboShift" GROUP BY 1, 2 HAVING count(*) > 1 ORDER BY 1, 2;
-- Settling a pair means moving the later row's setups, slabs and delay logs
-- onto the earlier one and removing the empty row — a data correction for the
-- owner to agree to, done by hand, not by this script. Until the index is in,
-- the code works without it (see WHEN).
-- It also refuses when "RoboShift" is not there (the wrong database), and
-- when an index already carries the name "RoboShift_date_shiftNumber_key" but
-- is not that index (not unique, not valid, a predicate or an expression, or
-- other columns than ("date", "shiftNumber") of "RoboShift" — one made by
-- hand): CREATE … IF NOT EXISTS would keep it and log the key as in place.
--
-- WHEN: any time, on the owner's go-ahead — before or after the code. The
-- code works with or without the index, and names no new column:
--   * the import finds the shift row first and makes one only when there is
--     none, with INSERT … ON CONFLICT DO NOTHING and a read-back (importShift
--     in src/lib/robo/registerImportDb.ts). Without the index nothing can
--     conflict and the row is inserted as before; with it, a row the tablet
--     made for the same date and shift in the same instant is found instead
--     of failing the import;
--   * the tablet's "start the day's shift" (POST /api/robo/shifts) creates
--     its row as it always has. Only with the index can the create hit a
--     date and shift number that already has a row — in practice a CLOSED one
--     the import made for today before the tablet's first slab — and it then
--     re-opens that row instead of making a second one. Nothing else changes.
--   * nothing upserts on (date, "shiftNumber"): ON CONFLICT on those columns
--     fails outright where the index is missing, and the schema says so.
--
-- LOCKS. CREATE UNIQUE INDEX holds a SHARE lock on "RoboShift" (reads go on,
-- writes wait) while it reads the table once, to COMMIT. The table is about
-- one row per production day, so it runs in well under a second. If the
-- table is busy it gives up after 5 s and rolls back whole rather than make
-- the tablet wait — run it again once the table is free.
--
-- Applied with:
--   npx prisma db execute --schema prisma/schema.prisma --file scripts/0131-robo-shift-date-unique.sql
-- (NOT `prisma db push`.)
--
-- IDEMPOTENT. CREATE UNIQUE INDEX IF NOT EXISTS; the refusals run every time
-- and find nothing on a second run. One transaction: all of it or none. Safe
-- to run twice; the second run changes nothing and logs nothing.
--
-- Logged: one action_log row on the first run, naming the index it added;
-- later runs log only if they change something (a database where it was
-- dropped by hand), exactly as 0124 logs.
--
-- CHECK (after):
--   SELECT indexname, indexdef FROM pg_indexes
--    WHERE schemaname = current_schema() AND tablename = 'RoboShift'
--    ORDER BY indexname;
--     -- 2 rows: RoboShift_pkey, and RoboShift_date_shiftNumber_key as
--     -- CREATE UNIQUE INDEX … ON … "RoboShift" USING btree (date, "shiftNumber")
--   SELECT count(*) FROM (SELECT 1 FROM "RoboShift" GROUP BY "date", "shiftNumber" HAVING count(*) > 1) AS pairs;
--     -- 0
--   SELECT summary FROM action_log WHERE payload->>'action' = '0131-robo-shift-date-unique';
--     -- 1 row
BEGIN;

-- Never queue the live ERP behind this: CREATE INDEX makes writes to the
-- table wait until COMMIT. If "RoboShift" is held by a long query or an idle
-- transaction, give up after 5 s.
SET LOCAL lock_timeout = '5s';

-- ──────────────────────────────── the refusals ──────────────────────────────────
-- Counted before anything is changed. A refusal rolls the whole run back.
-- to_regclass is given the names quoted: unquoted, it would fold them to lower
-- case and find nothing.
DO $$
DECLARE
  shift_pairs integer;
BEGIN
  IF to_regclass('"RoboShift"') IS NULL THEN
    RAISE EXCEPTION '0131: the table "RoboShift" is not there — this is not the ERP database. Nothing was changed.';
  END IF;
  -- An index already under the name must be the one this script builds:
  -- valid, unique, no predicate or expression, on exactly ("date",
  -- "shiftNumber") of "RoboShift".
  IF to_regclass('"RoboShift_date_shiftNumber_key"') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_index i
        WHERE i.indexrelid = to_regclass('"RoboShift_date_shiftNumber_key"')
          AND i.indrelid = to_regclass('"RoboShift"')
          AND i.indisunique AND i.indisvalid
          AND i.indpred IS NULL AND i.indexprs IS NULL
          AND ARRAY(SELECT a.attname::text
                      FROM unnest(i.indkey::int2[]) WITH ORDINALITY AS k (attnum, ord)
                      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
                     ORDER BY k.ord) = ARRAY['date', 'shiftNumber']) THEN
    RAISE EXCEPTION '0131: "RoboShift_date_shiftNumber_key" is already there but is not the unique index on "RoboShift" ("date", "shiftNumber") this script builds. Nothing was changed; compare it with pg_indexes and settle it by hand.';
  END IF;
  SELECT count(*) INTO shift_pairs
    FROM (SELECT 1 FROM "RoboShift" GROUP BY "date", "shiftNumber" HAVING count(*) > 1) AS pairs;
  IF shift_pairs > 0 THEN
    RAISE EXCEPTION '0131: % date / shift number pair(s) on "RoboShift" are held by more than one row, so the unique index cannot be built. Nothing was changed; list them with the query in this script''s header and settle them by hand, with the owner, first.',
      shift_pairs;
  END IF;
END $$;

-- What this run changes, read from the catalogue before anything is changed,
-- for the log at the end. A second run finds it done and logs nothing.
CREATE TEMP TABLE changed (what text) ON COMMIT DROP;
INSERT INTO changed
SELECT 'added ' || n FROM unnest(ARRAY['RoboShift_date_shiftNumber_key']) AS n WHERE to_regclass(quote_ident(n)) IS NULL;

-- ──────────────────────────────── the index ─────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS "RoboShift_date_shiftNumber_key" ON "RoboShift" ("date", "shiftNumber");

-- ──────────────────────────────────── the log ───────────────────────────────────
INSERT INTO action_log (id, actor, kind, model, summary, payload)
SELECT gen_random_uuid()::text, 'schema change (scripts/0131)', 'edit', 'RoboShift',
       format('One Robo shift row per date and shift number (scripts/0131): %s unique index on "RoboShift" ("date", "shiftNumber") added. No row was changed.',
              count(*)),
       jsonb_build_object('action', '0131-robo-shift-date-unique',
                          'changed', COALESCE(jsonb_agg(what ORDER BY what), '[]'::jsonb))
FROM changed
HAVING count(*) > 0
    OR NOT EXISTS (SELECT 1 FROM action_log WHERE payload->>'action' = '0131-robo-shift-date-unique');

SELECT count(*) AS indexes_changed FROM changed;

COMMIT;

-- ───────────────────────────────── UNDO ─────────────────────────────────────────
-- By hand, any time: the code works without the index (see WHEN), so nothing
-- has to be rolled back first. No row is touched either way.
--
-- BEGIN;
-- SET LOCAL lock_timeout = '5s';
-- DROP INDEX IF EXISTS "RoboShift_date_shiftNumber_key";
-- COMMIT;
