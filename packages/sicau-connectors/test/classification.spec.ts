import {
  classifyNotice,
  parseEvidenceCandidate,
} from "../dist/notices/index.js";
import {
  positiveGroups,
  nonCompetitionTitles,
  ambiguousTitles,
} from "./classification-corpus.js";

describe("赛事分类独立于审核状态", () => {
  it("延期说明后紧接的新绝对截止仍可提取，旧日期在前不能抵消相对变更", () => {
    const parse = (paragraphs: string[]) =>
      parseEvidenceCandidate(
        {
          title: "2026年数学竞赛补充通知",
          publishedAt: null,
          text: paragraphs.join("\n"),
          paragraphs,
          attachments: [],
        },
        "https://example.edu/n",
        [],
        "v1",
      );
    expect(
      parse(["数学竞赛报名延期，报名截止：2026年11月8日。"]).fields.deadline
        .value,
    ).toBe("2026-11-08");
    expect(
      parse(["报名截止：2026年11月1日。", "现延期至一周后。"]).fields.deadline
        .value,
    ).toBeNull();
  });
  it.each(["不可参加", "不予报名", "不接受报名"])(
    "资格否定 %s 保留复杂原文，不列为允许学院",
    (denied) => {
      const text = `参赛对象：仅信息工程学院学生可参加，生命科学学院${denied}。`;
      const result = parseEvidenceCandidate(
        {
          title: "2026年数学竞赛报名通知",
          publishedAt: null,
          text,
          paragraphs: [text],
          attachments: [],
        },
        "https://example.edu/n",
        [
          { id: "information-engineering", name: "信息工程学院" },
          { id: "life-science", name: "生命科学学院" },
        ],
        "v1",
      );
      expect(result.fields.scope).toMatchObject({
        kind: "complex",
        colleges: [],
        note: text,
      });
    },
  );
  it.each(["一周后", "下月初", "五个工作日后"])(
    "延期至 %s 没有新绝对日期时不保留旧截止",
    (relative) => {
      const paragraphs = [
        "原报名截止：2026年11月1日。",
        `现延期至${relative}。`,
      ];
      const result = parseEvidenceCandidate(
        {
          title: "2026年数学竞赛补充通知",
          publishedAt: null,
          text: paragraphs.join("\n"),
          paragraphs,
          attachments: [],
        },
        "https://example.edu/n",
        [],
        "v1",
      );
      expect(result.fields.deadline).toEqual({
        precision: "unknown",
        value: null,
      });
      expect(
        result.fieldConflicts?.find((c) => c.field === "deadline")?.values,
      ).toHaveLength(2);
    },
  );
  it("联合主办单位中的逗号不丢失，也不把不同来源的甲乙与甲当成同值", () => {
    const text = "主办单位：甲，乙。";
    const result = parseEvidenceCandidate(
      {
        title: "2026年竞赛报名通知",
        publishedAt: null,
        text,
        paragraphs: [text],
        attachments: [],
      },
      "https://example.edu/n",
      [],
      "v1",
      [
        {
          format: "pdf",
          url: "https://example.edu/a",
          noticeVersion: "v1",
          attachmentVersion: "a1",
          segments: [{ kind: "page", index: 1, text: "主办单位：甲。" }],
        },
      ],
    );
    expect(result.fields.organizer).toBeNull();
    expect(
      result.fieldConflicts
        ?.find((c) => c.field === "organizer")
        ?.values.map((c) => c.value),
    ).toEqual(["甲，乙", "甲"]);
  });
  it("资格排除、主办承办和否定模式不得自动解释成相反含义", () => {
    const text =
      "主办单位：教务处，承办单位：信息工程学院。参赛对象：仅信息工程学院学生可参加，生命科学学院不得参加。参赛规则：禁止个人参赛，须以团队参加。";
    const result = parseEvidenceCandidate(
      {
        title: "2026年竞赛报名通知",
        publishedAt: null,
        text,
        paragraphs: text.split("。").filter(Boolean),
        attachments: [],
      },
      "https://example.edu/n",
      [
        { id: "information-engineering", name: "信息工程学院" },
        { id: "life-science", name: "生命科学学院" },
      ],
      "v1",
    );
    expect(result.fields.organizer).toBe("教务处");
    expect(result.fields.scope.kind).toBe("complex");
    expect(result.fields.scope.colleges).toEqual([]);
    expect(result.fields.mode).toBe("team");
    expect(result.fieldConflicts?.some((c) => c.field === "mode")).toBe(false);
  });
  it("旧绝对截止后出现未锚定相对延期，不沿用旧截止", () => {
    const paragraphs = ["原报名截止：2026年11月1日。", "现延期至下周一。"];
    const result = parseEvidenceCandidate(
      {
        title: "2026年数学竞赛补充通知",
        publishedAt: "2026-10-01",
        text: paragraphs.join("\n"),
        paragraphs,
        attachments: [],
      },
      "https://example.edu/n",
      [],
      "v1",
    );
    expect(result.fields.deadline).toEqual({
      precision: "unknown",
      value: null,
    });
    expect(
      result.fieldConflicts
        ?.find((c) => c.field === "deadline")
        ?.values.map((c) => c.value),
    ).toEqual(
      expect.arrayContaining([
        { precision: "date", value: "2026-11-01" },
        { precision: "unknown", value: null },
      ]),
    );
    expect(
      result.evidence
        .filter((e) => e.field === "deadline")
        .some((e) => e.excerpt.includes("下周一")),
    ).toBe(true);
  });
  it("顿号连接的多赛段时间仍保留两侧候选证据", () => {
    const text = "院赛报名截止：2026年11月1日、校赛报名截止：2026年11月8日。";
    const result = parseEvidenceCandidate(
      {
        title: "2026年数学竞赛报名通知",
        publishedAt: null,
        text,
        paragraphs: [text],
        attachments: [],
      },
      "https://example.edu/n",
      [],
      "v1",
    );
    expect(result.fields.deadline.value).toBeNull();
    expect(
      result.fieldConflicts?.find((c) => c.field === "deadline")?.values,
    ).toHaveLength(2);
    expect(result.evidence.filter((e) => e.field === "deadline")).toHaveLength(
      2,
    );
  });
  it("通用标题的kind证据必须包含真正支持通知种类的正文", () => {
    const text = "2026年数学竞赛通知已发布。";
    const result = parseEvidenceCandidate(
      {
        title: "相关事项",
        publishedAt: null,
        text,
        paragraphs: [text],
        attachments: [],
      },
      "https://example.edu/n",
      [],
      "v1",
    );
    expect(result.evidence).toContainEqual(
      expect.objectContaining({ field: "kind", paragraph: 0, excerpt: text }),
    );
  });
  it("普通标题的结果公示或新闻不能因引用旧报名日期被当成报名", () => {
    for (const title of ["通知", "2026年数学竞赛通知", "参赛事项"])
      for (const [body, kind] of [
        ["现将数学竞赛获奖结果公示。报名截止曾为2026年10月1日。", "award"],
        ["数学竞赛圆满结束，现回顾比赛。报名截止曾为2026年10月1日。", "news"],
      ]) {
        const result = parseEvidenceCandidate(
          {
            title,
            publishedAt: null,
            text: body,
            paragraphs: [body],
            attachments: [],
          },
          "https://example.edu/n",
          [],
          "v1",
        );
        expect(result.fields.kind).toBe(kind);
        expect(result.fields.deadline).toEqual({
          precision: "unknown",
          value: null,
        });
        expect(result.classification).toMatchObject({
          classification: "non_competition",
          priority: 3,
          needsReview: false,
        });
      }
  });
  it("同值多赛段截止也聚合两侧证据，整体归属仍未知", () => {
    const text = "院赛报名截止：2026年11月1日，校赛报名截止：2026年11月1日。";
    const result = parseEvidenceCandidate(
      {
        title: "2026年数学竞赛报名通知",
        publishedAt: null,
        text,
        paragraphs: [text],
        attachments: [],
      },
      "https://example.edu/n",
      [],
      "v1",
    );
    expect(result.fields.deadline.precision).toBe("unknown");
    expect(result.evidence.filter((e) => e.field === "deadline")).toHaveLength(
      2,
    );
  });
  it("只有附件标题表明赛事变更也保留疑似或明确，不清掉规则附件", () => {
    expect(
      classifyNotice(
        "补充说明",
        ["具体事宜详见附件。"],
        ["数学竞赛延期通知.pdf"],
      ),
    ).toMatchObject({
      classification: "definite",
      notificationKind: "supplement",
    });
    expect(
      classifyNotice("事项说明", ["具体事宜详见附件。"], ["附件1.pdf"]),
    ).toMatchObject({ classification: "suspected" });
  });
  it("同句逗号分隔的两个赛段截止保留候选值及定位", () => {
    const parsed = parseEvidenceCandidate(
      {
        title: "2026年数学竞赛报名通知",
        publishedAt: null,
        text: "院赛报名截止：2026年11月1日，校赛报名截止：2026年11月8日。",
        paragraphs: [
          "院赛报名截止：2026年11月1日，校赛报名截止：2026年11月8日。",
        ],
        attachments: [],
      },
      "https://example.edu/n",
      [],
      "v1",
    );
    expect(parsed.fields.deadline).toEqual({
      precision: "unknown",
      value: null,
    });
    expect(
      parsed.fieldConflicts
        ?.find((c) => c.field === "deadline")
        ?.values.map((c) => c.value),
    ).toEqual([
      { precision: "date", value: "2026-11-01" },
      { precision: "date", value: "2026-11-08" },
    ]);
    expect(parsed.evidence.filter((e) => e.field === "deadline")).toHaveLength(
      2,
    );
  });
  it("资格标题和下一段分属不同证据时分别定位，不伪造跨来源摘录", () => {
    const parsed = parseEvidenceCandidate(
      {
        title: "补充通知",
        publishedAt: null,
        text: "参赛对象：",
        paragraphs: ["参赛对象："],
        attachments: [],
      },
      "https://example.edu/n",
      [],
      "v1",
      [
        {
          format: "docx",
          url: "https://example.edu/a",
          noticeVersion: "v1",
          attachmentVersion: "a1",
          segments: [
            {
              kind: "paragraph",
              index: 1,
              text: "全校学生可参加数学竞赛报名。",
            },
          ],
        },
      ],
    );
    expect(parsed.evidence.filter((e) => e.field === "scope")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ format: "html", excerpt: "参赛对象：" }),
        expect.objectContaining({
          format: "docx",
          excerpt: "全校学生可参加数学竞赛报名。",
          paragraph: 1,
        }),
      ]),
    );
  });
  for (const [category, titles] of Object.entries(positiveGroups))
    it.each(titles)(`${category} 构造正例 %s`, (title) => {
      const article = {
        title: `2026年${title}报名通知`,
        publishedAt: "2026-10-01",
        paragraphs: ["报名截止：2026年11月1日。"],
        text: "报名截止：2026年11月1日。",
        attachments: [],
      };
      const parsed = parseEvidenceCandidate(
        article,
        "https://example.edu/notice",
        [],
        "v1",
      );
      expect(parsed.classification).toMatchObject({
        classification: "definite",
        notificationKind: "registration",
      });
      expect(parsed.fields.deadline).toEqual({
        precision: "date",
        value: "2026-11-01",
      });
      for (const field of ["name", "edition", "kind", "deadline"])
        expect(parsed.evidence).toContainEqual(
          expect.objectContaining({
            field,
            noticeVersion: "v1",
            format: "html",
          }),
        );
    });
  it.each(nonCompetitionTitles)("构造非赛事 %s", (title) =>
    expect(classifyNotice(title, ["请按安排办理相关事项。"])).toMatchObject({
      classification: "non_competition",
    }),
  );
  it.each(ambiguousTitles)("构造易混淆 %s 不一律接受或丢弃", (title) =>
    expect(classifyNotice(title, []).classification).toBe("suspected"),
  );
  it.each([
    "延期",
    "延长",
    "更正",
    "调整",
    "规则修改",
    "规则变更",
    "补充",
    "变更",
    "延期公告",
    "报名延期",
  ])("构造变更 %s 进入审核", (change) =>
    expect(
      classifyNotice("补充通知", [
        `数学竞赛${change}：报名截止改为2026年11月8日。`,
      ]),
    ).toMatchObject({
      classification: "definite",
      notificationKind: "supplement",
      priority: 0,
    }),
  );
  it("补充通知通过正文识别报名变更，并优先复核", () => {
    expect(
      classifyNotice("补充通知", ["数学建模竞赛报名延期至2026年11月10日。"]),
    ).toMatchObject({
      classification: "definite",
      notificationKind: "supplement",
      priority: 0,
      needsReview: true,
    });
  });
  it("正文与PDF截止冲突保留候选值及页码，自动字段不选更新者", () => {
    const parsed = parseEvidenceCandidate(
      {
        title: "2026年数学竞赛报名通知",
        publishedAt: null,
        text: "报名截止：2026年11月1日。",
        paragraphs: ["报名截止：2026年11月1日。"],
        attachments: [],
      },
      "https://example.edu/notice",
      [],
      "html-v1",
      [
        {
          format: "pdf",
          url: "https://example.edu/rules.pdf",
          noticeVersion: "html-v1",
          attachmentVersion: "pdf-v2",
          segments: [
            { kind: "page", index: 2, text: "报名截止：2026年11月8日。" },
          ],
        },
      ],
    );
    expect(parsed.fields.deadline).toEqual({
      precision: "unknown",
      value: null,
    });
    expect(
      parsed.fieldConflicts?.find((c) => c.field === "deadline")?.values,
    ).toHaveLength(2);
    expect(parsed.evidence).toContainEqual(
      expect.objectContaining({
        field: "deadline",
        format: "pdf",
        attachmentVersion: "pdf-v2",
        page: 2,
      }),
    );
  });
  it.each([
    [
      "2026年竞赛报名通知",
      ["院赛报名截止：2026年11月1日。", "校赛报名截止：2026年11月8日。"],
      null,
    ],
    [
      "2026年竞赛报名通知",
      ["赛道：创意、创业。", "报名截止：2026年11月1日。"],
      null,
    ],
    [
      "2026年竞赛报名通知",
      ["2025年举办上一届，报名截止：2026年11月1日。"],
      null,
    ],
    ["竞赛报名通知", ["报名下周截止。"], null],
    ["竞赛报名通知", ["报名截止：11月1日。"], null],
    ["2026年竞赛获奖新闻", ["报名截止：2026年11月1日。"], null],
    ["2026年竞赛报名通知", ["报名截止：2026年11月1日。"], "2026-11-01"],
  ] as const)("%s 的时间不猜测（%s）", (title, paragraphs, deadline) => {
    const parsed = parseEvidenceCandidate(
      {
        title,
        publishedAt: null,
        text: paragraphs.join("\n"),
        paragraphs: [...paragraphs],
        attachments: [],
      },
      "https://example.edu/n",
      [],
      "v1",
    );
    expect(parsed.fields.deadline.value).toBe(deadline);
  });
  it("三个主办表述不能在冲突后静默恢复第三个值，资格与附件保留两侧定位", () => {
    const result = parseEvidenceCandidate(
      {
        title: "2026年竞赛报名通知",
        publishedAt: "2025-12-31",
        text: "",
        paragraphs: [
          "主办单位：甲。",
          "主办单位：乙。",
          "主办单位：丙。",
          "参赛对象：全校学生。",
        ],
        attachments: [],
      },
      "https://example.edu/n",
      [],
      "v1",
      [
        {
          format: "docx",
          url: "https://example.edu/a.docx",
          noticeVersion: "v1",
          attachmentVersion: "a1",
          segments: [
            { kind: "paragraph", index: 3, text: "参赛对象：仅限大三学生。" },
          ],
        },
      ],
    );
    expect(result.fields).toMatchObject({
      organizer: null,
      edition: null,
      hosts: [],
      scope: { kind: "unknown" },
    });
    expect(
      result.fieldConflicts?.find((c) => c.field === "organizer")?.values,
    ).toHaveLength(3);
    expect(
      result.fieldConflicts?.find((c) => c.field === "scope")?.values[1]
        .evidence[0],
    ).toMatchObject({ format: "docx", paragraph: 3, attachmentVersion: "a1" });
  });
  it("正文泛指「调整」不把首次通知判成补充通知", () => {
    // 2026-11-01 实站抽样：助学金、职业规划大赛首次通知因正文出现「调整」被判 supplement。
    expect(
      classifyNotice("环境学院关于评定2026-2027学年国家助学金的通知", [
        "如上级政策调整，以最新通知为准。",
        "请符合条件的同学按时提交材料。",
      ]),
    ).toMatchObject({ notificationKind: "news" });
    expect(
      classifyNotice("关于举办风景园林学院大学生职业规划大赛的预通知", [
        "比赛时间根据省赛安排可能调整。",
        "参赛对象：全院本科生。",
      ]),
    ).toMatchObject({ notificationKind: "registration" });
    expect(
      classifyNotice("数学建模竞赛报名延期通知", [
        "报名截止延至2026年11月10日。",
      ]),
    ).toMatchObject({ notificationKind: "supplement" });
  });
  it("评选标题同时含赛事线索时进入复核，单独评选与结果公示仍排除", () => {
    for (const title of [
      "关于举办2026年大学生优秀设计作品评选大赛的通知",
      "关于开展数学比赛作品评审的通知",
    ])
      expect(
        classifyNotice(title, ["面向全校学生，报名截止：2026年11月20日。"]),
      ).toMatchObject({
        classification: "definite",
        needsReview: true,
      });
    expect(classifyNotice("关于开展征文作品评选的通知", [])).toMatchObject({
      classification: "suspected",
      needsReview: true,
    });
    expect(
      classifyNotice("关于组织开展创新创业典型评选工作的通知", []),
    ).toMatchObject({
      classification: "suspected",
      needsReview: true,
    });
    for (const title of [
      "关于开展优秀作品评选的通知",
      "关于开展项目评审的通知",
      "数学比赛评审结果公示",
      "设计大赛获奖名单公示",
    ])
      expect(classifyNotice(title, ["此前数学比赛报名已结束。"])).toMatchObject(
        {
          classification: "non_competition",
          needsReview: false,
        },
      );
  });
  it("评选赛事未开放报名时进入普通复核，不占用报名优先级", () => {
    for (const title of [
      "关于开展数学比赛作品评审的通知",
      "关于开展设计大赛作品评选的通知",
    ]) {
      expect(
        classifyNotice(title, ["请专家按既定评分标准完成作品审核。"]),
      ).toMatchObject({
        classification: "definite",
        notificationKind: "news",
        priority: 1,
        needsReview: true,
      });
      expect(
        classifyNotice(title, ["报名截止：2026年11月20日。"]),
      ).toMatchObject({
        notificationKind: "registration",
        priority: 0,
      });
    }
  });
  it("结果公示与评选、评定类通知按非赛事处理，不进入复核", () => {
    for (const title of [
      "资源学院关于第二十届“挑战杯”全国大学生课外学术科技作品竞赛校内预选赛项目结果公示",
      "关于组织开展2025—2026学年优秀典型评选工作的通知",
      "环境学院关于评定2026-2027学年国家助学金的通知",
      "2025-2026学年度学生奖励评审结果公示",
    ])
      expect(classifyNotice(title, ["现将结果公示如下。"])).toMatchObject({
        classification: "non_competition",
        needsReview: false,
      });
    // 带报名或参赛语义的赛事通知仍按赛事处理。
    expect(
      classifyNotice("关于举办2026年数学建模竞赛报名通知", [
        "报名截止：2026年10月20日。",
      ]),
    ).toMatchObject({ classification: "definite" });
    expect(
      classifyNotice("关于组织参加第二十届“挑战杯”竞赛参赛作品评选的通知", [
        "参赛作品提交截止：2026年10月20日。",
      ]),
    ).toMatchObject({ classification: "definite" });
  });
  it("党团事务与培训班通知不因正文提到比赛就判为明确赛事", () => {
    // 实站样本：正文提到往届比赛，标题本身是入团或培训班通知。
    expect(
      classifyNotice("机电学院关于2026年度下半年青年入团相关通知", [
        "各团支部组织团员参加知识比赛与志愿服务。",
      ]),
    ).toMatchObject({ classification: "suspected", needsReview: true });
    expect(
      classifyNotice("食品学院关于开展第三期“春笋计划”赛训育人交互班的通知", [
        "培训围绕学科比赛备赛展开。",
      ]),
    ).toMatchObject({ classification: "suspected" });
    expect(
      classifyNotice("风景园林学院关于2026年秋季入团积极分子确定与培养的通知", [
        "结合比赛获奖情况择优推荐。",
      ]),
    ).toMatchObject({ classification: "suspected" });
    // 标题本身写明竞赛的党团或培训类活动仍按赛事处理。
    expect(
      classifyNotice("关于举办党校学员党史知识竞赛的通知", [
        "报名截止：2026年10月20日。",
      ]),
    ).toMatchObject({ classification: "definite" });
  });
  it("发展团员与体质健康测试通知不因正文赛事词或补充字样进入明确赛事", () => {
    // 批次四实站样本：发展团员通知的申请材料里列了「比赛获奖」，标题仍是团务。
    expect(
      classifyNotice("关于法学院2026年秋季学期发展团员工作的通知", [
        "提交附件3以及相关证明材料（如成绩、志愿时长、比赛获奖、荣誉证书等）。",
      ]),
    ).toMatchObject({ classification: "suspected", needsReview: true });
    expect(
      classifyNotice("建筑与城乡规划学院2026年下半年团员发展通知", [
        "参考比赛获奖情况。",
      ]),
    ).toMatchObject({ classification: "suspected" });
    // 体质健康测试是测试安排，不是赛事；标题带「补充通知」也不进复核。
    expect(
      classifyNotice("关于都江堰校区2025、2026级学生体质健康测试的补充通知", [
        "请各学院按规定时间组织学生参加测试。",
      ]),
    ).toMatchObject({ classification: "non_competition", needsReview: false });
  });
  it("求职补贴等资助类人员公示按个人名单跳过", () => {
    // 批次四实站样本：补贴公示逐条列人名，标题未出现「名单」二字。
    expect(
      classifyNotice(
        "土木工程学院关于2027届毕业本科生一次性求职补贴人员的公示",
        ["经审核，现将名单公示如下。"],
      ),
    ).toMatchObject({
      classification: "non_competition",
      exclusions: expect.arrayContaining(["applicant-list"]),
    });
    // 只是组织评选的通知不是名单，仍按非赛事保留而不按个人名单跳过。
    expect(
      classifyNotice(
        "法学院关于开展2026年“盟遂合作”遂宁籍学子资助金评选推荐工作的通知",
        ["请各班级按条件推荐。"],
      ).exclusions,
    ).not.toContain("applicant-list");
  });
  it("赛后回顾报道不算可报名赛事", () => {
    // #179 冻结质量集样本 025bcfcf：标题「圆满落幕」，正文全是赛后描述。
    const result = classifyNotice(
      "农学院第三届“物华农业杯”创新创业大赛暨2026中国国际大学生创新创业大赛院赛选拔赛圆满落幕",
      [
        "3月17日下午，农学院第三届“物华农业杯”创新创业大赛在第二教学楼201会议室隆重举行。",
        "本届大赛共有11个优秀项目入围决赛，项目内容涵盖乡村振兴、科技创新、智慧农业等多个农业科技前沿领域。",
      ],
    );
    expect(result.classification).toBe("non_competition");
    expect(result.notificationKind).toBe("news");
  });
  it("奖项评选标题含赛事词仍是评奖通知", () => {
    // #179 冻结质量集样本 074982a6：标题同时含「运动会」与「评选…奖」。
    expect(
      classifyNotice(
        "建筑与城乡规划学院关于评选“匠心筑梦青春，运动赋能成长”第四届班级运动会精神文明风尚奖的通知",
        [
          "学院决定在“匠心筑梦青春，运动赋能成长”第四届班级运动会期间开展精神文明风尚奖的评比。",
          "三、评选指标及流程：全院评选1个精神文明风尚奖。",
        ],
      ).classification,
    ).toBe("non_competition");
    // 奖学金评选正文列举「竞赛奖」，同样是奖项类别而非赛事。
    expect(
      classifyNotice("林学院关于开展2025-2026学年单项奖学金推荐工作的通知", [
        "现将2025-2026学年单项奖学金推荐相关工作安排通知如下：",
        "竞赛奖按学校规定评定。",
      ]).classification,
    ).toBe("non_competition");
  });
  it("遴选公示按结果公示排除，不判为可报名赛事", () => {
    // #179 冻结质量集样本 af6de5fa：标题以「遴选的公示」结尾。
    expect(
      classifyNotice(
        "关于第二十届“挑战杯”全国大学生课外学术科技作品竞赛院赛遴选的公示",
        [
          "现将土木工程学院拟推荐参加校赛的初选结果予以公示。",
          "最终报送结果将根据修改后的材料质量确定。",
        ],
      ).classification,
    ).toBe("non_competition");
    // 但「遴选的通知」是组织遴选的工作通知，属赛事进程，不能一并排除。
    expect(
      classifyNotice(
        "公共管理学院关于第二十届“挑战杯”中国大学生课外学术科技作品竞赛校内预选赛及校内重点项目（第一轮）遴选的通知",
        ["现将学院相关安排通知如下。", "一、参赛对象 在校本科生、硕士研究生。"],
      ).classification,
    ).toBe("definite");
  });
  it("正文旁证不足以单独确认赛事，标题无赛事词时只判疑似", () => {
    // #179 冻结质量集中被误判明确的四类真实样本：正文提到「竞赛」，
    // 但「竞赛」出现在项目类型、培养成果、研究方向或发展材料里，不是通知性质声明。
    const cases: Array<[string, string[]]> = [
      [
        "2027年寒假世界名校海外访学项目报名通知",
        [
          "面向全校本科生及研究生开放专业学习、语言文化、竞赛、导师推荐信、就业实习类线下访学项目。",
          "2027年寒假完整项目清单详见附件。",
        ],
      ],
      [
        "人工智能应用实验室招新",
        [
          "信息工程学院“人工智能应用工作室”拟于2026年11月开展招新工作。",
          "实验室聚焦深度学习、机器学习等核心领域，鼓励成员参加各类竞赛。",
        ],
      ],
      [
        "四川农业大学社会工作硕士研究生招生宣传资料",
        [
          "本学位点立足四川、面向西部，培养高层次应用型社会工作人才。",
          "鼓励学生参与各类学科竞赛。",
        ],
      ],
      [
        "环境学院关于做好2026年秋季组织发展工作通知",
        ["各团支部、党支部：", "请按要求提交发展材料，参考比赛获奖情况。"],
      ],
    ];
    for (const [title, paragraphs] of cases) {
      const result = classifyNotice(title, paragraphs);
      // 标题没有赛事词时，正文命中只能到疑似，并进入人工复核。
      expect(result.classification).toBe("suspected");
      expect(result.needsReview).toBe(true);
    }
    // 标题本身点明赛事时，正文旁证不影响，仍是明确赛事。
    expect(
      classifyNotice("关于举办2026年数学建模竞赛的通知", [
        "同时鼓励学生参加各类创新创业竞赛。",
        "报名截止 2026年11月20日。",
      ]).classification,
    ).toBe("definite");
  });
  it("只有标题或只有转发语时不足以判明确赛事", () => {
    // protocol v2 B1：definite 要求正文能确认赛事名称、举办/报名事实，
    // 且至少一项可核对安排；只有标题或只有转发语应判 suspected。
    expect(
      classifyNotice("关于举办2026年数学建模竞赛的通知", []).classification,
    ).toBe("suspected");
    expect(
      classifyNotice("转发：关于举办2026年挑战杯竞赛的通知", [
        "现将通知转发如下，请关注。",
      ]).classification,
    ).toBe("suspected");
    // 正文有可核对安排时仍是明确赛事。
    expect(
      classifyNotice("关于举办2026年数学建模竞赛的通知", [
        "一、参赛对象 全校本科生。",
        "二、报名截止 2026年11月20日。",
      ]).classification,
    ).toBe("definite");
  });
  it("推荐或遴选参赛队伍属赛事选拔，不按评奖排除", () => {
    // 「推荐」既可指评优也可指赛事选拔；标题同时出现参赛/队伍时属赛事进程。
    for (const title of [
      "关于推荐2026年四川省大学生电子设计竞赛参赛队伍的通知",
      "关于推荐优秀本科生参加2026年电子设计竞赛的通知",
      "关于遴选2026年数学建模竞赛参赛队伍的通知",
    ])
      expect(
        classifyNotice(title, ["参赛对象为全校本科生，请各学院按要求推荐。"]),
      ).toMatchObject({
        classification: "definite",
        notificationKind: "registration",
      });
    // 纯评优推荐仍是评奖通知。
    expect(
      classifyNotice("关于开展优秀学生推荐工作的通知", ["请各班级按条件推荐。"])
        .classification,
    ).toBe("non_competition");
    for (const action of ["评选", "评审"])
      expect(
        classifyNotice(`关于推荐学生参加运动会优秀运动员${action}的通知`, [
          "请各班级按条件推荐，评审时间为2026年11月1日。",
        ]).classification,
      ).toBe("non_competition");
    expect(
      classifyNotice("关于运动会后推荐学生参加交流活动的通知", [
        "活动时间为2026年11月1日。",
      ]).classification,
    ).toBe("non_competition");
  });
});
