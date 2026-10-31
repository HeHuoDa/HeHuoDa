import {
  fixedSources,
  defaultSettings,
  unavailableControl,
  type SourceConfig,
  type IngestionRun,
  type IngestionControlService,
} from "./ingestion-control";
import { queryPage } from "./resource";
export const sourceExamples: SourceConfig[] = fixedSources.map((s, i) => ({
  id: s.id,
  listUrl: s.listUrl,
  channels: [
    {
      id: "default",
      enabled: !i,
      settings: { ...defaultSettings },
      baseline: `example-channel-${i}`,
      verificationStatus: "verified",
      verifiedAt: "2026-10-20",
      verifiedBy: "example",
      activatedOn: "2026-10-01",
      pendingCount: 0,
      backoffUntil: null,
      failureCount: 0,
      coverage: {},
      lastSuccessfulCheck: null,
      budgetUsage: null,
      latestRound: null,
      discoveryDelay: {
        precision: "days",
        sampleCount: 0,
        averageDays: null,
        maxDays: null,
      },
    },
  ],
  title: s.publisher,
  status: i ? "disabled" : "enabled",
  date: "2026-10-20",
  enabled: !i,
  settings: { ...defaultSettings },
  baseline: `example-source-${i}`,
  availability: i ? "disabled" : "idle",
  lastRunId: `example-run-${i + 1}`,
}));
export const runExamples: IngestionRun[] = Array.from(
  { length: 12 },
  (_, i) => ({
    id: `example-run-${i + 1}`,
    title: `示例 · ${fixedSources[i % 2]!.publisher}通知扫描`,
    status: (
      ["partial", "running", "succeeded", "failed", "interrupted"] as const
    )[i % 5]!,
    date: "2026-10-20",
    sourceId: fixedSources[i % 2]!.id,
    range: { from: "2026-07-23", to: "2026-10-20", url: "" },
    trigger: i % 3 === 0 ? "resume" : i % 3 === 1 ? "scheduled" : "manual",
    settings: { ...defaultSettings },
    counts: {
      discovered: 80,
      new: 12,
      changed: 3,
      unchanged: 55,
      ignored: 5,
      failed: i % 5 === 2 ? 0 : 5,
    },
    errors:
      i % 5 === 2
        ? []
        : [
            {
              message:
                i % 5 === 0
                  ? "请求预算耗尽，仍有列表及通知待处理。"
                  : "示例网络错误，请重新查询状态后核对。",
              url: fixedSources[i % 2]!.listUrl,
              kind: i % 5 === 0 ? "budget" : "request",
            },
          ],
    cursor: {
      pages: i % 5 === 2 ? 0 : 2,
      pending: i % 5 === 2 ? 0 : 8,
      seen: 80,
    },
    previousRunId: i === 0 ? "example-run-11" : null,
    nextRunId: i === 10 ? "example-run-1" : null,
  }),
);
export const exampleControl: IngestionControlService = {
  ...unavailableControl,
  async sources() {
    return structuredClone(sourceExamples);
  },
  async runs(query, sourceId) {
    return queryPage(
      runExamples.filter((r) => !sourceId || r.sourceId === sourceId),
      query,
    );
  },
  async run(id) {
    const run = runExamples.find((r) => r.id === id);
    if (!run) throw new Error("未找到运行示例");
    return structuredClone(run);
  },
};
