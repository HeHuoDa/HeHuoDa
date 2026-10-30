/** 仓库发布的解析配置；管理 HTTP 不接收选择器、路径规则或适配器代码。 */
export interface Channel {
  id: string;
  listUrl: string;
  adapterId: "vsb-selectors";
  version: string;
  noticePath: string;
  listPath: string;
  datePattern?: string;
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
      if (channel.datePattern) new RegExp(channel.datePattern);
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
