import {
  classifyNotice,
  competitionName,
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
  it("仅指向附件的提示不是已提取规则，也不抢占真实规则证据", () => {
    const empty = parseEvidenceCandidate(
      article(["参赛规则：详见附件1。"]),
      url,
      directory,
      "dev-rule-reference",
    );
    expect(empty.fields.rules).toEqual([]);
    const mixed = parseEvidenceCandidate(
      article(["参赛规则", "详细查看附件1。", "参赛作品必须原创。"]),
      url,
      directory,
      "dev-rule-reference-mixed",
    );
    expect(mixed.fields.rules).toEqual(["参赛作品必须原创。"]);
    expect(
      mixed.evidence
        .filter((entry) => entry.field === "rules")
        .map((entry) => entry.excerpt),
    ).toEqual(["参赛作品必须原创。"]);
  });
  it.each([
    [
      ["往年决赛获奖作品不得重复申报。", "本届赛程分为初赛、复赛两个阶段。"],
      ["初赛", "复赛"],
    ],
    [["在竞赛决赛前尚未通过博士资格考试的，可以按硕士学历申报作品。"], []],
  ])("历史获奖或学历资格中的阶段词不当作本届赛程：%j", (paragraphs, stages) => {
    const parsed = parseEvidenceCandidate(
      article(paragraphs),
      url,
      directory,
      "dev-stage-context",
    );
    expect(parsed.fields.stageNames).toEqual(stages);
  });
  it("不同赛项的集体作品人数与团队人数保留冲突，不自动挑一项", () => {
    const parsed = parseEvidenceCandidate(
      article([
        "赛项一：集体作品作者均为学生，人数限定在3~10人。",
        "赛项二：以团队形式参赛，每队3-15人。",
      ]),
      url,
      directory,
      "dev-members-by-event",
    );
    expect(parsed.fields.members).toBeNull();
    expect(
      parsed.fieldConflicts?.find((conflict) => conflict.field === "members")
        ?.values,
    ).toHaveLength(2);
  });
  it.each([
    ["主办单位：教务处 承办单位：理学院 活动目的：提升学生能力。", "教务处"],
    [
      "本竞赛由某教育部门指导，某学会和某中心主办，理学院承办。",
      "某学会和某中心",
    ],
  ])("主办单位不串入指导、承办和活动说明：%s", (text, expected) => {
    const parsed = parseEvidenceCandidate(
      article([text]),
      url,
      directory,
      "dev-organization-roles",
    );
    expect(parsed.fields.organizer).toBe(expected);
  });
  it("命名赛道冒号后的组织流程不作为赛道名称", () => {
    const parsed = parseEvidenceCandidate(
      article([
        "①结构化赛道：将考生分为若干组，一对一面试；②无领导小组赛道：每组9人进行讨论。",
      ]),
      url,
      directory,
      "dev-track-labels",
    );
    expect(parsed.fields.tracks.map((track) => track.name)).toEqual([
      "结构化赛道",
      "无领导小组赛道",
    ]);
  });
  it("参赛形式不夹带同句的报名材料流程", () => {
    const parsed = parseEvidenceCandidate(
      article(["本次竞赛以个人形式参赛，报名表须于五月提交，逾期不予受理。"]),
      url,
      directory,
      "dev-mode-phrase",
    );
    expect(parsed.fields.mode).toBe("本次竞赛以个人形式参赛");
    expect(parsed.fields.modeKind).toBe("individual");
  });
  it("年级和长编号不能被截成日期", () => {
    expect(extractDates("1.2024级、2025级同学可自愿报名。", "2026")).toEqual(
      [],
    );
    expect(extractDates("项目编号12026.11.201234", "2026")).toEqual([]);
    expect(extractDates("报名截止2026.11.20。", "2026")).toEqual([
      { precision: "date", value: "2026-11-20" },
    ]);
  });
  it("学籍注册基准日不自动成为报名截止", () => {
    const parsed = parseEvidenceCandidate(
      article(["参赛对象：2026年6月1日以前正式注册的全日制本科生可参赛。"]),
      url,
      directory,
      "dev-registration-role",
    );
    expect(parsed.fields.deadline).toEqual({
      precision: "unknown",
      value: null,
    });
    const registration = parseEvidenceCandidate(
      article(["在校学生请于2026年7月20日前完成赛事平台注册。"]),
      url,
      directory,
      "dev-platform-registration",
    );
    expect(registration.fields.deadline).toEqual({
      precision: "date",
      value: "2026-07-20",
    });
  });
  it.each([
    ["公共管理学院", ["public-administration"]],
    ["公共管理学院、管理学院", ["management", "public-administration"]],
  ])("完整学院名称不同时匹配其短后缀：%s", (names, expected) => {
    const parsed = parseEvidenceCandidate(
      article([`本竞赛由${names}承办。`, `参赛对象：${names}本科生。`]),
      url,
      [
        { id: "science", name: "理学院" },
        { id: "management", name: "管理学院" },
        { id: "public-administration", name: "公共管理学院" },
      ],
      "dev-college-names",
    );
    expect(parsed.fields.hosts).toEqual(expected);
    expect(parsed.fields.scope).toMatchObject({
      kind: "specified",
      colleges: expected,
    });
  });
  it.each([
    [["参赛对象：全校本科生。", "主体赛道参赛对象参赛材料"], "all"],
    [["本竞赛参赛范围最广，吸引学生参与。"], "unknown"],
    [["参赛对象：全校本科生。", "若作品抄袭则取消参赛资格。"], "all"],
  ])("资格词的表头或旁提不覆盖真实资格：%j", (paragraphs, kind) => {
    const parsed = parseEvidenceCandidate(
      article(paragraphs as string[]),
      url,
      directory,
      "dev-scope-context",
    );
    expect(parsed.fields.scope.kind).toBe(kind);
  });
  it("非赛事通知只保留通知元数据，不自动声称比赛字段", () => {
    const parsed = parseEvidenceCandidate(
      article(
        [
          "主办单位：教务处。",
          "招生对象：理学院学生，提交个人课程计划后报名。",
        ],
        "2026年国际交流项目招生简章",
      ),
      url,
      directory,
      "dev-non-competition",
    );
    expect(parsed.classification?.classification).toBe("non_competition");
    expect(parsed.fields).toMatchObject({
      name: "",
      edition: null,
      organizer: null,
      hosts: [],
      scope: { kind: "unknown", colleges: [] },
      mode: null,
      rules: [],
      stageNames: [],
      deadline: { precision: "unknown", value: null },
    });
    expect(parsed.evidence).toEqual([]);
  });
  it("普通个人和团队事务不是参赛形式，赛事通知中的无关段落也不能污染形式", () => {
    for (const text of [
      "请同学填写个人银行账户，用于发放助学补贴。",
      "申请流程：个人提交申请，学院审核。",
      "请在导师指导下制定个人学习计划。",
      "本月开展团队建设与个人成长交流活动。",
      "参赛者请完善个人信息和联系方式。",
      "请同学自由组队开展课程学习。",
    ]) {
      const parsed = parseCandidate(article([text]), url, directory);
      expect(parsed.fields.mode).toBeNull();
      expect(parsed.fields.modeKind).toBeNull();
      expect(parsed.evidence.filter((item) => item.field === "mode")).toEqual(
        [],
      );
    }
    const parsed = parseEvidenceCandidate(
      article(["请填写个人银行账户。参赛形式：团队。请提交个人联系方式。"]),
      url,
      directory,
      "dev-mode-context",
    );
    expect(parsed.fields.mode).toBe("参赛形式：团队。");
    expect(parsed.fields.modeKind).toBe("team");
    const sameSentence = parseCandidate(
      article(["参赛形式：团队，请完善个人信息。"]),
      url,
      directory,
    );
    expect(sameSentence.fields.modeKind).toBe("team");
  });
  it("显式形式标签及不带以的团队参赛保留归一和赛段冲突", () => {
    for (const text of ["参赛形式：个人形式", "参赛形式：个人身份"]) {
      const parsed = parseCandidate(article([text]), url, directory);
      expect(parsed.fields.mode).toBe(text);
      expect(parsed.fields.modeKind).toBe("individual");
    }
    const text = "初赛个人参赛，决赛团队参赛";
    const parsed = parseCandidate(article([text]), url, directory);
    expect(parsed.fields.mode).toBe(text);
    expect(parsed.fields.modeKind).toBeNull();
    expect(parsed.conflicts).toContain(
      "参赛形式按赛段分别规定，不能合并为单一形式",
    );
    expect(
      parseCandidate(article(["团队参赛"]), url, directory).fields.modeKind,
    ).toBe("team");
  });
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
    // 用赛事标题隔离「材料义务主体」这一条规则；非赛事标题现在由空字段基线处理，
    // 不会再产出比赛材料字段或冲突（见 S4 回归）。
    const parsed = parseCandidate(
      article([
        "11月5日-11日：报名、准备作品。",
        "11月12日-13日：作品审核、筛选、报送优秀作品参与教育部组织的展示活动。",
      ]),
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
    // S4：非赛事空比赛字段必须在证据入口、runner 入口与保存入口（裁剪正文后
    // 再解析）三处一致，不能只在证据入口生效。
    it("非赛事通知在三个真实入口都不生成比赛字段", () => {
      const admin = article(
        ["请符合条件的同学提交申请。"],
        "2026年优秀毕业生推荐通知",
      );
      // store 分支：非赛事正文已裁剪，再解析一次。
      const cropped: Article = {
        ...admin,
        text: "",
        paragraphs: [],
        attachments: [],
      };
      const entries = {
        evidence: parseEvidenceCandidate(admin, url, directory, "v1"),
        runner: parseCandidate(admin, url, directory),
        store: parseCandidate(cropped, url, directory),
      };
      for (const [entry, parsed] of Object.entries(entries)) {
        expect({ entry, name: parsed.fields.name }).toEqual({
          entry,
          name: "",
        });
        expect({ entry, edition: parsed.fields.edition }).toEqual({
          entry,
          edition: null,
        });
        expect(parsed.classification?.classification).toBe("non_competition");
        expect(parsed.fields.organizer).toBeNull();
        expect(parsed.fields.scope).toMatchObject({
          kind: "unknown",
          colleges: [],
        });
        expect(parsed.warnings).toContain(
          "非赛事通知不自动生成比赛字段，原文仍可人工核对",
        );
      }
      // 原始标题与发布日期仍属于通知元数据，不被清空。
      expect(entries.runner.warnings.length).toBeGreaterThan(0);
    });
    it("裁剪正文后再解析仍沿用裁剪前已确认的非赛事结论", () => {
      // store 的非赛事分支先清空正文，再解析一次以写入候选。只按标题重新分类时
      // 「…获奖新闻」会判回 suspected，于是又生成比赛名称与届次。
      const title = "2026年程序设计竞赛获奖新闻";
      const paragraphs = ["竞赛圆满结束，获奖名单见附件。"];
      const classification = classifyNotice(title, paragraphs);
      expect(classification.classification).toBe("non_competition");
      const cropped: Article = {
        title,
        publishedAt: "2026-11-12",
        text: "",
        paragraphs: [],
        attachments: [],
      };
      // 空正文时无论是否传分类都不再按标题编赛事名（标题不足以证明是赛事）。
      // 但两者区别仍在：不传分类时结果不带已确认分类，调用方无法据此判定非赛事。
      const stale = parseCandidate(cropped, url, directory);
      expect(stale.fields.name).toBe("");
      expect(stale.classification).toBeUndefined();
      // 有正文时 parseCandidate 会自行分类并返回结论；空正文时它分类不出
      // non_competition，这正是 store 必须把裁剪前的分类显式传下来的原因。
      const withBody: Article = {
        title,
        publishedAt: "2026-11-12",
        text: paragraphs.join("\n"),
        paragraphs,
        attachments: [],
      };
      expect(
        parseCandidate(withBody, url, directory).classification?.classification,
      ).toBe("non_competition");
      const reused = parseCandidate(cropped, url, directory, {
        classification,
      });
      expect(reused.fields.name).toBe("");
      expect(reused.fields.edition).toBeNull();
      expect(reused.classification).toEqual(classification);
      expect(reused.warnings).toContain(
        "非赛事通知不自动生成比赛字段，原文仍可人工核对",
      );
    });
    it("正文为空时不按标题生成赛事名与届次", () => {
      // 离线证据包可能只有标题（正文抽取为空）。此时标题里的「关于…的通知」
      // 既可能是赛事，也可能是任免、转正公示、开题报告；分类只能给「疑似」，
      // 按标题切片编出赛事名会把非赛事通知伪装成已抽取结果。
      // 换一个仅凭标题只能判「疑似」的教务通知：真正非赛事的标题已被分类
      // 阶段拦下并走 nonCompetitionCandidate，这条覆盖分类未拦住的空正文路径。
      const empty: Article = {
        title:
          "生命科学学院关于开展2026年全日制本科生创新创业实践成果替代毕业论文（设计）工作的通知",
        publishedAt: "2026-10-20",
        text: "",
        paragraphs: [],
        attachments: [],
      };
      const parsed = parseCandidate(empty, url, directory);
      expect(parsed.fields.name).toBe("");
      expect(parsed.fields.edition).toBeNull();
      expect(parsed.fields.scope.kind).toBe("unknown");
      expect(parsed.warnings).toContain(
        "正文为空，只有标题：不按标题生成赛事名与届次，原文仍可人工核对",
      );
      // 有正文时标题才参与命名，正常赛事通知不受影响。
      expect(
        parseCandidate(
          article(["报名截止2026年10月20日。"], "关于举办数学竞赛的通知"),
          url,
          directory,
        ).fields.name,
      ).toBe("数学竞赛");
    });
    it("非赛事判定不吞掉正式赛事与非赛事项的保留语义", () => {
      for (const title of [
        "2026年数学竞赛报名通知",
        "关于举办大学生职业规划大赛的通知",
        // 补充通知标题从不点名赛事，仍按赛事进程解析。
        "2026年数学竞赛补充通知",
      ])
        expect(
          parseCandidate(
            article(["报名截止2026年10月20日。"], title),
            url,
            directory,
          ).fields.name,
        ).not.toBe("");
      // 无赛事依据的标题本身仍按非赛事处理（补充通知需要赛事上下文才成立）。
      expect(
        parseCandidate(
          article(["报名截止2026年10月20日。"], "2026年补充说明"),
          url,
          directory,
        ).fields.name,
      ).toBe("");
      // 非赛事仍可被人工恢复并保留原文：空字段只影响自动字段，不是删除通知。
      const admin = parseCandidate(
        article(["请符合条件的同学提交申请。"], "2026年优秀毕业生推荐通知"),
        url,
        directory,
      );
      expect(admin.classification?.classification).toBe("non_competition");
      expect(admin.evidence).toEqual([]);
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
        { notificationKind: "supplement" },
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
        // 剥离规则本身直接验证 competitionName：空正文时 parseCandidate 不再
        // 按标题生成赛事名（仅有标题不足以证明是赛事），经它验证会混淆两件事。
        expect(competitionName(title)).toBe(expected);
    });
    it("name 剥离后为空回退标题原文", () => {
      // 纯解析层验证套语剥离的回退，不经分类：无赛事依据的标题现在按非赛事
      // 返回空比赛字段（S4），不能再用它验证名称回退。
      expect(competitionName("关于举办的通知")).toBe("关于举办的通知");
      expect(competitionName("关于举办比赛的通知")).toBe("比赛");
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
      ])
        // 同上：只验证剥离边界，不依赖空正文时是否产出 name。
        expect(competitionName(title)).toBe(expected);
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

  // 以下用例均为构造的最小文本，不是实站样本；用于锁定已确认真实缺陷的最小形态。
  describe("scope 标题变体与明示全校措辞", () => {
    it.each([
      "三、参赛对象及资格",
      "三、参赛人员及资格",
      "三、参赛对象及组队要求",
      "三、参赛资格及要求",
    ])("资格小节标题变体也能读取范围：%s", (heading) => {
      const parsed = parseEvidenceCandidate(
        article([heading, "四川农业大学全日制在校本科生。", "四、报名方式"]),
        url,
        directory,
        "scope-heading-variant-v1",
      );
      expect(parsed.fields.scope.kind).toBe("all");
    });
    it.each([
      "我校在校本科生、研究生均可参赛。",
      "四川农业大学全体在校本科生。",
      "具有四川农业大学正式学籍的全日制在校本科生、专科生均具有资格报名参赛，专业不限。",
      "我校本科生、研究生均可参加。",
    ])("明示全校的措辞不被降级：%s", (text) => {
      const parsed = parseEvidenceCandidate(
        article(["三、参赛对象", text]),
        url,
        directory,
        "scope-all-phrase-v1",
      );
      expect(parsed.fields.scope.kind).toBe("all");
      expect(parsed.fields.scope.colleges).toEqual([]);
    });
    it.each([
      "我院全体在校本科生均可参赛。",
      "本院全体在校本科生均可参赛。",
      "该院全体在校本科生均可参赛。",
      "本学院全体在校本科生均可参赛。",
    ])("相对指代的学院不是明示全校：%s", (text) => {
      const parsed = parseEvidenceCandidate(
        article(["三、参赛对象", text]),
        url,
        directory,
        "scope-relative-college-v1",
      );
      expect(parsed.fields.scope.kind).not.toBe("all");
      expect(parsed.fields.scope.colleges).toEqual([]);
    });
    it("身份核验与条件后果不是资格排除", () => {
      const parsed = parseEvidenceCandidate(
        article([
          "三、参赛对象",
          "参赛运动员必须是理学院在校学生（检录时需携带学生证或校园一卡通等有效证件，身份不明者不可参加比赛）。",
        ]),
        url,
        directory,
        "scope-identity-check-v1",
      );
      expect(parsed.fields.scope).toMatchObject({
        kind: "specified",
        colleges: ["science"],
      });
    });
    it("没有资格依据的条款不与已确认范围冲突", () => {
      const parsed = parseEvidenceCandidate(
        article([
          "八、参赛对象：四川农业大学全日制在校本科生。",
          "1.参赛资格：以团队形式参赛，团队人数3-5人。",
          "九、报名方式",
        ]),
        url,
        directory,
        "scope-mode-only-clause-v1",
      );
      expect(parsed.fields.scope.kind).toBe("all");
    });
    it.each([
      "研究生由学院研管办负责",
      "该学院负责组织",
      "参赛学院初赛的同学按时报名",
      "每个学院每个赛道推荐1-2人",
      "按学院要求提交电子版材料",
    ])("泛称「学院」不算未知学院名：%s", (generic) => {
      const parsed = parseEvidenceCandidate(
        article(["三、参赛对象", "理学院全体学生。", `${generic}。`]),
        url,
        directory,
        "scope-generic-college-v1",
      );
      expect(parsed.fields.scope).toMatchObject({
        kind: "specified",
        colleges: ["science"],
      });
      expect(parsed.warnings).not.toContain("资格条款含未知学院名称");
    });
    it("表格里单独的列标签不是资格小节标题", () => {
      const parsed = parseEvidenceCandidate(
        article([
          "二、活动对象",
          "全体本科生、硕士生（博）",
          "四、大赛内容",
          "主体赛道参赛对象参赛材料",
          "参赛对象",
          "参赛材料",
          "成长赛道本科2025级、2026级",
          "说明：就业赛道本科学生应为计划求职学生，不含已通过推免获得录取资格的学生。",
          "五、大赛流程",
        ]),
        url,
        directory,
        "scope-bare-header-label-v1",
      );
      expect(parsed.fields.scope.kind).toBe("unknown");
    });
    // S2：组织关系（承办／负责组织）描述谁干活，不描述谁可以参赛。
    // 明示全校时不能因为同段出现学院名就收窄为指定学院。
    it.each([
      "参赛对象：全校学生，理学院负责组织。",
      "参赛对象：全校学生（理学院负责组织）。",
      "参赛对象：全校学生，由理学院组织。",
      "参赛对象：全校学生，理学院负责具体组织工作。",
      "参赛对象：全校学生，理学院负责报名汇总。",
      "参赛对象：全校学生，理学院组织初赛。",
    ])("组织关系不缩小明示全校范围：%s", (text) => {
      const parsed = parseEvidenceCandidate(
        article([text]),
        url,
        directory,
        "scope-organizer-not-eligibility-v1",
      );
      expect(parsed.fields.scope).toMatchObject({ kind: "all", colleges: [] });
      expect(parsed.fields.scope.note).toContain(text);
    });
    it("同一输入基线为 other，本次修复后应为 all", () => {
      // 审核快照 d8d3e6c 上该输入返回 other；组织学院被当成允许范围是本轮引入的回归。
      const parsed = parseCandidate(
        article(["参赛对象：全校学生，理学院负责组织。"]),
        url,
        directory,
      );
      expect(parsed.fields.scope.kind).toBe("all");
      expect(parsed.fields.scope.colleges).toEqual([]);
    });
    it("明示指定学院仍按学院枚举，不被全校措辞以外的组织关系吞掉", () => {
      const specified = parseCandidate(
        article(["参赛对象：仅理学院学生，法学院负责组织。"]),
        url,
        directory,
      );
      expect(specified.fields.scope).toMatchObject({
        kind: "specified",
        colleges: ["science"],
      });
      const multiple = parseCandidate(
        article(["参赛对象：理学院、法学院学生。"]),
        url,
        directory,
      );
      expect(multiple.fields.scope).toMatchObject({
        kind: "specified",
        colleges: ["science", "law"],
      });
    });
    it("同名学院后缀按完整学院名匹配，不重复计学院", () => {
      const parsed = parseCandidate(
        article(["参赛对象：公共管理学院学生。"]),
        url,
        [
          { id: "public-admin", name: "公共管理学院" },
          { id: "management", name: "管理学院" },
          { id: "science", name: "理学院" },
        ],
      );
      expect(parsed.fields.scope).toMatchObject({
        kind: "specified",
        colleges: ["public-admin"],
      });
    });
    it("否定与排除条款不写允许学院，也不因明示全校而覆盖排除", () => {
      for (const text of [
        "参赛对象：全校学生，不含在职研究生。",
        "参赛对象：面向全校，但理学院除外。",
        "参赛对象：除理学院外均可参加。",
      ]) {
        const parsed = parseCandidate(article([text]), url, directory);
        expect(parsed.fields.scope).toMatchObject({
          kind: "other",
          colleges: [],
        });
      }
    });
    it("未知学院名不被单字后缀吞掉，也不把全校静默改为 all", () => {
      // genericCollegeQualifiers 曾按单字后缀过滤，「和泰和学院」的「和」使
      // 泰和学院被当作泛称，于是「全校＋未知学院」被判 all 且无提示。
      for (const text of [
        "参赛对象：全校本科生和泰和学院学生。",
        "参赛对象：全校学生、泰和学院学生。",
        "参赛对象：全校学生及泰和学院学生。",
      ]) {
        const parsed = parseEvidenceCandidate(
          article([text]),
          url,
          directory,
          "scope-unknown-college-suffix-v1",
        );
        expect(parsed.fields.scope.kind).toBe("other");
        expect(parsed.fields.scope.colleges).toEqual([]);
        expect(parsed.warnings).toContain("资格条款含未知学院名称");
      }
      // 真正的组织泛称仍不触发未知学院，避免修复时把泛称一起判未知。
      for (const generic of [
        "各学院自行组织初赛",
        "该学院负责组织",
        "每个学院每个赛道推荐1-2人",
      ]) {
        const parsed = parseEvidenceCandidate(
          article(["三、参赛对象", "理学院全体学生。", `${generic}。`]),
          url,
          directory,
          "scope-generic-college-v2",
        );
        expect(parsed.fields.scope).toMatchObject({
          kind: "specified",
          colleges: ["science"],
        });
        expect(parsed.warnings).not.toContain("资格条款含未知学院名称");
      }
    });
    it("相对指代与空表头仍保持保守，不因修复抬成全校", () => {
      expect(
        parseCandidate(article(["参赛对象：我院全体学生。"]), url, directory)
          .fields.scope.kind,
      ).toBe("other");
      expect(
        parseCandidate(article(["参赛对象："]), url, directory).fields.scope
          .kind,
      ).toBe("unknown");
      expect(
        parseCandidate(
          article(["参赛对象与要求", "二、报名方式"]),
          url,
          directory,
        ).fields.scope.kind,
      ).toBe("unknown");
    });
    it("真正未收录的学院名仍然不猜 ID", () => {
      const parsed = parseEvidenceCandidate(
        article([
          "三、参赛对象",
          "理学院全体学生。",
          "草业学院学生可放宽条件。",
        ]),
        url,
        directory,
        "scope-unknown-college-v1",
      );
      expect(parsed.fields.scope.kind).toBe("other");
      expect(parsed.warnings).toContain("资格条款含未知学院名称");
    });
  });

  // 同样为构造的最小文本，来源为已核实失败样本的语义形态。
  describe("mode 剔除报名、提交与物流子句", () => {
    it.each([
      [
        "3.提交格式：邮件主题命名为“作品类型-作品名称-姓名（团队参赛则写队长）”。",
        null,
      ],
      [
        "16×60m迎面抱球接力：按照附件2：团体项目分组情况以组为单位进行运动员招募并填写报名表。",
        null,
      ],
    ])("只写提交方式与报名表的子句不进入 mode：%s", (text, expected) => {
      const parsed = parseEvidenceCandidate(
        article([text]),
        url,
        directory,
        "mode-submission-v1",
      );
      expect(parsed.fields.mode).toBe(expected);
    });
    it("报名时间里的组队方式只保留形式短语", () => {
      const parsed = parseEvidenceCandidate(
        article([
          "（一）报名时间：即日起至2026年11月15日上午10时，组队报名，提交参赛队伍名单，每组3人，队长负责本队参赛事宜。允许跨年级、跨专业，但不得跨校区组队。",
        ]),
        url,
        directory,
        "mode-registration-clause-v1",
      );
      expect(parsed.fields.mode).toContain("组队报名");
      expect(parsed.fields.mode).not.toContain("提交参赛队伍名单");
      expect(parsed.fields.mode).not.toContain("队长负责");
      expect(parsed.fields.modeKind).toBe("team");
    });
    it.each([
      ["以团队形式参赛并提交报名表。", "以团队形式参赛"],
      ["参赛形式为团队，须提交项目书。", "参赛形式为团队"],
    ])("同一句给出形式又要求提交时保留形式原文：%s", (text, form) => {
      const parsed = parseEvidenceCandidate(
        article([text]),
        url,
        directory,
        "mode-form-with-submission-v1",
      );
      expect(parsed.fields.mode).toContain(form);
      expect(parsed.fields.modeKind).toBe("team");
      expect(parsed.fields.mode).not.toContain("报名表");
      expect(parsed.fields.mode).not.toContain("项目书");
    });
    it("小节标题不是参赛形式原文", () => {
      const parsed = parseEvidenceCandidate(
        article(["三、参赛对象及组队要求", "以团队形式参赛。"]),
        url,
        directory,
        "mode-heading-v1",
      );
      expect(parsed.fields.mode).not.toContain("参赛对象");
      expect(parsed.fields.modeKind).toBe("team");
    });
    // S3：纪律后果只说明违规代价，不改变同一句前面的参赛形式声明。
    it.each([
      ["参赛形式：以团队形式参赛，否则取消参赛资格。", "team"],
      ["参赛形式：个人或团队，逾期取消资格。", "mixed"],
      ["参赛形式：以个人形式参赛，否则取消参赛资格。", "individual"],
      ["参赛形式：以团队形式参赛并提交报名表，否则取消资格。", "team"],
      ["参赛形式：以团队形式参赛，违规将追究责任。", "team"],
    ] as const)("有形式声明时保留形式且不夹带后果：%s", (text, kind) => {
      const parsed = parseEvidenceCandidate(
        article([text]),
        url,
        directory,
        "mode-consequence-scope-v1",
      );
      expect(parsed.fields.modeKind).toBe(kind);
      expect(parsed.fields.mode).toContain("参赛形式");
      for (const consequence of ["否则", "取消", "逾期", "违规", "追究"])
        expect(parsed.fields.mode).not.toContain(consequence);
      expect(parsed.conflicts).not.toContain(
        "参赛形式存在互不覆盖的要求，须人工核对",
      );
    });
    it("后果在形式之前时保留形式，不因后果词丢弃整句", () => {
      const parsed = parseCandidate(
        article(["违规者取消参赛资格，参赛形式为团队。"]),
        url,
        directory,
      );
      expect(parsed.fields.modeKind).toBe("team");
      expect(parsed.fields.mode).not.toContain("取消");
    });
    it("分号切开的后果句不在 mode 里留下残标点", () => {
      for (const text of [
        "参赛形式：以团队形式参赛；违规者取消参赛资格。",
        "参赛形式：以团队形式参赛，违反纪律者通报批评。",
      ]) {
        const parsed = parseCandidate(article([text]), url, directory);
        expect(parsed.fields.modeKind).toBe("team");
        expect(parsed.fields.mode).not.toMatch(/[；;]$/);
        expect(parsed.fields.mode).not.toContain("取消");
        expect(parsed.fields.mode).not.toContain("违规");
      }
    });
    it("组织关系句里出现参赛对象措辞仍不缩小全校范围", () => {
      for (const text of [
        "参赛对象：全校学生，理学院负责组织学生参赛。",
        "参赛对象：全校学生（理学院负责组织学生参赛）。",
        "参赛对象：全校学生，理学院参与组织。",
      ]) {
        const parsed = parseCandidate(article([text]), url, directory);
        expect(parsed.fields.scope).toMatchObject({
          kind: "all",
          colleges: [],
        });
      }
    });
    it("只有纪律后果没有形式时不提取", () => {
      for (const text of [
        "否则取消参赛资格。",
        "逾期取消资格。",
        "严格遵守活动安排，不得擅自做出违规行为，否则取消个人参赛资格。",
      ]) {
        const parsed = parseCandidate(article([text]), url, directory);
        expect(parsed.fields.mode).toBeNull();
        expect(parsed.fields.modeKind).toBeNull();
      }
    });
    it("形式声明里的否定仍按作用范围生效，不被后果剥离抹掉", () => {
      const negated = parseCandidate(
        article(["参赛形式：不得以个人形式参赛，否则取消资格。"]),
        url,
        directory,
      );
      expect(negated.fields.modeKind).toBeNull();
      expect(negated.fields.mode).not.toContain("否则");
      const frontNegation = parseCandidate(
        article(["本赛项不接受团队报名，否则视为无效报名。"]),
        url,
        directory,
      );
      expect(frontNegation.fields.modeKind).toBeNull();
    });
    it("不同赛段残留的冲突判定不被后果剥离绕过", () => {
      // 赛段冲突的具体文案由既有优先级决定；这里只要求不被剥离成单一的确定形式。
      for (const paragraphs of [
        ["初赛为个人赛，否则取消资格。决赛为团队赛。"],
        ["初赛为个人赛，否则取消资格。", "决赛为团队赛。"],
      ]) {
        const parsed = parseCandidate(article(paragraphs), url, directory);
        expect(parsed.fields.modeKind).toBeNull();
        expect(parsed.conflicts).toContainEqual(
          expect.stringMatching(/赛段|互不覆盖/),
        );
        expect(parsed.fields.mode).not.toContain("否则");
      }
    });
    it("条件后果句不构成参赛形式", () => {
      const parsed = parseEvidenceCandidate(
        article([
          "1.参赛资格：以团队形式参赛，团队人数3-5人。",
          "2.严格遵守活动安排，不得擅自做出违规行为，否则取消个人参赛资格。",
        ]),
        url,
        directory,
        "mode-conditional-consequence-v1",
      );
      expect(parsed.fields.modeKind).toBe("team");
      expect(parsed.fields.mode).not.toContain("违规行为");
      expect(parsed.conflicts).not.toContain(
        "参赛形式存在互不覆盖的要求，须人工核对",
      );
    });
    it("报名阶段的括注碎片不进入 mode", () => {
      const parsed = parseEvidenceCandidate(
        article([
          "（1）正式报名阶段：参赛个人或团队提交作品与参赛报名表（见附件1，请保证信息的准确性，凡是填报信息有误，后果自负。",
        ]),
        url,
        directory,
        "mode-registration-fragment-v1",
      );
      expect(parsed.fields.mode).toBeNull();
    });
    it("以个人名义参赛也能识别为个人形式", () => {
      const parsed = parseEvidenceCandidate(
        article(["校内选拔赛以个人名义参赛。"]),
        url,
        directory,
        "mode-individual-name-v1",
      );
      expect(parsed.fields.modeKind).toBe("individual");
    });
  });
});
