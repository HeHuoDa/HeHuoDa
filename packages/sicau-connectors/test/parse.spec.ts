import {
  parseCandidate,
  parseEvidenceCandidate,
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
  it("院校审核报送阶段不能当作参赛者材料截止", () => {
    const parsed = parseCandidate(
      article(
        [
          "11月5日-11日：报名、准备作品。",
          "11月12日-13日：作品审核、筛选、报送优秀作品参与教育部组织的展示活动。",
        ],
        "关于开展2026年高校“礼敬中华优秀传统文化”宣传教育活动的通知",
      ),
      url,
      directory,
    );
    expect(parsed.fields.materialsAt).toEqual({
      precision: "unknown",
      value: null,
    });
    expect(
      parsed.conflicts.some((conflict) => conflict.startsWith("materialsAt")),
    ).toBe(true);
  });
  it("参赛者本人的提交截止仍可确定，不被主体校验误伤", () => {
    expect(
      parseCandidate(
        article(["参赛者须于2026年11月10日前提交作品。"]),
        url,
        directory,
      ).fields.materialsAt,
    ).toEqual({ precision: "date", value: "2026-11-10" });
    expect(
      parseCandidate(
        article(["各参赛队于11月10日前将作品报送至学院。"]),
        url,
        directory,
      ).fields.materialsAt,
    ).toEqual({ precision: "date", value: "2026-11-10" });
  });
  it("组织方汇总报送的时间不升级为材料截止", () => {
    expect(
      parseCandidate(
        article(["学院于11月12日前汇总报送作品。"]),
        url,
        directory,
      ).fields.materialsAt,
    ).toEqual({ precision: "unknown", value: null });
  });
  it.each([
    ["学校报送作品截止2026年11月12日。"],
    ["作品报送截止2026年11月12日。"],
    ["请于2026年11月12日前报送作品。"],
  ])("「截止」不代替义务主体判断：%s", (paragraph) => {
    expect(
      parseCandidate(article([paragraph]), url, directory).fields.materialsAt,
    ).toEqual({ precision: "unknown", value: null });
  });
  it("短的无编号句子是正文而不是标题", () => {
    expect(
      parseCandidate(article(["二、参赛对象", "理学院本科生"]), url, directory)
        .fields.scope,
    ).toMatchObject({ kind: "colleges", colleges: ["science"] });
  });
  it("同一段里的规则句不被误判成标题而丢弃", () => {
    expect(
      parseCandidate(article(["参赛要求为原创作品"]), url, directory).fields
        .rules,
    ).toEqual(["参赛要求为原创作品"]);
  });
  it("编号标题冒号后的同段正文保留字段值和原文定位", () => {
    const paragraphs = [
      "二、参赛对象：理学院本科生",
      "四、参赛要求：原创作品",
    ];
    const parsed = parseEvidenceCandidate(
      article(paragraphs),
      url,
      directory,
      "notice-v1",
    );
    expect(parsed.fields.scope).toMatchObject({
      kind: "colleges",
      colleges: ["science"],
    });
    expect(parsed.fields.rules).toEqual([paragraphs[1]]);
    expect(parsed.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: "scope",
          paragraph: 0,
          excerpt: paragraphs[0],
          noticeVersion: "notice-v1",
        }),
        expect.objectContaining({
          field: "rules",
          paragraph: 1,
          excerpt: paragraphs[1],
          noticeVersion: "notice-v1",
        }),
      ]),
    );
  });
  it("带冒号的小节标题不进入规则取值", () => {
    expect(
      parseCandidate(
        article(["四、参赛要求：", "作品须原创。"]),
        url,
        directory,
      ).fields.rules,
    ).toEqual(["作品须原创。"]);
  });
  it.each(["参赛要求", "参赛要求：", "四、参赛要求："])(
    "纯标题 %s 读取所属正文并在下一节停止",
    (heading) => {
      const parsed = parseEvidenceCandidate(
        article([heading, "", "作品须原创。", "报名方式", "在线填写报名表。"]),
        url,
        directory,
        "notice-v1",
      );
      expect(parsed.fields.rules).toEqual(["作品须原创。"]);
      expect(parsed.evidence.filter((entry) => entry.field === "rules")).toEqual([
        expect.objectContaining({
          excerpt: "作品须原创。",
          paragraph: 2,
          noticeVersion: "notice-v1",
        }),
      ]);
    },
  );
  it("末尾无编号纯标题不支撑规则或范围", () => {
    const parsed = parseCandidate(
      article(["参赛要求", "报名对象"]),
      url,
      directory,
    );
    expect(parsed.fields.rules).toEqual([]);
    expect(parsed.fields.scope.kind).toBe("unknown");
    expect(
      parsed.evidence.filter((entry) => ["rules", "scope"].includes(entry.field)),
    ).toEqual([]);
  });
  it("资格小节读取全部正文，后续限制条款不被截断", () => {
    const parsed = parseCandidate(
      article([
        "二、参赛对象",
        "全校学生。",
        "不含毕业年级学生。",
        "三、报名方式",
      ]),
      url,
      directory,
    );
    expect(parsed.fields.scope.kind).toBe("complex");
    expect(parsed.fields.scope.note).toContain("不含毕业年级学生");
    expect(
      parsed.evidence
        .filter((entry) => entry.field === "scope")
        .map((entry) => entry.paragraph),
    ).toEqual([1, 2]);
  });
  it("资格标题与正文跨来源时保持未知，不加关联", () => {
    const parsed = parseEvidenceCandidate(
      article(["二、参赛对象"]),
      url,
      directory,
      "notice-v1",
      [
        {
          format: "docx",
          url: "https://example.edu/a.docx",
          noticeVersion: "notice-v1",
          attachmentVersion: "attachment-v1",
          segments: [{ kind: "paragraph", index: 1, text: "理学院学生。" }],
        },
      ],
    );
    expect(parsed.fields.scope).toEqual({
      kind: "unknown",
      colleges: [],
      note: "跨来源资格标题不能自动关联",
    });
    expect(parsed.conflicts).toContain(
      "资格标题与内容分属不同来源，须人工核对",
    );
  });
  it("小节标题不能单独作为参赛规则证据", () => {
    const parsed = parseCandidate(
      article([
        "四、参赛要求",
        "以班级为单位参赛，每班限参加1个作品，作品须为原创。",
      ]),
      url,
      directory,
    );
    expect(parsed.fields.rules).not.toContain("四、参赛要求");
    expect(parsed.fields.rules.join("\n")).toContain("每班限参加1个作品");
  });
  it("资格小节标题不能单独作为参赛范围证据", () => {
    expect(
      parseCandidate(
        article(["二、参赛对象及要求", "理学院在校本科生。"]),
        url,
        directory,
      ).fields.scope,
    ).toMatchObject({ kind: "colleges", colleges: ["science"] });
  });
  it("整篇聚合时证据落到真实段落，不把小节标题当引用", () => {
    const parsed = parseEvidenceCandidate(
      article([
        "四、参赛要求",
        "以班级为单位参赛，每班限参加1个作品，作品须为原创。",
        "二、参赛对象及要求",
        "理学院在校本科生。",
      ]),
      url,
      directory,
      "notice-v1",
    );
    expect(parsed.fields.rules).toEqual([
      "以班级为单位参赛，每班限参加1个作品，作品须为原创。",
    ]);
    expect(parsed.fields.scope).toMatchObject({
      kind: "colleges",
      colleges: ["science"],
    });
    expect(
      parsed.evidence
        .filter((entry) => entry.field === "rules" || entry.field === "scope")
        .map((entry) => [entry.field, entry.paragraph, entry.excerpt]),
    ).toEqual(
      expect.arrayContaining([
        ["rules", 1, "以班级为单位参赛，每班限参加1个作品，作品须为原创。"],
        ["scope", 3, "理学院在校本科生。"],
      ]),
    );
    expect(
      parsed.evidence.filter(
        (entry) =>
          (entry.field === "rules" || entry.field === "scope") &&
          /参赛要求|参赛对象/.test(entry.excerpt),
      ),
    ).toHaveLength(0);
  });
  it("只在末尾出现资格小节标题时保留未知并提示，不编造范围", () => {
    const parsed = parseEvidenceCandidate(
      article(["二、参赛对象及要求"]),
      url,
      directory,
      "notice-v1",
    );
    expect(parsed.fields.scope).toEqual({
      kind: "unknown",
      colleges: [],
      note: "参赛范围待核对",
    });
    expect(
      parsed.evidence.filter((entry) => entry.field === "scope"),
    ).toHaveLength(0);
    expect(parsed.warnings).toContain(
      "资格小节标题下未读取到正文，参赛范围待核对",
    );
  });
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
