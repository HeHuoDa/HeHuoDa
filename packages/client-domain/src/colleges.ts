export const colleges = [
  { id: "agriculture", name: "农学院" },
  {
    id: "animal-science",
    name: "动物科技学院",
  },
  {
    id: "veterinary-medicine",
    name: "动物医学院",
  },
  {
    id: "grassland-science",
    name: "草业科技学院",
  },
  { id: "fisheries", name: "水产学院" },
  { id: "forestry", name: "林学院" },
  { id: "horticulture", name: "园艺学院" },
  {
    id: "landscape-architecture",
    name: "风景园林学院",
  },
  { id: "resources", name: "资源学院" },
  { id: "environment", name: "环境学院" },
  { id: "economics", name: "经济学院" },
  { id: "management", name: "管理学院" },
  {
    id: "agricultural-engineering",
    name: "农业工程学院",
  },
  {
    id: "food-science",
    name: "食品学院",
  },
  { id: "science", name: "理学院" },
  {
    id: "life-science",
    name: "生命科学学院",
  },
  {
    id: "mechanical-electrical",
    name: "机电学院",
  },
  {
    id: "information-engineering",
    name: "信息工程学院",
  },
  {
    id: "water-conservancy",
    name: "水利水电学院",
  },
  { id: "humanities", name: "人文学院" },
  {
    id: "public-administration",
    name: "公共管理学院",
  },
  { id: "law", name: "法学院" },
  { id: "sports", name: "体育学院" },
  {
    id: "arts-media",
    name: "艺术与传媒学院",
  },
  {
    id: "architecture-planning",
    name: "建筑与城乡规划学院",
  },
  {
    id: "civil-engineering",
    name: "土木工程学院",
  },
  {
    id: "business-tourism",
    name: "商旅学院",
  },
] as const;

export type CollegeId = (typeof colleges)[number]["id"];
