export interface Source {
  id: string;
  publisher: string;
  host: string;
  listUrl: string;
  version: string;
}

export const sources: Source[] = [
  {
    id: "information-engineering",
    publisher: "信息工程学院",
    host: "xxgc.sicau.edu.cn",
    listUrl: "https://xxgc.sicau.edu.cn/xygl/tz.htm",
    version: "1",
  },
  {
    id: "life-sciences",
    publisher: "生命科学学院",
    host: "smkx.sicau.edu.cn",
    listUrl: "https://smkx.sicau.edu.cn/xwjtz/tzgg.htm",
    version: "1",
  },
];

export function sourceById(id: string): Source {
  const source = sources.find((s) => s.id === id);
  if (!source) throw new Error("未知采集来源");
  return source;
}
