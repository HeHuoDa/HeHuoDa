/** 仓库发布的解析配置；管理 HTTP 不接收选择器、路径规则或适配器代码。 */
export interface Channel {
  id: string;
  listUrl: string;
  adapterId: "vsb-selectors";
  version: string;
  noticePath: string;
  listPath: string;
  datePattern?: string;
  /** 仅列表行使用；列表与正文日期分块顺序不同时覆盖 datePattern。 */
  listDatePattern?: string;
  pagination?: {
    mode: "numbered";
    current: string;
    total: string;
    target:
      { kind: "query"; parameter: string } | { kind: "path"; template: string };
  };
  selectors: {
    rows: string;
    link: string;
    linkTitle?: string;
    date: string;
    pagination: string;
    nextText: string;
    title: string;
    content: string;
    meta: string;
    attachments: string;
    empty?: string;
  };
}
export interface Source {
  id: string;
  collegeId: string;
  publisher: string;
  host: string;
  listUrl: string;
  version: string;
  defaultChannelId: string;
  channels: readonly Channel[];
  /** 经代码审阅的同源附件下载路径；未配置的来源禁止下载附件。 */
  attachmentPaths?: readonly string[];
  /** 仅保留迁移前已支持的默认栏目启用语义；新来源不得沿用此标记。 */
  legacyDefaultEnabled?: boolean;
}

export const sources: Source[] = [
  {
    id: "information-engineering",
    legacyDefaultEnabled: true,
    collegeId: "information-engineering",
    publisher: "信息工程学院",
    host: "xxgc.sicau.edu.cn",
    attachmentPaths: ["^/system/_content/download\\.jsp$"],
    listUrl: "https://xxgc.sicau.edu.cn/xygl/tz.htm",
    version: "1",
    defaultChannelId: "default",
    channels: [
      {
        id: "default",
        listUrl: "https://xxgc.sicau.edu.cn/xygl/tz.htm",
        adapterId: "vsb-selectors",
        version: "1",
        noticePath: "^/info/\\d+/\\d+\\.htm$",
        listPath: "^/xygl/(?:tz\\.htm|tz/\\d+\\.htm)$",
        selectors: {
          rows: "div[id^='line_u']",
          link: "h1.content-page-title a[rel=bookmark]",
          date: ".spanTime",
          pagination: ".p_pages",
          nextText: "^(下页|下一页|下一頁|Next|>)$",
          title: "h1.page-title",
          content: ".news-body #vsb_content .v_news_content",
          meta: ".news-meta time",
          attachments: ".news-body",
        },
      },
    ],
  },
  {
    id: "life-sciences",
    legacyDefaultEnabled: true,
    collegeId: "life-science",
    publisher: "生命科学学院",
    host: "smkx.sicau.edu.cn",
    attachmentPaths: ["^/system/_content/download\\.jsp$"],
    listUrl: "https://smkx.sicau.edu.cn/xwjtz/tzgg.htm",
    version: "1",
    defaultChannelId: "default",
    channels: [
      {
        id: "default",
        listUrl: "https://smkx.sicau.edu.cn/xwjtz/tzgg.htm",
        adapterId: "vsb-selectors",
        version: "1",
        noticePath: "^/info/\\d+/\\d+\\.htm$",
        listPath: "^/xwjtz/(?:tzgg\\.htm|tzgg/\\d+\\.htm)$",
        selectors: {
          rows: "ul.sub-list02.sub-list02T li",
          link: "a.gp-m15",
          linkTitle: "h3",
          date: ".news-time",
          pagination: ".p_pages",
          nextText: "^(下页|下一页|下一頁|Next|>)$",
          title: ".pageArticleTitle",
          content:
            "#vsb_content .v_news_content, #vsb_content_4 .v_news_content",
          meta: ".articleAuthor",
          attachments: ".pageArticle,.gp-article",
        },
      },
    ],
  },
  {
    id: "science",
    collegeId: "science",
    publisher: "理学院",
    host: "lixueyuan.sicau.edu.cn",
    attachmentPaths: ["^/system/_content/download\\.jsp$"],
    listUrl: "https://lixueyuan.sicau.edu.cn/xwjtz/tzgg.htm",
    version: "1",
    defaultChannelId: "default",
    channels: [
      {
        id: "default",
        listUrl: "https://lixueyuan.sicau.edu.cn/xwjtz/tzgg.htm",
        adapterId: "vsb-selectors",
        version: "1",
        noticePath: "^/info/\\d+/\\d+\\.htm$",
        listPath: "^/xwjtz/(?:tzgg\\.htm|tzgg/\\d+\\.htm)$",
        selectors: {
          rows: "li[id^='line_u8_']",
          link: "a",
          linkTitle: "span.fl",
          date: "span.fr",
          pagination: ".p_pages",
          nextText: "^(下页|下一页|下一頁|Next|>)$",
          title: "p.burl",
          content: "#vsb_content .v_news_content",
          meta: "p.time",
          attachments: ".wenzan",
        },
      },
    ],
  },
  {
    id: "arts-media",
    collegeId: "arts-media",
    publisher: "艺术与传媒学院",
    host: "yscm.sicau.edu.cn",
    attachmentPaths: ["^/system/_content/download\\.jsp$"],
    listUrl: "https://yscm.sicau.edu.cn/qt/tzgg/xsl.htm",
    version: "1",
    defaultChannelId: "default",
    channels: [
      {
        id: "default",
        listUrl: "https://yscm.sicau.edu.cn/qt/tzgg/xsl.htm",
        adapterId: "vsb-selectors",
        version: "1",
        noticePath: "^/info/\\d+/\\d+\\.htm$",
        listPath: "^/qt/tzgg/(?:xsl\\.htm|xsl/\\d+\\.htm)$",
        selectors: {
          rows: "#newlist li",
          link: "a",
          date: "span",
          pagination: ".p_pages",
          nextText: "^(下页|下一页|下一頁|Next|>)$",
          title: "#newsconttitle h1",
          content: "#newcontent #vsb_content .v_news_content",
          meta: "#newsconttitle p",
          attachments: "#mainContent",
        },
      },
    ],
  },
  {
    id: "agriculture",
    collegeId: "agriculture",
    publisher: "农学院",
    host: "nxy.sicau.edu.cn",
    attachmentPaths: ["^/system/_content/download\\.jsp$"],
    listUrl: "https://nxy.sicau.edu.cn/sqyr1/cxcy.htm",
    version: "1",
    defaultChannelId: "default",
    channels: [
      {
        id: "default",
        listUrl: "https://nxy.sicau.edu.cn/sqyr1/cxcy.htm",
        adapterId: "vsb-selectors",
        version: "1",
        noticePath: "^/info/\\d+/\\d+\\.htm$",
        listPath: "^/sqyr1/(?:cxcy\\.htm|cxcy/\\d+\\.htm)$",
        listDatePattern:
          "(?<day>\\d{1,2})\\s*(?<year>20\\d{2})\\s*-\\s*(?<month>\\d{1,2})",
        selectors: {
          rows: "li.cleafix[id^='line_u8_']",
          link: "a",
          linkTitle: "h2",
          date: ".list-data",
          pagination: ".p_pages",
          nextText: "^(下页|下一页|下一頁|Next|>)$",
          title: ".con_nav h2",
          content: "[id^='vsb_content'] .v_news_content",
          meta: ".ly",
          attachments: "ul[style*='list-style-type']",
        },
      },
    ],
  },
  {
    id: "animal-science",
    collegeId: "animal-science",
    publisher: "动物科技学院",
    host: "dky.sicau.edu.cn",
    attachmentPaths: ["^/system/_content/download\\.jsp$"],
    listUrl: "https://dky.sicau.edu.cn/tzgg.htm",
    version: "1",
    defaultChannelId: "default",
    channels: [
      {
        id: "default",
        listUrl: "https://dky.sicau.edu.cn/tzgg.htm",
        adapterId: "vsb-selectors",
        version: "1",
        noticePath: "^/info/\\d+/\\d+\\.htm$",
        listPath: "^/(?:tzgg\\.htm|tzgg/\\d+\\.htm)$",
        selectors: {
          rows: "li[id^='line_u7_']",
          link: "a.tit",
          date: ".date",
          pagination: ".p_pages",
          nextText: "^(下页|下一页|下一頁|Next|>)$",
          title: "form[name=_newscontent_fromname] .tit",
          content: "[id^='vsb_content'] .v_news_content",
          meta: ".infor",
          attachments: "ul[style*='list-style-type']",
        },
      },
    ],
  },
  {
    id: "veterinary-medicine",
    collegeId: "veterinary-medicine",
    publisher: "动物医学院",
    host: "dyy.sicau.edu.cn",
    attachmentPaths: ["^/system/_content/download\\.jsp$"],
    listUrl: "https://dyy.sicau.edu.cn/xwzx1/tzgg.htm",
    version: "1",
    defaultChannelId: "default",
    channels: [
      {
        id: "default",
        listUrl: "https://dyy.sicau.edu.cn/xwzx1/tzgg.htm",
        adapterId: "vsb-selectors",
        version: "1",
        noticePath: "^/info/\\d+/\\d+\\.htm$",
        listPath: "^/xwzx1/(?:tzgg\\.htm|tzgg/\\d+\\.htm)$",
        selectors: {
          rows: "li.item[id^='line_u7_']",
          link: ".title a",
          date: ".date",
          pagination: ".p_pages",
          nextText: "^(下页|下一页|下一頁|Next|>)$",
          title: ".news_title .title",
          content: "[id^='vsb_content'] .v_news_content",
          meta: ".news_title",
          attachments: "ul[style*='list-style-type']",
        },
      },
    ],
  },
  {
    id: "grassland-science",
    collegeId: "grassland-science",
    publisher: "草业科技学院",
    host: "cgst.sicau.edu.cn",
    listUrl: "https://cgst.sicau.edu.cn/index/tzgg/xsl.htm",
    version: "1",
    defaultChannelId: "default",
    channels: [
      {
        id: "default",
        listUrl: "https://cgst.sicau.edu.cn/index/tzgg/xsl.htm",
        adapterId: "vsb-selectors",
        version: "1",
        noticePath: "^/info/\\d+/\\d+\\.htm$",
        listPath: "^/index/tzgg/(?:xsl\\.htm|xsl/\\d+\\.htm)$",
        selectors: {
          rows: "div.listItem[id^='line_u5_']",
          link: "a",
          linkTitle: ".title",
          date: ".postTime",
          pagination: ".p_pages",
          nextText: "^(下页|下一页|下一頁|Next|>)$",
          title: ".articles_title",
          content: "[id^='vsb_content'] .v_news_content",
          meta: ".articles_detail",
          attachments: "ul[style*='list-style-type']",
        },
      },
    ],
  },
  {
    id: "fisheries",
    collegeId: "fisheries",
    publisher: "水产学院",
    host: "scxy.sicau.edu.cn",
    attachmentPaths: ["^/system/_content/download\\.jsp$"],
    listUrl: "https://scxy.sicau.edu.cn/index/tzgg.htm",
    version: "1",
    defaultChannelId: "default",
    channels: [
      {
        id: "default",
        listUrl: "https://scxy.sicau.edu.cn/index/tzgg.htm",
        adapterId: "vsb-selectors",
        version: "1",
        noticePath: "^/info/\\d+/\\d+\\.htm$",
        listPath: "^/index/(?:tzgg\\.htm|tzgg/\\d+\\.htm)$",
        selectors: {
          rows: ".list2 li",
          link: "a",
          date: "span",
          pagination: ".p_pages",
          nextText: "^(下页|下一页|下一頁|Next|>)$",
          title: ".art-tit h3",
          content: "[id^='vsb_content'] .v_news_content",
          meta: ".art-tit p",
          attachments: "ul[style*='list-style-type']",
        },
      },
    ],
  },
  {
    id: "forestry",
    collegeId: "forestry",
    publisher: "林学院",
    host: "lxy.sicau.edu.cn",
    attachmentPaths: ["^/system/_content/download\\.jsp$"],
    listUrl: "https://lxy.sicau.edu.cn/index/tzgg.htm",
    version: "1",
    defaultChannelId: "default",
    channels: [
      {
        id: "default",
        listUrl: "https://lxy.sicau.edu.cn/index/tzgg.htm",
        adapterId: "vsb-selectors",
        version: "1",
        noticePath: "^/info/\\d+/\\d+\\.htm$",
        listPath: "^/index/(?:tzgg\\.htm|tzgg/\\d+\\.htm)$",
        listDatePattern:
          "(?<day>\\d{1,2})\\s*(?<year>20\\d{2})\\s*-\\s*(?<month>\\d{1,2})",
        selectors: {
          rows: "li[id^='line_u10_']",
          link: "a",
          linkTitle: ".line-1",
          date: ".time",
          pagination: ".p_pages",
          nextText: "^(下页|下一页|下一頁|Next|>)$",
          title: "form[name=_newscontent_fromname] .title",
          content: "[id^='vsb_content'] .v_news_content",
          meta: ".source",
          attachments: "ul[style*='list-style-type']",
        },
      },
    ],
  },
];

export function sourceById(id: string): Source {
  const source = sources.find((s) => s.id === id);
  if (!source) throw new Error("未知采集来源");
  return source;
}

export function channelById(
  source: Source,
  id = source.defaultChannelId,
): Channel {
  const channel = source.channels.find((entry) => entry.id === id);
  if (!channel) throw new Error("未知采集栏目");
  return channel;
}

export function validateSource(source: Source): void {
  const fail = () => {
    throw new Error("采集来源或栏目配置无效");
  };
  const entryAllowed = (value: string) => {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === source.host &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.hash
    );
  };
  try {
    if (
      !source.id ||
      !source.collegeId ||
      !source.version ||
      !source.channels.length ||
      new Set(source.channels.map((channel) => channel.id)).size !==
        source.channels.length ||
      channelById(source).listUrl !== source.listUrl ||
      !entryAllowed(source.listUrl)
    )
      fail();
    for (const channel of source.channels) {
      if (
        !channel.id ||
        !channel.version ||
        channel.adapterId !== "vsb-selectors" ||
        !entryAllowed(channel.listUrl)
      )
        fail();
      for (const pattern of [channel.noticePath, channel.listPath]) {
        if (!pattern.startsWith("^/") || !pattern.endsWith("$")) fail();
        new RegExp(pattern);
      }
      if (!new RegExp(channel.listPath).test(new URL(channel.listUrl).pathname))
        fail();
      for (const selector of [
        channel.selectors.rows,
        channel.selectors.link,
        channel.selectors.date,
        channel.selectors.pagination,
        channel.selectors.title,
        channel.selectors.content,
        channel.selectors.meta,
        channel.selectors.attachments,
      ])
        if (!selector.trim()) fail();
      new RegExp(channel.selectors.nextText, "i");
      for (const pattern of [channel.datePattern, channel.listDatePattern]) {
        if (!pattern) continue;
        new RegExp(pattern);
        // 命名组必须同时给出 year/month/day，缺一仍按默认年-月-日顺序取值。
        if (
          pattern.includes("(?<") &&
          !["year", "month", "day"].every((name) =>
            pattern.includes(`(?<${name}>`),
          )
        )
          fail();
      }
      if (channel.pagination) {
        const p = channel.pagination;
        if (p.mode !== "numbered" || !p.current.trim() || !p.total.trim())
          fail();
        if (p.target.kind === "query") {
          if (!/^[a-zA-Z][\w-]{0,63}$/.test(p.target.parameter)) fail();
        } else if (
          p.target.kind !== "path" ||
          !p.target.template.startsWith("/") ||
          p.target.template.split("{page}").length !== 2 ||
          !entryAllowed(
            new URL(
              p.target.template.replace("{page}", "1"),
              channel.listUrl,
            ).toString(),
          ) ||
          !new RegExp(channel.listPath).test(
            p.target.template.replace("{page}", "1"),
          )
        )
          fail();
      }
    }
  } catch {
    fail();
  }
}

sources.forEach(validateSource);
