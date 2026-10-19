import type { CompetitionDetail } from "@hehuoda/api-types";
import { parseBusinessId } from "./params.ts";

/** 选择器使用渲染索引，不将外部 stage 参数直接拼进 CSS 选择器。 */
export function resolveStageTarget(detail: CompetitionDetail, raw: unknown) {
  if (raw === undefined || raw === null) return { selector: null, message: "" };
  const stage = parseBusinessId(raw);
  const index = stage.issue
    ? -1
    : detail.stages.findIndex((s) => s.id === stage.value);
  return index < 0
    ? {
        selector: null,
        message: "指定赛段不存在或定位参数无效，以下仍展示完整比赛详情。",
      }
    : { selector: `#competition-stage-${index}`, message: "" };
}
