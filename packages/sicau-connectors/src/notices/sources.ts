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
          content: "[id^='vsb_content'] .v_news_content",
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
  {
    id: "horticulture",
    collegeId: "horticulture",
    publisher: "园艺学院",
    host: "yyx.sicau.edu.cn",
    attachmentPaths: ["^/system/_content/download\\.jsp$"],
    listUrl: "https://yyx.sicau.edu.cn/xyxw/xytz.htm",
    version: "1",
    defaultChannelId: "default",
    channels: [
      {
        id: "default",
        listUrl: "https://yyx.sicau.edu.cn/xyxw/xytz.htm",
        adapterId: "vsb-selectors",
        version: "1",
        noticePath: "^/info/\\d+/\\d+\\.htm$",
        listPath: "^/xyxw/(?:xytz\\.htm|xytz/\\d+\\.htm)$",
        listDatePattern:
          "(?<year>20\\d{2})\\s*-\\s*(?<month>\\d{1,2})\\s*(?<day>\\d{1,2})",
        selectors: {
          rows: "li[id^='line_u10_']",
          link: "h1 a",
          date: ".date",
          pagination: ".p_pages",
          nextText: "^(下页|下一页|下一頁|Next|>)$",
          title: "form[name=_newscontent_fromname] .content h3",
          content: "[id^='vsb_content'] .v_news_content",
          meta: "form[name=_newscontent_fromname] .content span.pr",
          attachments: "div.content ul",
        },
      },
    ],
  },
  {
    id: "landscape-architecture",
    collegeId: "landscape-architecture",
    publisher: "风景园林学院",
    host: "fjylxy.sicau.edu.cn",
    attachmentPaths: ["^/system/_content/download\\.jsp$"],
    listUrl: "https://fjylxy.sicau.edu.cn/xwzx1/tzgg.htm",
    version: "1",
    defaultChannelId: "default",
    channels: [
      {
        id: "default",
        listUrl: "https://fjylxy.sicau.edu.cn/xwzx1/tzgg.htm",
        adapterId: "vsb-selectors",
        version: "1",
        noticePath: "^/info/\\d+/\\d+\\.htm$",
        listPath: "^/xwzx1/(?:tzgg\\.htm|tzgg/\\d+\\.htm)$",
        selectors: {
          rows: "li[id^='line_u7_']",
          link: "p a",
          date: "span",
          pagination: ".p_pages",
          nextText: "^(下页|下一页|下一頁|Next|>)$",
          title: "h1.page_box_news_title",
          content: "[id^='vsb_content'] .v_news_content",
          meta: "h1.page_box_news_title + h2",
          attachments: "ul[style*='list-style-type']",
        },
      },
    ],
  },
  {
    id: "resources",
    collegeId: "resources",
    publisher: "资源学院",
    host: "zyxy.sicau.edu.cn",
    listUrl: "https://zyxy.sicau.edu.cn/sy/tzgg.htm",
    version: "1",
    defaultChannelId: "default",
    channels: [
      {
        id: "default",
        listUrl: "https://zyxy.sicau.edu.cn/sy/tzgg.htm",
        adapterId: "vsb-selectors",
        version: "1",
        noticePath: "^/info/\\d+/\\d+\\.htm$",
        listPath: "^/sy/(?:tzgg\\.htm|tzgg/\\d+\\.htm)$",
        selectors: {
          rows: "li[id^='line_u5_']",
          link: "a",
          date: ".date",
          pagination: ".p_pages",
          nextText: "^(下页|下一页|下一頁|Next|>)$",
          title: "form[name=_newscontent_fromname] > div > h1",
          content: "[id^='vsb_content'] .v_news_content",
          meta: "form[name=_newscontent_fromname] > div > div[align=center]",
          attachments: "ul[style*='list-style-type']",
        },
      },
    ],
  },
  {
    id: "environment",
    collegeId: "environment",
    publisher: "环境学院",
    host: "hjxy.sicau.edu.cn",
    attachmentPaths: ["^/system/_content/download\\.jsp$"],
    listUrl: "https://hjxy.sicau.edu.cn/xwzx1/tzgg.htm",
    version: "1",
    defaultChannelId: "default",
    channels: [
      {
        id: "default",
        listUrl: "https://hjxy.sicau.edu.cn/xwzx1/tzgg.htm",
        adapterId: "vsb-selectors",
        version: "1",
        noticePath: "^/info/\\d+/\\d+\\.htm$",
        listPath: "^/xwzx1/(?:tzgg\\.htm|tzgg/\\d+\\.htm)$",
        selectors: {
          rows: "li[id^='line_u11_']",
          link: "p a",
          date: "span",
          pagination: ".p_pages",
          nextText: "^(下页|下一页|下一頁|Next|>)$",
          title: "h1.page_box_news_title",
          content: "[id^='vsb_content'] .v_news_content",
          meta: "h1.page_box_news_title + h2",
          attachments: "ul[style*='list-style-type']",
        },
      },
    ],
  },
  {
    id: "management",
    collegeId: "management",
    publisher: "管理学院",
    host: "glxy.sicau.edu.cn",
    attachmentPaths: ["^/system/_content/download\\.jsp$"],
    listUrl: "https://glxy.sicau.edu.cn/ggl/xsl.htm",
    version: "1",
    defaultChannelId: "default",
    channels: [
      {
        id: "default",
        listUrl: "https://glxy.sicau.edu.cn/ggl/xsl.htm",
        adapterId: "vsb-selectors",
        version: "1",
        noticePath: "^/info/\\d+/\\d+\\.htm$",
        listPath: "^/ggl/(?:xsl\\.htm|xsl/\\d+\\.htm)$",
        selectors: {
          rows: "li[id^='line_u6_']",
          link: "a",
          linkTitle: ".title",
          date: ".leftDate",
          pagination: ".p_pages",
          nextText: "^(下页|下一页|下一頁|Next|>)$",
          title: "form[name=_newscontent_fromname] > .article_w > h1",
          content: "[id^='vsb_content'] .v_news_content",
          meta: "form[name=_newscontent_fromname] > .article_w > p",
          attachments: "ul[style*='list-style-type']",
        },
      },
    ],
  },
  {
    id: "agricultural-engineering",
    collegeId: "agricultural-engineering",
    publisher: "农业工程学院",
    host: "nygcxy.sicau.edu.cn",
    attachmentPaths: ["^/system/_content/download\\.jsp$"],
    listUrl: "https://nygcxy.sicau.edu.cn/index/tzgg.htm",
    version: "1",
    defaultChannelId: "default",
    channels: [
      {
        id: "default",
        listUrl: "https://nygcxy.sicau.edu.cn/index/tzgg.htm",
        adapterId: "vsb-selectors",
        version: "1",
        noticePath: "^/info/\\d+/\\d+\\.htm$",
        listPath: "^/index/(?:tzgg\\.htm|tzgg/\\d+\\.htm)$",
        selectors: {
          rows: "li[id^='line_u6_']",
          link: "a",
          date: "time",
          pagination: ".p_pages",
          nextText: "^(下页|下一页|下一頁|Next|>)$",
          title: "header.article-head h1",
          content: "[id^='vsb_content'] .v_news_content",
          meta: "header.article-head .meta",
          attachments: "footer.article-links",
        },
      },
    ],
  },
  {
    id: "food-science",
    collegeId: "food-science",
    publisher: "食品学院",
    host: "spxy.sicau.edu.cn",
    attachmentPaths: ["^/system/_content/download\\.jsp$"],
    listUrl: "https://spxy.sicau.edu.cn/index/tzgg.htm",
    version: "1",
    defaultChannelId: "default",
    channels: [
      {
        id: "default",
        listUrl: "https://spxy.sicau.edu.cn/index/tzgg.htm",
        adapterId: "vsb-selectors",
        version: "1",
        noticePath: "^/info/\\d+/\\d+\\.htm$",
        listPath: "^/index/(?:tzgg\\.htm|tzgg/\\d+\\.htm)$",
        selectors: {
          // 列表行无 id，标题与日期同在一个 a 内，附件列表在正文容器之外。
          rows: "div.newlist1 ul.list li",
          link: "a.flex.wl",
          linkTitle: "h3.l1.txt1",
          date: "span",
          pagination: ".p_pages",
          nextText: "^(下页|下一页|下一頁|Next|>)$",
          title: "h2.tit",
          content: "[id^='vsb_content'] .v_news_content",
          meta: "p.conttime",
          attachments: "div.cont > ul",
        },
      },
    ],
  },
  {
    id: "mechanical-electrical",
    collegeId: "mechanical-electrical",
    publisher: "机电学院",
    host: "jdxy.sicau.edu.cn",
    attachmentPaths: ["^/system/_content/download\\.jsp$"],
    listUrl: "https://jdxy.sicau.edu.cn/index/tzgg.htm",
    version: "1",
    defaultChannelId: "default",
    channels: [
      {
        id: "default",
        listUrl: "https://jdxy.sicau.edu.cn/index/tzgg.htm",
        adapterId: "vsb-selectors",
        version: "1",
        noticePath: "^/info/\\d+/\\d+\\.htm$",
        listPath: "^/index/(?:tzgg\\.htm|tzgg/\\d+\\.htm)$",
        selectors: {
          rows: "li[id^='line_u5_']",
          link: "a",
          linkTitle: "h3",
          date: "time",
          pagination: ".p_pages",
          nextText: "^(下页|下一页|下一頁|Next|>)$",
          title: "header.jdxy-article-head h1",
          content: "[id^='vsb_content'] .v_news_content",
          meta: ".jdxy-article-meta",
          attachments: "footer.jdxy-article-links",
        },
      },
    ],
  },
  {
    id: "water-conservancy",
    collegeId: "water-conservancy",
    publisher: "水利水电学院",
    host: "slsd.sicau.edu.cn",
    attachmentPaths: ["^/system/_content/download\\.jsp$"],
    listUrl: "https://slsd.sicau.edu.cn/tzgg.htm",
    version: "1",
    defaultChannelId: "default",
    channels: [
      {
        id: "default",
        listUrl: "https://slsd.sicau.edu.cn/tzgg.htm",
        adapterId: "vsb-selectors",
        version: "1",
        noticePath: "^/info/\\d+/\\d+\\.htm$",
        listPath: "^/(?:tzgg\\.htm|tzgg/\\d+\\.htm)$",
        selectors: {
          // 列表行带摘要段，日期在 .meta-date；标题在 .article-header 内。
          rows: "li.article-item",
          link: "a.article-link",
          linkTitle: "h3.article-title",
          date: ".meta-date",
          pagination: ".p_pages",
          nextText: "^(下页|下一页|下一頁|Next|>)$",
          title: ".article-header .article-title",
          content: "#vsb_content .v_news_content",
          meta: ".article-header",
          attachments: ".article-attachments",
        },
      },
    ],
  },
  {
    id: "humanities",
    collegeId: "humanities",
    publisher: "人文学院",
    host: "rwy.sicau.edu.cn",
    attachmentPaths: ["^/system/_content/download\\.jsp$"],
    listUrl: "https://rwy.sicau.edu.cn/index/tz.htm",
    version: "1",
    defaultChannelId: "default",
    channels: [
      {
        id: "default",
        listUrl: "https://rwy.sicau.edu.cn/index/tz.htm",
        adapterId: "vsb-selectors",
        version: "1",
        noticePath: "^/info/\\d+/\\d+\\.htm$",
        listPath: "^/index/(?:tz\\.htm|tz/\\d+\\.htm)$",
        selectors: {
          // 列表行是 div.title，日期在同级绝对定位的 div 内且无 class；标题用自定义标签 p2。
          rows: "div.center-body > div.title",
          link: "a",
          date: "div.title > div",
          pagination: ".p_pages",
          nextText: "^(下页|下一页|下一頁|Next|>)$",
          title: ".article-title p2",
          content: ".article-words .v_news_content",
          meta: ".article-title p3",
          attachments: "form[name=_newscontent_fromname] > ul",
        },
      },
    ],
  },
  {
    id: "public-administration",
    collegeId: "public-administration",
    publisher: "公共管理学院",
    host: "fpa.sicau.edu.cn",
    attachmentPaths: ["^/system/_content/download\\.jsp$"],
    listUrl: "https://fpa.sicau.edu.cn/sylm/tzgg/xsl.htm",
    version: "1",
    defaultChannelId: "default",
    channels: [
      {
        id: "default",
        listUrl: "https://fpa.sicau.edu.cn/sylm/tzgg/xsl.htm",
        adapterId: "vsb-selectors",
        version: "1",
        noticePath: "^/info/\\d+/\\d+\\.htm$",
        listPath: "^/sylm/tzgg/(?:xsl\\.htm|xsl/\\d+\\.htm)$",
        selectors: {
          // 学生类栏目沿用旧版表格分页，没有 .p_pages；首页的「上页」是 span，第 2 页起变成 a，
          // 固定用表格单元格内的分页 div 定位，末页无下页时按结束处理。
          rows: "li[id^='line_u9_']",
          link: "a",
          date: "span",
          pagination: "td[nowrap] > div",
          nextText: "^(下页|下一页|下一頁|Next|>)$",
          title: "#newsconttitle h1",
          content: "#vsb_content .v_news_content",
          meta: "#newsconttitle p",
          attachments: "form[name=_newscontent_fromname] > ul",
        },
      },
    ],
  },
  {
    id: "law",
    collegeId: "law",
    publisher: "法学院",
    host: "fxy.sicau.edu.cn",
    attachmentPaths: ["^/system/_content/download\\.jsp$"],
    listUrl: "https://fxy.sicau.edu.cn/index/tzgg.htm",
    version: "1",
    defaultChannelId: "default",
    channels: [
      {
        id: "default",
        listUrl: "https://fxy.sicau.edu.cn/index/tzgg.htm",
        adapterId: "vsb-selectors",
        version: "1",
        noticePath: "^/info/\\d+/\\d+\\.htm$",
        listPath: "^/index/(?:tzgg\\.htm|tzgg/\\d+\\.htm)$",
        selectors: {
          // 列表行含摘要段和「快速链接」重复入口；日期与链接同在一个 span，取标题锚点限定在 p.title 内。
          rows: "div.item[id^='line_u2_']",
          link: "p.title a",
          date: "span",
          pagination: ".p_pages",
          nextText: "^(下页|下一页|下一頁|Next|>)$",
          title: "form[name=_newscontent_fromname] > h3",
          content: "[id^='vsb_content'] .v_news_content",
          meta: "p.abstitle",
          attachments: "form[name=_newscontent_fromname] > ul",
        },
      },
    ],
  },
  {
    id: "sports",
    collegeId: "sports",
    publisher: "体育学院",
    host: "ytxy.sicau.edu.cn",
    attachmentPaths: ["^/system/_content/download\\.jsp$"],
    listUrl: "https://ytxy.sicau.edu.cn/qtlm/tzgg.htm",
    version: "1",
    defaultChannelId: "default",
    channels: [
      {
        id: "default",
        listUrl: "https://ytxy.sicau.edu.cn/qtlm/tzgg.htm",
        adapterId: "vsb-selectors",
        version: "1",
        noticePath: "^/info/\\d+/\\d+\\.htm$",
        listPath: "^/qtlm/(?:tzgg\\.htm|tzgg/\\d+\\.htm)$",
        selectors: {
          // 列表沿用旧版表格分页，没有 .p_pages；正文标题是 form 内 h1，附件链接在正文段落里。
          rows: "li[id^='line_u8_']",
          link: "a",
          date: "span",
          pagination: "td[nowrap] > div",
          nextText: "^(下页|下一页|下一頁|Next|>)$",
          title: "form[name=_newscontent_fromname] h1",
          content: "[id^='vsb_content'] .v_news_content",
          meta: ".article-info",
          attachments: "form[name=_newscontent_fromname] > ul",
        },
      },
    ],
  },
  {
    id: "architecture-planning",
    collegeId: "architecture-planning",
    publisher: "建筑与城乡规划学院",
    host: "jg.sicau.edu.cn",
    attachmentPaths: ["^/system/_content/download\\.jsp$"],
    listUrl: "https://jg.sicau.edu.cn/index/tzgg.htm",
    version: "1",
    defaultChannelId: "default",
    channels: [
      {
        id: "default",
        listUrl: "https://jg.sicau.edu.cn/index/tzgg.htm",
        adapterId: "vsb-selectors",
        version: "1",
        noticePath: "^/info/\\d+/\\d+\\.htm$",
        listPath: "^/index/(?:tzgg\\.htm|tzgg/\\d+\\.htm)$",
        listDatePattern:
          "(?<day>\\d{1,2})\\s*(?<year>20\\d{2})\\s*-\\s*(?<month>\\d{1,2})",
        selectors: {
          // 列表日期拆成「日」和「年-月」两块；正文标题在 .art-tit 的 h3，日期在同一容器的 p 内。
          rows: "li[id^='line_u8_']",
          link: "a",
          date: ".date2",
          pagination: "td[nowrap] > div",
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
    id: "civil-engineering",
    collegeId: "civil-engineering",
    publisher: "土木工程学院",
    host: "tmgcxy.sicau.edu.cn",
    attachmentPaths: ["^/system/_content/download\\.jsp$"],
    listUrl: "https://tmgcxy.sicau.edu.cn/index/tzgg.htm",
    version: "1",
    defaultChannelId: "default",
    channels: [
      {
        id: "default",
        listUrl: "https://tmgcxy.sicau.edu.cn/index/tzgg.htm",
        adapterId: "vsb-selectors",
        version: "1",
        noticePath: "^/info/\\d+/\\d+\\.htm$",
        listPath: "^/index/(?:tzgg\\.htm|tzgg/\\d+\\.htm)$",
        selectors: {
          // 列表行是 ul.box_news_listR 下的 li，日期在 span.time；正文标题为 form 直属 h1，日期在 .prompt 内。
          rows: "ul.box_news_listR > li",
          link: ".a_l a",
          date: "span.time",
          pagination: ".p_pages",
          nextText: "^(下页|下一页|下一頁|Next|>)$",
          title: "form[name=_newscontent_fromname] h1",
          content: "[id^='vsb_content'] .v_news_content",
          meta: ".prompt",
          attachments: "form[name=_newscontent_fromname] > ul",
        },
      },
    ],
  },
  {
    id: "business-tourism",
    collegeId: "business-tourism",
    publisher: "商旅学院",
    host: "slxy.sicau.edu.cn",
    attachmentPaths: ["^/system/_content/download\\.jsp$"],
    listUrl: "https://slxy.sicau.edu.cn/index/tzgg.htm",
    version: "1",
    defaultChannelId: "default",
    channels: [
      {
        id: "default",
        listUrl: "https://slxy.sicau.edu.cn/index/tzgg.htm",
        adapterId: "vsb-selectors",
        version: "1",
        noticePath: "^/info/\\d+/\\d+\\.htm$",
        listPath: "^/index/(?:tzgg\\.htm|tzgg/\\d+\\.htm)$",
        selectors: {
          // 列表与正文沿用 #newsconttitle 模板；栏目仅 9 条、单页无下页，分页仍是旧版表格。
          rows: "li[id^='line_u7_']",
          link: "a",
          date: "span",
          pagination: "td[nowrap] > div",
          nextText: "^(下页|下一页|下一頁|Next|>)$",
          title: "#newsconttitle h1",
          content: "#vsb_content .v_news_content",
          meta: "#newsconttitle p",
          attachments: "form[name=_newscontent_fromname] > ul",
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
