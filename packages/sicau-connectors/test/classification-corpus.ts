// 人工指定标签的构造最小文本，非实站样本，不代表全站准确率或漏收率。
export const positiveGroups = {
  discipline: [
    "数学建模竞赛",
    "程序设计比赛",
    "化学实验大赛",
    "英语演讲比赛",
    "物理实验竞赛",
    "机械设计大赛",
    "电子设计竞赛",
    "统计建模比赛",
    "生命科学竞赛",
    "法学案例大赛",
  ],
  innovation: [
    "创新创业大赛",
    "挑战杯竞赛",
    "互联网+大赛",
    "创业计划竞赛",
    "乡村振兴创意比赛",
    "创客作品大赛",
    "商业计划比赛",
    "创新项目竞赛",
    "农业创新大赛",
    "创业模拟比赛",
  ],
  career: [
    "职业规划大赛",
    "职业技能竞赛",
    "简历设计比赛",
    "求职模拟大赛",
    "生涯规划比赛",
    "职场演讲竞赛",
    "就业能力大赛",
    "职业礼仪比赛",
    "面试技能竞赛",
    "教师技能大赛",
  ],
  arts: [
    "校园歌唱比赛",
    "舞蹈大赛",
    "书法竞赛",
    "摄影比赛",
    "绘画大赛",
    "戏剧表演比赛",
    "器乐比赛",
    "朗诵大赛",
    "海报设计竞赛",
    "短片创作比赛",
  ],
  sports: [
    "篮球比赛",
    "足球联赛",
    "排球比赛",
    "乒乓球锦标赛",
    "羽毛球比赛",
    "田径运动会",
    "游泳比赛",
    "网球联赛",
    "定向越野比赛",
    "健美操大赛",
  ],
};
export const nonCompetitionTitles = [
  "体质测试安排",
  "体育体测通知",
  "期末考试通知",
  "英语考试报名",
  "学术讲座报名",
  "创新方法培训",
  "招聘宣讲通知",
  "志愿活动报名",
  "图书馆开放安排",
  "校园网维护通知",
  "宿舍卫生检查",
  "教材领取通知",
  "学生资助申请",
  "课程调整通知",
  "食堂营业安排",
  "运动场维修",
  "图书借阅规则变更",
  "假期放假通知",
  "办公电话调整",
  "实验室安全检查",
  "学位申请通知",
  "课程补考报名",
  "教学评估安排",
  "体育课选课通知",
  "心理讲座报名",
];
/**
 * #205 的成对边界：同一份 dev 语料里既要有「谁做什么、对象是不是参赛者」的负例，
 * 也要有只差一个主体的正例，避免把「出现执裁／招募／选拔」当成排除词表。
 * 期望值按人工判断写死，不由实现计算得出。
 */
export interface ClassificationBoundaryCase {
  /** 这条用例守住的边界，失败时直接指出是哪条判定被破坏。 */
  boundary: string;
  title: string;
  paragraphs: string[];
  classification: "definite" | "suspected" | "non_competition";
  notificationKind: "registration" | "supplement" | "award" | "news";
  priority: number;
}

export const classificationBoundaryCases: ClassificationBoundaryCase[] = [
  {
    boundary: "执裁回顾不是可报名赛事",
    title: "体育学院武术队受邀执裁第四届川东北武术套路公开赛",
    paragraphs: [
      "2026年10月18日，第四届川东北武术套路公开赛在南充市体育中心举行。",
      "体育学院武术队受邀承担本次比赛裁判工作，圆满完成执裁任务。",
      "比赛设男子长拳、女子南拳等12个项目，共有9支代表队参赛。",
    ],
    classification: "non_competition",
    notificationKind: "news",
    priority: 3,
  },
  {
    boundary: "学生组织招新不是赛事报名",
    title: "校学生会体育部2026年秋季招新通知",
    paragraphs: [
      "校学生会体育部拟于2026年9月开展招新工作，面向全校2026级新生。",
      "体育部负责承办校运动会、篮球比赛等体育活动的组织与服务。",
      "报名方式：填写报名表并于9月20日前交至学生会办公室。",
    ],
    classification: "non_competition",
    notificationKind: "registration",
    priority: 3,
  },
  {
    boundary: "实验室招新提到竞赛方向仍是招新",
    title: "人工智能应用实验室招新",
    paragraphs: [
      "信息工程学院“人工智能应用工作室”拟于2026年11月开展招新工作。",
      "实验室聚焦深度学习、机器学习等核心领域，鼓励成员参加各类竞赛。",
    ],
    classification: "non_competition",
    notificationKind: "news",
    priority: 3,
  },
  {
    boundary: "社会实践团队招募不是赛事报名",
    title: "关于开展2026年暑期社会实践团队招募的通知",
    paragraphs: [
      "学院拟组建暑期社会实践团队，现面向全院招募队员。",
      "近年学院社会实践团队在“挑战杯”竞赛中多次获奖。",
      "报名截止：2026年6月10日。",
    ],
    classification: "non_competition",
    notificationKind: "registration",
    priority: 3,
  },
  {
    boundary: "假期与离校管理不是赛事报名",
    title: "关于2026年国庆节假期学生管理工作的通知",
    paragraphs: [
      "放假时间为2026年10月1日至7日。",
      "学生离校前须报备行程，参加竞赛集训的学生按学院安排执行。",
      "请各班于9月28日前完成离校登记。",
    ],
    classification: "non_competition",
    notificationKind: "news",
    priority: 3,
  },
  {
    boundary: "岗位招募不是赛事报名",
    title: "关于招聘学院实验教学助理的通知",
    paragraphs: [
      "学院拟招聘实验教学助理若干名，协助实验课程准备与竞赛资料整理。",
      "岗位要求：责任心强，每周工作不少于8小时。",
      "报名截止：2026年9月30日。",
    ],
    classification: "non_competition",
    notificationKind: "registration",
    priority: 3,
  },
  {
    boundary: "赛事队伍招募仍是明确赛事",
    title: "关于招募2026年四川省大学生电子设计竞赛参赛队伍的通知",
    paragraphs: [
      "参赛对象为全校本科生，请各学院组织学生报名，报名截止：2026年10月20日。",
    ],
    classification: "definite",
    notificationKind: "registration",
    priority: 0,
  },
  {
    boundary: "推荐学生参加具体赛事仍是明确赛事",
    title: "关于推荐优秀本科生参加2026年全国大学生数学建模竞赛的通知",
    paragraphs: ["学校将择优推荐学生参赛，报名截止：2026年9月10日。"],
    classification: "definite",
    notificationKind: "registration",
    priority: 0,
  },
  {
    boundary: "赛事通知提到执裁安排不因此降级",
    title: "关于举办2026年校园武术套路公开赛的通知",
    paragraphs: [
      "报名截止：2026年11月1日，比赛时间：2026年11月15日，地点：体育馆。",
      "本次比赛设裁判组，由武术队队员协助执裁。",
    ],
    classification: "definite",
    notificationKind: "registration",
    priority: 0,
  },
  {
    boundary: "只面向研究生的真赛事仍是明确赛事",
    title: "关于举办2026年中国研究生智能建造创新大赛校内选拔赛的通知",
    paragraphs: ["参赛对象：在校研究生。报名截止：2026年10月15日。"],
    classification: "definite",
    notificationKind: "registration",
    priority: 0,
  },
  {
    boundary: "延期补充仍按赛事进程处理",
    title: "2026年数学建模竞赛补充通知",
    paragraphs: ["数学建模竞赛报名延期至2026年11月10日。"],
    classification: "definite",
    notificationKind: "supplement",
    priority: 0,
  },
];

export const ambiguousTitles = [
  "校园征文通知",
  "绘画作品征集",
  "活动赛报名",
  "创新创业交流",
  "职业规划交流",
  "艺术节作品征集",
  "体育节活动",
  "文学征文活动",
  "影像作品征集",
  "读书征文启事",
  "公益作品征集",
  "校园活动赛",
  "职业规划咨询",
  "创新创业分享",
  "艺术节安排",
];
