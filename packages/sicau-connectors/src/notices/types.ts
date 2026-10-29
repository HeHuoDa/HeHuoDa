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
export interface CandidateFields {
  name: string;
  edition: string | null;
  kind: "registration" | "supplement" | "award" | "news";
  organizer: string | null;
  hosts: string[];
  scope: {
    kind: "all" | "colleges" | "complex" | "unknown";
    colleges: string[];
    note: string;
  };
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
  startsAt: TimeValue;
  deadline: TimeValue;
  materialsAt: TimeValue;
  eventAt: TimeValue;
}
export interface ParsedCandidate {
  privacyRedacted?: boolean;
  classification?: import("./classification.js").NoticeClassification;
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
