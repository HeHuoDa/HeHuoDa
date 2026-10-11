import type {
  CollegeRecord,
  TimeValue,
} from "../competitions/competition.model.js";

export interface ListItem {
  url: string;
  title: string;
  publishedAt: string | null;
}
export interface Page {
  items: ListItem[];
  next: string | null;
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
  stageNames: string[];
  startsAt: TimeValue;
  deadline: TimeValue;
  materialsAt: TimeValue;
  eventAt: TimeValue;
}
export interface ParsedCandidate {
  fields: CandidateFields;
  evidence: Evidence[];
  missing: string[];
  conflicts: string[];
  warnings: string[];
}
export type Directory = CollegeRecord[];

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
