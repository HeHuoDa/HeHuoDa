import type { InjectionKey } from "vue";
import type {
  CompetitionDetail,
  CompetitionStage,
  Time,
} from "@hehuoda/api-types";
import type { PageQuery, PageResult } from "./resource";
import { ServiceUnavailable } from "../services";
export type CandidateStatus = "pending" | "approved" | "rejected" | "imported";
export type ReviewAction =
  "save" | "approve" | "reject" | "reopen" | "import" | "publish";
export interface Article {
  title: string;
  publishedAt: string | null;
  text: string;
  paragraphs: string[];
  attachments: { title: string; url: string }[];
}
export type StagePatch = Omit<CompetitionStage, "status">;
export interface CompetitionPatch {
  id: string;
  name: string;
  edition: string;
  category: string;
  organizer: string;
  origin: "official" | "historical" | "demo";
  publication: "draft" | "published" | "hidden";
  stages: StagePatch[];
  tracks: CompetitionDetail["tracks"];
  notices: CompetitionDetail["notices"];
}
// 对齐 review.ts ReviewFile 的页面材料形状；不把它冒充尚不存在的 #40 HTTP DTO。
export interface ReviewMaterial {
  format: 1;
  operationId: string;
  candidateId: string;
  sourceVersion: string;
  candidateRevision: number;
  targetId: string;
  baseline: string;
  source: {
    id: string;
    url: string;
    finalUrl: string;
    publisher: string;
    fetchedAt: string;
    adapterVersion: string;
    health: string;
  };
  article: Article;
  previousArticle: Article | null;
  candidate: {
    fields: {
      name: string;
      edition: string | null;
      organizer: string | null;
      hosts: string[];
      scope: StagePatch["scope"];
      startsAt: Time;
      deadline: Time;
      materialsAt: Time;
      eventAt: Time;
      kind: "registration" | "supplement" | "award" | "news";
      mode: "individual" | "team" | "mixed" | null;
      tracks: {
        name: string;
        mode: "individual" | "team" | "mixed" | null;
        members: string | null;
        rules: string | null;
      }[];
      members: string | null;
      rules: string[];
      stageNames: string[];
    };
    evidence: {
      field: string;
      excerpt: string;
      paragraph: number;
      url: string;
      sourceVersion?: string;
    }[];
    missing: string[];
    conflicts: string[];
    warnings: string[];
  };
  mergeSuggestions: { id: string; name: string; edition: string }[];
  formalBefore: CompetitionPatch | null;
  batch: { competitions: CompetitionPatch[] };
  checkedAt: string | null;
  resolution: string;
}
export interface ReviewRecord {
  id: string;
  title: string;
  status: CandidateStatus;
  date: string;
  versions: string[];
  latestVersion: string;
  material: ReviewInput;
  requiresReapproval?: boolean;
}
export type ImportPatch = Partial<
  Omit<CompetitionPatch, "stages" | "tracks" | "notices">
> & {
  id: string;
  stages?: (Omit<Partial<StagePatch>, "scope"> & {
    id: string;
    scope?: Partial<StagePatch["scope"]>;
  })[];
  tracks?: (Partial<CompetitionDetail["tracks"][number]> & { id: string })[];
  notices?: (Partial<CompetitionDetail["notices"][number]> & { id: string })[];
};
export type ReviewInput = Omit<ReviewMaterial, "batch"> & {
  batch: { competitions: ImportPatch[] };
};
export interface PreviewReceipt {
  contentKey: string;
  token: string;
}
export interface ReviewService {
  list(
    kind: "candidates" | "notices",
    query: PageQuery,
  ): Promise<PageResult<ReviewRecord>>;
  detail(
    kind: "candidates" | "notices",
    id: string,
    version?: string,
    targetId?: string,
  ): Promise<ReviewRecord>;
  preview(
    material: ReviewInput,
    action: "import" | "publish",
  ): Promise<PreviewReceipt>;
  change(
    action: ReviewAction,
    material: ReviewInput,
    reason: string,
    operationId: string,
    receipt?: PreviewReceipt,
    options?: { confirmPublished: boolean },
  ): Promise<void>;
}
export const reviewKey: InjectionKey<ReviewService> = Symbol("review");
export const reviewStates: Record<CandidateStatus, string> = {
  pending: "待审核",
  approved: "已批准，未导入",
  rejected: "已拒绝",
  imported: "已导入，发布另行确认",
};
export const unavailableReview: ReviewService = {
  async list() {
    throw new ServiceUnavailable(
      "候选与通知管理查询服务未开放，请单独查看页面示例。",
    );
  },
  async detail() {
    throw new ServiceUnavailable(
      "审核材料服务未开放，无法读取真实原文与版本。",
    );
  },
  async preview() {
    throw new ServiceUnavailable(
      "服务未开放，以下仅为布局预览，尚未完成服务端基线核验。",
    );
  },
  async change() {
    throw new ServiceUnavailable(
      "服务未开放，未执行审核、导入或发布；原状态未改变。",
    );
  },
};
export function allowedReviewAction(
  status: CandidateStatus,
  action: ReviewAction,
) {
  return (
    {
      pending: ["save", "approve", "reject"],
      approved: ["save", "approve", "reject", "import"],
      rejected: ["reopen"],
      imported: ["publish"],
    } as Record<CandidateStatus, ReviewAction[]>
  )[status].includes(action);
}
export function samePreview(key: string, material: ReviewMaterial) {
  return key === JSON.stringify(material);
}
export function safeSourceUrl(value: string) {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
export function validDate(value: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value + "T00:00:00Z")) &&
    new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value
  );
}
export function validateReviewDraft(
  file: ReviewMaterial,
): { field: string; message: string } | null {
  if (!file.checkedAt || !validDate(file.checkedAt))
    return {
      field: "checkedAt",
      message: "请填写真实有效的人工核对日期，不使用采集时间代替。",
    };
  if (!file.resolution.trim() || file.resolution.trim().length > 2000)
    return {
      field: "resolution",
      message: "请填写核对理由（1–2000 字），说明缺失、冲突及附件处理。",
    };
  const patch = file.batch.competitions[0];
  if (!patch || !patch.name.trim() || /[<>]/.test(patch.name))
    return { field: "name", message: "请填写比赛名称，不能含 HTML 标记。" };
  if (file.batch.competitions.length !== 1 || patch.id !== file.targetId)
    return { field: "name", message: "目标届次与核对材料不匹配，请重新载入。" };
  for (const stage of patch.stages) {
    if (
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(stage.id) ||
      !stage.name.trim() ||
      patch.stages.filter((item) => item.id === stage.id).length !== 1
    )
      return {
        field: "stage-" + stage.id,
        message: "请填写唯一的赛段 ID 和赛段名称。",
      };
    for (const key of [
      "startsAt",
      "deadline",
      "materialsAt",
      "eventAt",
    ] as const) {
      const time = stage[key];
      if (
        (time.precision === "date" &&
          (!time.value || !validDate(time.value))) ||
        (time.precision === "instant" &&
          (!time.value ||
            !/(?:Z|[+-]\d{2}:\d{2})$/.test(time.value) ||
            !validDate(time.value.slice(0, 10)) ||
            !Number.isFinite(Date.parse(time.value))))
      )
        return {
          field: "stage-" + stage.id,
          message: "请检查各类时间；精确时刻须含时区，未知时间保持未知。",
        };
    }
    if (stage.scope.kind === "colleges" && !stage.scope.colleges.length)
      return {
        field: "stage-" + stage.id,
        message: "指定学院参赛范围必须选择学院。",
      };
  }
  for (const track of patch.tracks)
    if (
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(track.id) ||
      !track.name.trim() ||
      !track.members.trim() ||
      !track.rules.trim() ||
      patch.tracks.filter((item) => item.id === track.id).length !== 1
    )
      return {
        field: "tracks",
        message: "请填写唯一赛道 ID、赛道名称、人数和规则；未知信息不要猜测。",
      };
  return null;
}
