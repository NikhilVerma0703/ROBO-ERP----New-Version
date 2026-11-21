// THE PLANT'S DELIVERIES, CHECKED BEFORE ANYTHING IS STORED: the rules of
// POST /api/plant/ingest (docs/plant/PLANT-SYNC-STEP1-SPEC.md sections 1-3).
//
// The plant PC (automation/plant/plant-sync.ps1, stage 2) reads the Breton SQL
// Server every five minutes and posts what it read here, one JSON "envelope"
// per outbox file. This file decides, with no database and no environment:
//   - whether the caller holds the upload key (keyAuthorised). The ERP keeps
//     only the key's SHA-256 (PLANT_SYNC_KEY_SHA256), never the key itself,
//     so a leaked Vercel variable cannot be replayed as the key;
//   - whether the body is an envelope of contract v1 (parseEnvelope), inside
//     the limits the PC chunks under (LIMITS). A body outside them is refused
//     whole, because a PC that sends one is not following the contract and a
//     person has to look;
//   - for each feed, every row's key, typed columns and hash (prepareFeed).
//     Everything the database will cast is proven castable HERE, so the
//     store's one statement per feed cannot fail half way on a bad value: a
//     value of the wrong shape becomes NULL, and only a bad key (or a value no
//     Postgres column can hold) turns a row away, with the rest of the post
//     kept.
//
// PURE: imports only node:crypto and ../secretEqual.ts, so node --test loads
// it as it is (tests/plantSyncIngest.test.ts). lib/plantSync/ingest-store.ts
// is the server side that writes what this prepares.
import { createHash } from "node:crypto";
import { secretEqual } from "../secretEqual.ts";

/* ------------------------------------------------------------------ limits */

/** The contract's limits (spec section 1). The PC chunks under them; the ERP
 *  answers 413 (body) or 400 (everything else) beyond them. */
export const LIMITS = {
  /** content-length, and the bytes actually read. Vercel itself stops near
   *  4.5 MB, so the ERP refuses first and says why. */
  bodyBytes: 4_000_000,
  rowsPerFeed: 5_000,
  rowsPerPost: 20_000,
  keysPerRow: 200,
  /** One row as JSON, in UTF-8 bytes (32 KB). */
  rowBytes: 32 * 1024,
  /** errors[] entries in one envelope. */
  errors: 50,
  /** errors[].message and latch.message, in characters. */
  messageChars: 500,
  /** A typed TEXT column keeps at most this many characters (longer is cut). */
  textChars: 500,
  /** pc.host and pc.script. */
  pcChars: 200,
  /** Entries in cursors, and the length of one cursor's name and string value. */
  cursors: 50,
  cursorNameChars: 64,
  cursorValueChars: 200,
  /** errors[].feed. */
  errorFeedChars: 64,
  /** Rejected rows listed in the answer and in plant_sync_post.rejected. */
  rejectedListed: 50,
  /** pressSlabs' key. */
  slabCodeChars: 40,
  /** gevDeploys' key. */
  gevIdChars: 64,
  /** pc.madeAt may be at most this far ahead of the ERP's own IST clock
   *  (clockRefusal): a PC clock further ahead would make the store drop the
   *  newer reads that follow, for good. */
  clockAheadMinutes: 10,
} as const;

/** batchId: 8-64 characters of [A-Za-z0-9-]; one per outbox file, reused on a resend. */
export const BATCH_ID = /^[A-Za-z0-9-]{8,64}$/;

/* ------------------------------------------------------------------- feeds */

export type FeedName =
  | "slabs" | "mixLines" | "channelOrders" | "pressSlabs"
  | "pressHourly" | "lineOrders" | "settings" | "gevDeploys";

/** How a row's plant_key is made (spec section 2). A row whose key is missing
 *  or malformed is rejected; nothing else rejects a row. */
export type KeyRule =
  /** An INTEGER id (F_ID 12345 -> "12345"). */
  | { readonly kind: "int"; readonly field: string }
  /** A non-empty string of at most 40 characters, trimmed. */
  | { readonly kind: "slabCode"; readonly field: string }
  /** A non-negative safe integer (a BIGINT identity). */
  | { readonly kind: "nonNegative"; readonly field: string }
  /** "<F_ID>|<F_LUD>|<sig>": one row per value the panel held (settingKey). */
  | { readonly kind: "setting" }
  /** A string (trimmed, at most 64) or an integer, kept as a string. */
  | { readonly kind: "idText"; readonly field: string };

/**
 * What a typed column holds, and so how its value is taken from the row.
 * A value of the wrong shape becomes NULL; none of these rejects a row.
 */
export type ColumnKind =
  /** INTEGER: a number that is a whole number within the INTEGER range. */
  | "integer"
  /** BIGINT: a number that is a safe integer. */
  | "bigint"
  /** DOUBLE PRECISION: a finite number. */
  | "double"
  /** TEXT: a string, trimmed, empty -> NULL, longer than 500 characters -> cut. */
  | "text"
  /** TIMESTAMP(3): a naive plant time (naiveTs), the fraction cut to 3 digits. */
  | "timestamp"
  /** INTEGER: the last 6 digits of a text field (slabNoOf). */
  | "slabNo"
  /** INTEGER: a text field that is all digits (F_MOLDING_ORDER "10183"). */
  | "digits"
  /** TEXT: the row's plant_key itself (gevDeploys' Id may come as a number). */
  | "key";

/** The column type each kind is cast to. Fixed here: nothing from a request
 *  ever reaches the SQL as a type or a name. */
export const SQL_TYPE: Readonly<Record<ColumnKind, string>> = {
  integer: "integer",
  bigint: "bigint",
  double: "double precision",
  text: "text",
  timestamp: "timestamp(3)",
  slabNo: "integer",
  digits: "integer",
  key: "text",
};

export interface FeedColumn {
  /** The column in the feed's table (snake_case). */
  readonly column: string;
  /** The envelope row's field it is taken from (the plant's column name). */
  readonly field: string;
  readonly kind: ColumnKind;
  /** NOT NULL in the table: guaranteed by the key rule, never by luck. */
  readonly notNull?: true;
}

export interface FeedDef {
  /** The name in the envelope's feeds object. */
  readonly name: FeedName;
  /** Where the PC reads it (for the health page and for people). */
  readonly source: string;
  /** The ERP table (scripts/0152-plant-sync.sql). */
  readonly table: string;
  /** upsert: a newer read of the same key replaces the row. insertOnly: an
   *  event; a resend never moves it. */
  readonly mode: "upsert" | "insertOnly";
  readonly key: KeyRule;
  readonly columns: readonly FeedColumn[];
}

/** The feed table of spec sections 2 and 3, as data. The store builds its SQL
 *  from these names alone. */
export const FEEDS: readonly FeedDef[] = [
  {
    name: "slabs", source: "BL_PACIFIC.dbo.T_RPT_SLABS", table: "plant_slab", mode: "upsert",
    key: { kind: "int", field: "F_ID" },
    columns: [
      { column: "f_id", field: "F_ID", kind: "integer", notNull: true },
      { column: "article", field: "F_ARTICLE", kind: "text" },
      { column: "slab_no", field: "F_ARTICLE", kind: "slabNo" },
      { column: "line_order", field: "F_MOLDING_ORDER", kind: "digits" },
      { column: "sts_begin", field: "F_STS_BEGIN_DIST", kind: "timestamp" },
      { column: "krs_begin", field: "F_KRS_BEGIN_LAM", kind: "timestamp" },
      { column: "pre_begin", field: "F_PRE_BEGIN", kind: "timestamp" },
      { column: "ove_end", field: "F_OVE_END", kind: "timestamp" },
    ],
  },
  {
    name: "mixLines", source: "BL_PACIFIC.dbo.T_RPT_BATCHES", table: "plant_mix_line", mode: "upsert",
    key: { kind: "int", field: "F_ID" },
    columns: [
      { column: "f_id", field: "F_ID", kind: "integer", notNull: true },
      { column: "f_code", field: "F_CODE", kind: "text" },
      { column: "f_date", field: "F_DATE", kind: "timestamp" },
      { column: "product_order", field: "F_PRODUCT_ORDER", kind: "text" },
    ],
  },
  {
    name: "channelOrders",
    source: "BL_PACIFIC.dbo.T_WK_MES_CHANNEL_ORDERS joined to T_AN_WORK_ORDERS (WO_ fields), channels 1-18",
    table: "plant_channel_order", mode: "upsert",
    key: { kind: "int", field: "F_ID" },
    columns: [
      { column: "f_id", field: "F_ID", kind: "integer", notNull: true },
      { column: "work_order_id", field: "F_ID_T_AN_WORK_ORDERS", kind: "integer" },
      { column: "channel", field: "F_ID_T_LS_MES_CHANNELS", kind: "integer" },
      { column: "state", field: "F_ID_T_CO_CHANNEL_ORDER_STATES", kind: "integer" },
      { column: "lud", field: "F_LUD", kind: "timestamp" },
      { column: "line_order", field: "WO_F_ID_T_AN_LINE_ORDERS", kind: "integer" },
      { column: "wo_index", field: "WO_F_INDEX", kind: "integer" },
    ],
  },
  {
    name: "pressSlabs", source: "BL_PACIFIC.dbo.ETLProcessPress01, summarised per slab on the PC",
    table: "plant_press_slab", mode: "upsert",
    key: { kind: "slabCode", field: "slabCode" },
    columns: [
      { column: "slab_code", field: "slabCode", kind: "key", notNull: true },
      { column: "slab_no", field: "slabCode", kind: "slabNo" },
      { column: "first_id", field: "firstId", kind: "bigint" },
      { column: "last_id", field: "lastId", kind: "bigint" },
      { column: "last_at", field: "lastAt", kind: "timestamp" },
    ],
  },
  {
    name: "pressHourly", source: "BL_PACIFIC.dbo.ETLProcessPress03s", table: "plant_press_hourly", mode: "upsert",
    key: { kind: "nonNegative", field: "id" },
    columns: [
      { column: "id", field: "id", kind: "bigint", notNull: true },
      { column: "tag_name", field: "TagName", kind: "text" },
      { column: "stamp", field: "dataTimeStamp", kind: "timestamp" },
    ],
  },
  {
    name: "lineOrders", source: "BL_PACIFIC.dbo.T_AN_LINE_ORDERS", table: "plant_line_order", mode: "upsert",
    key: { kind: "int", field: "F_ID" },
    columns: [
      { column: "f_id", field: "F_ID", kind: "integer", notNull: true },
      { column: "lud", field: "F_LUD", kind: "timestamp" },
      { column: "qty", field: "F_QTY", kind: "integer" },
      { column: "description", field: "F_DESCRIPTION", kind: "text" },
    ],
  },
  {
    name: "settings",
    source: "BL_PACIFIC.dbo.T_WK_FIELD_TAGS (the mapped F_IDs and FR_Press_Phase_Rnn)",
    table: "plant_setting_change", mode: "insertOnly",
    key: { kind: "setting" },
    columns: [
      { column: "f_id", field: "F_ID", kind: "integer", notNull: true },
      { column: "lud", field: "F_LUD", kind: "timestamp", notNull: true },
      { column: "obj_name", field: "F_ObjName", kind: "text" },
      { column: "value_num", field: "F_VALUE_READ", kind: "double" },
      { column: "value_word", field: "F_WORD_Value_READ", kind: "bigint" },
      { column: "value_text", field: "F_String_Value_READ", kind: "text" },
      { column: "observed_at", field: "observedAt", kind: "timestamp" },
    ],
  },
  {
    name: "gevDeploys",
    source: "BL_GEV_PACIFIC.Publisher.DeploymentAudits joined to Publisher.Deployments, DEPLOY audits",
    table: "plant_gev_deploy", mode: "upsert",
    key: { kind: "idText", field: "Id" },
    columns: [
      { column: "audit_id", field: "Id", kind: "key", notNull: true },
      { column: "deployment_id", field: "DeploymentId", kind: "text" },
      { column: "instance_id", field: "InstanceId", kind: "text" },
      { column: "created_on_utc", field: "CreatedOn", kind: "timestamp" },
      { column: "title", field: "Title", kind: "text" },
    ],
  },
];

export const FEED_NAMES: readonly FeedName[] = FEEDS.map((f) => f.name);

/** The feed of that envelope name, or undefined for a name not in section 2. */
export function feedByName(name: string): FeedDef | undefined {
  return FEEDS.find((f) => f.name === name);
}

/* ------------------------------------------------------------ the upload key */

const HEX64 = /^[0-9a-fA-F]{64}$/;
const BEARER = /^Bearer[ \t]+(\S+)[ \t]*$/i;

/** Is PLANT_SYNC_KEY_SHA256 set to something that can be a SHA-256 hex digest?
 *  Unset, blank or malformed, the route refuses everything. */
export function keyConfigured(expectedSha256Hex: string | null | undefined): boolean {
  return typeof expectedSha256Hex === "string" && HEX64.test(expectedSha256Hex.trim());
}

/**
 * PLANT_SYNC_KEY_SHA256 in three states, for the people who have to fix it:
 *   - "unset": not set, or blank. The sync is switched off on purpose; the
 *     quiet alert stays silent.
 *   - "malformed": set, but not 64 hex characters (most likely the whole line
 *     SetKey prints, "PLANT_SYNC_KEY_SHA256 = <hex>", pasted as the value).
 *     The route refuses everything, as for "unset", but this is a mistake,
 *     not a choice: the page says how to fix it and the quiet alert fires
 *     (review, 2 Nov 2026). The value is never repaired here: one exact
 *     accepted form.
 *   - "ok": usable (keyConfigured).
 */
export type KeyState = "unset" | "malformed" | "ok";

export function keyState(expectedSha256Hex: string | null | undefined): KeyState {
  if (typeof expectedSha256Hex !== "string" || !expectedSha256Hex.trim()) return "unset";
  return keyConfigured(expectedSha256Hex) ? "ok" : "malformed";
}

/** Why the ingest route refuses everything while the key is not usable: for
 *  its log line only. The caller is answered a plain 401 "Unauthorized" in
 *  every state (security review, 4 Nov 2026, ingest-2). */
export function keyRefusal(state: Exclude<KeyState, "ok">): string {
  return state === "unset"
    ? "PLANT_SYNC_KEY_SHA256 is not configured"
    : "PLANT_SYNC_KEY_SHA256 is not configured (it is set, but not as 64 hex characters)";
}

/* --------------------------------------------------------------- the clock */

/** The start of the refusal text for a delivery made too far ahead
 *  (clockRefusal): the PC keeps such a file and sends it again. */
export const CLOCK_REFUSAL = "The plant PC's clock is";
/** The start of the refusal text for a fault while storing (the route's
 *  500): the PC keeps the file and sends it again. */
export const FAULT_REFUSAL = "Not stored: a fault in the ERP";

/**
 * How many minutes a naive plant time (pc.madeAt, IST as the PC's clock
 * reads) is ahead of the ERP's own IST clock at `now`; negative when behind.
 * IST is UTC+05:30 all year, so no zone data is needed.
 */
export function minutesAhead(naive: string, now: Date): number | null {
  const t = naiveTs(naive);
  if (t === null) return null;
  const m = NAIVE_TS.exec(t);
  if (!m) return null;
  const madeUtcFields = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]), Number(m[7] ?? 0));
  const istNow = now.getTime() + 330 * 60_000;
  return (madeUtcFields - istNow) / 60_000;
}

/**
 * Why a delivery is refused for its PC clock, or null. read_at is pc.madeAt,
 * and the store lets a read replace a kept row only when it is not older: a
 * PC clock a day ahead would mark rows read "tomorrow", and every true read
 * until then would be dropped as stale, silently and for good (review, 2 Nov
 * 2026). Refused with 409, which the PC treats as "keep the file, stop
 * sending": the files wait, unchanged, until the clock is right. Never
 * capped or repaired here: which of two reads is newer is the PC's word.
 */
export function clockRefusal(madeAt: string, now: Date): string | null {
  const ahead = minutesAhead(madeAt, now);
  if (ahead === null || ahead <= LIMITS.clockAheadMinutes) return null;
  return `${CLOCK_REFUSAL} ${Math.round(ahead)} min ahead of the ERP's (IST): set the PC's clock and time zone `
    + "(India Standard Time); the file is kept on the PC and sent again";
}

/**
 * Does `Authorization: Bearer <key>` carry the key whose SHA-256 is configured?
 *
 * The key is hashed here and the hex compared in constant time
 * (lib/secretEqual.ts), so how long a refusal takes says nothing about how
 * close a guess was. The configured hex is read case-insensitively: SetKey
 * prints it in lower case, but a person pasting it into Vercel may not.
 * False whenever either side is missing.
 */
export function keyAuthorised(authorizationHeader: string | null | undefined, expectedSha256Hex: string | null | undefined): boolean {
  if (!authorizationHeader || !keyConfigured(expectedSha256Hex)) return false;
  const m = BEARER.exec(authorizationHeader);
  if (!m) return false;
  const got = createHash("sha256").update(m[1], "utf8").digest("hex");
  return secretEqual(got, (expectedSha256Hex as string).trim().toLowerCase());
}

/* ------------------------------------------------------------ small checks */

/** A value as the PC may send it in a row: the plant's column, flat. */
export type PlantValue = string | number | boolean | null;
export type PlantRow = Record<string, PlantValue>;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** A NUL, or half of a surrogate pair: text Postgres refuses (a jsonb or text
 *  value with either fails the whole statement). JSON.parse lets both in. */
const UNSTORABLE = /\u0000|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** Can Postgres keep this string as text and inside jsonb? */
export function storable(s: string): boolean {
  return !UNSTORABLE.test(s);
}

/** Length in characters (code points), the way Postgres counts text. */
function chars(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length && (s.charCodeAt(i + 1) & 0xfc00) === 0xdc00) i++;
    n++;
  }
  return n;
}

/** The first `max` characters, never splitting a surrogate pair. */
function cut(s: string, max: number): string {
  return s.length <= max ? s : chars(s) <= max ? s : Array.from(s).slice(0, max).join("");
}

/** UTF-8 length of a string, without allocating it. */
function utf8Bytes(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length && (s.charCodeAt(i + 1) & 0xfc00) === 0xdc00) { n += 4; i++; }
    else n += 3;
  }
  return n;
}

const INT_MIN = -2147483648;
const INT_MAX = 2147483647;

const asInteger = (v: unknown): number | null =>
  typeof v === "number" && Number.isInteger(v) && v >= INT_MIN && v <= INT_MAX ? v : null;
const asBigint = (v: unknown): number | null =>
  typeof v === "number" && Number.isSafeInteger(v) ? v : null;
const asDouble = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/** TEXT: trimmed; empty -> NULL; longer than LIMITS.textChars -> cut there. */
function asText(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? cut(t, LIMITS.textChars) : null;
}

/** INTEGER from a field that is all digits ("10183", "010183", or 10183). A
 *  blank or mixed order (F_MOLDING_ORDER is nchar; 7 slabs had it blank) is NULL. */
function asDigits(v: unknown): number | null {
  if (typeof v === "number") return Number.isInteger(v) && v >= 0 && v <= INT_MAX ? v : null;
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!/^\d{1,10}$/.test(t)) return null;
  const n = Number(t);
  return n <= INT_MAX ? n : null;
}

/**
 * The ERP slab number in a plant slab code: its last 6 digits, the plant's own
 * RIGHT(RTRIM(F_ARTICLE), 6) - "SLAB01000000166391" -> 166391. NULL when the
 * text does not end in 6 digits (the code is then not a slab's).
 */
export function slabNoOf(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const m = /(\d{6})$/.exec(v.trim());
  return m ? Number(m[1]) : null;
}

const NAIVE_TS = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,7}))?$/;

function daysIn(year: number, month: number): number {
  if (month === 2) return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/**
 * A plant time, exactly as the plant wrote it: naive IST (or UTC for GEV's
 * CreatedOn), yyyy-MM-ddTHH:mm:ss with up to 7 fractional digits (datetime2).
 * Returned as yyyy-MM-ddTHH:mm:ss.fff, the fraction CUT (not rounded) to the
 * 3 digits TIMESTAMP(3) keeps, so the cast cannot round into the next second.
 *
 * The calendar is checked as well as the pattern: 2026-02-30 or 24:00:00
 * match the pattern and would fail the cast, taking the feed's whole
 * statement with them. Seconds stop at 59 (Postgres reads :60 as the next
 * minute, which is not what the plant wrote). NULL for anything else.
 */
export function naiveTs(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = NAIVE_TS.exec(v);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = [m[1], m[2], m[3], m[4], m[5], m[6]].map(Number);
  if (y < 1 || mo < 1 || mo > 12 || d < 1 || d > daysIn(y, mo) || h > 23 || mi > 59 || s > 59) return null;
  const frac = (m[7] ?? "").slice(0, 3).padEnd(3, "0");
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}.${frac}`;
}

/* --------------------------------------------------------- canonical JSON */

/**
 * JSON with every object's keys sorted, so the same row hashes the same
 * whichever order the PC wrote its fields in. Arrays keep their order.
 * Anything JSON.stringify cannot write (undefined) is null in an array and
 * left out of an object, as JSON.stringify itself does.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const s = JSON.stringify(value);
    return s === undefined ? "null" : s;
  }
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(",")}]`;
  const o = value as Record<string, unknown>;
  const parts: string[] = [];
  for (const k of Object.keys(o).sort()) {
    if (o[k] === undefined) continue;
    parts.push(`${JSON.stringify(k)}:${canonicalJson(o[k])}`);
  }
  return `{${parts.join(",")}}`;
}

const sha256Hex = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

/** row_hash: SHA-256 hex of the row's canonical JSON. A re-read of a row that
 *  did not change hashes the same, and the store writes nothing for it. */
export function rowHash(row: unknown): string {
  return sha256Hex(canonicalJson(row));
}

/* ------------------------------------------------------------------- keys */

type KeyResult = { ok: true; key: string } | { ok: false; reason: string };

const missing = (v: unknown) => v === undefined || v === null;

/**
 * A panel setting's key: "<F_ID>|<F_LUD>|<sig>", sig the first 16 hex of the
 * SHA-256 of [F_VALUE_READ, F_WORD_Value_READ, F_String_Value_READ] as
 * canonical JSON. One row per value the panel held at that F_LUD: F_LUD can
 * move without the value changing and the value is all that matters, so both
 * are in the key, and observedAt (when the PC happened to look) is not - a
 * resend, or a second look at an unchanged field, lands on the same key.
 * F_LUD is taken as naiveTs gives it, so .123 and .1230000 are one key.
 * NULL when F_ID or F_LUD is not usable.
 */
export function settingKey(row: Record<string, unknown>): string | null {
  const id = asInteger(row.F_ID);
  const lud = naiveTs(row.F_LUD);
  if (id === null || lud === null) return null;
  const v = (k: string) => (row[k] === undefined ? null : row[k]);
  const sig = sha256Hex(canonicalJson([v("F_VALUE_READ"), v("F_WORD_Value_READ"), v("F_String_Value_READ")])).slice(0, 16);
  return `${id}|${lud}|${sig}`;
}

/** The row's plant_key under its feed's rule, or why it has none. */
export function keyOf(rule: KeyRule, row: Record<string, unknown>): KeyResult {
  switch (rule.kind) {
    case "int": {
      const v = row[rule.field];
      if (missing(v)) return { ok: false, reason: `${rule.field} is missing` };
      const n = asInteger(v);
      return n === null ? { ok: false, reason: `${rule.field} is not a whole number in the INTEGER range` } : { ok: true, key: String(n) };
    }
    case "nonNegative": {
      const v = row[rule.field];
      if (missing(v)) return { ok: false, reason: `${rule.field} is missing` };
      const n = asBigint(v);
      return n === null || n < 0 ? { ok: false, reason: `${rule.field} is not a non-negative safe integer` } : { ok: true, key: String(n) };
    }
    case "slabCode": {
      const v = row[rule.field];
      if (missing(v)) return { ok: false, reason: `${rule.field} is missing` };
      if (typeof v !== "string") return { ok: false, reason: `${rule.field} is not a string` };
      const t = v.trim();
      if (!t) return { ok: false, reason: `${rule.field} is empty` };
      if (chars(t) > LIMITS.slabCodeChars) return { ok: false, reason: `${rule.field} is longer than ${LIMITS.slabCodeChars} characters` };
      return { ok: true, key: t };
    }
    case "idText": {
      const v = row[rule.field];
      if (missing(v)) return { ok: false, reason: `${rule.field} is missing` };
      if (typeof v === "number") {
        return Number.isSafeInteger(v) ? { ok: true, key: String(v) } : { ok: false, reason: `${rule.field} is a number but not a safe integer` };
      }
      if (typeof v !== "string") return { ok: false, reason: `${rule.field} is neither a string nor an integer` };
      const t = v.trim();
      if (!t) return { ok: false, reason: `${rule.field} is empty` };
      if (chars(t) > LIMITS.gevIdChars) return { ok: false, reason: `${rule.field} is longer than ${LIMITS.gevIdChars} characters` };
      return { ok: true, key: t };
    }
    case "setting": {
      if (missing(row.F_ID)) return { ok: false, reason: "F_ID is missing" };
      if (asInteger(row.F_ID) === null) return { ok: false, reason: "F_ID is not a whole number in the INTEGER range" };
      if (missing(row.F_LUD)) return { ok: false, reason: "F_LUD is missing" };
      const key = settingKey(row);
      return key === null ? { ok: false, reason: "F_LUD is not a plant time (yyyy-MM-ddTHH:mm:ss[.fffffff])" } : { ok: true, key };
    }
  }
}

/* --------------------------------------------------------------- envelope */

export interface PcInfo {
  host: string;
  script: string;
  /** As the PC wrote them (plant_sync_post.pc_made_at keeps madeAt so). */
  madeAt: string;
  sentAt: string;
}

export interface PcError { feed: string; at: string; message: string }

export interface Latch { since: string; message: string; number?: number }

export interface Envelope {
  v: 1;
  batchId: string;
  kind: "data" | "heartbeat";
  pc: PcInfo;
  /** pc.madeAt as naiveTs gives it: each row's read_at. */
  readAt: string;
  feeds: Partial<Record<FeedName, PlantRow[]>>;
  cursors: Record<string, PlantValue> | null;
  errors: PcError[];
  latch: Latch | null;
  outbox: number | null;
  test: boolean;
  /** Rows across every feed, as posted. */
  rowsIn: number;
}

export type ParsedEnvelope = { ok: true; envelope: Envelope } | { ok: false; error: string };

const TOP_LEVEL = new Set(["v", "batchId", "kind", "pc", "feeds", "cursors", "errors", "latch", "outbox", "test"]);

/** A name from the body, said back only when it is a plain word: a refusal
 *  names the field it is about without echoing anything else the PC sent. */
const sayName = (k: string) => (/^[A-Za-z0-9_]{1,40}$/.test(k) ? `"${k}"` : "(a field with an unusual name)");

/** A short string of at most `max` characters that Postgres can keep. */
function shortText(v: unknown, max: number, allowEmpty = false): string | null {
  if (typeof v !== "string" || !storable(v)) return null;
  if (!allowEmpty && !v.trim()) return null;
  return chars(v) <= max ? v : null;
}

/**
 * Is this body an envelope of contract v1 (spec section 1)? The first problem
 * found is the answer's error; nothing in it repeats a value the PC sent.
 *
 * Strict at the top level (an unknown field is a PC on another contract, and
 * is refused so that a person sees it), lenient inside pc / errors / latch
 * (a field the contract does not name there is left out, not refused: a
 * heartbeat that reports a login latch must not be turned away for carrying
 * one more detail).
 */
export function parseEnvelope(body: unknown): ParsedEnvelope {
  const no = (error: string): ParsedEnvelope => ({ ok: false, error });
  if (!isObject(body)) return no("the body is not a JSON object");
  for (const k of Object.keys(body)) if (!TOP_LEVEL.has(k)) return no(`unknown field ${sayName(k)} (contract v1)`);

  if (body.v !== 1) return no("v must be 1");
  if (typeof body.batchId !== "string" || !BATCH_ID.test(body.batchId)) return no("batchId must be 8-64 characters of A-Z, a-z, 0-9 and -");
  if (body.kind !== "data" && body.kind !== "heartbeat") return no('kind must be "data" or "heartbeat"');

  // pc: who sent it, and when it read what it sends.
  if (!isObject(body.pc)) return no("pc is missing");
  const host = shortText(body.pc.host, LIMITS.pcChars);
  if (host === null) return no(`pc.host must be a non-empty string of at most ${LIMITS.pcChars} characters`);
  const script = shortText(body.pc.script, LIMITS.pcChars);
  if (script === null) return no(`pc.script must be a non-empty string of at most ${LIMITS.pcChars} characters`);
  const readAt = naiveTs(body.pc.madeAt);
  if (readAt === null) return no("pc.madeAt must be a plant time yyyy-MM-ddTHH:mm:ss.fff");
  if (naiveTs(body.pc.sentAt) === null) return no("pc.sentAt must be a plant time yyyy-MM-ddTHH:mm:ss.fff");

  // feeds: only the names of section 2, each a list of flat rows, inside the limits.
  const feeds: Partial<Record<FeedName, PlantRow[]>> = {};
  let rowsIn = 0;
  if (body.feeds !== undefined && body.feeds !== null) {
    if (!isObject(body.feeds)) return no("feeds must be an object of feed name -> rows");
    for (const [name, rows] of Object.entries(body.feeds)) {
      const feed = feedByName(name);
      if (!feed) return no(`feeds: ${sayName(name)} is not a feed (the feeds are ${FEED_NAMES.join(", ")})`);
      if (!Array.isArray(rows)) return no(`feeds.${name} must be a list of rows`);
      if (rows.length > LIMITS.rowsPerFeed) return no(`feeds.${name} has more than ${LIMITS.rowsPerFeed} rows`);
      rowsIn += rows.length;
      if (rowsIn > LIMITS.rowsPerPost) return no(`the post has more than ${LIMITS.rowsPerPost} rows`);
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const at = `feeds.${name}[${i}]`;
        if (!isObject(row)) return no(`${at} is not an object`);
        const keys = Object.keys(row);
        if (keys.length > LIMITS.keysPerRow) return no(`${at} has more than ${LIMITS.keysPerRow} fields`);
        for (const k of keys) {
          const v = row[k];
          if (v !== null && typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean") {
            return no(`${at}: a value is not a string, number, boolean or null (rows are flat)`);
          }
        }
        if (utf8Bytes(JSON.stringify(row)) > LIMITS.rowBytes) return no(`${at} is larger than ${LIMITS.rowBytes} bytes as JSON`);
      }
      feeds[feed.name] = rows as PlantRow[];
    }
  }
  if (body.kind === "heartbeat" && rowsIn > 0) return no("a heartbeat carries no rows");

  // cursors: informational, shown on the health page.
  let cursors: Record<string, PlantValue> | null = null;
  if (body.cursors !== undefined && body.cursors !== null) {
    if (!isObject(body.cursors)) return no("cursors must be an object");
    const entries = Object.entries(body.cursors);
    if (entries.length > LIMITS.cursors) return no(`cursors has more than ${LIMITS.cursors} entries`);
    cursors = {};
    for (const [k, v] of entries) {
      if (shortText(k, LIMITS.cursorNameChars) === null) return no(`cursors: a name is empty or longer than ${LIMITS.cursorNameChars} characters`);
      const fine = v === null || typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v))
        || (typeof v === "string" && shortText(v, LIMITS.cursorValueChars, true) !== null);
      if (!fine) return no(`cursors.${sayName(k)} must be a number, a string of at most ${LIMITS.cursorValueChars} characters, a boolean or null`);
      cursors[k] = v as PlantValue;
    }
  }

  // errors: what went wrong on the PC this run, per feed.
  const errors: PcError[] = [];
  if (body.errors !== undefined && body.errors !== null) {
    if (!Array.isArray(body.errors)) return no("errors must be a list");
    if (body.errors.length > LIMITS.errors) return no(`errors has more than ${LIMITS.errors} entries`);
    for (let i = 0; i < body.errors.length; i++) {
      const e = body.errors[i];
      if (!isObject(e)) return no(`errors[${i}] is not an object`);
      const feed = shortText(e.feed, LIMITS.errorFeedChars);
      if (feed === null) return no(`errors[${i}].feed must be a non-empty string of at most ${LIMITS.errorFeedChars} characters`);
      const at = naiveTs(e.at);
      if (at === null) return no(`errors[${i}].at must be a plant time yyyy-MM-ddTHH:mm:ss.fff`);
      const message = shortText(e.message, LIMITS.messageChars, true);
      if (message === null) return no(`errors[${i}].message must be a string of at most ${LIMITS.messageChars} characters`);
      errors.push({ feed, at: e.at as string, message });
    }
  }

  // latch: the plant login failed once and is not being tried again.
  let latch: Latch | null = null;
  if (body.latch !== undefined && body.latch !== null) {
    if (!isObject(body.latch)) return no("latch must be null or an object");
    if (naiveTs(body.latch.since) === null) return no("latch.since must be a plant time yyyy-MM-ddTHH:mm:ss.fff");
    const message = shortText(body.latch.message, LIMITS.messageChars, true);
    if (message === null) return no(`latch.message must be a string of at most ${LIMITS.messageChars} characters`);
    latch = { since: body.latch.since as string, message };
    // The SQL error number the PC's latch file keeps (18456...), when sent.
    if (asInteger(body.latch.number) !== null) latch.number = body.latch.number as number;
  }

  let outbox: number | null = null;
  if (body.outbox !== undefined && body.outbox !== null) {
    if (asInteger(body.outbox) === null || (body.outbox as number) < 0) return no("outbox must be a whole number, 0 or more");
    outbox = body.outbox as number;
  }

  if (body.test !== undefined && typeof body.test !== "boolean") return no("test must be true or false");

  return {
    ok: true,
    envelope: {
      v: 1,
      batchId: body.batchId,
      kind: body.kind,
      pc: { host, script, madeAt: body.pc.madeAt as string, sentAt: body.pc.sentAt as string },
      readAt,
      feeds,
      cursors,
      errors,
      latch,
      outbox,
      test: body.test === true,
      rowsIn,
    },
  };
}

/** What a refusal row can say about a body that was not a valid envelope:
 *  whatever of it is readable and safe to keep, nothing else. */
export interface RefusalFacts {
  batchId: string | null;
  kind: "data" | "heartbeat" | null;
  test: boolean;
  pcHost: string | null;
  pcScript: string | null;
  pcMadeAt: string | null;
  rowsIn: number;
}

export function refusalFacts(body: unknown): RefusalFacts {
  const b = isObject(body) ? body : {};
  const pc = isObject(b.pc) ? b.pc : {};
  const keep = (v: unknown, max: number) => (typeof v === "string" && storable(v) && v.trim() ? cut(v, max) : null);
  let rowsIn = 0;
  if (isObject(b.feeds)) for (const rows of Object.values(b.feeds)) if (Array.isArray(rows)) rowsIn += rows.length;
  return {
    batchId: typeof b.batchId === "string" && BATCH_ID.test(b.batchId) ? b.batchId : null,
    kind: b.kind === "data" || b.kind === "heartbeat" ? b.kind : null,
    test: b.test === true,
    pcHost: keep(pc.host, LIMITS.pcChars),
    pcScript: keep(pc.script, LIMITS.pcChars),
    pcMadeAt: keep(pc.madeAt, 40),
    rowsIn: Math.min(rowsIn, INT_MAX),
  };
}

/* ------------------------------------------------------------ preparation */

/** One row, ready for the store: its key, the row as sent, its hash, when the
 *  PC read it, and each typed column's value, already proven castable. */
export interface PreparedRow {
  key: string;
  hash: string;
  data: PlantRow;
  readAt: string | null;
  values: Record<string, number | string | null>;
}

export interface Rejection { index: number; reason: string }

/** Does the row hold anything Postgres cannot keep in jsonb? JSON.parse gives
 *  Infinity for 1e999, and lets NUL and lone surrogates through. */
function unstorableRow(row: Record<string, unknown>): boolean {
  for (const k of Object.keys(row)) {
    if (!storable(k)) return true;
    const v = row[k];
    if (typeof v === "string" && !storable(v)) return true;
    if (typeof v === "number" && !Number.isFinite(v)) return true;
  }
  return false;
}

function typedValue(col: FeedColumn, row: Record<string, unknown>, key: string): number | string | null {
  const v = row[col.field];
  switch (col.kind) {
    case "integer": return asInteger(v);
    case "bigint": return asBigint(v);
    case "double": return asDouble(v);
    case "text": return asText(v);
    case "timestamp": return naiveTs(v);
    case "slabNo": return slabNoOf(v);
    case "digits": return asDigits(v);
    case "key": return key;
  }
}

/**
 * A feed's rows, ready to write: each row keyed, typed and hashed, rows with
 * no usable key rejected (with their index in the feed and why), and a key
 * that appears twice kept once - the LAST occurrence, the PC's latest read of
 * it. Twice in one statement would fail it: ON CONFLICT DO UPDATE cannot
 * touch the same row twice. Rows come back sorted by key, so two deliveries
 * that share rows lock them in the same order.
 */
export function prepareFeed(feed: FeedDef | FeedName, rows: readonly unknown[], readAt: string | null): { rows: PreparedRow[]; rejected: Rejection[] } {
  const def = typeof feed === "string" ? feedByName(feed) : feed;
  if (!def) throw new Error(`plantSync: no feed named ${String(feed)}`);
  const read = naiveTs(readAt);
  const byKey = new Map<string, PreparedRow>();
  const rejected: Rejection[] = [];
  rows.forEach((row, index) => {
    if (!isObject(row)) { rejected.push({ index, reason: "the row is not an object" }); return; }
    if (unstorableRow(row)) {
      rejected.push({ index, reason: "the row holds a value the database cannot keep (a NUL character, half a surrogate pair or a number out of range)" });
      return;
    }
    const k = keyOf(def.key, row);
    if (!k.ok) { rejected.push({ index, reason: k.reason }); return; }
    const values: Record<string, number | string | null> = {};
    for (const col of def.columns) values[col.column] = typedValue(col, row, k.key);
    byKey.delete(k.key);
    byKey.set(k.key, { key: k.key, hash: rowHash(row), data: row as PlantRow, readAt: read, values });
  });
  const prepared = [...byKey.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return { rows: prepared, rejected };
}

/* ------------------------------------------------------------ the answer */

export interface FeedCounts { received: number; inserted: number; updated: number; unchanged: number; rejected: number }

/** unchanged is what is left: rows that were already there as sent, rows an
 *  older read could not overwrite, and repeats of a key inside the post. */
export function feedCounts(received: number, rejected: number, inserted: number, updated: number): FeedCounts {
  return { received, inserted, updated, unchanged: Math.max(0, received - rejected - inserted - updated), rejected };
}

/* -------------------------------------------------------------- the body */

/**
 * Read a request body as UTF-8 text, stopping as soon as it passes `limit`
 * bytes: content-length can be absent (a chunked upload), so the cap has to
 * hold on what is actually read, not only on what was declared. "tooBig" past
 * the limit, "notUtf8" for bytes that are not UTF-8 (the contract says
 * charset=utf-8; a Windows code page would turn names into nonsense).
 */
export async function readBodyCapped(
  body: ReadableStream<Uint8Array> | null,
  limit: number,
): Promise<{ ok: true; text: string; bytes: number } | { ok: false; why: "tooBig" | "notUtf8"; bytes: number }> {
  if (!body) return { ok: true, text: "", bytes: 0 };
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > limit) {
      await reader.cancel().catch(() => {});
      return { ok: false, why: "tooBig", bytes };
    }
    chunks.push(value);
  }
  const all = new Uint8Array(bytes);
  let at = 0;
  for (const c of chunks) { all.set(c, at); at += c.byteLength; }
  try {
    return { ok: true, text: new TextDecoder("utf-8", { fatal: true }).decode(all), bytes };
  } catch {
    return { ok: false, why: "notUtf8", bytes };
  }
}
