import { colleges, type CollegeId } from "./colleges.ts";

// 空数组：未选择且无结果；all：明确选择全部学院；非空数组：自选学院。
export type CollegeSelection = CollegeId[] | "all";

// 选择顺序与目录一致；选满也保持自选，不把数组折叠为 all。
export function normalizeCollegeSelection(
  selection: readonly string[] | "all",
): CollegeSelection {
  return selection === "all"
    ? "all"
    : colleges
        .filter((college) => selection.includes(college.id))
        .map((college) => college.id);
}

export function toggleCollegeSelection(
  selection: CollegeSelection,
  id: CollegeId,
): CollegeSelection {
  const ids = selection === "all" ? [] : selection;
  return normalizeCollegeSelection(
    ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id],
  );
}
