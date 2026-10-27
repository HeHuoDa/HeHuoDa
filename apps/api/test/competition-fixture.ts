import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { migrate } from "../src/database/migrate.js";
import type {
  ImportBatch,
  ImportCompetition,
} from "../src/competitions/import.js";
export async function testDatabase(migrationDirectory?: string) {
  const raw = process.env.TEST_DATABASE_URL;
  if (!raw || !new URL(raw).pathname.endsWith("_test"))
    throw new Error(
      "真实数据库测试需要独立 TEST_DATABASE_URL，数据库名称须以 _test 结尾",
    );
  if (raw === process.env.DATABASE_URL)
    throw new Error("测试连接不能与开发连接相同");
  const admin = new Pool({ connectionString: raw });
  const schema = "test_" + randomUUID().replaceAll("-", "");
  await admin.query('CREATE SCHEMA "' + schema + '"');
  const url = new URL(raw);
  url.searchParams.set("options", "-c search_path=" + schema);
  const pool = new Pool({ connectionString: url.toString() });
  await migrate(pool, migrationDirectory);
  return {
    pool,
    url: url.toString(),
    async close() {
      await pool.end();
      await admin.query('DROP SCHEMA "' + schema + '" CASCADE');
      await admin.end();
    },
  };
}
export function edition(
  id = "alpha",
  extra: Partial<ImportCompetition> = {},
): ImportCompetition {
  return {
    id,
    name: "测试比赛 " + id,
    edition: "2026",
    category: "测试",
    organizer: "学校",
    origin: "official",
    publication: "published",
    notices: [
      {
        id: id + "-notice",
        title: "报名通知",
        publisher: "学校",
        url: "https://sicau.edu.cn/info/1.htm",
        publishedAt: "2026-09-01",
        checkedAt: "2026-10-04",
        kind: "registration",
      },
    ],
    tracks: [
      {
        id: id + "-track",
        name: "团队",
        mode: "team",
        members: "3 人",
        rules: "核对原文",
      },
    ],
    stages: [
      {
        id: id + "-stage",
        name: "校赛",
        organizer: "学院",
        hosts: ["law", "science"],
        scope: { kind: "all", colleges: [], note: "全校" },
        startsAt: { precision: "instant", value: "2026-10-08T10:00:00+08:00" },
        deadline: { precision: "instant", value: "2026-10-13T18:00:00+08:00" },
        registration: "官方入口",
        sourceIds: [id + "-notice"],
        order: 0,
      },
    ],
    ...extra,
  };
}
export const directory: ImportBatch["colleges"] = [
  { id: "law", name: "法学院", order: 0 },
  { id: "science", name: "理学院", order: 1 },
];
