import type { InjectionKey } from "vue";
import type { College } from "@hehuoda/api-types";
import type { CompetitionPatch, ImportPatch } from "./review";
import { validDate } from "./review";
import { manualSourceUrlError } from "./source-url";
import type { PageQuery, PageResult } from "./resource";
import { ConsoleError, errorMessage, queryPage } from "./resource";
import type { Schema } from "../http";
import { ServiceUnavailable } from "../services";

// 页面模型与 #38 生成 DTO（AdminCompetition*Dto）一一对应；此处不重复声明契约形状。
export type CompetitionAction = "save" | "publish" | "hide";
export interface ManagedCompetition {
  id: string;
  baseline: string;
  /** 完整可编辑内容；列表行需要的标题与状态从这里派生，避免再存一份副本。 */
  content: CompetitionPatch;
}
export interface CompetitionListItem {
  id: string;
  title: string;
  status: string;
  /** 管理列表契约没有日期字段，固定留空由页面显示明确空态。 */
  date: string;
  secondary: string;
}
export interface CompetitionBaseline {
  targetId: string;
  exists: boolean;
  baseline: string;
  publication: string | null;
}
export interface CompetitionPreviewReceipt {
  /** 与页面 contentKey 同一算法；不一致的回执不能用于提交。 */
  contentKey: string;
  /** 服务端预览回执（previewId），只能消费一次。 */
  token: string;
  changes: Schema["AdminCompetitionChangeDto"][];
  blocks: Schema["AdminCompetitionPublishBlockDto"][];
}
export interface CompetitionCommandResult {
  targetId: string;
  action: CompetitionAction;
  publication: string;
  baseline: string;
  changes: Schema["AdminCompetitionChangeDto"][];
  auditOperationId: string;
}
/**
 * 比赛维护专用的错误文案。
 * 服务端用不同 code 区分基线过期、目标不符、需显式确认、预览失效与发布底线；
 * 这些原因直接决定下一步该重载、重预览还是补齐内容，不能收敛成一句泛化提示。
 */
export function competitionErrorMessage(error: unknown) {
  if (error instanceof ConsoleError && error.code?.startsWith("COMPETITION_"))
    return error.message || errorMessage(error);
  return errorMessage(error);
}
export interface CompetitionService {
  list(query: PageQuery): Promise<PageResult<CompetitionListItem>>;
  detail(id: string): Promise<ManagedCompetition>;
  baseline(id: string): Promise<CompetitionBaseline>;
  preview(input: {
    content: CompetitionPatch;
    patch: ImportPatch;
    baseline: string;
    action: CompetitionAction;
    reason: string;
  }): Promise<CompetitionPreviewReceipt>;
  change(input: {
    patch: ImportPatch;
    baseline: string;
    action: CompetitionAction;
    reason: string;
    operationId: string;
    receipt?: CompetitionPreviewReceipt;
    confirmPublished: boolean;
  }): Promise<CompetitionCommandResult>;
}
/** 页面与服务适配共用的预览绑定键：内容、基线或动作任一变化即失效。 */
export function competitionContentKey(
  content: CompetitionPatch,
  baseline: string,
  action: CompetitionAction,
) {
  return JSON.stringify({ content, baseline, action });
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
    // 发布状态只能由 publish/hide 命令改变，save 携带不同 publication 会被拒绝。
    if (
      key !== "publication" &&
      (!before || JSON.stringify(after[key]) !== JSON.stringify(before[key]))
    )
      Object.assign(patch, { [key]: structuredClone(after[key]) });
  return patch;
}
/** 已有记录是否存在未提交的表单修改（发布/隐藏不含内容，须先保存）。 */
export function competitionDirty(
  after: CompetitionPatch,
  before: CompetitionPatch | null,
) {
  return (
    JSON.stringify(competitionPatch(after, before)) !==
    JSON.stringify({ id: after.id })
  );
}
export function validCompetitionId(value: string) {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) && value.length <= 100;
}
export function validateCompetition(
  value: CompetitionPatch,
  colleges: College[],
  action: CompetitionAction = "save",
): { field: string; message: string } | null {
  const id = validCompetitionId;
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
  for (const n of value.notices) {
    const urlError = manualSourceUrlError(n.url);
    if (
      !n.title.trim() ||
      !n.publisher.trim() ||
      urlError ||
      [n.publishedAt, n.checkedAt].some((d) => d !== null && !validDate(d))
    )
      return {
        // 手工比赛通道：公开 HTTPS 外链（无凭据、无非默认端口），官方性由管理员核实。
        field: "relations",
        message:
          "来源须填写标题、发布单位、安全链接及有效日期（未知保持空）；" +
          (urlError
            ? urlError + "请自行核实其官方性。"
            : "链接须为无凭据、无非默认端口的公开 https 地址，请自行核实其官方性。"),
      };
  }
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
  baseline: unavailable,
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
      baseline: `example-baseline-${i}`,
      content,
    };
  },
);
export const exampleCompetitions: CompetitionService = {
  ...unavailableCompetitions,
  async list(q) {
    // 示例行与真实管理列表同形：没有独立日期字段，只按名称与状态本地筛选。
    return queryPage(
      competitionExamples.map((v) => ({
        id: v.id,
        title: v.content.name,
        status: v.content.publication ?? "draft",
        date: "",
        secondary: "示例 · 不会写入",
      })),
      q,
    );
  },
  async detail(id) {
    const value = competitionExamples.find((v) => v.id === id);
    if (!value) throw new Error("未找到示例");
    return structuredClone(value);
  },
  async baseline(id) {
    const value = competitionExamples.find((v) => v.id === id);
    return {
      targetId: id,
      exists: !!value,
      baseline: value?.baseline ?? "example-baseline-new",
      publication: value?.content.publication ?? null,
    };
  },
};
