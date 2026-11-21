import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// THE DESIGN AND PROGRAM MASTERS HAVE NO PATCH — code review of 20 Oct 2026,
// ROBO-3, removed by the owner's decision of the same day.
//
// PATCH /api/robo/designs/[id] and /api/robo/programs/[id] handed the request
// body to prisma.update() as it arrived. Any Robo session could send a nested
// write through the relations — {"batchRecipes":{"updateMany":{...}}} rewrote
// the batch number and date of every setup of a design; {"productionRecords":
// {"deleteMany":{}}} under a setup deleted its slabs — with no action_log entry
// and no restore. No screen called either: the masters only add and delete.
// This pins that they are gone, that the screens still use only what is left,
// and that no Robo route passes a request body straight to Prisma.

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p: string) => readFileSync(join(ROOT, p), "utf8").replace(/\r\n/g, "\n");
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const walk = (rel: string): string[] =>
  readdirSync(join(ROOT, rel)).flatMap((f) => {
    const p = join(rel, f);
    return statSync(join(ROOT, p)).isDirectory() ? walk(p) : f === "route.ts" ? [p] : [];
  });

const DESIGN = "src/app/api/robo/designs/[id]/route.ts";
const PROGRAM = "src/app/api/robo/programs/[id]/route.ts";

test("the design and program [id] routes export DELETE and nothing that writes a body", () => {
  for (const file of [DESIGN, PROGRAM]) {
    const src = code(read(file));
    const verbs = [...src.matchAll(/^export (?:async function|const) (GET|POST|PUT|PATCH|DELETE)\b/gm)].map((m) => m[1]);
    assert.deepEqual(verbs, ["DELETE"], `${file} exports ${verbs.join(", ")}`);
    assert.doesNotMatch(src, /req\.json\(\)/, `${file} reads no request body`);
    assert.doesNotMatch(src, /\.(roboDesign|roboProgram)\.update\(/, `${file} updates no master row`);
  }
});

test("the masters' screens call those routes only to delete", () => {
  for (const [screen, path] of [
    ["src/components/robo/masters/DesignsMaster.tsx", "/api/robo/designs/"],
    ["src/components/robo/masters/ProgramsMaster.tsx", "/api/robo/programs/"],
  ] as const) {
    const src = read(screen);
    const calls = [...src.matchAll(/fetch\(`([^`]+)`,\s*\{\s*method:\s*"(\w+)"/g)].filter((m) => m[1].startsWith(path));
    assert.ok(calls.length > 0, `${screen} still deletes through ${path}`);
    for (const [, url, method] of calls) assert.equal(method, "DELETE", `${screen} ${method} ${url}`);
  }
  // And nothing else in the app sends a PATCH to either.
  const everywhere = (dir: string): string[] =>
    readdirSync(join(ROOT, dir)).flatMap((f) => {
      const p = join(dir, f);
      return statSync(join(ROOT, p)).isDirectory() ? everywhere(p) : /\.tsx?$/.test(f) ? [p] : [];
    });
  for (const file of everywhere("src")) {
    const src = read(file);
    assert.doesNotMatch(src, /\/api\/robo\/(designs|programs)\/\$\{[^}]+\}`,\s*\{\s*method:\s*"PATCH"/, file);
  }
});

test("no /api/robo route hands a request body to Prisma as it arrived", () => {
  const routes = walk("src/app/api/robo");
  assert.ok(routes.length >= 30, `found ${routes.length}`);
  for (const file of routes) {
    assert.doesNotMatch(code(read(file)), /data:\s*await req\.json\(\)/, file);
  }
});
