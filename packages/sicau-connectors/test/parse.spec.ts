import {
  classifyNotice,
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
      modeKind: "individual",
    });
    // 否定式「不组队」先按否定处理；mode 保留剥离否定后的原文。
    expect(parsed.fields.mode).toContain("个人赛");
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
      modeKind: "team",
      deadline: { precision: "instant", value: "2026-10-20T16:00:00.000Z" },
      // The fixture labels a materials deadline without stating the submitting actor.
      materialsAt: { precision: "unknown", value: null },
      eventAt: { precision: "date", value: "2026-10-25" },
    });
    expect(parsed.evidence).toContainEqual({
      field: "deadline",
      excerpt: "报名截止：2026年10月20日24:00",
      paragraph: 3,
      url,
    });
    expect(parsed.warnings).toContain("附件仅记录链接，未解析或核实附件规则");
    expect(parsed.conflicts).toContain(
      "materialsAt 主体不明，保留原文待人工核对",
    );
    expect(parsed.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: "materialsAt",
          excerpt: "材料提交截止：2026年10月22日",
        }),
      ]),
    );
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
    ).toMatchObject({ kind: "specified", colleges: ["science"] });
    const unknown = parseCandidate(
      article(["参赛对象：未知学院学生。"]),
      url,
      directory,
    );
    expect(unknown.fields.scope.kind).toBe("other");
    expect(unknown.warnings).toContain("资格条款含未知学院名称");
    const mixed = parseCandidate(
      article(["由理学院、未知学院承办。", "参赛对象：理学院、未知学院学生。"]),
      url,
      directory,
    );
    expect(mixed.fields.scope).toMatchObject({ kind: "other", colleges: [] });
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
      { name: "算法挑战", modeKind: null, members: null, rules: null },
      { name: "应用开发", modeKind: null, members: null, rules: null },
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
  ])("%s 的模式有原文依据", (word, mode) => {
    const parsed = parseCandidate(article([word]), url, directory);
    expect(parsed.fields.modeKind).toBe(mode);
    // mode 保留原文短语，协议 fields.mode 比较这一层。
    expect(parsed.fields.mode).toBe(word);
  });
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
      // 通知种类由 classifyNotice 决定；候选字段不再承载它。
      const classification = classifyNotice(title, [
        "报名截止：2026年10月20日24:00。",
      ]);
      expect(classification.notificationKind).toBe(
        title.includes("获奖") ? "award" : "news",
      );
      expect(parsed.fields).not.toHaveProperty("kind");
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
  it.each([
    ["参赛者于2026年11月5日至2026年11月10日提交作品。", "date", "2026-11-10"],
    ["参赛者于2026年11月5日-10日提交作品。", "date", "2026-11-10"],
    ["参赛者于2026年11月5日–2026年11月10日提交作品。", "date", "2026-11-10"],
    ["参赛者于2026年11月5日–10日提交作品。", "date", "2026-11-10"],
    [
      "参赛者于2026年11月5日09:00至2026年11月10日18:00提交作品。",
      "instant",
      "2026-11-10T18:00:00+08:00",
    ],
  ])("明确材料提交窗口取终点且保留原文：%s", (paragraph, precision, value) => {
    const parsed = parseEvidenceCandidate(
      article([paragraph]),
      url,
      directory,
      "notice-v1",
    );
    expect(parsed.fields.materialsAt).toEqual({ precision, value });
    expect(parsed.fields.deadline).toEqual({
      precision: "unknown",
      value: null,
    });
    expect(parsed.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: "materialsAt",
          paragraph: 0,
          excerpt: paragraph.replace(/。$/, ""),
          noticeVersion: "notice-v1",
        }),
      ]),
    );
  });
  it.each([false, true])(
    "院校转交不阻断明确参赛者截止，顺序反转=%s",
    (reverse) => {
      const paragraphs = [
        "学院于2026年11月12日前汇总报送作品。",
        "参赛者于2026年11月10日前提交作品。",
      ];
      if (reverse) paragraphs.reverse();
      const parsed = parseEvidenceCandidate(
        article(paragraphs),
        url,
        directory,
        "notice-v1",
      );
      expect(parsed.fields.materialsAt).toEqual({
        precision: "date",
        value: "2026-11-10",
      });
      expect(
        parsed.evidence.filter((entry) => entry.field === "materialsAt"),
      ).toEqual(
        expect.arrayContaining(
          paragraphs.map((paragraph, index) =>
            expect.objectContaining({
              paragraph: index,
              excerpt: paragraph.replace(/。$/, ""),
              noticeVersion: "notice-v1",
            }),
          ),
        ),
      );
    },
  );
  it("同段逗号分隔的参赛者提交和院校报送分别核对主体", () => {
    const parsed = parseEvidenceCandidate(
      article([
        "参赛者于2026年11月10日前提交作品，学院于2026年11月12日前统一报送。",
      ]),
      url,
      directory,
      "notice-v1",
    );
    expect(parsed.fields.materialsAt).toEqual({
      precision: "date",
      value: "2026-11-10",
    });
    expect(
      parsed.evidence.filter((entry) => entry.field === "materialsAt"),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          paragraph: 0,
          excerpt: "参赛者于2026年11月10日前提交作品",
        }),
        expect.objectContaining({
          paragraph: 0,
          excerpt: "学院于2026年11月12日前统一报送",
        }),
      ]),
    );
  });
  it("材料提交截止标签本身不证明义务主体", () => {
    const parsed = parseEvidenceCandidate(
      article(["作品提交截止2026年11月10日。"]),
      url,
      directory,
      "notice-v1",
    );
    expect(parsed.fields.materialsAt).toEqual({
      precision: "unknown",
      value: null,
    });
    expect(parsed.conflicts).toContain(
      "materialsAt 主体不明，保留原文待人工核对",
    );
  });
  it.each([false, true])(
    "主体不明日期不被明确截止覆盖，顺序反转=%s",
    (reverse) => {
      const paragraphs = [
        "作品报送截止2026年11月12日。",
        "参赛者于2026年11月10日前提交作品。",
      ];
      if (reverse) paragraphs.reverse();
      const parsed = parseEvidenceCandidate(
        article(paragraphs),
        url,
        directory,
        "notice-v1",
      );
      expect(parsed.fields.materialsAt).toEqual({
        precision: "unknown",
        value: null,
      });
      expect(parsed.conflicts).toContain(
        "materialsAt 主体不明，保留原文待人工核对",
      );
      expect(
        parsed.evidence.filter((entry) => entry.field === "materialsAt"),
      ).toHaveLength(2);
    },
  );
  it.each([
    "参赛者于2026年11月10日至2026年11月5日提交作品。",
    "参赛者于2026年11月5日至2026年11月40日提交作品。",
    "参赛者于2026年11月5日、2026年11月10日提交作品。",
  ])("无法确定的材料窗口保持未知并保留原文：%s", (paragraph) => {
    const parsed = parseEvidenceCandidate(
      article([paragraph]),
      url,
      directory,
      "notice-v1",
    );
    expect(parsed.fields.materialsAt).toEqual({
      precision: "unknown",
      value: null,
    });
    expect(parsed.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: "materialsAt",
          paragraph: 0,
          excerpt: paragraph.replace(/。$/, ""),
        }),
      ]),
    );
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
    "各参赛队须于2026年11月10日前向理学院报送作品。",
    "理学院组织各参赛队于2026年11月10日前提交作品。",
  ])("学院作为接收方或组织方时保留明确的参赛者截止：%s", (paragraph) => {
    const parsed = parseEvidenceCandidate(
      article([paragraph]),
      url,
      directory,
      "notice-v1",
    );
    expect(parsed.fields.materialsAt).toEqual({
      precision: "date",
      value: "2026-11-10",
    });
    expect(
      parsed.conflicts.filter((entry) => entry.startsWith("materialsAt")),
    ).toEqual([]);
  });
  it.each([
    "各参赛队的作品由学院于2026年11月12日前统一报送。",
    "学校提交作品截止2026年11月12日。",
  ])("材料时间按实际义务主体保留未知：%s", (paragraph) => {
    const parsed = parseEvidenceCandidate(
      article([paragraph]),
      url,
      directory,
      "notice-v1",
    );
    expect(parsed.fields.materialsAt).toEqual({
      precision: "unknown",
      value: null,
    });
    expect(parsed.conflicts).toContain(
      "materialsAt 主体为院校审核或报送，不能作为参赛者材料截止",
    );
    expect(parsed.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: "materialsAt",
          excerpt: paragraph.replace(/。$/, ""),
          paragraph: 0,
          noticeVersion: "notice-v1",
        }),
      ]),
    );
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
    ).toMatchObject({ kind: "specified", colleges: ["science"] });
  });
  it("同一段里的规则句不被误判成标题而丢弃", () => {
    expect(
      parseCandidate(article(["参赛要求为原创作品"]), url, directory).fields
        .rules,
    ).toEqual(["参赛要求为原创作品"]);
  });
  it("编号标题冒号后的同段正文保留字段值和原文定位", () => {
    const paragraphs = ["二、参赛对象：理学院本科生", "四、参赛要求：原创作品"];
    const parsed = parseEvidenceCandidate(
      article(paragraphs),
      url,
      directory,
      "notice-v1",
    );
    expect(parsed.fields.scope).toMatchObject({
      kind: "specified",
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
      expect(
        parsed.evidence.filter((entry) => entry.field === "rules"),
      ).toEqual([
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
      parsed.evidence.filter((entry) =>
        ["rules", "scope"].includes(entry.field),
      ),
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
    expect(parsed.fields.scope.kind).toBe("other");
    expect(parsed.fields.scope.note).toContain("不含毕业年级学生");
    expect(
      parsed.evidence
        .filter((entry) => entry.field === "scope")
        .map((entry) => entry.paragraph),
    ).toEqual([1, 2]);
  });
  it.each([
    "仅允许理学院学生以团队赛形式参赛。",
    "禁止理学院学生组队报名。",
    "不接受理学院学生组队报名。",
  ])("资格限制同时描述模式时不能被过滤：%s", (restriction) => {
    const parsed = parseEvidenceCandidate(
      article(["二、参赛对象", "全校本科生。", restriction, "三、报名方式"]),
      url,
      directory,
      "notice-v1",
    );
    expect(parsed.fields.scope.kind).not.toBe("all");
    expect(parsed.fields.scope.note).toContain(restriction);
    expect(parsed.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: "scope",
          excerpt: restriction,
          paragraph: 2,
          noticeVersion: "notice-v1",
        }),
      ]),
    );
    if (restriction.startsWith("禁止") || restriction.startsWith("不接受"))
      expect(parsed.fields.scope).toMatchObject({
        kind: "other",
        colleges: [],
      });
  });
  it.each(["仅以团队赛形式参赛。", "只允许团队赛形式参赛。", "仅限个人赛。"])(
    "纯模式限制不收窄全校范围：%s",
    (mode) => {
      const parsed = parseCandidate(
        article(["二、参赛对象", "全校本科生。", mode, "三、报名方式"]),
        url,
        directory,
      );
      expect(parsed.fields.scope).toMatchObject({ kind: "all", colleges: [] });
    },
  );
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
  it("附件起始空段不能绕过资格来源边界，双方证据分别保留", () => {
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
          segments: [
            { kind: "paragraph", index: 1, text: "" },
            { kind: "paragraph", index: 2, text: "理学院学生。" },
          ],
        },
      ],
    );
    expect(parsed.fields.scope.kind).toBe("unknown");
    expect(parsed.conflicts).toContain(
      "资格标题与内容分属不同来源，须人工核对",
    );
    expect(parsed.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: "scope",
          format: "html",
          paragraph: 0,
          excerpt: "二、参赛对象",
          noticeVersion: "notice-v1",
        }),
        expect.objectContaining({
          field: "scope",
          format: "docx",
          paragraph: 2,
          excerpt: "理学院学生。",
          noticeVersion: "notice-v1",
          attachmentVersion: "attachment-v1",
        }),
      ]),
    );
  });
  it("规则跨来源时不自动取值，但双方原文仍有独立位置和版本", () => {
    const parsed = parseEvidenceCandidate(
      article(["四、参赛要求"]),
      url,
      directory,
      "notice-v1",
      [
        {
          format: "docx",
          url: "https://example.edu/rules.docx",
          noticeVersion: "notice-v1",
          attachmentVersion: "rules-v1",
          segments: [{ kind: "paragraph", index: 1, text: "作品须为原创。" }],
        },
      ],
    );
    expect(parsed.fields.rules).toEqual([]);
    expect(parsed.conflicts).toContain(
      "参赛规则标题与内容分属不同来源，须人工核对",
    );
    expect(parsed.evidence.filter((entry) => entry.field === "rules")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          format: "html",
          paragraph: 0,
          excerpt: "四、参赛要求",
          noticeVersion: "notice-v1",
          attachmentVersion: null,
        }),
        expect.objectContaining({
          format: "docx",
          paragraph: 1,
          excerpt: "作品须为原创。",
          noticeVersion: "notice-v1",
          attachmentVersion: "rules-v1",
        }),
      ]),
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
    ).toMatchObject({ kind: "specified", colleges: ["science"] });
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
      kind: "specified",
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
  describe("候选字段契约 v2", () => {
    it("范围只输出契约字段，不泄漏内部学院识别标记", () => {
      const parsed = parseCandidate(
        article(["参赛对象：理学院学生。"]),
        url,
        directory,
      );
      expect(Object.keys(parsed.fields.scope).sort()).toEqual([
        "colleges",
        "kind",
        "note",
      ]);
    });
    it("全校资格不因同段承办学院而变成学院限制", () => {
      for (const owner of ["理学院", "食品学院"]) {
        for (const clause of [
          `${owner}承办`,
          `承办单位：${owner}`,
          `承办单位为${owner}`,
          `主办单位是${owner}`,
          `${owner}为承办单位`,
        ]) {
          const text = `参赛对象：全校本科生均可参加，${clause}。`;
          const parsed = parseEvidenceCandidate(
            article([text]),
            url,
            directory,
            "scope-owner-v1",
          );
          expect(parsed.fields.scope.kind).toBe("all");
          expect(parsed.fields.scope.colleges).toEqual([]);
          expect(parsed.fields.scope.note).toContain(text);
          expect(parsed.warnings).not.toContain("资格条款含未知学院名称");
        }
      }
    });
    it("不同赛段规定相同参赛形式时仍可可靠归一", () => {
      for (const [text, expected] of [
        ["初赛为个人赛，决赛为个人赛。", "individual"],
        ["初赛为团队赛，决赛为团队赛。", "team"],
        ["初赛个人或团队均可，决赛个人或团队均可。", "mixed"],
      ] as const) {
        const parsed = parseEvidenceCandidate(
          article([text]),
          url,
          directory,
          "mode-stage-v1",
        );
        expect(parsed.fields.modeKind).toBe(expected);
        expect(
          parsed.conflicts.filter((reason) => /参赛形式/.test(reason)),
        ).toEqual([]);
      }
    });
    it("契约标记存在，且候选不再有 fields.kind", () => {
      const parsed = parseCandidate(
        article(["参赛对象：全校本科生。"]),
        url,
        directory,
      );
      expect(parsed.fieldsContract).toBe("candidate-fields-v2");
      expect(parsed.fields).not.toHaveProperty("kind");
    });
    it("明确但无法枚举的限制用 other，缺乏依据用 unknown", () => {
      const other = parseCandidate(
        article(["参赛对象：面向全校，但不含毕业年级学生。"]),
        url,
        directory,
      );
      expect(other.fields.scope).toMatchObject({ kind: "other", colleges: [] });
      expect(other.fields.scope.note).toContain("不含毕业年级学生");

      const noBasis = parseCandidate(
        article(["一、参赛对象", "二、报名方式", "报名截止：2026年10月20日。"]),
        url,
        directory,
      );
      expect(noBasis.fields.scope.kind).toBe("unknown");
    });
    it("否定与排除不把禁入学院写成允许范围", () => {
      for (const text of [
        "参赛对象：除食品学院外均可参加。",
        "参赛对象：生命科学学院不可参加。",
        "参赛对象：不符合条件者不得报名。",
      ]) {
        const parsed = parseCandidate(article([text]), url, directory);
        expect(parsed.fields.scope.kind).toBe("other");
        expect(parsed.fields.scope.colleges).toEqual([]);
      }
    });
    it("未知学院名不猜学院 ID，保留 other 与原文", () => {
      const parsed = parseCandidate(
        article(["参赛对象：未知学院学生。"]),
        url,
        directory,
      );
      expect(parsed.fields.scope).toMatchObject({
        kind: "other",
        colleges: [],
      });
      expect(parsed.warnings).toContain("资格条款含未知学院名称");
    });
    it("eventKind 只取显式标注，不从标题或阶段派生", () => {
      const explicit = parseCandidate(
        article(["项目类型：创业计划类", "报名截止：2026年10月20日。"]),
        url,
        directory,
      );
      expect(explicit.fields.eventKind).toBe("创业计划类");

      for (const title of [
        "关于举办第五届农业机器人大赛决赛的通知",
        "关于举办第四届全国大学生职业规划大赛院级研究生选拔赛的通知",
        "关于举办2026年新生运动会的通知",
      ])
        expect(
          parseCandidate(
            article(["报名截止：2026年10月20日。"], title),
            url,
            directory,
          ).fields.eventKind,
        ).toBeNull();
    });
    it("eventKind 不返回通知种类", () => {
      const parsed = parseCandidate(
        article(["报名截止：2026年10月20日。"], "2026年补充说明"),
        url,
        directory,
        "supplement",
      );
      expect(["registration", "supplement", "award", "news"]).not.toContain(
        parsed.fields.eventKind,
      );
    });
    it("name 只剥离通知套语，保留发文单位、年份届次、选拔层级与子赛道", () => {
      const cases: [string, string][] = [
        ["关于举办数学竞赛的更正通知", "数学竞赛"],
        ["关于举办第五届农业机器人大赛决赛的通知", "第五届农业机器人大赛决赛"],
        [
          "食品学院关于举办“烽烟长征存赤脉”知识竞赛的通知",
          "食品学院“烽烟长征存赤脉”知识竞赛",
        ],
        [
          "关于举办2026年全国大学生生命科学竞赛（创新创业类）校内选拔大赛的通知",
          "2026年全国大学生生命科学竞赛（创新创业类）校内选拔大赛",
        ],
        [
          "法学院关于举办第四届大学生职业规划大赛院内选拔赛的预通知",
          "法学院第四届大学生职业规划大赛院内选拔赛",
        ],
      ];
      for (const [title, expected] of cases)
        expect(
          parseCandidate(article([], title), url, directory).fields.name,
        ).toBe(expected);
    });
    it("name 剥离后为空回退标题原文", () => {
      expect(
        parseCandidate(article([], "关于举办的通知"), url, directory).fields
          .name,
      ).toBe("关于举办的通知");
    });
    it("mode 保留原文，modeKind 只给可靠归一值", () => {
      const cases: [string, string, "individual" | "team" | "mixed" | null][] =
        [
          ["竞赛为个人赛，独立参赛。", "个人赛", "individual"],
          ["每班组成一支队伍参赛。", "每班组成一支队伍参赛", "team"],
          ["个人作品或集体作品均可。", "个人作品或集体作品均可", "mixed"],
        ];
      for (const [text, mode, modeKind] of cases) {
        const parsed = parseCandidate(article([text]), url, directory);
        expect(parsed.fields.modeKind).toBe(modeKind);
        expect(parsed.fields.mode).toContain(mode);
      }
    });
    it("互不覆盖的参赛形式不合并成 mixed，modeKind 置 null", () => {
      const parsed = parseCandidate(
        article(["必须以团队参赛。", "本赛项仅限个人参赛。"]),
        url,
        directory,
      );
      expect(parsed.fields.modeKind).toBeNull();
      expect(parsed.conflicts).toContain(
        "参赛形式存在互不覆盖的要求，须人工核对",
      );
    });
    it("明确的个人赛与团队赛并存才归 mixed", () => {
      expect(
        parseCandidate(article(["个人赛及团队赛均可报名。"]), url, directory)
          .fields.modeKind,
      ).toBe("mixed");
    });
    it("mode 始终保留原文，不改写成原文中不存在的措辞", () => {
      for (const text of [
        "参赛者不得以个人或团队形式参赛。",
        "个人赛不接受报名，仅可组队参赛。",
        "初赛为个人赛，决赛为团队赛。",
        "参赛形式：团队。",
      ]) {
        const parsed = parseCandidate(article([text]), url, directory);
        expect(parsed.fields.mode).toBe(text);
      }
    });
    it("前置否定整体否定，后置否定只否定它点名的形式", () => {
      // 「不得以个人或团队形式参赛」两种都被否定：不能归一。
      const bothDenied = parseCandidate(
        article(["参赛者不得以个人或团队形式参赛。"]),
        url,
        directory,
      );
      expect(bothDenied.fields.modeKind).toBeNull();
      expect(bothDenied.conflicts).toContain(
        "参赛形式被否定，未形成可归一形式",
      );

      // 「个人赛不接受报名，仅可组队参赛」个人被否定、团队被要求 → team。
      const teamOnly = parseCandidate(
        article(["个人赛不接受报名，仅可组队参赛。"]),
        url,
        directory,
      );
      expect(teamOnly.fields.modeKind).toBe("team");

      // 后置否定「不组队」只否定团队，不推翻已确认的个人赛。
      const individual = parseCandidate(
        article(["竞赛为个人赛，独立参赛，不组队。"]),
        url,
        directory,
      );
      expect(individual.fields.modeKind).toBe("individual");
    });
    it("不同赛段的形式不能合并，互斥要求也不合并成 mixed", () => {
      const byStage = parseCandidate(
        article(["初赛为个人赛，决赛为团队赛。"]),
        url,
        directory,
      );
      expect(byStage.fields.modeKind).toBeNull();
      expect(byStage.conflicts).toContain(
        "参赛形式按赛段分别规定，不能合并为单一形式",
      );

      const contradiction = parseCandidate(
        article(["参赛必须以个人参赛，参赛必须以团队参赛。"]),
        url,
        directory,
      );
      expect(contradiction.fields.modeKind).toBeNull();
      expect(contradiction.conflicts).toContain(
        "参赛形式存在互不覆盖的要求，须人工核对",
      );
    });
    it("常见参赛形式都能识别并保留原文", () => {
      const cases = [
        ["参赛形式：团队。", "team"],
        ["参赛形式：每班一队。", "team"],
        ["参赛形式：个人或自行组队。", "mixed"],
        ["每班组成一支队伍参赛。", "team"],
        ["个人作品或集体作品均可。", "mixed"],
      ] as const;
      for (const [text, expected] of cases) {
        const parsed = parseCandidate(article([text]), url, directory);
        expect(parsed.fields.mode).toBe(text);
        expect(parsed.fields.modeKind).toBe(expected);
      }
    });
    it("eventKind 显式标注也要过语义边界，拒绝选拔层级与组别", () => {
      const rejected = [
        ["项目类型：院级研究生选拔赛。", "选拔层级或赛段不是赛事种类"],
        ["比赛类型：新生组。", "组别或人群不是赛事种类"],
        ["竞赛类型：决赛。", "选拔层级或赛段不是赛事种类"],
        ["项目类型：创新创业类（复赛）。", "选拔层级或赛段不是赛事种类"],
        ["比赛类型：体育类（新生组）。", "组别或人群不是赛事种类"],
      ] as const;
      for (const [text, reason] of rejected) {
        const parsed = parseCandidate(article([text]), url, directory);
        expect(parsed.fields.eventKind).toBeNull();
        expect(parsed.warnings).toContain("赛事种类标注被拒绝：" + reason);
      }
      // 真正的种类仍然接受。
      expect(
        parseCandidate(article(["项目类型：创业计划类"]), url, directory).fields
          .eventKind,
      ).toBe("创业计划类");
    });
    it("name 不剥离未确认的前缀或赛事名末尾动作", () => {
      for (const [title, expected] of [
        ["关于印发数学竞赛规则的通知", "关于印发数学竞赛规则"],
        ["理学院就举办数学竞赛的通知", "理学院就举办数学竞赛"],
        ["关于举办数学竞赛遴选通知", "数学竞赛遴选"],
      ]) {
        expect(
          parseCandidate(article([], title), url, directory).fields.name,
        ).toBe(expected);
      }
    });
    it("人数、教师和组队范围限制不否定已允许的参赛形式", () => {
      const cases = [
        ["个人或团队均可，不得跨学院组队。", "mixed"],
        ["团队人数不得超过3人。", "team"],
        ["参赛形式不限个人或团队。", "mixed"],
        ["以团队参赛，指导教师不得超过2人。", "team"],
      ] as const;
      for (const [text, expected] of cases) {
        const parsed = parseEvidenceCandidate(
          article([text]),
          url,
          directory,
          "mode-constraints-v1",
        );
        expect(parsed.fields.mode).toBe(text);
        expect(parsed.fields.modeKind).toBe(expected);
        expect(parsed.conflicts).toEqual([]);
      }
    });
    it("并列形式的共同后置否定不能变成允许两种形式", () => {
      for (const text of [
        "个人和团队均不得参赛。",
        "个人和团队都不可以参赛。",
        "个人及团队皆不接受报名。",
        "个人或团队均不能报名。",
        "个人和团队均不参赛。",
      ]) {
        const parsed = parseEvidenceCandidate(
          article([text]),
          url,
          directory,
          "mode-denial-v1",
        );
        expect(parsed.fields.mode).toBe(text);
        expect(parsed.fields.modeKind).toBeNull();
        expect(parsed.conflicts).toContain("参赛形式被否定，未形成可归一形式");
      }
    });
  });
});
