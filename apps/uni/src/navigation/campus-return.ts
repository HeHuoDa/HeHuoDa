import { parseBusinessId } from "./params.ts";

/** 仅恢复页面位置；永不接受任意 URL 或自动执行原业务动作。 */
export function campusReturnTarget(
  query: Record<string, unknown>,
): { name: "team-new" | "team-detail"; id?: string } | null {
  if (query.returnTo === "team-new") return { name: "team-new" };
  if (query.returnTo === "team-detail") {
    const result = parseBusinessId(query.teamId);
    if (result.value && !result.issue)
      return { name: "team-detail", id: result.value };
  }
  return null;
}
