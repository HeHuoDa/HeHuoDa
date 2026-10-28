/**
 * Issue #174 的 27 院候选核验线索。只读展示，不构成来源登记、栏目配置或网络白名单。
 * checkedAt 与 observations 是研究时观察；所有候选仍需重新完成管理端人工核验。
 */
export interface CollegeVerificationCandidate {
  collegeId: string;
  collegeName: string;
  sourceId: string;
  officialUrl: string;
  candidateChannels: readonly {
    channelId: string;
    channelUrl: string;
    status: "pending_full_validation";
    enabled: false;
  }[];
  sampleNoticeUrls: readonly string[];
  checkedAt: string;
  status: "pending";
  reason: string;
  observations: {
    homePageOutcome: "text_read" | "timeout_or_internal_error";
    candidateListsOutcome: "text_read" | "timeout_or_cache_miss";
    sampleArticlesOutcome:
      "text_read" | "timeout_or_cache_miss_or_inaccessible";
    pagination: "not_verified";
    dates: "not_verified";
    attachmentsAndHosts: "not_verified";
    robotsDnsTls: "not_tested";
  };
  note?: string;
}

export const collegeVerificationCandidates: readonly CollegeVerificationCandidate[] =
  [
    {
      collegeId: "agriculture",
      collegeName: "农学院",
      sourceId: "college-agriculture",
      officialUrl: "https://nxy.sicau.edu.cn/",
      candidateChannels: [
        {
          channelId: "agriculture-channel-1",
          channelUrl: "https://nxy.sicau.edu.cn/index/tzgg.htm",
          status: "pending_full_validation",
          enabled: false,
        },
        {
          channelId: "agriculture-channel-2",
          channelUrl: "https://nxy.sicau.edu.cn/sqyr1/cxcy.htm",
          status: "pending_full_validation",
          enabled: false,
        },
      ],
      sampleNoticeUrls: ["https://nxy.sicau.edu.cn/info/1133/15025.htm"],
      checkedAt: "2026-10-28",
      status: "pending",
      reason:
        "研究记录未完成 DOM 解析、分页完整性、发布日期、附件链接及站点访问安全核验；候选栏目保持关闭，不进入可执行来源或网络白名单。页面返回文本不等于解析契约已验证。",
      observations: {
        homePageOutcome: "timeout_or_internal_error",
        candidateListsOutcome: "text_read",
        sampleArticlesOutcome: "timeout_or_cache_miss_or_inaccessible",
        pagination: "not_verified",
        dates: "not_verified",
        attachmentsAndHosts: "not_verified",
        robotsDnsTls: "not_tested",
      },
      note: "",
    },
    {
      collegeId: "animal-science",
      collegeName: "动物科技学院",
      sourceId: "college-animal-science",
      officialUrl: "https://dky.sicau.edu.cn/",
      candidateChannels: [
        {
          channelId: "animal-science-channel-1",
          channelUrl: "https://dky.sicau.edu.cn/tzgg.htm",
          status: "pending_full_validation",
          enabled: false,
        },
        {
          channelId: "animal-science-channel-2",
          channelUrl: "https://dky.sicau.edu.cn/xsgz/xgdt.htm",
          status: "pending_full_validation",
          enabled: false,
        },
      ],
      sampleNoticeUrls: ["https://dky.sicau.edu.cn/info/1032/16853.htm"],
      checkedAt: "2026-10-28",
      status: "pending",
      reason:
        "研究记录未完成 DOM 解析、分页完整性、发布日期、附件链接及站点访问安全核验；候选栏目保持关闭，不进入可执行来源或网络白名单。页面返回文本不等于解析契约已验证。",
      observations: {
        homePageOutcome: "text_read",
        candidateListsOutcome: "text_read",
        sampleArticlesOutcome: "text_read",
        pagination: "not_verified",
        dates: "not_verified",
        attachmentsAndHosts: "not_verified",
        robotsDnsTls: "not_tested",
      },
      note: "",
    },
    {
      collegeId: "veterinary-medicine",
      collegeName: "动物医学院",
      sourceId: "college-veterinary-medicine",
      officialUrl: "https://dyy.sicau.edu.cn/",
      candidateChannels: [
        {
          channelId: "veterinary-medicine-channel-1",
          channelUrl: "https://dyy.sicau.edu.cn/xwzx1/tzgg.htm",
          status: "pending_full_validation",
          enabled: false,
        },
        {
          channelId: "veterinary-medicine-channel-2",
          channelUrl: "https://dyy.sicau.edu.cn/xsgz1/xsgl.htm",
          status: "pending_full_validation",
          enabled: false,
        },
      ],
      sampleNoticeUrls: ["https://dyy.sicau.edu.cn/info/1013/136203.htm"],
      checkedAt: "2026-10-28",
      status: "pending",
      reason:
        "研究记录未完成 DOM 解析、分页完整性、发布日期、附件链接及站点访问安全核验；候选栏目保持关闭，不进入可执行来源或网络白名单。页面返回文本不等于解析契约已验证。",
      observations: {
        homePageOutcome: "timeout_or_internal_error",
        candidateListsOutcome: "text_read",
        sampleArticlesOutcome: "text_read",
        pagination: "not_verified",
        dates: "not_verified",
        attachmentsAndHosts: "not_verified",
        robotsDnsTls: "not_tested",
      },
      note: "",
    },
    {
      collegeId: "grassland-science",
      collegeName: "草业科技学院",
      sourceId: "college-grassland-science",
      officialUrl: "https://cgst.sicau.edu.cn/",
      candidateChannels: [
        {
          channelId: "grassland-science-channel-1",
          channelUrl: "https://cgst.sicau.edu.cn/index/tzgg/xsl.htm",
          status: "pending_full_validation",
          enabled: false,
        },
        {
          channelId: "grassland-science-channel-2",
          channelUrl: "https://cgst.sicau.edu.cn/xsgz/cxcy.htm",
          status: "pending_full_validation",
          enabled: false,
        },
      ],
      sampleNoticeUrls: ["https://cgst.sicau.edu.cn/info/1059/15538.htm"],
      checkedAt: "2026-10-28",
      status: "pending",
      reason:
        "研究记录未完成 DOM 解析、分页完整性、发布日期、附件链接及站点访问安全核验；候选栏目保持关闭，不进入可执行来源或网络白名单。页面返回文本不等于解析契约已验证。",
      observations: {
        homePageOutcome: "text_read",
        candidateListsOutcome: "text_read",
        sampleArticlesOutcome: "timeout_or_cache_miss_or_inaccessible",
        pagination: "not_verified",
        dates: "not_verified",
        attachmentsAndHosts: "not_verified",
        robotsDnsTls: "not_tested",
      },
      note: "",
    },
    {
      collegeId: "fisheries",
      collegeName: "水产学院",
      sourceId: "college-fisheries",
      officialUrl: "https://scxy.sicau.edu.cn/",
      candidateChannels: [
        {
          channelId: "fisheries-channel-1",
          channelUrl: "https://scxy.sicau.edu.cn/index/tzgg.htm",
          status: "pending_full_validation",
          enabled: false,
        },
        {
          channelId: "fisheries-channel-2",
          channelUrl: "https://scxy.sicau.edu.cn/xsgz/xgdt.htm",
          status: "pending_full_validation",
          enabled: false,
        },
      ],
      sampleNoticeUrls: ["https://scxy.sicau.edu.cn/info/1021/4501.htm"],
      checkedAt: "2026-10-28",
      status: "pending",
      reason:
        "研究记录未完成 DOM 解析、分页完整性、发布日期、附件链接及站点访问安全核验；候选栏目保持关闭，不进入可执行来源或网络白名单。页面返回文本不等于解析契约已验证。",
      observations: {
        homePageOutcome: "text_read",
        candidateListsOutcome: "text_read",
        sampleArticlesOutcome: "text_read",
        pagination: "not_verified",
        dates: "not_verified",
        attachmentsAndHosts: "not_verified",
        robotsDnsTls: "not_tested",
      },
      note: "",
    },
    {
      collegeId: "forestry",
      collegeName: "林学院",
      sourceId: "college-forestry",
      officialUrl: "https://lxy.sicau.edu.cn/",
      candidateChannels: [
        {
          channelId: "forestry-channel-1",
          channelUrl: "https://lxy.sicau.edu.cn/index/tzgg.htm",
          status: "pending_full_validation",
          enabled: false,
        },
        {
          channelId: "forestry-channel-2",
          channelUrl: "https://lxy.sicau.edu.cn/xsgz/xgdt.htm",
          status: "pending_full_validation",
          enabled: false,
        },
      ],
      sampleNoticeUrls: ["https://lxy.sicau.edu.cn/info/1041/9786.htm"],
      checkedAt: "2026-10-28",
      status: "pending",
      reason:
        "研究记录未完成 DOM 解析、分页完整性、发布日期、附件链接及站点访问安全核验；候选栏目保持关闭，不进入可执行来源或网络白名单。页面返回文本不等于解析契约已验证。",
      observations: {
        homePageOutcome: "timeout_or_internal_error",
        candidateListsOutcome: "text_read",
        sampleArticlesOutcome: "text_read",
        pagination: "not_verified",
        dates: "not_verified",
        attachmentsAndHosts: "not_verified",
        robotsDnsTls: "not_tested",
      },
      note: "",
    },
    {
      collegeId: "horticulture",
      collegeName: "园艺学院",
      sourceId: "college-horticulture",
      officialUrl: "https://yyx.sicau.edu.cn/",
      candidateChannels: [
        {
          channelId: "horticulture-channel-1",
          channelUrl: "https://yyx.sicau.edu.cn/xsgz/xsgzxw.htm",
          status: "pending_full_validation",
          enabled: false,
        },
        {
          channelId: "horticulture-channel-2",
          channelUrl: "https://yyx.sicau.edu.cn/xyxw/xytz.htm",
          status: "pending_full_validation",
          enabled: false,
        },
      ],
      sampleNoticeUrls: ["https://yyx.sicau.edu.cn/info/1058/9372.htm"],
      checkedAt: "2026-10-28",
      status: "pending",
      reason:
        "研究记录未完成 DOM 解析、分页完整性、发布日期、附件链接及站点访问安全核验；候选栏目保持关闭，不进入可执行来源或网络白名单。页面返回文本不等于解析契约已验证。",
      observations: {
        homePageOutcome: "timeout_or_internal_error",
        candidateListsOutcome: "text_read",
        sampleArticlesOutcome: "text_read",
        pagination: "not_verified",
        dates: "not_verified",
        attachmentsAndHosts: "not_verified",
        robotsDnsTls: "not_tested",
      },
      note: "",
    },
    {
      collegeId: "landscape-architecture",
      collegeName: "风景园林学院",
      sourceId: "college-landscape-architecture",
      officialUrl: "https://fjylxy.sicau.edu.cn/",
      candidateChannels: [
        {
          channelId: "landscape-architecture-channel-1",
          channelUrl: "https://fjylxy.sicau.edu.cn/jxyj/xskcjs.htm",
          status: "pending_full_validation",
          enabled: false,
        },
      ],
      sampleNoticeUrls: ["https://fjylxy.sicau.edu.cn/info/1071/8303.htm"],
      checkedAt: "2026-10-28",
      status: "pending",
      reason:
        "研究记录未完成 DOM 解析、分页完整性、发布日期、附件链接及站点访问安全核验；候选栏目保持关闭，不进入可执行来源或网络白名单。页面返回文本不等于解析契约已验证。",
      observations: {
        homePageOutcome: "text_read",
        candidateListsOutcome: "text_read",
        sampleArticlesOutcome: "text_read",
        pagination: "not_verified",
        dates: "not_verified",
        attachmentsAndHosts: "not_verified",
        robotsDnsTls: "not_tested",
      },
      note: "",
    },
    {
      collegeId: "resources",
      collegeName: "资源学院",
      sourceId: "college-resources",
      officialUrl: "https://zyxy.sicau.edu.cn/",
      candidateChannels: [
        {
          channelId: "resources-channel-1",
          channelUrl: "https://zyxy.sicau.edu.cn/sy/xsgz1.htm",
          status: "pending_full_validation",
          enabled: false,
        },
      ],
      sampleNoticeUrls: ["https://zyxy.sicau.edu.cn/info/1192/16068.htm"],
      checkedAt: "2026-10-28",
      status: "pending",
      reason:
        "研究记录未完成 DOM 解析、分页完整性、发布日期、附件链接及站点访问安全核验；候选栏目保持关闭，不进入可执行来源或网络白名单。页面返回文本不等于解析契约已验证。",
      observations: {
        homePageOutcome: "text_read",
        candidateListsOutcome: "timeout_or_cache_miss",
        sampleArticlesOutcome: "text_read",
        pagination: "not_verified",
        dates: "not_verified",
        attachmentsAndHosts: "not_verified",
        robotsDnsTls: "not_tested",
      },
      note: "",
    },
    {
      collegeId: "environment",
      collegeName: "环境学院",
      sourceId: "college-environment",
      officialUrl: "https://hjxy.sicau.edu.cn/",
      candidateChannels: [
        {
          channelId: "environment-channel-1",
          channelUrl: "https://hjxy.sicau.edu.cn/xwzx1/tzgg.htm",
          status: "pending_full_validation",
          enabled: false,
        },
        {
          channelId: "environment-channel-2",
          channelUrl: "https://hjxy.sicau.edu.cn/xwzx1/xshd.htm",
          status: "pending_full_validation",
          enabled: false,
        },
        {
          channelId: "environment-channel-3",
          channelUrl: "https://hjxy.sicau.edu.cn/xsgz/cxcy.htm",
          status: "pending_full_validation",
          enabled: false,
        },
      ],
      sampleNoticeUrls: ["https://hjxy.sicau.edu.cn/info/1013/16303.htm"],
      checkedAt: "2026-10-28",
      status: "pending",
      reason:
        "研究记录未完成 DOM 解析、分页完整性、发布日期、附件链接及站点访问安全核验；候选栏目保持关闭，不进入可执行来源或网络白名单。页面返回文本不等于解析契约已验证。",
      observations: {
        homePageOutcome: "timeout_or_internal_error",
        candidateListsOutcome: "text_read",
        sampleArticlesOutcome: "text_read",
        pagination: "not_verified",
        dates: "not_verified",
        attachmentsAndHosts: "not_verified",
        robotsDnsTls: "not_tested",
      },
      note: "",
    },
    {
      collegeId: "economics",
      collegeName: "经济学院",
      sourceId: "college-economics",
      officialUrl: "https://jjxy.sicau.edu.cn/",
      candidateChannels: [
        {
          channelId: "economics-channel-1",
          channelUrl: "https://jjxy.sicau.edu.cn/sylm/xwdt.htm",
          status: "pending_full_validation",
          enabled: false,
        },
        {
          channelId: "economics-channel-2",
          channelUrl: "https://jjxy.sicau.edu.cn/dtjs/txgz.htm",
          status: "pending_full_validation",
          enabled: false,
        },
      ],
      sampleNoticeUrls: ["https://jjxy.sicau.edu.cn/info/1007/25202.htm"],
      checkedAt: "2026-10-28",
      status: "pending",
      reason:
        "研究记录未完成 DOM 解析、分页完整性、发布日期、附件链接及站点访问安全核验；候选栏目保持关闭，不进入可执行来源或网络白名单。页面返回文本不等于解析契约已验证。",
      observations: {
        homePageOutcome: "timeout_or_internal_error",
        candidateListsOutcome: "text_read",
        sampleArticlesOutcome: "text_read",
        pagination: "not_verified",
        dates: "not_verified",
        attachmentsAndHosts: "not_verified",
        robotsDnsTls: "not_tested",
      },
      note: "",
    },
    {
      collegeId: "management",
      collegeName: "管理学院",
      sourceId: "college-management",
      officialUrl: "https://glxy.sicau.edu.cn/",
      candidateChannels: [
        {
          channelId: "management-channel-1",
          channelUrl: "https://glxy.sicau.edu.cn/ggl/xsl.htm",
          status: "pending_full_validation",
          enabled: false,
        },
      ],
      sampleNoticeUrls: ["https://glxy.sicau.edu.cn/info/1076/14932.htm"],
      checkedAt: "2026-10-28",
      status: "pending",
      reason:
        "研究记录未完成 DOM 解析、分页完整性、发布日期、附件链接及站点访问安全核验；候选栏目保持关闭，不进入可执行来源或网络白名单。页面返回文本不等于解析契约已验证。",
      observations: {
        homePageOutcome: "text_read",
        candidateListsOutcome: "text_read",
        sampleArticlesOutcome: "text_read",
        pagination: "not_verified",
        dates: "not_verified",
        attachmentsAndHosts: "not_verified",
        robotsDnsTls: "not_tested",
      },
      note: "",
    },
    {
      collegeId: "agricultural-engineering",
      collegeName: "农业工程学院",
      sourceId: "college-agricultural-engineering",
      officialUrl: "https://nygcxy.sicau.edu.cn/",
      candidateChannels: [
        {
          channelId: "agricultural-engineering-channel-1",
          channelUrl: "https://nygcxy.sicau.edu.cn/xsgz/cxcy.htm",
          status: "pending_full_validation",
          enabled: false,
        },
      ],
      sampleNoticeUrls: ["https://nygcxy.sicau.edu.cn/info/1621/3841.htm"],
      checkedAt: "2026-10-28",
      status: "pending",
      reason:
        "研究记录未完成 DOM 解析、分页完整性、发布日期、附件链接及站点访问安全核验；候选栏目保持关闭，不进入可执行来源或网络白名单。页面返回文本不等于解析契约已验证。",
      observations: {
        homePageOutcome: "text_read",
        candidateListsOutcome: "text_read",
        sampleArticlesOutcome: "text_read",
        pagination: "not_verified",
        dates: "not_verified",
        attachmentsAndHosts: "not_verified",
        robotsDnsTls: "not_tested",
      },
      note: "",
    },
    {
      collegeId: "food-science",
      collegeName: "食品学院",
      sourceId: "college-food-science",
      officialUrl: "https://spxy.sicau.edu.cn/",
      candidateChannels: [
        {
          channelId: "food-science-channel-1",
          channelUrl: "https://spxy.sicau.edu.cn/xsgz/xsdt.htm",
          status: "pending_full_validation",
          enabled: false,
        },
      ],
      sampleNoticeUrls: ["https://spxy.sicau.edu.cn/info/1021/151151.htm"],
      checkedAt: "2026-10-28",
      status: "pending",
      reason:
        "研究记录未完成 DOM 解析、分页完整性、发布日期、附件链接及站点访问安全核验；候选栏目保持关闭，不进入可执行来源或网络白名单。页面返回文本不等于解析契约已验证。",
      observations: {
        homePageOutcome: "text_read",
        candidateListsOutcome: "timeout_or_cache_miss",
        sampleArticlesOutcome: "text_read",
        pagination: "not_verified",
        dates: "not_verified",
        attachmentsAndHosts: "not_verified",
        robotsDnsTls: "not_tested",
      },
      note: "",
    },
    {
      collegeId: "science",
      collegeName: "理学院",
      sourceId: "college-science",
      officialUrl: "https://lixueyuan.sicau.edu.cn/",
      candidateChannels: [
        {
          channelId: "science-channel-1",
          channelUrl: "https://lixueyuan.sicau.edu.cn/xwjtz/tzgg.htm",
          status: "pending_full_validation",
          enabled: false,
        },
        {
          channelId: "science-channel-2",
          channelUrl: "https://lixueyuan.sicau.edu.cn/xsgz/xsgz.htm",
          status: "pending_full_validation",
          enabled: false,
        },
      ],
      sampleNoticeUrls: ["https://lixueyuan.sicau.edu.cn/info/1071/20303.htm"],
      checkedAt: "2026-10-28",
      status: "pending",
      reason:
        "研究记录未完成 DOM 解析、分页完整性、发布日期、附件链接及站点访问安全核验；候选栏目保持关闭，不进入可执行来源或网络白名单。页面返回文本不等于解析契约已验证。",
      observations: {
        homePageOutcome: "text_read",
        candidateListsOutcome: "timeout_or_cache_miss",
        sampleArticlesOutcome: "text_read",
        pagination: "not_verified",
        dates: "not_verified",
        attachmentsAndHosts: "not_verified",
        robotsDnsTls: "not_tested",
      },
      note: "",
    },
    {
      collegeId: "life-science",
      collegeName: "生命科学学院",
      sourceId: "life-sciences",
      officialUrl: "https://smkx.sicau.edu.cn/",
      candidateChannels: [
        {
          channelId: "life-science-channel-1",
          channelUrl: "https://smkx.sicau.edu.cn/xwjtz/tzgg.htm",
          status: "pending_full_validation",
          enabled: false,
        },
      ],
      sampleNoticeUrls: ["https://smkx.sicau.edu.cn/info/1061/28771.htm"],
      checkedAt: "2026-10-28",
      status: "pending",
      reason:
        "研究记录未完成 DOM 解析、分页完整性、发布日期、附件链接及站点访问安全核验；候选栏目保持关闭，不进入可执行来源或网络白名单。页面返回文本不等于解析契约已验证。",
      observations: {
        homePageOutcome: "text_read",
        candidateListsOutcome: "text_read",
        sampleArticlesOutcome: "timeout_or_cache_miss_or_inaccessible",
        pagination: "not_verified",
        dates: "not_verified",
        attachmentsAndHosts: "not_verified",
        robotsDnsTls: "not_tested",
      },
      note: "保留旧 sourceId life-sciences 及其运行、游标、恢复链",
    },
    {
      collegeId: "mechanical-electrical",
      collegeName: "机电学院",
      sourceId: "college-mechanical-electrical",
      officialUrl: "https://jdxy.sicau.edu.cn/",
      candidateChannels: [
        {
          channelId: "mechanical-electrical-channel-1",
          channelUrl: "https://jdxy.sicau.edu.cn/index/tzgg.htm",
          status: "pending_full_validation",
          enabled: false,
        },
        {
          channelId: "mechanical-electrical-channel-2",
          channelUrl: "https://jdxy.sicau.edu.cn/xsgz/dtjs.htm",
          status: "pending_full_validation",
          enabled: false,
        },
      ],
      sampleNoticeUrls: ["https://jdxy.sicau.edu.cn/info/1702/43591.htm"],
      checkedAt: "2026-10-28",
      status: "pending",
      reason:
        "研究记录未完成 DOM 解析、分页完整性、发布日期、附件链接及站点访问安全核验；候选栏目保持关闭，不进入可执行来源或网络白名单。页面返回文本不等于解析契约已验证。",
      observations: {
        homePageOutcome: "timeout_or_internal_error",
        candidateListsOutcome: "text_read",
        sampleArticlesOutcome: "timeout_or_cache_miss_or_inaccessible",
        pagination: "not_verified",
        dates: "not_verified",
        attachmentsAndHosts: "not_verified",
        robotsDnsTls: "not_tested",
      },
      note: "",
    },
    {
      collegeId: "information-engineering",
      collegeName: "信息工程学院",
      sourceId: "information-engineering",
      officialUrl: "https://xxgc.sicau.edu.cn/",
      candidateChannels: [
        {
          channelId: "information-engineering-channel-1",
          channelUrl: "https://xxgc.sicau.edu.cn/xygl/tz.htm",
          status: "pending_full_validation",
          enabled: false,
        },
        {
          channelId: "information-engineering-channel-2",
          channelUrl: "https://xxgc.sicau.edu.cn/xwzx/xgzx.htm",
          status: "pending_full_validation",
          enabled: false,
        },
      ],
      sampleNoticeUrls: ["https://xxgc.sicau.edu.cn/info/1043/18354.htm"],
      checkedAt: "2026-10-28",
      status: "pending",
      reason:
        "研究记录未完成 DOM 解析、分页完整性、发布日期、附件链接及站点访问安全核验；候选栏目保持关闭，不进入可执行来源或网络白名单。页面返回文本不等于解析契约已验证。",
      observations: {
        homePageOutcome: "timeout_or_internal_error",
        candidateListsOutcome: "text_read",
        sampleArticlesOutcome: "text_read",
        pagination: "not_verified",
        dates: "not_verified",
        attachmentsAndHosts: "not_verified",
        robotsDnsTls: "not_tested",
      },
      note: "",
    },
    {
      collegeId: "water-conservancy",
      collegeName: "水利水电学院",
      sourceId: "college-water-conservancy",
      officialUrl: "https://slsd.sicau.edu.cn/",
      candidateChannels: [
        {
          channelId: "water-conservancy-channel-1",
          channelUrl: "https://slsd.sicau.edu.cn/",
          status: "pending_full_validation",
          enabled: false,
        },
        {
          channelId: "water-conservancy-channel-2",
          channelUrl: "https://slsd.sicau.edu.cn/tzgg.htm",
          status: "pending_full_validation",
          enabled: false,
        },
        {
          channelId: "water-conservancy-channel-3",
          channelUrl: "https://slsd.sicau.edu.cn/xsgca/txdt.htm",
          status: "pending_full_validation",
          enabled: false,
        },
      ],
      sampleNoticeUrls: ["https://slsd.sicau.edu.cn/info/1012/15235.htm"],
      checkedAt: "2026-10-28",
      status: "pending",
      reason:
        "研究记录未完成 DOM 解析、分页完整性、发布日期、附件链接及站点访问安全核验；候选栏目保持关闭，不进入可执行来源或网络白名单。页面返回文本不等于解析契约已验证。",
      observations: {
        homePageOutcome: "text_read",
        candidateListsOutcome: "text_read",
        sampleArticlesOutcome: "timeout_or_cache_miss_or_inaccessible",
        pagination: "not_verified",
        dates: "not_verified",
        attachmentsAndHosts: "not_verified",
        robotsDnsTls: "not_tested",
      },
      note: "",
    },
    {
      collegeId: "humanities",
      collegeName: "人文学院",
      sourceId: "college-humanities",
      officialUrl: "https://rwy.sicau.edu.cn/",
      candidateChannels: [
        {
          channelId: "humanities-channel-1",
          channelUrl: "https://rwy.sicau.edu.cn/",
          status: "pending_full_validation",
          enabled: false,
        },
        {
          channelId: "humanities-channel-2",
          channelUrl: "https://rwy.sicau.edu.cn/index/tz.htm",
          status: "pending_full_validation",
          enabled: false,
        },
        {
          channelId: "humanities-channel-3",
          channelUrl: "https://rwy.sicau.edu.cn/index/txgz/pphd.htm",
          status: "pending_full_validation",
          enabled: false,
        },
      ],
      sampleNoticeUrls: ["https://rwy.sicau.edu.cn/info/1173/27768.htm"],
      checkedAt: "2026-10-28",
      status: "pending",
      reason:
        "研究记录未完成 DOM 解析、分页完整性、发布日期、附件链接及站点访问安全核验；候选栏目保持关闭，不进入可执行来源或网络白名单。页面返回文本不等于解析契约已验证。",
      observations: {
        homePageOutcome: "text_read",
        candidateListsOutcome: "text_read",
        sampleArticlesOutcome: "text_read",
        pagination: "not_verified",
        dates: "not_verified",
        attachmentsAndHosts: "not_verified",
        robotsDnsTls: "not_tested",
      },
      note: "",
    },
    {
      collegeId: "public-administration",
      collegeName: "公共管理学院",
      sourceId: "college-public-administration",
      officialUrl: "https://fpa.sicau.edu.cn/",
      candidateChannels: [
        {
          channelId: "public-administration-channel-1",
          channelUrl: "https://fpa.sicau.edu.cn/",
          status: "pending_full_validation",
          enabled: false,
        },
        {
          channelId: "public-administration-channel-2",
          channelUrl: "https://fpa.sicau.edu.cn/sylm/tzgg/xsl.htm",
          status: "pending_full_validation",
          enabled: false,
        },
        {
          channelId: "public-administration-channel-3",
          channelUrl: "https://fpa.sicau.edu.cn/dtjs/txgz.htm",
          status: "pending_full_validation",
          enabled: false,
        },
      ],
      sampleNoticeUrls: ["https://fpa.sicau.edu.cn/info/1007/8680.htm"],
      checkedAt: "2026-10-28",
      status: "pending",
      reason:
        "研究记录未完成 DOM 解析、分页完整性、发布日期、附件链接及站点访问安全核验；候选栏目保持关闭，不进入可执行来源或网络白名单。页面返回文本不等于解析契约已验证。",
      observations: {
        homePageOutcome: "text_read",
        candidateListsOutcome: "text_read",
        sampleArticlesOutcome: "timeout_or_cache_miss_or_inaccessible",
        pagination: "not_verified",
        dates: "not_verified",
        attachmentsAndHosts: "not_verified",
        robotsDnsTls: "not_tested",
      },
      note: "",
    },
    {
      collegeId: "law",
      collegeName: "法学院",
      sourceId: "college-law",
      officialUrl: "https://fxy.sicau.edu.cn/",
      candidateChannels: [
        {
          channelId: "law-channel-1",
          channelUrl: "https://fxy.sicau.edu.cn/",
          status: "pending_full_validation",
          enabled: false,
        },
        {
          channelId: "law-channel-2",
          channelUrl: "https://fxy.sicau.edu.cn/index/tzgg.htm",
          status: "pending_full_validation",
          enabled: false,
        },
        {
          channelId: "law-channel-3",
          channelUrl: "https://fxy.sicau.edu.cn/dqgz/txgz.htm",
          status: "pending_full_validation",
          enabled: false,
        },
      ],
      sampleNoticeUrls: ["https://fxy.sicau.edu.cn/info/1045/8432.htm"],
      checkedAt: "2026-10-28",
      status: "pending",
      reason:
        "研究记录未完成 DOM 解析、分页完整性、发布日期、附件链接及站点访问安全核验；候选栏目保持关闭，不进入可执行来源或网络白名单。页面返回文本不等于解析契约已验证。",
      observations: {
        homePageOutcome: "timeout_or_internal_error",
        candidateListsOutcome: "text_read",
        sampleArticlesOutcome: "text_read",
        pagination: "not_verified",
        dates: "not_verified",
        attachmentsAndHosts: "not_verified",
        robotsDnsTls: "not_tested",
      },
      note: "",
    },
    {
      collegeId: "sports",
      collegeName: "体育学院",
      sourceId: "college-sports",
      officialUrl: "https://ytxy.sicau.edu.cn/",
      candidateChannels: [
        {
          channelId: "sports-channel-1",
          channelUrl: "https://ytxy.sicau.edu.cn/",
          status: "pending_full_validation",
          enabled: false,
        },
        {
          channelId: "sports-channel-2",
          channelUrl: "https://ytxy.sicau.edu.cn/kwty.htm",
          status: "pending_full_validation",
          enabled: false,
        },
        {
          channelId: "sports-channel-3",
          channelUrl: "https://ytxy.sicau.edu.cn/kwty/xyhzl.htm",
          status: "pending_full_validation",
          enabled: false,
        },
        {
          channelId: "sports-channel-4",
          channelUrl: "https://ytxy.sicau.edu.cn/zgzj/hdxx.htm",
          status: "pending_full_validation",
          enabled: false,
        },
        {
          channelId: "sports-channel-5",
          channelUrl: "https://ytxy.sicau.edu.cn/dxty/tzjkcs.htm",
          status: "pending_full_validation",
          enabled: false,
        },
      ],
      sampleNoticeUrls: ["https://ytxy.sicau.edu.cn/info/1095/21874.htm"],
      checkedAt: "2026-10-28",
      status: "pending",
      reason:
        "研究记录未完成 DOM 解析、分页完整性、发布日期、附件链接及站点访问安全核验；候选栏目保持关闭，不进入可执行来源或网络白名单。页面返回文本不等于解析契约已验证。",
      observations: {
        homePageOutcome: "text_read",
        candidateListsOutcome: "text_read",
        sampleArticlesOutcome: "timeout_or_cache_miss_or_inaccessible",
        pagination: "not_verified",
        dates: "not_verified",
        attachmentsAndHosts: "not_verified",
        robotsDnsTls: "not_tested",
      },
      note: "",
    },
    {
      collegeId: "arts-media",
      collegeName: "艺术与传媒学院",
      sourceId: "college-arts-media",
      officialUrl: "https://yscm.sicau.edu.cn/",
      candidateChannels: [
        {
          channelId: "arts-media-channel-1",
          channelUrl: "https://yscm.sicau.edu.cn/",
          status: "pending_full_validation",
          enabled: false,
        },
        {
          channelId: "arts-media-channel-2",
          channelUrl: "https://yscm.sicau.edu.cn/qt/tzgg/xsl.htm",
          status: "pending_full_validation",
          enabled: false,
        },
        {
          channelId: "arts-media-channel-3",
          channelUrl: "https://yscm.sicau.edu.cn/xsgz.htm",
          status: "pending_full_validation",
          enabled: false,
        },
      ],
      sampleNoticeUrls: ["https://yscm.sicau.edu.cn/info/1053/18211.htm"],
      checkedAt: "2026-10-28",
      status: "pending",
      reason:
        "研究记录未完成 DOM 解析、分页完整性、发布日期、附件链接及站点访问安全核验；候选栏目保持关闭，不进入可执行来源或网络白名单。页面返回文本不等于解析契约已验证。",
      observations: {
        homePageOutcome: "text_read",
        candidateListsOutcome: "text_read",
        sampleArticlesOutcome: "text_read",
        pagination: "not_verified",
        dates: "not_verified",
        attachmentsAndHosts: "not_verified",
        robotsDnsTls: "not_tested",
      },
      note: "",
    },
    {
      collegeId: "architecture-planning",
      collegeName: "建筑与城乡规划学院",
      sourceId: "college-architecture-planning",
      officialUrl: "https://jg.sicau.edu.cn/",
      candidateChannels: [
        {
          channelId: "architecture-planning-channel-1",
          channelUrl: "https://jg.sicau.edu.cn/",
          status: "pending_full_validation",
          enabled: false,
        },
        {
          channelId: "architecture-planning-channel-2",
          channelUrl: "https://jg.sicau.edu.cn/index/tzgg.htm",
          status: "pending_full_validation",
          enabled: false,
        },
        {
          channelId: "architecture-planning-channel-3",
          channelUrl: "https://jg.sicau.edu.cn/dtgz/txgz.htm",
          status: "pending_full_validation",
          enabled: false,
        },
      ],
      sampleNoticeUrls: ["https://jg.sicau.edu.cn/info/1059/9568.htm"],
      checkedAt: "2026-10-28",
      status: "pending",
      reason:
        "研究记录未完成 DOM 解析、分页完整性、发布日期、附件链接及站点访问安全核验；候选栏目保持关闭，不进入可执行来源或网络白名单。页面返回文本不等于解析契约已验证。",
      observations: {
        homePageOutcome: "text_read",
        candidateListsOutcome: "text_read",
        sampleArticlesOutcome: "text_read",
        pagination: "not_verified",
        dates: "not_verified",
        attachmentsAndHosts: "not_verified",
        robotsDnsTls: "not_tested",
      },
      note: "",
    },
    {
      collegeId: "civil-engineering",
      collegeName: "土木工程学院",
      sourceId: "college-civil-engineering",
      officialUrl: "https://tmgcxy.sicau.edu.cn/",
      candidateChannels: [
        {
          channelId: "civil-engineering-channel-1",
          channelUrl: "https://tmgcxy.sicau.edu.cn/",
          status: "pending_full_validation",
          enabled: false,
        },
        {
          channelId: "civil-engineering-channel-2",
          channelUrl: "https://tmgcxy.sicau.edu.cn/index/tzgg.htm",
          status: "pending_full_validation",
          enabled: false,
        },
        {
          channelId: "civil-engineering-channel-3",
          channelUrl: "https://tmgcxy.sicau.edu.cn/txgz.htm",
          status: "pending_full_validation",
          enabled: false,
        },
      ],
      sampleNoticeUrls: ["https://tmgcxy.sicau.edu.cn/info/1046/10774.htm"],
      checkedAt: "2026-10-28",
      status: "pending",
      reason:
        "研究记录未完成 DOM 解析、分页完整性、发布日期、附件链接及站点访问安全核验；候选栏目保持关闭，不进入可执行来源或网络白名单。页面返回文本不等于解析契约已验证。",
      observations: {
        homePageOutcome: "text_read",
        candidateListsOutcome: "text_read",
        sampleArticlesOutcome: "text_read",
        pagination: "not_verified",
        dates: "not_verified",
        attachmentsAndHosts: "not_verified",
        robotsDnsTls: "not_tested",
      },
      note: "",
    },
    {
      collegeId: "business-tourism",
      collegeName: "商旅学院",
      sourceId: "college-business-tourism",
      officialUrl: "https://slxy.sicau.edu.cn/",
      candidateChannels: [
        {
          channelId: "business-tourism-channel-1",
          channelUrl: "https://slxy.sicau.edu.cn/",
          status: "pending_full_validation",
          enabled: false,
        },
        {
          channelId: "business-tourism-channel-2",
          channelUrl: "https://slxy.sicau.edu.cn/index/tzgg.htm",
          status: "pending_full_validation",
          enabled: false,
        },
        {
          channelId: "business-tourism-channel-3",
          channelUrl: "https://slxy.sicau.edu.cn/dtjs/txgz1/txdt2.htm",
          status: "pending_full_validation",
          enabled: false,
        },
        {
          channelId: "business-tourism-channel-4",
          channelUrl: "https://slxy.sicau.edu.cn/dtjs/txgz1/zzjg.htm",
          status: "pending_full_validation",
          enabled: false,
        },
      ],
      sampleNoticeUrls: ["https://slxy.sicau.edu.cn/info/1053/15697.htm"],
      checkedAt: "2026-10-28",
      status: "pending",
      reason:
        "研究记录未完成 DOM 解析、分页完整性、发布日期、附件链接及站点访问安全核验；候选栏目保持关闭，不进入可执行来源或网络白名单。页面返回文本不等于解析契约已验证。",
      observations: {
        homePageOutcome: "text_read",
        candidateListsOutcome: "text_read",
        sampleArticlesOutcome: "text_read",
        pagination: "not_verified",
        dates: "not_verified",
        attachmentsAndHosts: "not_verified",
        robotsDnsTls: "not_tested",
      },
      note: "",
    },
  ] as const;
