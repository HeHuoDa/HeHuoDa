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
