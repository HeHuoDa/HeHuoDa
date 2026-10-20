import type { InjectionKey } from "vue";
import type { College } from "@hehuoda/api-types";
import type { CompetitionPatch, ImportPatch, PreviewReceipt } from "./review";
import { validDate, safeSourceUrl } from "./review";
import type { PageQuery, PageResult } from "./resource";
import { queryPage } from "./resource";
import { ServiceUnavailable } from "../services";

// #38 尚未提供 HTTP 契约；此处仅为页面模型，不是生成 DTO。
export type CompetitionAction = "save" | "publish" | "hide";
export interface ManagedCompetition {
  id: string;
  title: string;
  status: string;
  date: string;
  baseline: string;
  content: CompetitionPatch;
}
export interface CompetitionService {
  list(query: PageQuery): Promise<PageResult<ManagedCompetition>>;
  detail(id: string): Promise<ManagedCompetition>;
  preview(
    content: CompetitionPatch,
    baseline: string,
    action: CompetitionAction,
  ): Promise<PreviewReceipt>;
  change(input: {
    content: CompetitionPatch;
    patch: ImportPatch;
    baseline: string;
    action: CompetitionAction;
    reason: string;
    operationId: string;
    receipt?: PreviewReceipt;
    confirmPublished: boolean;
  }): Promise<void>;
}
export const competitionKey: InjectionKey<CompetitionService> =
  Symbol("competitions");
export const publicationStates = {
  draft: "草稿",
  published: "已发布",
  hidden: "已隐藏",
};
export function emptyCompetition(): CompetitionPatch {
  return {
    id: "",
    name: "",
    edition: "",
    category: "",
    organizer: "",
    origin: "official",
    publication: "draft",
    stages: [],
    tracks: [],
    notices: [],
  };
}
export function competitionPatch(
  after: CompetitionPatch,
  before: CompetitionPatch | null,
): ImportPatch {
  const patch: ImportPatch = { id: after.id };
  for (const key of Object.keys(after) as (keyof CompetitionPatch)[])
    if (!before || JSON.stringify(after[key]) !== JSON.stringify(before[key]))
      Object.assign(patch, { [key]: structuredClone(after[key]) });
  return patch;
}
export function validateCompetition(
  value: CompetitionPatch,
  colleges: College[],
  action: CompetitionAction = "save",
): { field: string; message: string } | null {
  const id = (v: string) =>
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v) && v.length <= 100;
  if (!id(value.id))
    return {
      field: "id",
      message: "ID 须为不超过100字的小写英文、数字与连字符。",
    };
  if (!value.name.trim()) return { field: "name", message: "请填写比赛名称。" };
  if (
    action === "publish" &&
    (!value.stages.length ||
      !value.tracks.length ||
      !value.notices.length ||
      value.stages.some((s) => !s.sourceIds.length) ||
      value.notices.some((n) => !n.checkedAt))
  )
    return {
      field: "relations",
      message: "发布前请补齐赛段、赛道、本届来源关联与人工核对日期。",
    };
  if (JSON.stringify(value).match(/[<>]/))
    return { field: "name", message: "文本不能含 HTML 标记。" };
  const known = new Set(colleges.map((c) => c.id));
  for (const group of [value.stages, value.tracks, value.notices])
    if (
      group.some((v) => !id(v.id)) ||
      new Set(group.map((v) => v.id)).size !== group.length
    )
      return {
        field: "relations",
        message: "赛段、赛道和来源各自须有合法、唯一的 ID。",
      };
  for (const stage of value.stages) {
    if (!Number.isInteger(stage.order) || stage.order < 0)
      return { field: "relations", message: "赛段排序须为非负整数。" };
    if (!stage.name.trim())
      return { field: "relations", message: "请填写赛段名称。" };
    if (stage.sourceIds.some((v) => !value.notices.some((n) => n.id === v)))
      return {
        field: "relations",
        message: "赛段来源必须属于当前届次，不能跨届引用。",
      };
    if ([...stage.hosts, ...stage.scope.colleges].some((v) => !known.has(v)))
      return {
        field: "relations",
        message: "学院 ID 不在已加载的稳定目录中，请重新查询学院。",
      };
    if (stage.scope.kind === "colleges" && !stage.scope.colleges.length)
      return { field: "relations", message: "指定学院参赛范围须选择学院。" };
    for (const t of [
      stage.startsAt,
      stage.deadline,
      stage.materialsAt,
      stage.eventAt,
    ]) {
      if (
        (t.precision === "unknown" && t.value !== null) ||
        (t.precision === "date" && !validDate(t.value ?? "")) ||
        (t.precision === "instant" &&
          (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
            t.value ?? "",
          ) ||
            !validDate((t.value ?? "").slice(0, 10)) ||
            !Number.isFinite(Date.parse(t.value ?? ""))))
      )
        return {
          field: "relations",
          message: "时间无效：具体时刻须含时区，仅日期不补时刻，未知值须为空。",
        };
    }
  }
  for (const n of value.notices)
    if (
      !n.title.trim() ||
      !n.publisher.trim() ||
      !safeSourceUrl(n.url) ||
      [n.publishedAt, n.checkedAt].some((d) => d !== null && !validDate(d))
    )
      return {
        field: "relations",
        message: "来源须填写标题、发布单位、安全链接及有效日期（未知保持空）。",
      };
  for (const t of value.tracks)
    if (!t.name.trim() || !t.members.trim() || !t.rules.trim())
      return { field: "relations", message: "请填写赛道名称、人数与规则。" };
  return null;
}
const unavailable = async (): Promise<never> => {
  throw new ServiceUnavailable(
    "比赛管理服务未开放，未保存、发布或隐藏任何内容。",
  );
};
export const unavailableCompetitions: CompetitionService = {
  list: unavailable,
  detail: unavailable,
  preview: unavailable,
  change: unavailable,
};
export const competitionExamples: ManagedCompetition[] = Array.from(
  { length: 12 },
  (_, i) => {
    const content = emptyCompetition();
    Object.assign(content, {
      id: `example-contest-${i + 1}`,
      name: `示例 · 校园创新竞赛${i + 1}`,
      edition: "2026届",
      category: "创新创业",
      publication: (["draft", "published", "hidden"] as const)[i % 3],
    });
    content.notices = [
      {
        id: "notice",
        title: "关于开展校园创新比赛的通知",
        publisher: "示例发布单位",
        url: "https://xxgc.sicau.edu.cn/",
        kind: "registration",
        publishedAt: "2026-10-01",
        checkedAt: "2026-10-20",
      },
    ];
    content.stages = [
      {
        id: "school",
        name: "校赛",
        organizer: "示例组织单位",
        hosts: [],
        scope: {
          kind: "unknown",
          colleges: [],
          note: "资格尚待核对，不能推为全校可报名",
        },
        startsAt: { precision: "unknown", value: null },
        deadline: { precision: "date", value: "2026-11-08" },
        materialsAt: {
          precision: "instant",
          value: "2026-11-09T18:00:00+08:00",
        },
        eventAt: { precision: "unknown", value: null },
        timeNote: "各类时间独立记录",
        conflict: false,
        registration: "以原通知为准",
        order: 0,
        sourceIds: ["notice"],
      },
    ];
    content.tracks = [
      {
        id: "team",
        name: "团队赛",
        mode: "team",
        members: "3–5人",
        rules: "示例规则，待人工核对",
      },
    ];
    return {
      id: content.id,
      title: content.name,
      status: content.publication,
      date: "2026-10-20",
      baseline: `example-baseline-${i}`,
      content,
    };
  },
);
export const exampleCompetitions: CompetitionService = {
  ...unavailableCompetitions,
  async list(q) {
    return queryPage(competitionExamples, q);
  },
  async detail(id) {
    const value = competitionExamples.find((v) => v.id === id);
    if (!value) throw new Error("未找到示例");
    return structuredClone(value);
  },
};
