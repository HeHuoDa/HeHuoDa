import { parseCandidate } from "./parse.js";
import { classifyNotice } from "./classification.js";
import type {
  Article,
  CandidateFields,
  Directory,
  Evidence,
  ParsedCandidate,
} from "./types.js";

export interface RuleEvidenceInput {
  format: "pdf" | "docx";
  url: string;
  noticeVersion: string;
  attachmentVersion: string;
  segments: { kind: "page" | "paragraph"; index: number; text: string }[];
}

/** Locations stay attached to every paragraph throughout rule evaluation. */
export function parseEvidenceCandidate(
  article: Article,
  url: string,
  directory: Directory,
  noticeVersion: string,
  attachments: RuleEvidenceInput[] = [],
): ParsedCandidate {
  const locations: {
    text: string;
    format: "html" | "pdf" | "docx";
    url: string;
    noticeVersion: string;
    attachmentVersion: string | null;
    paragraph: number;
    page?: number;
  }[] = article.paragraphs.map((text, paragraph) => ({
    text,
    format: "html" as const,
    url,
    noticeVersion,
    attachmentVersion: null as string | null,
    paragraph,
    page: undefined as number | undefined,
  }));
  for (const attachment of attachments)
    for (const segment of attachment.segments)
      locations.push({
        text: segment.text,
        format: attachment.format,
        url: attachment.url,
        noticeVersion: attachment.noticeVersion,
        attachmentVersion: attachment.attachmentVersion,
        paragraph: segment.kind === "paragraph" ? segment.index : -1,
        page: segment.kind === "page" ? segment.index : undefined,
      });
  const classification = classifyNotice(
    article.title,
    locations.map((l) => l.text),
    article.attachments.map((a) => a.title),
  );
  const combined = {
    ...article,
    paragraphs: locations.map((l) => l.text),
    text: locations.map((l) => l.text).join("\n"),
  };
  const result = parseCandidate(
    combined,
    url,
    directory,
    classification.notificationKind,
  );
  const locate = (entry: Evidence): Evidence => {
    const location = locations[entry.paragraph];
    if (!location)
      return {
        ...entry,
        format: "html",
        sourceVersion: noticeVersion,
        noticeVersion,
        attachmentVersion: null,
      };
    return {
      ...entry,
      url: location.url,
      format: location.format,
      sourceVersion: location.noticeVersion,
      noticeVersion: location.noticeVersion,
      attachmentVersion: location.attachmentVersion,
      paragraph: location.paragraph,
      ...(location.page !== undefined ? { page: location.page } : {}),
    };
  };
  result.evidence = result.evidence.flatMap((entry) => {
    const location = locations[entry.paragraph],
      next = locations[entry.paragraph + 1];
    if (
      location &&
      next &&
      entry.excerpt === location.text + "\n" + next.text
    ) {
      if (location.attachmentVersion !== next.attachmentVersion) {
        result.fields.scope = {
          kind: "unknown",
          colleges: [],
          note: "跨来源资格标题不能自动关联",
        };
        result.conflicts.push("资格标题与内容分属不同来源，须人工核对");
      }
      return [
        locate({ ...entry, excerpt: location.text }),
        locate({
          ...entry,
          paragraph: entry.paragraph + 1,
          excerpt: next.text,
        }),
      ];
    }
    return [locate(entry)];
  });
  locations.forEach((location, index) => {
    if (/报名|参赛|补充|延期|更正|调整|变更|获奖|公示|回顾/.test(location.text))
      result.evidence.push(
        locate({
          field: "kind",
          excerpt: location.text,
          paragraph: index,
          url,
        }),
      );
  });
  result.classification = classification;
  for (const attachment of article.attachments)
    if (/竞赛|比赛|报名|延期|规则|补充/.test(attachment.title))
      result.evidence.push(
        locate({
          field: "kind",
          excerpt: attachment.title,
          paragraph: -1,
          url,
        }),
      );
  result.fieldConflicts = [];
  // Evaluate clauses separately to retain alternative values even when the aggregate is unknown.
  const alternatives = new Map<
    string,
    Map<string, { value: unknown; evidence: Evidence[] }>
  >();
  locations.forEach((location, index) => {
    for (const clause of location.text.split(/[。；;\n，,]/).filter(Boolean)) {
      const local = parseCandidate(
        { ...article, text: clause, paragraphs: [clause], attachments: [] },
        url,
        directory,
        classification.notificationKind,
      );
      for (const evidence of local.evidence.filter((e) => e.paragraph >= 0)) {
        const field = evidence.field;
        if (
          !(field in local.fields) ||
          ["tracks", "stageNames", "rules", "hosts"].includes(field)
        )
          continue;
        const value = local.fields[field as keyof CandidateFields];
        if (
          value == null ||
          (typeof value === "object" &&
            "precision" in value &&
            value.value == null) ||
          (typeof value === "object" &&
            "kind" in value &&
            value.kind === "unknown")
        )
          continue;
        // Scope notes preserve wording, but equivalent eligibility values aggregate evidence.
        const key =
          field === "scope"
            ? JSON.stringify({
                kind: local.fields.scope.kind,
                colleges: local.fields.scope.colleges,
                ...(local.fields.scope.kind === "complex"
                  ? { note: local.fields.scope.note }
                  : {}),
              })
            : JSON.stringify(value);
        const choices = alternatives.get(field) ?? new Map();
        const choice = choices.get(key) ?? { value, evidence: [] };
        choice.evidence.push(locate({ ...evidence, paragraph: index }));
        choices.set(key, choice);
        alternatives.set(field, choices);
      }
    }
  });
  for (const [field, choices] of alternatives) {
    const evidence = [...choices.values()].flatMap((choice) => choice.evidence);
    for (const entry of evidence)
      if (
        !result.evidence.some(
          (existing) => JSON.stringify(existing) === JSON.stringify(entry),
        )
      )
        result.evidence.push(entry);
    if (choices.size > 1) {
      result.fieldConflicts.push({ field, values: [...choices.values()] });
      result.conflicts.push(`${field} 多来源或条款冲突，须保留原文人工核对`);
      if (["startsAt", "deadline", "materialsAt", "eventAt"].includes(field))
        Object.assign(result.fields, {
          [field]: { precision: "unknown", value: null },
        });
      else if (field === "scope")
        result.fields.scope = {
          kind: "unknown",
          colleges: [],
          note: "资格证据冲突，待人工核对",
        };
      else Object.assign(result.fields, { [field]: null });
    }
  }
  const publicationYear = article.publishedAt?.slice(0, 4);
  if (
    publicationYear &&
    result.fields.edition &&
    publicationYear !== result.fields.edition
  ) {
    result.conflicts.push("发布日期与届次年份不同，待人工核对");
    result.fields.edition = null;
  }
  if (attachments.length)
    result.warnings = result.warnings.filter(
      (w) => w !== "附件仅记录链接，未解析或核实附件规则",
    );
  if (result.fields.tracks.length > 1) {
    result.conflicts.push("含多个赛道，时间与资格归属须分别核对");
    for (const field of [
      "startsAt",
      "deadline",
      "materialsAt",
      "eventAt",
    ] as const)
      result.fields[field] = { precision: "unknown", value: null };
  }
  return result;
}
