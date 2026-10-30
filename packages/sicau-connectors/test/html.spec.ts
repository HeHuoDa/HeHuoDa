import {
  decodeHtml,
  extractArticle,
  extractList,
  isCompetitionNotice,
  containsApplicantList,
  sources,
  channelById,
  validateSource,
  publishedDate,
} from "../dist/notices/index.js";

import {
  informationList,
  lifeList,
  informationArticle,
  lifeArticle,
} from "./fixtures.js";

describe("来源适配器的离线页面", () => {
  it("仓库日期规则仍要求完整合法年月日，缺年与不存在的日期保持未知", () => {
    expect(
      publishedDate("发布时间：20261028", "(20\\d{2})(\\d{2})(\\d{2})"),
    ).toBe("2026-10-28");
    expect(publishedDate("20260230", "(20\\d{2})(\\d{2})(\\d{2})")).toBeNull();
    expect(publishedDate("10-28")).toBeNull();
  });
  it.each(["query", "path"] as const)(
    "复用%s页码分页规则，保持业务参数且不猜缺失日期",
    (kind) => {
      const pagination =
        kind === "query"
          ? {
              mode: "numbered" as const,
              current: ".current",
              total: ".total",
              target: { kind: "query" as const, parameter: "page" },
            }
          : {
              mode: "numbered" as const,
              current: ".current",
              total: ".total",
              target: {
                kind: "path" as const,
                template: "/xygl/tz/{page}.htm",
              },
            };
      const source = {
        ...sources[0],
        channels: [{ ...sources[0].channels[0], pagination }],
      };
      const html = informationList.replace(
        '<a href="tz/3.htm">下页</a>',
        '<span class="current">1</span><span class="total">3</span>',
      );
      expect(
        extractList(html, source.listUrl + "?edition=2026", source).next,
      ).toBe(
        kind === "query"
          ? source.listUrl + "?edition=2026&page=2"
          : "https://xxgc.sicau.edu.cn/xygl/tz/2.htm?edition=2026",
      );
      expect(() =>
        extractList(
          html.replace(">3</span>", ">bad</span>"),
          source.listUrl,
          source,
        ),
      ).toThrow("页码");
    },
  );
  it("发布配置拒绝重复栏目、越域入口、无界路径与未实现适配器", () => {
    const source = sources[0];
    const channel = channelById(source);
    expect(() => validateSource(source)).not.toThrow();
    for (const broken of [
      { ...source, channels: [channel, channel] },
      {
        ...source,
        channels: [{ ...channel, listUrl: "https://evil.test/list" }],
      },
      { ...source, channels: [{ ...channel, listPath: ".*" }] },
      { ...source, channels: [{ ...channel, noticePath: "[" }] },
      { ...source, defaultChannelId: "missing" },
      { ...source, listUrl: "https://xxgc.sicau.edu.cn/other.htm" },
    ])
      expect(() => validateSource(broken)).toThrow("配置");
  });
  it("下一页跳出注册栏目路径及自循环均明确失败", () => {
    for (const next of ["/admin/login", sources[0].listUrl])
      expect(() =>
        extractList(
          informationList.replace("tz/3.htm", next),
          sources[0].listUrl,
          sources[0],
        ),
      ).toThrow(/分页|路径/);
  });
  it("仅显式空态标记可确认空栏目，选择器失效和拦截页仍失败", () => {
    const source = {
      ...sources[0],
      channels: [
        {
          ...channelById(sources[0]),
          selectors: {
            ...channelById(sources[0]).selectors,
            empty: ".confirmed-empty",
          },
        },
      ],
    };
    expect(
      extractList(
        '<div class="confirmed-empty">暂无通知</div><div class="p_pages"></div>',
        source.listUrl,
        source,
      ),
    ).toEqual({ items: [], next: null });
    expect(() =>
      extractList(
        '<div class="confirmed-empty">暂无通知</div>',
        source.listUrl,
        source,
      ),
    ).toThrow("分页");
    expect(() =>
      extractList(
        '<h1>请输入验证码</h1><div class="confirmed-empty"></div><div class="p_pages"></div>',
        source.listUrl,
        source,
      ),
    ).toThrow("拦截");
  });
  it("一个站的第二栏目仅靠配置解析列表、正文和分页，无学院名称分支", () => {
    const channel = {
      ...channelById(sources[0]),
      id: "student-competitions",
      listUrl: "https://xxgc.sicau.edu.cn/students/contests.htm",
      listPath: "^/students/(?:contests\\.htm|contests/\\d+\\.htm)$",
      selectors: {
        ...channelById(sources[0]).selectors,
        rows: ".contest-row",
        link: "a.notice",
        date: ".date",
        title: "h2",
        content: ".body",
        meta: ".published",
        attachments: ".body",
      },
    };
    const source = {
      ...sources[0],
      id: "synthetic-college",
      channels: [...sources[0].channels, channel],
    };
    const page = extractList(
      '<div class="contest-row"><a class="notice" href="/info/1/2.htm?id=7&utm_source=x">2026测试竞赛</a><span class="date">2026年10月28日</span></div><div class="p_pages"><a href="contests/2.htm">下一页</a></div>',
      channel.listUrl,
      source,
      channel.id,
    );
    expect(page).toEqual({
      items: [
        {
          url: "https://xxgc.sicau.edu.cn/info/1/2.htm?id=7",
          title: "2026测试竞赛",
          publishedAt: "2026-10-28",
        },
      ],
      next: "https://xxgc.sicau.edu.cn/students/contests/2.htm",
    });
    const article = extractArticle(
      '<h2>2026测试竞赛</h2><div class="published">2026-10-28</div><div class="body"><p>本届竞赛面向全校在校学生开放，请同学们按通知规定时间报名。</p></div>',
      page.items[0].url,
      source,
      channel.id,
    );
    expect(article).toMatchObject({
      title: "2026测试竞赛",
      publishedAt: "2026-10-28",
    });
  });
  it("稳定来源映射目录学院，旧调用仍使用原默认栏目", () => {
    expect(sources[1].id).toBe("life-sciences");
    expect(sources[1].collegeId).toBe("life-science");
    expect(channelById(sources[1]).listUrl).toBe(sources[1].listUrl);
    expect(() => channelById(sources[1], "unknown")).toThrow("栏目");
  });
  it("混合列表跳过站外转载并保留合法通知及跳过原因", () => {
    const external = informationList.replace(
      "../info/1043/100.htm",
      "https://jiaowu.sicau.edu.cn/info/1/123.htm",
    );
    const page = extractList(
      informationList + external,
      sources[0].listUrl,
      sources[0],
    );
    expect(page.items).toHaveLength(1);
    expect(page).toMatchObject({
      skipped: [
        expect.objectContaining({ reason: expect.stringContaining("白名单") }),
      ],
    });
  });
  it("普通学术新闻不进入竞赛候选，报名者信息不采集", () => {
    expect(isCompetitionNotice("学院学术报告通知")).toBe(false);
    expect(isCompetitionNotice("程序设计竞赛报名通知")).toBe(true);
    expect(containsApplicantList("程序设计竞赛报名人员名单")).toBe(true);
    expect(containsApplicantList("竞赛参赛名单")).toBe(true);
  });
  it("正文外的官方附件列表仍记录链接，不读取附件内容", () => {
    const html =
      '<div class="pageArticle"><div class="gp-article">' +
      lifeArticle +
      '</div><div class="articleBottom"><ul><li><a href="/system/_content/download.jsp?id=1">规则.docx</a></li></ul></div></div>';
    expect(
      extractArticle(html, sources[1].listUrl, sources[1]).attachments,
    ).toHaveLength(2);
  });
  it("生命科学学院兼容实站无数字后缀的正文容器", () => {
    const article = extractArticle(
      lifeArticle.replace('id="vsb_content_4"', 'id="vsb_content"'),
      "https://smkx.sicau.edu.cn/info/1061/29421.htm",
      sources[1],
    );
    expect(article.title).toBe("2026年测试竞赛报名通知");
    expect(article.publishedAt).toBe("2026-10-08");
    expect(article.text).toContain("参赛对象：全校学生");
    expect(article.attachments).toHaveLength(1);
  });
  it("两站处理相对通知链接、分页及不同日期精度，不根据月份猜年份", () => {
    expect(
      extractList(informationList, sources[0].listUrl, sources[0]),
    ).toEqual({
      items: [
        {
          url: "https://xxgc.sicau.edu.cn/info/1043/100.htm",
          title: "2026年测试竞赛报名通知",
          publishedAt: null,
        },
      ],
      next: "https://xxgc.sicau.edu.cn/xygl/tz/3.htm",
    });
    expect(extractList(lifeList, sources[1].listUrl, sources[1])).toEqual({
      items: [
        {
          url: "https://smkx.sicau.edu.cn/info/1061/100.htm",
          title: "普通学术新闻",
          publishedAt: "2026-10-08",
        },
      ],
      next: "https://smkx.sicau.edu.cn/xwjtz/tzgg/92.htm",
    });
    expect(
      extractList(
        informationList
          .replace("tz/3.htm", "2.htm")
          .replace("../info/", "../../info/"),
        "https://xxgc.sicau.edu.cn/xygl/tz/3.htm",
        sources[0],
      ).next,
    ).toBe("https://xxgc.sicau.edu.cn/xygl/tz/2.htm");
  });
  it.each([
    [sources[0], informationArticle],
    [sources[1], lifeArticle],
  ] as const)("正文证据、日期和附件保留，剔除脚本", (source, html) => {
    const article = extractArticle(
      html,
      `https://${source.host}/info/1/100.htm`,
      source,
    );
    expect(article.publishedAt).toBe("2026-10-08");
    expect(article.text).toContain("报名截止：2026年10月20日24:00");
    expect(article.text).not.toContain("危险脚本");
    expect(article.attachments).toEqual([
      {
        title: "附件：规则.docx",
        url: `https://${source.host}/system/_content/download.jsp?urltype=news.DownloadAttachUrl&owner=1`,
      },
    ]);
  });
  it("置顶与不规则日期保留全部通知，不在老日期处截断", () => {
    const body = lifeList.replace(
      "</ul>",
      `<li><a class="gp-m15" href="../info/1061/101.htm"><h3>置顶旧通知</h3><span class="news-time">2025-01-01</span></a></li><li><a class="gp-m15" href="../info/1061/102.htm"><h3>新通知</h3><span class="news-time">2026-10-09</span></a></li></ul>`,
    );
    expect(
      extractList(body, sources[1].listUrl, sources[1]).items.map(
        (i) => i.publishedAt,
      ),
    ).toEqual(["2026-10-08", "2025-01-01", "2026-10-09"]);
  });
  it("选择器变化、空正文和危险通知链接报告失败", () => {
    expect(() =>
      extractList("<html>空页</html>", sources[0].listUrl, sources[0]),
    ).toThrow("列表");
    expect(() =>
      extractList(
        informationList.replace("../info/1043/100.htm", "https://127.0.0.1/a"),
        sources[0].listUrl,
        sources[0],
      ),
    ).toThrow("白名单");
    expect(() =>
      extractArticle(
        informationArticle.replace(/<p>.*?<\/p>/gs, ""),
        sources[0].listUrl,
        sources[0],
      ),
    ).toThrow("正文");
    expect(() =>
      extractArticle(
        informationArticle.replace("vsb_content", "new_content"),
        sources[0].listUrl,
        sources[0],
      ),
    ).toThrow("选择器");
  });
  it("按 meta/响应头解码 UTF-8 和 GB18030，坏编码明确失败", () => {
    expect(
      decodeHtml(new TextEncoder().encode("<meta charset=utf-8>中文")),
    ).toContain("中文");
    expect(
      decodeHtml(
        Uint8Array.from([0xd6, 0xd0, 0xce, 0xc4]),
        "text/html; charset=gb18030",
      ),
    ).toBe("中文");
    expect(() =>
      decodeHtml(Uint8Array.from([0xff]), "text/html; charset=utf-8"),
    ).toThrow("编码");
  });
});
