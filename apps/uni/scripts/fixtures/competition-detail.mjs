export const unknownTime = { precision: "unknown", value: null };
export function detail(id = "competition-a") {
  return {
    id,
    name: "校园创新比赛",
    edition: "2026届",
    category: "创新创业",
    organizer: "校团委",
    origin: "historical",
    evaluatedAt: "2026-10-19T00:00:00Z",
    tracks: [
      {
        id: "track-a",
        name: "创意赛道",
        mode: "team",
        members: "2–5人",
        rules: "提交项目方案",
      },
    ],
    stages: [
      {
        id: "stage-a",
        name: "学院初赛",
        organizer: "学院",
        hosts: [],
        scope: { kind: "complex", colleges: [], note: "须通过资格审核" },
        startsAt: unknownTime,
        deadline: { precision: "date", value: "2026-10-20" },
        materialsAt: unknownTime,
        eventAt: unknownTime,
        timeNote: "时间以补充通知为准",
        conflict: true,
        registration: "联系所在学院",
        order: 0,
        sourceIds: ["notice-a"],
        status: "conflict",
      },
    ],
    notices: [
      {
        id: "notice-a",
        title: "比赛新闻回顾",
        publisher: "学校",
        url: "https://example.edu.cn/news",
        publishedAt: null,
        checkedAt: null,
        kind: "news",
      },
    ],
  };
}
