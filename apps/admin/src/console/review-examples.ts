import { queryPage, ConsoleError } from "./resource";
import {
  unavailableReview,
  type ReviewRecord,
  type CompetitionPatch,
  type ReviewService,
} from "./review";
const unknownTime = () => ({ precision: "unknown" as const, value: null });
const patch = (id: string): CompetitionPatch => ({
  id,
  name: "示例创新设计竞赛",
  edition: "",
  category: "",
  organizer: "",
  origin: "official",
  publication: id === "example-published" ? "published" : "draft",
  tracks: [],
  notices: [
    {
      id: "example-notice-ref",
      title: "示例报名通知",
      publisher: "示例发布单位（与承办关系无关）",
      url: "https://xxgc.sicau.edu.cn/",
      publishedAt: "2026-10-18",
      checkedAt: null,
      kind: "registration",
    },
  ],
  stages: [
    {
      id: "example-campus-stage",
      name: "示例校内选拔",
      organizer: "",
      hosts: [],
      scope: { kind: "unknown", colleges: [], note: "" },
      startsAt: unknownTime(),
      deadline: { precision: "date", value: "2026-11-08" },
      materialsAt: unknownTime(),
      eventAt: unknownTime(),
      timeNote: "仅报名截止有日期，其余未知，不自动补齐。",
      conflict: true,
      registration: "以官方原文为准",
      order: 0,
      sourceIds: ["example-notice-ref"],
    },
  ],
});
export const reviewExamples: ReviewRecord[] = Array.from(
  { length: 12 },
  (_, i) => {
    const id = `example-candidate-${i + 1}`;
    const targetId =
      i % 3 === 0
        ? "notice-" + id
        : i % 3 === 1
          ? "example-draft"
          : "example-published";
    const status = (["pending", "approved", "imported", "rejected"] as const)[
      i % 4
    ]!;
    const batch = patch(targetId);
    if (status !== "pending") batch.notices[0]!.checkedAt = "2026-10-19";
    const before =
      targetId.startsWith("notice-") && status !== "imported"
        ? null
        : patch(targetId);
    if (before) {
      before.name = "示例创新设计竞赛（原正式名称）";
      before.stages[0]!.deadline = { precision: "date", value: "2026-11-01" };
    }
    return {
      id,
      title: `示例通知 ${i + 1}：创新设计竞赛报名及材料安排`,
      status,
      date: "2026-10-18",
      versions: ["example-v2", "example-v1"],
      latestVersion: "example-v2",
      material: {
        format: 1,
        operationId: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
        candidateId: id,
        sourceVersion: "example-v2",
        candidateRevision: 2,
        targetId,
        baseline: "example-formal-baseline-" + targetId,
        source: {
          id: "example-source",
          url: "https://xxgc.sicau.edu.cn/",
          finalUrl: "https://xxgc.sicau.edu.cn/",
          publisher: "示例发布单位（与承办关系无关）",
          fetchedAt: "2026-10-19T01:00:00Z",
          adapterVersion: "example-adapter-1",
          health: "待核查（示例）",
        },
        article: {
          title: "示例原文：报名及材料安排",
          publishedAt: "2026-10-18",
          text: "本页为独立审核样例，不对应真实通知。\n报名截止日期为 2026年11月8日。材料截止及比赛时间尚未明确。\n<script>window.__unsafeExecuted=true</script>\n附件仅提供链接，不下载或解析。",
          paragraphs: [
            "本页为独立审核样例，不对应真实通知。",
            "报名截止日期为 2026年11月8日。材料截止及比赛时间尚未明确。",
          ],
          attachments: [
            {
              title: "附件链接示例（不解析）",
              url: "https://xxgc.sicau.edu.cn/",
            },
          ],
        },
        previousArticle: {
          title: "示例旧通知",
          publishedAt: "2026-10-17",
          text: "旧版报名截止为2026年11月1日；承办学院及参赛范围尚未核实。",
          paragraphs: ["旧版报名截止为2026年11月1日。"],
          attachments: [],
        },
        candidate: {
          fields: {
            name: batch.name,
            edition: null,
            organizer: null,
            hosts: [],
            scope: { kind: "unknown", colleges: [], note: "" },
            startsAt: unknownTime(),
            deadline: { precision: "date", value: "2026-11-08" },
            materialsAt: unknownTime(),
            eventAt: unknownTime(),
            kind: "registration",
            mode: null,
            tracks: [],
            members: null,
            rules: [],
            stageNames: ["校内选拔"],
          },
          evidence: [
            {
              field: "deadline",
              excerpt: "报名截止日期为 2026年11月8日。",
              paragraph: 2,
              url: "https://xxgc.sicau.edu.cn/",
              sourceVersion: "example-v2",
            },
          ],
          missing: ["承办学院", "参赛范围", "报名开始", "材料截止", "比赛时间"],
          conflicts: ["旧通知截止为11月1日，新通知为11月8日，需人工确认。"],
          warnings: [
            "不能从发布单位推断承办学院。",
            "附件未解析，须人工核对。",
          ],
        },
        mergeSuggestions: [],
        formalBefore: before,
        batch: { competitions: [batch] },
        checkedAt: status === "pending" ? null : "2026-10-19",
        resolution:
          status === "pending"
            ? ""
            : "示例既有核对理由；不是本次审核成功记录。",
      },
    };
  },
);
export const exampleReview: ReviewService = {
  async list(kind, query) {
    const rows =
      kind === "notices"
        ? reviewExamples.map((row, i) => ({
            ...row,
            id: `example-notice-${i + 1}`,
          }))
        : reviewExamples;
    return queryPage(rows, query);
  },
  async detail(_kind, id, version, targetId) {
    const index = Number(id.split("-").at(-1)) - 1;
    const original = reviewExamples[index];
    if (!original) throw new ConsoleError(404, "not found");
    const row = structuredClone({ ...original, id });
    if (version && !row.versions.includes(version))
      throw new ConsoleError(404, "version not found");
    if (version === "example-v1") {
      row.material.sourceVersion = version;
      row.material.candidateRevision = 1;
      row.material.article = row.material.previousArticle!;
      row.material.previousArticle = null;
      row.material.candidate.evidence = [];
      row.material.candidate.fields.deadline = {
        precision: "date",
        value: "2026-11-01",
      };
      row.material.batch.competitions[0]!.stages![0]!.deadline = {
        precision: "date",
        value: "2026-11-01",
      };
    }
    if (targetId) {
      row.requiresReapproval = true;
      const next = patch(targetId);
      row.material.targetId = targetId;
      row.material.batch = { competitions: [next] };
      row.material.formalBefore =
        targetId === "example-draft" || targetId === "example-published"
          ? patch(targetId)
          : null;
      row.material.baseline = "example-formal-baseline-" + targetId;
      row.material.checkedAt = null;
      row.material.resolution = "";
    }
    return row;
  },
  preview: unavailableReview.preview,
  change: unavailableReview.change,
};
