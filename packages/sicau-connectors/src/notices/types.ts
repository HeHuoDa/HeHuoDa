export interface College {
  id: string;
  name: string;
}
export interface TimeValue {
  precision: "instant" | "date" | "unknown";
  value: string | null;
}

export interface ListItem {
  url: string;
  title: string;
  publishedAt: string | null;
}
export interface Page {
  items: ListItem[];
  next: string | null;
  skipped?: { title: string; reason: string }[];
}
export interface Article {
  title: string;
  publishedAt: string | null;
  text: string;
  paragraphs: string[];
  attachments: { title: string; url: string }[];
}
export interface Evidence {
  field: string;
  excerpt: string;
  paragraph: number;
  url: string;
  sourceVersion?: string;
  format?: "html" | "pdf" | "docx";
  noticeVersion?: string;
  attachmentVersion?: string | null;
  page?: number;
}

/** 候选字段契约版本；缺该键的历史候选按 v1 显式归一读取。 */
export const candidateFieldsContract = "candidate-fields-v2";
export type CandidateFieldsContract = typeof candidateFieldsContract;

/** 协议 3.3：参赛范围四值。正式比赛 ScopeRecord 是另一套枚举，不能互换。 */
export type ScopeKind = "all" | "specified" | "other" | "unknown";
/** 参赛形式的机器可读归一值；原文短语另存于 mode。 */
export type ModeKind = "individual" | "team" | "mixed";

export interface CandidateFields {
  /** 赛事名，已剥离可确认的通知套语；保留发文单位、年份届次、选拔层级与子赛道。 */
  name: string;
  edition: string | null;
  /** 赛事种类／项目类型；不承载通知种类、赛段、选拔层级或组别。未提取为 null。 */
  eventKind: string | null;
  organizer: string | null;
  hosts: string[];
  scope: {
    kind: ScopeKind;
    /** 仅允许参赛的学院；否定、排除与未知学院一律不写入。 */
    colleges: string[];
    note: string;
  };
  /** 参赛形式原文短语；协议 fields.mode 比较这一层。 */
  mode: string | null;
  /** 可靠归一结果；无法可靠归一为 null，导入时须人工填写。 */
  modeKind: ModeKind | null;
  tracks: {
    name: string;
    modeKind: ModeKind | null;
    members: string | null;
    rules: string | null;
  }[];
  members: string | null;
  rules: string[];
  stageNames: string[];
  startsAt: TimeValue;
  deadline: TimeValue;
  materialsAt: TimeValue;
  eventAt: TimeValue;
}
export interface ParsedCandidate {
  privacyRedacted?: boolean;
  classification?: import("./classification.js").NoticeClassification;
  fieldsContract?: CandidateFieldsContract;
  fieldConflicts?: {
    field: string;
    values: { value: unknown; evidence: Evidence[] }[];
  }[];
  fields: CandidateFields;
  evidence: Evidence[];
  missing: string[];
  conflicts: string[];
  warnings: string[];
}
export type Directory = College[];
