import "dotenv/config";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { Pool } from "pg";
import { IngestionRunner, type ScanPhase } from "../src/ingestion/runner.js";
import { sources, sourceById } from "@hehuoda/sicau-connectors/notices";
import {
  approveReview,
  applyReview,
  exportReview,
  publishImported,
  setReviewState,
} from "../src/ingestion/review.js";
import {
  cleanupResponses,
  initializeSources,
  configureSource,
  recoverInterruptedRuns,
  transaction,
} from "../src/ingestion/store.js";
import { refreshExtraction } from "../src/ingestion/extraction-store.js";

const args = process.argv.slice(2),
  command = args.shift();
const values: Record<string, string> = {},
  flags = new Set<string>();
const valueNames = new Set([
  "source",
  "channel",
  "phase",
  "rebuild-task",
  "from",
  "to",
  "url",
  "resume",
  "candidate",
  "target",
  "out",
  "file",
  "reviewer",
  "reason",
  "baseline",
  "days",
  "enabled",
  "pages",
  "requests",
  "interval",
  "timeout",
  "duration",
  "bytes",
  "frequency",
]);
const flagNames = new Set(["preview", "confirm-published"]);
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  connectionTimeoutMillis: 5000,
});
const stop = new AbortController();
const interrupt = () => stop.abort();
process.on("SIGINT", interrupt);
process.on("SIGTERM", interrupt);
try {
  while (args.length) {
    const argument = args.shift()!;
    if (!argument.startsWith("--")) throw new Error("参数须使用 --name value");
    const name = argument.slice(2);
    if (values[name] !== undefined || flags.has(name))
      throw new Error("重复参数：" + name);
    if (flagNames.has(name)) flags.add(name);
    else if (valueNames.has(name) && args[0] && !args[0].startsWith("--"))
      values[name] = args.shift()!;
    else throw new Error("未知参数或缺少值：" + name);
  }
  if (!process.env.DATABASE_URL)
    throw new Error("需要 DATABASE_URL；先执行 db:migrate");
  const need = (name: string) => {
    if (!values[name]) throw new Error("需要 --" + name);
    return values[name];
  };
  const options = {
    preview: flags.has("preview"),
    confirmPublished: flags.has("confirm-published"),
  };
  const allowedByCommand: Record<string, string[]> = {
    scan: [
      "source",
      "channel",
      "phase",
      "rebuild-task",
      "from",
      "to",
      "url",
      "resume",
      "preview",
    ],
    sources: [],
    runs: [],
    candidates: [],
    reextract: ["candidate"],
    operations: [],
    configure: [
      "source",
      "enabled",
      "pages",
      "requests",
      "interval",
      "timeout",
      "duration",
      "bytes",
      "frequency",
    ],
    export: ["candidate", "target", "out"],
    approve: ["file", "reviewer"],
    apply: ["file", "reviewer", "preview", "confirm-published"],
    reject: ["candidate", "reviewer", "reason"],
    reopen: ["candidate", "reviewer", "reason"],
    publish: [
      "candidate",
      "reviewer",
      "baseline",
      "preview",
      "confirm-published",
    ],
    cleanup: ["days"],
  };
  if (
    !command ||
    !allowedByCommand[command] ||
    [...Object.keys(values), ...flags].some(
      (name) => !allowedByCommand[command].includes(name),
    )
  )
    throw new Error("命令或参数组合无效");
  const input = async () =>
    JSON.parse(await readFile(need("file"), "utf8")) as unknown;
  let result: unknown;
  switch (command) {
    case "reextract": {
      const row = (
        await pool.query(
          "SELECT notice_id FROM ingestion_candidates WHERE id=$1",
          [need("candidate")],
        )
      ).rows[0];
      if (!row) throw new Error("候选不存在");
      await transaction(pool, (client) =>
        refreshExtraction(client, row.notice_id),
      );
      result = {
        candidateId: values.candidate,
        status: "refreshed-from-snapshots",
      };
      break;
    }
    case "scan": {
      const phase = (value: string | undefined): ScanPhase | undefined => {
        if (
          value === undefined ||
          value === "fresh" ||
          value === "backfill" ||
          value === "revisit" ||
          value === "retry"
        )
          return value;
        throw new Error("--phase 须为 fresh/backfill/revisit/retry");
      };
      if (values.resume && (values.url || values.from || values.to))
        throw new Error("续跑沿用原记录范围，不能同时指定 URL 或日期");
      const selected = values.source
        ? sources.filter((s) => s.id === values.source)
        : sources;
      if (
        !selected.length ||
        (values.url && !values.source) ||
        (values.resume && !values.source) ||
        (values.channel && !values.source) ||
        (values["rebuild-task"] && (!values.source || !values.phase))
      )
        throw new Error("URL 重跑/续跑须指定有效 --source");
      const runner = new IngestionRunner(pool),
        scans = [];
      for (const source of selected)
        scans.push(
          await runner.scan(
            {
              sourceId: source.id,
              channelId: values.channel,
              phase: phase(values.phase),
              rebuildTaskId: values["rebuild-task"],
              from: values.from,
              to: values.to,
              url: values.url,
              resume: values.resume,
              preview: options.preview,
            },
            stop.signal,
          ),
        );
      if (scans.some((s) => s.status !== "succeeded")) process.exitCode = 1;
      result = scans;
      break;
    }
    case "sources":
      await initializeSources(pool);
      result = (await pool.query("SELECT * FROM ingestion_sources ORDER BY id"))
        .rows;
      break;
    case "runs":
      await recoverInterruptedRuns(pool);
      result = (
        await pool.query(
          "SELECT * FROM ingestion_runs ORDER BY started_at DESC LIMIT 30",
        )
      ).rows;
      break;
    case "candidates":
      result = (
        await pool.query(
          "SELECT c.*,n.url,n.health FROM ingestion_candidates c JOIN ingestion_notices n ON n.id=c.notice_id ORDER BY c.updated_at DESC LIMIT 100",
        )
      ).rows;
      break;
    case "operations":
      result = (
        await pool.query(
          "SELECT id,candidate_id,source_version,candidate_revision,kind,reviewer,created_at,result FROM ingestion_operations ORDER BY created_at DESC LIMIT 100",
        )
      ).rows;
      break;
    case "configure": {
      await initializeSources(pool);
      const source = sourceById(need("source"));
      if (values.enabled !== "true" && values.enabled !== "false")
        throw new Error("--enabled 须为 true 或 false");
      const settings: Record<string, number> = {};
      for (const [option, key] of Object.entries({
        pages: "maxPages",
        requests: "requests",
        interval: "intervalMs",
        timeout: "timeoutMs",
        duration: "durationMs",
        bytes: "bytes",
        frequency: "frequencyMinutes",
      }))
        if (values[option] !== undefined)
          settings[key] = Number(values[option]);
      result = await configureSource(
        pool,
        source,
        values.enabled === "true",
        settings,
      );
      break;
    }
    case "export": {
      result = await exportReview(pool, need("candidate"), values.target);
      const out = need("out");
      await mkdir(dirname(out), { recursive: true });
      await writeFile(out, JSON.stringify(result, null, 2) + "\n", {
        encoding: "utf8",
        flag: "wx",
      });
      console.log("审核文件已导出：" + out);
      break;
    }
    case "approve":
      result = await approveReview(pool, await input(), need("reviewer"));
      break;
    case "apply":
      result = await applyReview(
        pool,
        await input(),
        need("reviewer"),
        options,
      );
      break;
    case "reject":
    case "reopen":
      result = await setReviewState(
        pool,
        need("candidate"),
        command,
        need("reviewer"),
        need("reason"),
      );
      break;
    case "publish":
      result = await publishImported(
        pool,
        need("candidate"),
        need("reviewer"),
        need("baseline"),
        options,
      );
      break;
    case "cleanup":
      result = await cleanupResponses(
        pool,
        values.days === undefined
          ? Number(process.env.INGESTION_RAW_DAYS ?? 30)
          : Number(values.days),
      );
      break;
    default:
      throw new Error(
        "命令：scan | sources | runs | candidates | export | approve | apply | reject | reopen | publish | cleanup",
      );
  }
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(
    error instanceof Error && !("code" in error)
      ? error.message
      : "采集/审核失败：检查数据库与配置；事务已回滚，不输出凭据",
  );
  process.exitCode = 1;
} finally {
  process.off("SIGINT", interrupt);
  process.off("SIGTERM", interrupt);
  await pool.end();
}
