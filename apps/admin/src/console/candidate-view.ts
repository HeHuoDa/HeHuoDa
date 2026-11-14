import type { Schema } from "../http";
import type { NoticeKind } from "./review";
import { classificationLabels, kindLabels } from "./review";

/** 通知种类标签：未知枚举不得回退为「报名通知」，也不得读作赛事种类。 */
export function notificationKindLabel(
  value: string | null | undefined,
): string {
  return value && Object.hasOwn(kindLabels, value)
    ? kindLabels[value as NoticeKind]
    : "未知通知种类";
}

/**
 * 候选 scope（协议四值）显示标签。与正式比赛 scope（all/colleges/complex/unknown）
 * 不是同一枚举，不能互相赋值或强制转换。
 */
export const candidateScopeLabels: Record<
  Schema["AdminCandidateScopeDto"]["kind"],
  string
> = {
  all: "全校",
  specified: "指定学院",
  other: "其他限制（须读原文）",
  unknown: "未知",
};

/**
 * 旧投影的 scope 是正式四值，显示时仍要给人读的中文；
 * 它与 candidateScopeLabels 是两套枚举，不能合并成一张表。
 */
export const legacyScopeLabels: Record<
  Schema["AdminLegacyScopeDto"]["kind"],
  string
> = {
  all: "全校",
  colleges: "指定学院",
  complex: "复杂规则",
  unknown: "未知",
};

export const modeKindLabels: Record<
  NonNullable<Schema["AdminCandidateFieldsDto"]["modeKind"]>,
  string
> = {
  individual: "个人",
  team: "团队",
  mixed: "个人或团队",
};

/**
 * 展示层需要的候选投影子集。
 *
 * 有意不复用 `Schema["AdminParsedCandidateDto"]`：生成类型把 `fieldsV2` 定为必填，
 * 但历史 format=1 审核材料（`ReviewMaterial`）确实没有该键，套用生成类型会逼出
 * 假默认值。这里三者都可选，再由 `candidateFieldsV2` 按 ADR 0010 §6 的
 * `fieldsContract` 单一判据收窄，调用方拿到明确的 null 而不是伪造对象。
 */
type CandidateProjection = {
  fieldsContract?: "candidate-fields-v2";
  fieldsV2?: Schema["AdminCandidateFieldsDto"];
  /** 后端兼容投影：kind 是通知种类，scope 是正式四值，mode 是英文枚举。 */
  fields?: { kind?: string | null };
  classification?: { notificationKind?: string };
};

/**
 * 取候选 v2 字段。
 *
 * 判据是 ADR 0010 §6 的 `fieldsContract`，与标题显示同一口径：
 * 标了 v2 契约就必须有 fieldsV2，缺失属于契约错误，显式返回 null 走 legacy
 * 提示，而不是悄悄读兼容投影把旧形状当成 v2。
 * 旧审核材料（历史导出、旧 CLI format=1）没有该键，同样返回 null。
 */
export function candidateFieldsV2(
  candidate: CandidateProjection | null | undefined,
): Schema["AdminCandidateFieldsDto"] | null {
  if (!candidate || candidate.fieldsContract !== "candidate-fields-v2")
    return null;
  return candidate.fieldsV2 ?? null;
}

/**
 * 旧材料分支的通知种类：只读兼容投影的 kind（后端保证它是通知种类）。
 * 该值绝不当作赛事种类；没有该投影时返回 null，由界面显示未知。
 */
export function legacyNotificationKind(
  candidate: CandidateProjection | null | undefined,
): string | null {
  return candidate?.fields?.kind ?? null;
}

/**
 * 通知种类：优先 classification.notificationKind。
 *
 * 缺失时读后端兼容投影的 fields.kind——它不是第二个来源：服务端
 * presentCandidate 已把该键统一写成 notificationKind 的投影（见
 * apps/api/src/ingestion/candidate-contract.ts），因此这里只是同一来源的
 * 备用字段，不会读到赛事种类。v1 归一候选没有 classification 时才真正依赖它。
 */
export function resolveNotificationKind(
  candidate: CandidateProjection | null | undefined,
): string | null {
  return (
    candidate?.classification?.notificationKind ??
    legacyNotificationKind(candidate)
  );
}

export type CandidateFieldRow = {
  label: string;
  value: string;
  hint?: string;
};

/**
 * 退役字段在管理端的统一说明。取值之所以是空，是本期范围决定，不是解析失败，
 * 也不表示原文没有信息；原文证据仍在候选里，可据此人工填写正式记录。
 */
export const RETIRED_FIELD_HINT = "本期不自动提取，请按原文人工填写";
/**
 * 赛道的嵌套字段（形式／人数／规则）本期不自动提取。
 * 与退役字段分开命名：赛道名称仍会给值，不能说整个赛道字段未提取。
 */
export const TRACK_NAME_ONLY_HINT =
  "本期只自动提取赛道名称，参赛形式、人数与规则请按原文人工填写";
const TRACK_NAME_ONLY_VALUE = "本期只提取赛道名称";
// 值列留空占位：本期范围决定没有自动取值，说明只写一次，避免与提示列重复。
const retiredHintRow = (label: string): CandidateFieldRow => ({
  label,
  value: "—",
  hint: RETIRED_FIELD_HINT,
});

/**
 * 只读展示行：保留原文与归一说明，未知显式标注，不猜测、不补齐。
 * 返回值只用于展示，不回写审核材料，也不参与提交。
 */
export function candidateFieldRows(
  fields: Schema["AdminCandidateFieldsDto"],
): CandidateFieldRow[] {
  const rows: CandidateFieldRow[] = [
    {
      label: "赛事名称",
      value: fields.name || "未提取",
      ...(fields.edition ? { hint: "届次：" + fields.edition } : {}),
    },
    // 退役字段只要能读出值就照旧展示（历史候选、旧材料），否则用一条说明
    // 告知本期不自动提取，而不伪装成「正文未提供」。
    fields.eventKind
      ? { label: "赛事种类", value: fields.eventKind }
      : retiredHintRow("赛事种类"),
    fields.mode
      ? {
          label: "参赛形式原文",
          value: fields.mode,
          ...(fields.modeKind
            ? { hint: "归一结果：" + modeKindLabels[fields.modeKind] }
            : { hint: "无法可靠归一，导入时须人工填写个人／团队／混合" }),
        }
      : retiredHintRow("参赛形式"),
    {
      label: "参赛范围",
      value:
        candidateScopeLabels[fields.scope.kind] +
        (fields.scope.kind === "specified" && fields.scope.colleges.length
          ? "：" + fields.scope.colleges.join("、")
          : ""),
      hint: fields.scope.note || "原文未提供范围说明",
    },
    {
      label: "承办学院",
      value: fields.hosts.length
        ? fields.hosts.join("、")
        : "未提取（不得由发布单位推断）",
    },
  ];
  pushOptionalRows(
    rows,
    {
      organizer: fields.organizer,
      edition: fields.edition,
      members: fields.members,
      rules: fields.rules,
      stageNames: fields.stageNames,
      tracks: fields.tracks.map((track) => ({
        name: track.name,
        mode: track.modeKind,
        members: track.members,
        rules: track.rules,
      })),
    },
    "",
    // 本期只自动提取赛道名称，嵌套的 modeKind/members/rules 按契约恒为空。
    // 旧材料分支仍用旧口径：那里为空是真未提取，不是本期范围。
    TRACK_NAME_ONLY_VALUE,
  );
  // 只对确实没有取值的情况补说明，已有历史取值已由 pushOptionalRows 展示。
  if (!fields.rules.length) rows.push(retiredHintRow("参赛规则"));
  if (!fields.stageNames.length) rows.push(retiredHintRow("赛段名称"));
  const knownTimes = CANDIDATE_TIME_LABELS.filter(
    ([key]) => fields[key]?.precision !== "unknown",
  );
  if (!knownTimes.length) rows.push(retiredHintRow("报名／材料／比赛时间"));
  else
    for (const [key, label] of knownTimes)
      rows.push({
        label,
        value: String(fields[key].value),
        hint: fields[key].precision,
      });
  return rows;
}

/**
 * 旧材料（无 fieldsV2）的只读展示行：把兼容投影里仍可读的字段全部列出，
 * 包括参赛规则、各赛道规则与时间；这些字段仍会随材料提交，复核时不能隐藏。
 * 旧 kind 是通知种类，不在此显示为赛事种类。
 */
export function legacyFieldRows(
  fields: Schema["AdminLegacyCandidateFieldsDto"],
): CandidateFieldRow[] {
  const rows: CandidateFieldRow[] = [
    { label: "赛事名称（旧）", value: fields.name || "未提取" },
    {
      label: "竞赛范围（正式四值投影）",
      value:
        legacyScopeLabels[fields.scope.kind] +
        (fields.scope.kind === "colleges" && fields.scope.colleges.length
          ? "：" + fields.scope.colleges.join("、")
          : ""),
      hint: fields.scope.note || "尚无说明",
    },
    {
      label: "参赛方式（英文枚举）",
      value: fields.mode
        ? modeKindLabels[fields.mode]
        : "未提取（旧材料无原文）",
    },
    {
      label: "承办学院（旧）",
      value: fields.hosts.length
        ? fields.hosts.join("、")
        : "未知，不能由发布单位推断",
    },
  ];
  pushOptionalRows(
    rows,
    {
      organizer: fields.organizer,
      edition: fields.edition,
      members: fields.members,
      rules: fields.rules,
      stageNames: fields.stageNames,
      tracks: fields.tracks.map((track) => ({
        name: track.name,
        mode: track.mode,
        members: track.members,
        rules: track.rules,
      })),
    },
    "（旧）",
    "参赛形式无法可靠归一",
  );
  for (const [key, label] of CANDIDATE_TIME_LABELS)
    rows.push({
      label: label + "（旧）",
      value:
        fields[key].precision === "unknown"
          ? "未知"
          : String(fields[key].value),
      hint: fields[key].precision,
    });
  return rows;
}

/**
 * 可选字段与赛道的共享投影。v2 与旧材料的字段形状只在 mode/modeKind 命名上不同，
 * 这里参数化这两个差异，避免两条分支各写一遍循环后漂移。
 */
function pushOptionalRows(
  rows: CandidateFieldRow[],
  source: {
    organizer?: string | null;
    edition?: string | null;
    members?: string | null;
    rules: string[];
    stageNames: string[];
    tracks: {
      name: string;
      mode: string | null;
      members?: string | null;
      rules?: string | null;
    }[];
  },
  suffix: string,
  trackModeFallback: string,
): void {
  if (source.organizer)
    rows.push({ label: "组织单位" + suffix, value: source.organizer });
  if (source.edition)
    rows.push({ label: "届次" + suffix, value: source.edition });
  if (source.members)
    rows.push({ label: "人数要求" + suffix, value: source.members });
  if (source.rules.length)
    rows.push({ label: "参赛规则" + suffix, value: source.rules.join("；") });
  if (source.stageNames.length)
    rows.push({ label: "赛段" + suffix, value: source.stageNames.join("、") });
  for (const track of source.tracks) {
    const name = track.name || "未命名";
    rows.push({
      label: "赛道" + suffix + "：" + name,
      value: track.mode
        ? modeKindLabels[track.mode as keyof typeof modeKindLabels]
        : trackModeFallback,
      hint: track.mode
        ? track.members
          ? "人数：" + track.members
          : undefined
        : TRACK_NAME_ONLY_HINT,
    });
    // 赛道规则可能含否定与例外条款（如「不得提交已获奖作品」），必须原样保留。
    if (track.rules?.trim())
      rows.push({
        label: "赛道规则" + suffix + "：" + name,
        value: track.rules,
      });
  }
}

/** 四个时间字段的顺序与标签，v2 与旧材料分支共用，避免两处口径漂移。 */
export const CANDIDATE_TIME_LABELS = [
  ["startsAt", "报名开始"],
  ["deadline", "报名截止"],
  ["materialsAt", "材料截止"],
  ["eventAt", "比赛时间"],
] as const;

/** 复核提示：分开列出冲突、缺失与警告，不把引文形态检查说成依据充分。 */
export function reviewHints(candidate: {
  missing?: string[];
  conflicts?: string[];
  warnings?: string[];
}): { kind: "missing" | "conflict" | "warning"; text: string }[] {
  return [
    ...(candidate.conflicts ?? []).map((text) => ({
      kind: "conflict" as const,
      text,
    })),
    ...(candidate.missing ?? []).map((item) => ({
      kind: "missing" as const,
      text: "缺少字段：" + item,
    })),
    ...(candidate.warnings ?? []).map((text) => ({
      kind: "warning" as const,
      text,
    })),
  ];
}

/** 定位所需的最小锚点；优先级只看版本、格式与段／页。 */
export type EvidenceAnchor = {
  format?: string;
  url: string;
  noticeVersion?: string;
  sourceVersion?: string;
  attachmentVersion?: string | null;
  page?: number;
  paragraph?: number;
  /** 字段名与引文只用于展示，不参与定位计算。 */
  field?: string;
  excerpt?: string;
};

export type EvidenceLike = EvidenceAnchor & {
  field: string;
  excerpt: string;
};

/** 分类标签：未知值不冒充任何已知分类。 */
export function classificationLabel(value: string | null | undefined): string {
  return value && Object.hasOwn(classificationLabels, value)
    ? classificationLabels[value as keyof typeof classificationLabels]
    : "未知分类";
}

/**
 * 候选列表摘要：通知类型与赛事种类分别出现。
 * 赛事种类未提取时不放占位，避免把「未提取」读成已核对的信息。
 */
export function candidateSummary(parts: {
  sourceId: string;
  classification: string | null | undefined;
  notificationKind: string | null | undefined;
  eventKind?: string | null;
  needsReview: boolean;
}): string {
  const segments = [
    parts.sourceId,
    classificationLabel(parts.classification),
    notificationKindLabel(parts.notificationKind),
  ];
  if (parts.eventKind) segments.push("赛事种类：" + parts.eventKind);
  segments.push(parts.needsReview ? "需复核" : "已核对");
  return segments.join(" · ");
}

export type EvidenceLocation = {
  path: string;
  query: Record<string, string>;
};

/**
 * 附件正文的每页段数，与 `AttachmentPanel.vue` 的 `:page-size="10"` 一致。
 * 两者改动必须同步，否则证据定位会落到错误的页。
 */
export const ATTACHMENT_SEGMENTS_PER_PAGE = 10;

/**
 * 证据定位：绑定真实通知／附件版本。
 * - HTML 证据定位到通知正文段落，版本取证据自身绑定的版本，缺失时才用材料版本。
 * - PDF／DOCX 证据必须带附件版本；没有绑定版本时返回 null，
 *   由界面说明无法定位，绝不静默跳到最新版本替代。
 */
export function evidenceLocation(
  noticeId: string | undefined,
  evidence: EvidenceAnchor,
  fallbackVersion: string,
): EvidenceLocation | null {
  if (!noticeId) return null;
  const attachment = evidence.format === "pdf" || evidence.format === "docx";
  const version =
    evidence.noticeVersion ?? evidence.sourceVersion ?? fallbackVersion;
  if (attachment) {
    if (!evidence.attachmentVersion) return null;
    const segment =
      evidence.format === "pdf"
        ? (evidence.page ?? 1)
        : (evidence.paragraph ?? 1);
    return {
      path: "/ingestion/notices/" + encodeURIComponent(noticeId),
      query: {
        version,
        attachmentUrl: evidence.url,
        attachmentVersion: evidence.attachmentVersion,
        segment: String(segment),
        attachmentPage: String(
          Math.ceil(segment / ATTACHMENT_SEGMENTS_PER_PAGE),
        ),
      },
    };
  }
  return {
    path: "/ingestion/notices/" + encodeURIComponent(noticeId),
    query: { version, paragraph: String(evidence.paragraph ?? 0) },
  };
}

/** 证据位置文案，与 DTO 口径一致：HTML 从 0 起、PDF 页与 DOCX 段落从 1 起、-1 为标题／元数据。 */
export function evidenceLabel(evidence: EvidenceAnchor): string {
  if (evidence.format === "pdf") return "PDF 第" + (evidence.page ?? 1) + "页";
  if (evidence.format === "docx")
    return "DOCX 第" + (evidence.paragraph ?? 1) + "段";
  const paragraph = evidence.paragraph ?? 0;
  return paragraph >= 0 ? "HTML 第" + (paragraph + 1) + "段" : "标题／元数据";
}
