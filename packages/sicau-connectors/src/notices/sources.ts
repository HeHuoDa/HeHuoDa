/** 仓库发布的解析配置；管理 HTTP 不接收选择器、路径规则或适配器代码。 */
export interface Channel {
  id: string;
  listUrl: string;
  adapterId: "vsb-selectors";
  version: string;
  noticePath: string;
  listPath: string;
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
}

export const sources: Source[] = [
  {
    id: "information-engineering",
    collegeId: "information-engineering",
    publisher: "信息工程学院",
    host: "xxgc.sicau.edu.cn",
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
    collegeId: "life-science",
    publisher: "生命科学学院",
    host: "smkx.sicau.edu.cn",
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
          content: "#vsb_content_4 .v_news_content",
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
    }
  } catch {
    fail();
  }
}

sources.forEach(validateSource);
