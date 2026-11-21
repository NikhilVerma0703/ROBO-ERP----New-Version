import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// EVERY /api/robo HANDLER CALLS roboGate() — code review 20 Oct 2026, ROBO-5.
//
// The edge middleware decides /api/robo from the JWT alone, without the
// database, so a ROBO login that has been deactivated, or signed out of every
// device (sessionVersion bumped), keeps passing it for the rest of an 8-hour
// token. roboGate (lib/rbac.ts) re-reads the session through currentUser() and
// refuses it. Four GETs never called it — qc-rejections, reports/hourly,
// reference/summary and batch-numbers — and kept answering production and QC
// data to revoked sessions. This sweeps the whole tree, so a fifth route added
// without the gate fails here rather than in a review.

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const walk = (rel: string): string[] =>
  readdirSync(join(ROOT, rel)).flatMap((f) => {
    const p = join(rel, f);
    return statSync(join(ROOT, p)).isDirectory() ? walk(p) : f === "route.ts" ? [p] : [];
  });
const read = (p: string) => readFileSync(join(ROOT, p), "utf8").replace(/\r\n/g, "\n");

const ROUTES = walk("src/app/api/robo");
const VERBS = /^export async function (GET|POST|PUT|PATCH|DELETE)\(/gm;

test("the sweep finds the robo routes, the four from ROBO-5 among them", () => {
  assert.ok(ROUTES.length >= 30, `found ${ROUTES.length}`);
  for (const r of ["qc-rejections", "reports/hourly", "reference/summary", "batch-numbers"]) {
    assert.ok(ROUTES.includes(join("src/app/api/robo", r, "route.ts")), r);
  }
});

test("every exported handler asks roboGate() before anything else it does", () => {
  for (const file of ROUTES) {
    const src = read(file);
    const starts = [...src.matchAll(VERBS)].map((m) => m.index!);
    if (!starts.length) {
      // One shared handler exported under each verb (attendance's catch-all):
      // the gate is in the one function they all are.
      assert.match(src, /^export const (GET|POST|PUT|PATCH|DELETE) = (\w+);$/m, `${file} exports its handlers somehow`);
      assert.match(src, /const refused = await roboGate\(\);\n\s+if \(refused\) return refused;/, `${file} gates its shared handler`);
      continue;
    }
    starts.forEach((at, i) => {
      const body = src.slice(at, starts[i + 1] ?? undefined);
      const name = /function (\w+)/.exec(body)![1];
      const gate = body.indexOf("const refused = await roboGate();\n");
      assert.ok(gate > 0, `${file} ${name} must call roboGate()`);
      assert.match(body.slice(gate), /^const refused = await roboGate\(\);\n\s+if \(refused\) return refused;/, `${file} ${name} returns the refusal`);
      // Nothing touches the database, or reads the request, before the gate.
      const before = body.slice(0, gate);
      assert.doesNotMatch(before, /prisma\.|await (?!roboGate)|searchParams/, `${file} ${name} does work before the gate`);
    });
  }
});
