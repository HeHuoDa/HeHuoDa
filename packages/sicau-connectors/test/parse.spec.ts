import {
  parseCandidate,
  extractDates,
  extractArticle,
  sources,
  type Article,
} from "../dist/notices/index.js";

import { informationArticle } from "./fixtures.js";

const url = "https://xxgc.sicau.edu.cn/info/1043/100.htm";
const directory = [
  { id: "science", name: "理学院", order: 0 },
  { id: "law", name: "法学院", order: 1 },
];
const article = (
  paragraphs: string[],
  title = "2026年测试竞赛报名通知",
): Article => ({
  title,
  publishedAt: "2026-10-08",
  text: paragraphs.join("\n"),
  paragraphs,
  attachments: [],
});
describe("候选领域解析", () => {
  it("不组队不误判团队，主办/承办单位与独立资格段落有明确证据", () => {
    const parsed = parseCandidate(
      article([
        "主办单位：四川农业大学教务处",
        "承办单位：四川农业大学理学院",
        "三、参赛对象",
        "我校全日制在校本科生，年级、专业不限。",
        "竞赛为个人赛，独立参赛，不组队。",
      ]),
      url,
      directory,
    );
    expect(parsed.fields).toMatchObject({
      organizer: "四川农业大学教务处",
      hosts: ["science"],
      scope: { kind: "all" },
      mode: "individual",
    });
  });
  it("发布网站不是承办学院，分开报名/材料/比赛时间和24:00证据", () => {
    const parsed = parseCandidate(
      extractArticle(informationArticle, url, sources[0]),
      url,
      directory,
    );
    expect(parsed.fields).toMatchObject({
      hosts: ["science"],
      organizer: "四川农业大学",
      scope: { kind: "all", colleges: [] },
      mode: "team",
      deadline: { precision: "instant", value: "2026-10-20T16:00:00.000Z" },
      materialsAt: { precision: "date", value: "2026-10-22" },
      eventAt: { precision: "date", value: "2026-10-25" },
    });
    expect(parsed.evidence).toContainEqual({
      field: "deadline",
      excerpt: "报名截止：2026年10月20日24:00",
      paragraph: 3,
      url,
    });
    expect(parsed.warnings).toContain("附件仅记录链接，未解析或核实附件规则");
    expect(
      parseCandidate(
        article(["学院转发该比赛通知，请同学们留意。"]),
        url,
        directory,
      ).fields.hosts,
    ).toEqual([]);
  });
  it("指定学院、未知学院和复杂资格条款不猜测", () => {
    expect(
      parseCandidate(article(["参赛对象：理学院学生。"]), url, directory).fields
        .scope,
    ).toMatchObject({ kind: "colleges", colleges: ["science"] });
    const unknown = parseCandidate(
      article(["参赛对象：未知学院学生。"]),
      url,
      directory,
    );
    expect(unknown.fields.scope.kind).toBe("complex");
    expect(unknown.warnings).toContain("资格条款含未知学院名称");
    const mixed = parseCandidate(
      article(["由理学院、未知学院承办。", "参赛对象：理学院、未知学院学生。"]),
      url,
      directory,
    );
    expect(mixed.fields.scope).toMatchObject({ kind: "complex", colleges: [] });
    expect(mixed.warnings).toContain("资格条款含未知学院名称");
    expect(mixed.warnings).toContain("承办单位尚未匹配学院目录，待核对");
    expect(
      parseCandidate(
        article(["参赛对象：全校学生（未知学院除外）。"]),
        url,
        directory,
      ).warnings,
    ).toContain("资格条款含未知学院名称");
  });
  it("显式赛道、人数和规则保存候选原文证据，不猜测各赛道归属", () => {
    const parsed = parseCandidate(
      article([
        "赛道：算法挑战、应用开发。",
        "组队要求：每组4人。",
        "参赛规则：作品须独立完成。",
      ]),
      url,
      directory,
    );
    expect(parsed.fields.tracks).toEqual([
      { name: "算法挑战", mode: null, members: null, rules: null },
      { name: "应用开发", mode: null, members: null, rules: null },
    ]);
    expect(parsed.fields.members).toBe("每组4人");
    expect(parsed.fields.rules).toContain("参赛规则：作品须独立完成。");
    expect(parsed.evidence).toContainEqual({
      field: "tracks.0.name",
      excerpt: "赛道：算法挑战、应用开发。",
      paragraph: 0,
      url,
    });
    expect(
      parsed.warnings.some((warning) => warning.includes("赛道人数")),
    ).toBe(true);
  });
  it.each([
    ["个人赛", "individual"],
    ["团队赛", "team"],
    ["个人赛及团队赛", "mixed"],
  ])("%s 的模式有原文依据", (word, mode) =>
    expect(parseCandidate(article([word]), url, directory).fields.mode).toBe(
      mode,
    ),
  );
  it("年份冲突、多个赛段和相对时间留待核对", () => {
    const conflict = parseCandidate(
      article([
        "2025年举办院赛，2026年举办校赛。报名截止：2026年10月20日24:00。",
      ]),
      url,
      directory,
    );
    expect(conflict.fields.edition).toBeNull();
    expect(conflict.fields.deadline).toEqual({
      precision: "unknown",
      value: null,
    });
    expect(conflict.fields.stageNames).toEqual(["院赛", "校赛"]);
    expect(conflict.conflicts.length).toBeGreaterThanOrEqual(2);
    expect(
      parseCandidate(
        article(["报名即日起到下周截止，其他事项另行通知。"]),
        url,
        directory,
      ).warnings.length,
    ).toBeGreaterThan(0);
  });
  it.each(["竞赛获奖名单公示", "竞赛新闻回顾"])(
    "%s 不能证明报名开放",
    (title) => {
      const parsed = parseCandidate(
        article(["报名截止：2026年10月20日24:00。"], title),
        url,
        directory,
      );
      expect(parsed.fields.deadline.precision).toBe("unknown");
      expect(parsed.fields.kind).toBe(
        title.includes("获奖") ? "award" : "news",
      );
    },
  );
  it("日期精度不补时刻，无年份依据不推断，非法日期不接受", () => {
    expect(extractDates("报名截止：10月20日", "2026")).toEqual([
      { precision: "date", value: "2026-10-20" },
    ]);
    expect(extractDates("10月20日", null)).toEqual([]);
    for (const text of [
      "2026年02月30日",
      "2026年13月01日",
      "2026年10月20日24:01",
    ])
      expect(extractDates(text, "2026")).toEqual([]);
  });
});
