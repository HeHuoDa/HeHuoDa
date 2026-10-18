// 固定自 Lucide 1.51.0，24×24、1.5px 圆头线条；许可见 third-party-notices。
// 字形随 base.css 内嵌，不访问图标服务；原生 tabBar 另用同源 PNG。
export const appIcons = {
  home: "\ue001",
  users: "\ue002",
  team: "\ue003",
  leaf: "\ue004",
  book: "\ue005",
  shield: "\ue006",
  pencil: "\ue007",
  mail: "\ue008",
  star: "\ue009",
  bell: "\ue00a",
  user: "\ue00b",
} as const;

export type AppIconName = keyof typeof appIcons;

export function resolveIcon(name: string) {
  return Object.hasOwn(appIcons, name) ? appIcons[name as AppIconName] : "?";
}
