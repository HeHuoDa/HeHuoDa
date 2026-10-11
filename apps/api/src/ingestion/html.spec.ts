import { decodeHtml } from "./http.js";
import {
  extractArticle,
  extractList,
  isCompetitionNotice,
  containsApplicantList,
} from "./html.js";
import { sources } from "./sources.js";
import {
  informationList,
  lifeList,
  informationArticle,
  lifeArticle,
} from "./fixtures.js";

describe("来源适配器的离线页面", () => {
  it("普通学术新闻不进入竞赛候选，报名者信息不采集", () => {
    expect(isCompetitionNotice("学院学术报告通知")).toBe(false);
    expect(isCompetitionNotice("程序设计竞赛报名通知")).toBe(true);
    expect(containsApplicantList("程序设计竞赛报名人员名单")).toBe(true);
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
