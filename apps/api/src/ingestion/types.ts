import type {
  CandidateFields as NoticeFields,
  ParsedCandidate as NoticeCandidate,
} from "@hehuoda/sicau-connectors/notices";
import type { TimeValue } from "../competitions/competition.model.js";

// 持久化候选使用 API 自有时间模型，保持既有审核文件结构。
export type CandidateFields = Omit<
  NoticeFields,
  "startsAt" | "deadline" | "materialsAt" | "eventAt"
> & {
  startsAt: TimeValue;
  deadline: TimeValue;
  materialsAt: TimeValue;
  eventAt: TimeValue;
};
export type ParsedCandidate = Omit<NoticeCandidate, "fields"> & {
  fields: CandidateFields;
};

/** 历史候选（v1）在读取时显式归一，不猜测缺失字段。 */
export type CandidateContract = "candidate-fields-v2";

export function digestInput(value: unknown): string {
  return JSON.stringify(canonical(value));
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value))
    return value
      .map(canonical)
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)]),
    );
  return value;
}
