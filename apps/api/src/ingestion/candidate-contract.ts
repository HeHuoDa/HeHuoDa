import type {
  CandidateFields,
  CandidateFieldsContract,
  ModeKind,
  ParsedCandidate,
  ScopeKind,
} from "@hehuoda/sicau-connectors/notices";
import { candidateFieldsContract } from "@hehuoda/sicau-connectors/notices";
import type { ScopeRecord } from "../competitions/competition.model.js";

/** 正式比赛沿用自身四值；与候选协议四值不是同一枚举，必须显式映射。 */
export const formalScopeKinds = [
  "all",
  "colleges",
  "complex",
  "unknown",
] as const;
export type FormalScopeKind = (typeof formalScopeKinds)[number];

/**
 * 候选 scope → 正式 scope。只允许四条有损/无损映射：
 *   all → all（colleges 必须为空）
 *   specified → colleges（colleges 必须非空）
 *   other → complex（必须保留原文）
 *   unknown → unknown
 * 反向的 other→colleges、unknown→all 等一律拒绝，避免静默换义。
 */
export function formalScope(scope: CandidateFields["scope"]): ScopeRecord {
  switch (scope.kind) {
    case "all":
      if (scope.colleges.length)
        throw new Error("全校范围不能附指定学院，拒绝导入");
      return { kind: "all", colleges: [], note: scope.note };
    case "specified":
      if (!scope.colleges.length)
        throw new Error("指定学院范围不能为空，拒绝导入");
      return {
        kind: "colleges",
        colleges: [...new Set(scope.colleges)].sort(),
        note: scope.note,
      };
    case "other":
      return { kind: "complex", colleges: [], note: scope.note };
    case "unknown":
      return { kind: "unknown", colleges: [], note: scope.note };
    default:
      throw new Error("未知的候选参赛范围，拒绝导入");
  }
}

/** 正式 scope → 候选协议 scope，仅用于读取历史候选与展示，不写回。 */
export function candidateScope(scope: ScopeRecord): CandidateFields["scope"] {
  switch (scope.kind) {
    case "all":
      return { kind: "all", colleges: [], note: scope.note };
    case "colleges":
      return {
        kind: "specified",
        colleges: [...new Set(scope.colleges)].sort(),
        note: scope.note,
      };
    case "complex":
      return { kind: "other", colleges: [], note: scope.note };
    default:
      return { kind: "unknown", colleges: [], note: scope.note };
  }
}

const v1ScopeKinds: Record<string, ScopeKind> = {
  all: "all",
  colleges: "specified",
  complex: "other",
  unknown: "unknown",
};

const modeKinds: readonly ModeKind[] = ["individual", "team", "mixed"];
const v1ModeKinds: Record<string, ModeKind> = {
  individual: "individual",
  team: "team",
  mixed: "mixed",
};

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function normalizeModeKind(value: unknown): ModeKind | null {
  return typeof value === "string" && modeKinds.includes(value as ModeKind)
    ? (value as ModeKind)
    : null;
}

/**
 * v1 候选（无 fieldsContract）显式归一为 v2。v1 的 fields.kind 是通知种类，
 * 不是赛事种类，因此**不得**映射到 eventKind；它只保留在 legacy 视图中。
 * v1 的 mode 是英文枚举，归一为 modeKind，原文无从恢复而留空。
 */
export function normalizeCandidateFields(raw: unknown): CandidateFields {
  const fields = (raw ?? {}) as Record<string, unknown>;
  const rawScope = (fields.scope ?? {}) as Record<string, unknown>;
  const rawTracks = Array.isArray(fields.tracks) ? fields.tracks : [];
  const v1Mode = typeof fields.mode === "string" ? fields.mode : null;
  return {
    name: text(fields.name),
    edition: typeof fields.edition === "string" ? fields.edition : null,
    // 赛事种类在 v1 中没有可靠来源：v1 的 kind 是通知种类。
    eventKind: null,
    organizer: typeof fields.organizer === "string" ? fields.organizer : null,
    hosts: Array.isArray(fields.hosts)
      ? fields.hosts.filter((h): h is string => typeof h === "string")
      : [],
    scope: {
      kind: v1ScopeKinds[text(rawScope.kind)] ?? "unknown",
      colleges: Array.isArray(rawScope.colleges)
        ? rawScope.colleges.filter((c): c is string => typeof c === "string")
        : [],
      note: text(rawScope.note),
    },
    mode: null,
    modeKind: v1Mode ? (v1ModeKinds[v1Mode] ?? null) : null,
    tracks: rawTracks.map((track) => {
      const value = (track ?? {}) as Record<string, unknown>;
      return {
        name: text(value.name),
        modeKind: normalizeModeKind(value.mode),
        members: typeof value.members === "string" ? value.members : null,
        rules: typeof value.rules === "string" ? value.rules : null,
      };
    }),
    members: typeof fields.members === "string" ? fields.members : null,
    rules: Array.isArray(fields.rules)
      ? fields.rules.filter((r): r is string => typeof r === "string")
      : [],
    stageNames: Array.isArray(fields.stageNames)
      ? fields.stageNames.filter((s): s is string => typeof s === "string")
      : [],
    startsAt: (fields.startsAt ?? {
      precision: "unknown",
      value: null,
    }) as CandidateFields["startsAt"],
    deadline: (fields.deadline ?? {
      precision: "unknown",
      value: null,
    }) as CandidateFields["deadline"],
    materialsAt: (fields.materialsAt ?? {
      precision: "unknown",
      value: null,
    }) as CandidateFields["materialsAt"],
    eventAt: (fields.eventAt ?? {
      precision: "unknown",
      value: null,
    }) as CandidateFields["eventAt"],
  };
}

/**
 * 读取候选数据：v2 原样使用，v1 显式归一。
 * 返回值同时给出兼容投影所需的旧值，供 HTTP 过渡视图使用。
 */
export function readCandidate(raw: unknown): {
  candidate: ParsedCandidate;
  legacy: { kind: string | null; scope: ScopeRecord; mode: ModeKind | null };
} {
  const value = (raw ?? {}) as Record<string, unknown>;
  // 兼容 v1 原始数据与上一版本已落库的 v2 数据（fields 为 v2、无 fieldsV2）。
  const rawFields = (value.fieldsV2 ?? value.fields ?? {}) as Record<
    string,
    unknown
  >;
  const stored = (value.fields ?? {}) as Record<string, unknown>;
  const isV2 = value.fieldsContract === candidateFieldsContract;
  const fields = isV2
    ? (rawFields as unknown as CandidateFields)
    : normalizeCandidateFields(rawFields);
  const candidate: ParsedCandidate = {
    ...(value as unknown as ParsedCandidate),
    fieldsContract: candidateFieldsContract,
    fields,
  };
  const rawScope = (stored.scope ?? {}) as Record<string, unknown>;
  return {
    candidate,
    legacy: {
      // v1 的 fields.kind 是通知种类；v2 的通知种类一律由 classification 提供。
      kind: isV2 ? null : typeof stored.kind === "string" ? stored.kind : null,
      scope: isV2
        ? formalScope(fields.scope)
        : {
            kind: formalScopeKinds.includes(
              text(rawScope.kind) as FormalScopeKind,
            )
              ? (text(rawScope.kind) as FormalScopeKind)
              : "unknown",
            colleges: fields.scope.colleges,
            note: fields.scope.note,
          },
      mode: isV2 ? fields.modeKind : normalizeModeKind(stored.mode),
    },
  };
}

/**
 * 旧客户端读取的兼容投影：保持 v1 的键与取值形状。
 * - kind：通知种类（来自 classification，不是赛事种类）
 * - scope：正式四值（specified→colleges、other→complex）
 * - mode：英文枚举（取自 modeKind）
 * 故意不含 eventKind：赛事种类是新概念，旧读者没有对应语义。
 */
export interface LegacyCandidateFields {
  name: string;
  edition: string | null;
  kind: string | null;
  organizer: string | null;
  hosts: string[];
  scope: ScopeRecord;
  mode: ModeKind | null;
  tracks: {
    name: string;
    mode: ModeKind | null;
    members: string | null;
    rules: string | null;
  }[];
  members: string | null;
  rules: string[];
  stageNames: string[];
  startsAt: CandidateFields["startsAt"];
  deadline: CandidateFields["deadline"];
  materialsAt: CandidateFields["materialsAt"];
  eventAt: CandidateFields["eventAt"];
}

export function legacyCandidateFields(
  candidate: ParsedCandidate,
): LegacyCandidateFields {
  const fields = candidate.fields;
  return {
    name: fields.name,
    edition: fields.edition,
    kind: candidate.classification?.notificationKind ?? null,
    organizer: fields.organizer,
    hosts: fields.hosts,
    scope: formalScope(fields.scope),
    mode: fields.modeKind,
    tracks: fields.tracks.map((track) => ({
      name: track.name,
      mode: track.modeKind,
      members: track.members,
      rules: track.rules,
    })),
    members: fields.members,
    rules: fields.rules,
    stageNames: fields.stageNames,
    startsAt: fields.startsAt,
    deadline: fields.deadline,
    materialsAt: fields.materialsAt,
    eventAt: fields.eventAt,
  };
}

export interface PresentedCandidate extends ParsedCandidate {
  fieldsContract: CandidateFieldsContract;
  /** 旧形状投影：旧客户端读 fields 即得到 v1 的键与取值。 */
  fieldsV2: CandidateFields;
}

/**
 * HTTP 呈现：`fields` 保持旧客户端认识的结构，协议契约放 `fieldsV2`。
 * 这样 #204 完成前旧管理端无需改代码；新代码只读 `fieldsV2`。
 * 投影只存在于响应里，不回写候选、不参与审核基线哈希。
 */
export function presentCandidate(raw: unknown): PresentedCandidate {
  const { candidate } = readCandidate(raw);
  return {
    ...candidate,
    // fields 覆写为兼容投影，保留 v1 的 kind/scope/mode 形状。
    fields: legacyCandidateFields(candidate) as unknown as CandidateFields,
    fieldsContract: candidateFieldsContract,
    fieldsV2: candidate.fields,
  };
}
