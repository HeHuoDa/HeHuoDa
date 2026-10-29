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
        expect(result.classification?.priority).toBe(1);
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
});
