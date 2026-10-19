import assert from "node:assert/strict";
import { test } from "node:test";
import { colleges } from "../src/colleges.ts";
import {
  normalizeCollegeSelection,
  toggleCollegeSelection,
} from "../src/college-selection.ts";

test("学院选择三态独立，规范化按目录去重并清理未知 ID，不修改输入", () => {
  const input = ["law", "missing", "agriculture", "law"];
  assert.equal(normalizeCollegeSelection("all"), "all");
  assert.deepEqual(normalizeCollegeSelection([]), []);
  assert.deepEqual(normalizeCollegeSelection(input), ["agriculture", "law"]);
  assert.deepEqual(input, ["law", "missing", "agriculture", "law"]);
  assert.deepEqual(normalizeCollegeSelection(["missing"]), []);
});

test("全部转单院，多选转空，逐个选满仍是自选", () => {
  assert.deepEqual(toggleCollegeSelection("all", "law"), ["law"]);
  assert.deepEqual(toggleCollegeSelection(["law"], "law"), []);
  let selection = [];
  for (const college of [...colleges].reverse())
    selection = toggleCollegeSelection(selection, college.id);
  assert.deepEqual(
    selection,
    colleges.map((college) => college.id),
  );
});
