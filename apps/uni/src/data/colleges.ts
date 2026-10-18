// 学院字典与本地展示资源；稳定 ID 用于选择状态。
const emblem0 = "/static/colleges/agriculture.png";
const emblem1 = "/static/colleges/animal-science.png";
const emblem2 = "/static/colleges/veterinary-medicine.png";
const emblem3 = "/static/colleges/grassland-science.png";
const emblem4 = "/static/colleges/fisheries.png";
const emblem5 = "/static/colleges/forestry.png";
const emblem6 = "/static/colleges/horticulture.png";
const emblem7 = "/static/colleges/landscape-architecture.png";
const emblem8 = "/static/colleges/resources.png";
const emblem9 = "/static/colleges/environment.png";
const emblem10 = "/static/colleges/economics.png";
const emblem11 = "/static/colleges/management.png";
const emblem13 = "/static/colleges/food-science.png";
const emblem14 = "/static/colleges/science.png";
const emblem15 = "/static/colleges/life-science.png";
const emblem16 = "/static/colleges/mechanical-electrical.png";
const emblem17 = "/static/colleges/information-engineering.png";
const emblem18 = "/static/colleges/water-conservancy.png";
const emblem19 = "/static/colleges/humanities.png";
const emblem20 = "/static/colleges/public-administration.png";
const emblem21 = "/static/colleges/law.png";
const emblem22 = "/static/colleges/sports.png";
const emblem23 = "/static/colleges/arts-media.png";
const emblem24 = "/static/colleges/architecture-planning.png";
const emblem26 = "/static/colleges/business-tourism.png";

export const colleges = [
  { id: "agriculture", name: "农学院", emblem: emblem0, whiteArtwork: false },
  {
    id: "animal-science",
    name: "动物科技学院",
    emblem: emblem1,
    whiteArtwork: false,
  },
  {
    id: "veterinary-medicine",
    name: "动物医学院",
    emblem: emblem2,
    whiteArtwork: false,
  },
  {
    id: "grassland-science",
    name: "草业科技学院",
    emblem: emblem3,
    whiteArtwork: false,
  },
  { id: "fisheries", name: "水产学院", emblem: emblem4, whiteArtwork: false },
  { id: "forestry", name: "林学院", emblem: emblem5, whiteArtwork: false },
  { id: "horticulture", name: "园艺学院", emblem: emblem6, whiteArtwork: true },
  {
    id: "landscape-architecture",
    name: "风景园林学院",
    emblem: emblem7,
    whiteArtwork: false,
  },
  { id: "resources", name: "资源学院", emblem: emblem8, whiteArtwork: false },
  { id: "environment", name: "环境学院", emblem: emblem9, whiteArtwork: false },
  { id: "economics", name: "经济学院", emblem: emblem10, whiteArtwork: false },
  { id: "management", name: "管理学院", emblem: emblem11, whiteArtwork: false },
  {
    id: "agricultural-engineering",
    name: "农业工程学院",
    emblem: null,
    whiteArtwork: false,
  },
  {
    id: "food-science",
    name: "食品学院",
    emblem: emblem13,
    whiteArtwork: true,
  },
  { id: "science", name: "理学院", emblem: emblem14, whiteArtwork: false },
  {
    id: "life-science",
    name: "生命科学学院",
    emblem: emblem15,
    whiteArtwork: false,
  },
  {
    id: "mechanical-electrical",
    name: "机电学院",
    emblem: emblem16,
    whiteArtwork: true,
  },
  {
    id: "information-engineering",
    name: "信息工程学院",
    emblem: emblem17,
    whiteArtwork: false,
  },
  {
    id: "water-conservancy",
    name: "水利水电学院",
    emblem: emblem18,
    whiteArtwork: false,
  },
  { id: "humanities", name: "人文学院", emblem: emblem19, whiteArtwork: false },
  {
    id: "public-administration",
    name: "公共管理学院",
    emblem: emblem20,
    whiteArtwork: false,
  },
  { id: "law", name: "法学院", emblem: emblem21, whiteArtwork: false },
  { id: "sports", name: "体育学院", emblem: emblem22, whiteArtwork: false },
  {
    id: "arts-media",
    name: "艺术与传媒学院",
    emblem: emblem23,
    whiteArtwork: false,
  },
  {
    id: "architecture-planning",
    name: "建筑与城乡规划学院",
    emblem: emblem24,
    whiteArtwork: true,
  },
  {
    id: "civil-engineering",
    name: "土木工程学院",
    emblem: null,
    whiteArtwork: false,
  },
  {
    id: "business-tourism",
    name: "商旅学院",
    emblem: emblem26,
    whiteArtwork: false,
  },
] as const;

export type CollegeId = (typeof colleges)[number]["id"];
