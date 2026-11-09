import { candidateFieldsContract } from "@hehuoda/sicau-connectors/notices";
import {
  candidateScope,
  formalScope,
  legacyCandidateFields,
  normalizeCandidateFields,
  presentCandidate,
  readCandidate,
} from "./candidate-contract.js";
import type { ScopeRecord } from "../competitions/competition.model.js";

const v2Fields = {
  name: "2026年数学建模竞赛",
  edition: "2026",
  eventKind: "学科竞赛",
  organizer: null,
  hosts: [],
  scope: {
    kind: "specified" as const,
    colleges: ["science"],
    note: "理学院本科生",
  },
  mode: "团队",
  modeKind: "team" as const,
  tracks: [
    { name: "算法", modeKind: "team" as const, members: null, rules: null },
  ],
  members: null,
  rules: [],
  stageNames: [],
  startsAt: { precision: "unknown" as const, value: null },
  deadline: { precision: "date" as const, value: "2026-11-01" },
  materialsAt: { precision: "unknown" as const, value: null },
  eventAt: { precision: "unknown" as const, value: null },
};

const v2Row = (overrides: Record<string, unknown> = {}) => ({
  fieldsContract: candidateFieldsContract,
  fieldsV2: v2Fields,
  classification: { notificationKind: "registration" },
  evidence: [],
  missing: [],
  conflicts: [],
  warnings: [],
  ...overrides,
});

describe("候选字段契约 v2 的兼容与映射", () => {
  describe("候选 scope → 正式 scope", () => {
    it("四条允许映射各自正确", () => {
      expect(formalScope({ kind: "all", colleges: [], note: "" })).toEqual({
        kind: "all",
        colleges: [],
        note: "",
      });
      expect(
        formalScope({
          kind: "specified",
          colleges: ["law", "science"],
          note: "x",
        }),
      ).toEqual({ kind: "colleges", colleges: ["law", "science"], note: "x" });
      expect(
        formalScope({ kind: "other", colleges: [], note: "不含毕业年级" }),
      ).toEqual({ kind: "complex", colleges: [], note: "不含毕业年级" });
      expect(
        formalScope({ kind: "unknown", colleges: [], note: "待核对" }),
      ).toEqual({ kind: "unknown", colleges: [], note: "待核对" });
    });

    it("禁止有损映射：全校附学院、空指定学院一律拒绝", () => {
      expect(() =>
        formalScope({ kind: "all", colleges: ["science"], note: "" }),
      ).toThrow(/全校范围不能附指定学院/);
      expect(() =>
        formalScope({ kind: "specified", colleges: [], note: "" }),
      ).toThrow(/指定学院范围不能为空/);
    });

    it("正式 scope 折回候选时 complex 必须变成 other", () => {
      const formal: ScopeRecord = {
        kind: "complex",
        colleges: [],
        note: "须通过资格审核",
      };
      expect(candidateScope(formal)).toEqual({
        kind: "other",
        colleges: [],
        note: "须通过资格审核",
      });
      expect(
        candidateScope({ kind: "colleges", colleges: ["science"], note: "" }),
      ).toMatchObject({ kind: "specified", colleges: ["science"] });
    });
  });

  describe("v1 候选显式归一", () => {
    const v1 = {
      fields: {
        name: "2026年数学建模竞赛报名通知",
        edition: "2026",
        kind: "registration",
        organizer: null,
        hosts: [],
        scope: { kind: "colleges", colleges: ["science"], note: "理学院" },
        mode: "team",
        tracks: [
          { name: "算法", mode: "individual", members: null, rules: null },
        ],
        members: null,
        rules: [],
        stageNames: [],
        startsAt: { precision: "unknown", value: null },
        deadline: { precision: "unknown", value: null },
        materialsAt: { precision: "unknown", value: null },
        eventAt: { precision: "unknown", value: null },
      },
      evidence: [],
      missing: [],
      conflicts: [],
      warnings: [],
    };

    it("scope 四值按协议归一，colleges 保留", () => {
      expect(normalizeCandidateFields(v1.fields).scope).toEqual({
        kind: "specified",
        colleges: ["science"],
        note: "理学院",
      });
      expect(
        normalizeCandidateFields({
          ...v1.fields,
          scope: { kind: "complex", colleges: [], note: "复杂" },
        }).scope.kind,
      ).toBe("other");
    });

    it("v1 的通知种类不得被解释为赛事种类", () => {
      const fields = normalizeCandidateFields(v1.fields);
      expect(fields.eventKind).toBeNull();
      expect(fields).not.toHaveProperty("kind");
    });

    it("v1 的英文 mode 只归一到 modeKind，不伪造原文", () => {
      const fields = normalizeCandidateFields(v1.fields);
      expect(fields.modeKind).toBe("team");
      expect(fields.mode).toBeNull();
      expect(fields.tracks[0]?.modeKind).toBe("individual");
    });

    it("读取历史候选时标注 v2 契约，并保留 legacy 视图", () => {
      const { candidate, legacy } = readCandidate(v1);
      expect(candidate.fieldsContract).toBe(candidateFieldsContract);
      expect(legacy.kind).toBe("registration");
      expect(legacy.scope.kind).toBe("colleges");
      expect(legacy.mode).toBe("team");
    });

    it("同一候选重复读取幂等（v2 行再次归一不丢字段）", () => {
      const once = readCandidate(v2Row());
      const twice = readCandidate(once.candidate);
      expect(twice.candidate.fields).toEqual(once.candidate.fields);
    });
  });

  describe("HTTP 兼容投影", () => {
    type LegacyView = ReturnType<typeof legacyCandidateFields>;

    it("fields 保持旧客户端认识的形状", () => {
      const projected = presentCandidate(
        v2Row({ classification: { notificationKind: "supplement" } }),
      );
      // 旧客户端读 fields.kind / fields.scope / fields.mode 仍可用。
      const legacy = projected.fields as unknown as LegacyView;
      expect(legacy.kind).toBe("supplement");
      expect(legacy.scope).toEqual({
        kind: "colleges",
        colleges: ["science"],
        note: "理学院本科生",
      });
      expect(legacy.mode).toBe("team");
      // 旧形状里没有新概念，避免旧读者误读。
      expect(legacy).not.toHaveProperty("eventKind");
      expect(legacy).not.toHaveProperty("modeKind");
    });

    it("协议契约放在 fieldsV2，kind 取通知种类而不是赛事种类", () => {
      const projected = presentCandidate(
        v2Row({ classification: { notificationKind: "supplement" } }),
      );
      expect(projected.fieldsContract).toBe(candidateFieldsContract);
      expect(projected.fieldsV2.eventKind).toBe("学科竞赛");
      expect(projected.fieldsV2.mode).toBe("团队");
      expect(projected.fieldsV2.modeKind).toBe("team");
      expect(projected.fieldsV2.scope).toEqual({
        kind: "specified",
        colleges: ["science"],
        note: "理学院本科生",
      });
      const legacy = projected.fields as unknown as LegacyView;
      expect(legacy.kind).not.toBe(projected.fieldsV2.eventKind);
    });

    it("other 折成 complex，且不写入允许学院", () => {
      const projected = presentCandidate(
        v2Row({
          fieldsV2: {
            ...v2Fields,
            scope: { kind: "other", colleges: [], note: "不含毕业年级" },
          },
        }),
      );
      const legacy = projected.fields as unknown as LegacyView;
      expect(legacy.scope).toEqual({
        kind: "complex",
        colleges: [],
        note: "不含毕业年级",
      });
    });

    it("没有分类时不伪造通知种类", () => {
      const projected = presentCandidate(
        v2Row({ classification: undefined, fieldsV2: v2Fields }),
      );
      const legacy = projected.fields as unknown as LegacyView;
      expect(legacy.kind).toBeNull();
    });

    it("旧 v1 候选经投影后同样给出旧形状，无需客户端改代码", () => {
      const projected = presentCandidate({
        fields: {
          ...v2Fields,
          ...{ kind: "registration" },
          scope: { kind: "colleges", colleges: ["law"], note: "法学院" },
          mode: "mixed",
        },
        evidence: [],
        missing: [],
        conflicts: [],
        warnings: [],
      });
      const legacy = projected.fields as unknown as LegacyView;
      expect(legacy.kind).toBe("registration");
      expect(legacy.scope.kind).toBe("colleges");
      expect(legacy.mode).toBe("mixed");
      expect(projected.fieldsV2.scope.kind).toBe("specified");
      expect(projected.fieldsV2.modeKind).toBe("mixed");
    });
  });
});
