import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  cleanMasterName, duplicateNameError, isUniqueViolation, missingNameError,
} from "../src/lib/robo/masterNames.ts";

// CR-002 (20 Nov 2026): adding a name already on a master list (Tools, Liquids,
// Powders, Designs, Programs) came back as a bare HTTP 500, and the Master
// Lists screens did not say anything. It is now a 409 with a sentence, as
// Delay Codes always was, and the screens show it.

const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("a name is stored trimmed, and anything that is not text is empty", () => {
  assert.equal(cleanMasterName("  BOAT 120 "), "BOAT 120");
  assert.equal(cleanMasterName(""), "");
  assert.equal(cleanMasterName(undefined), "");
  assert.equal(cleanMasterName(42), "");
});

test("the refusals are sentences that name what was refused", () => {
  assert.equal(duplicateNameError("tool", "BOAT 120"), 'A tool named "BOAT 120" already exists.');
  assert.equal(missingNameError("liquid"), "Enter the liquid name.");
});

test("only Prisma's unique-constraint code reads as a duplicate", () => {
  assert.equal(isUniqueViolation({ code: "P2002" }), true);
  assert.equal(isUniqueViolation({ code: "P2003" }), false);
  assert.equal(isUniqueViolation(new Error("x")), false);
  assert.equal(isUniqueViolation(null), false);
});

for (const [route, model, kind] of [
  ["tools", "roboTool", "tool"],
  ["liquids", "roboLiquid", "liquid"],
  ["powders", "roboPowder", "powder"],
  ["designs", "roboDesign", "design"],
  ["programs", "roboProgram", "program"],
] as const) {
  test(`POST /api/robo/${route} answers a duplicate with 409, before and during the create`, () => {
    const s = src(`src/app/api/robo/${route}/route.ts`);
    const post = s.slice(s.indexOf("export async function POST("));
    assert.ok(post.indexOf("await roboGate()") >= 0 && post.indexOf("await roboGate()") < post.indexOf("findUnique"), "the module gate still comes first");
    assert.match(post, new RegExp(`prisma\\.${model}\\.findUnique\\(\\{ where: \\{ name \\} \\}\\)`));
    assert.match(post, new RegExp(`duplicateNameError\\("${kind}", name\\) \\}, \\{ status: 409 \\}`));
    assert.match(post, /if \(isUniqueViolation\(e\)\) return/, "a create that loses the race is a 409 too");
    assert.match(post, new RegExp(`missingNameError\\("${kind}"\\) \\}, \\{ status: 400 \\}`));
  });
}

test("a program must name a design that exists", () => {
  const s = src("src/app/api/robo/programs/route.ts");
  assert.match(s, /Pick the design this program belongs to\./);
});

test("the Master Lists screens show why an add was refused and keep what was typed", () => {
  for (const p of ["SimpleListMaster", "DesignsMaster", "ProgramsMaster"]) {
    const s = src(`src/components/robo/masters/${p}.tsx`);
    const add = s.slice(s.indexOf("const add = async"), s.indexOf("const del = async"));
    assert.match(add, /const res = await fetch\(/, p);
    assert.match(add, /if \(!res\.ok\) \{[\s\S]*setError\(data\.error \|\| "Could not add this /, p);
    assert.ok(add.indexOf("if (!res.ok)") < add.indexOf("setName(\"\")") || add.indexOf("if (!res.ok)") < add.indexOf("setForm("), `${p}: the typed name is cleared only after a success`);
  }
});
