// 图标工具：分组预设 emoji 图标集 + 旧标识符兼容 + 自定义图片图标判断
//
// 为什么分组：图标从 20 个扩到 50+ 后，单屏平铺会变成一堵墙，
// 用户找不到东西。按「加油充电 / 洗美维修 / 通行规费 / 车型车色 / 其他」分栏，
// 每栏 6~15 个，一屏可见。

export interface IconGroup {
  key: string;
  label: string;
  icons: string[];
}

/** 分组预设图标（emoji），供支出类别 / 车辆 / 保养项共用 */
export const ICON_GROUPS: IconGroup[] = [
  {
    key: 'energy',
    label: '能源',
    icons: ['🛢️', '⛽', '🔋', '⚡', '🔌']
  },
  {
    key: 'care',
    label: '养护',
    // 只用 Emoji 12 及更早的字符：Unicode 13 新增的图标（🪣🪟🪛 等）
    // 在 Android 10 及更早系统上会渲染成方框，而养护栏恰好最常用。
    // 贴膜用 🎞️（胶片）表达，语义够用且兼容性最好。
    icons: [
      '🧽', '🧼', '🚿', '🧴', '✨', '🎞️',
      '🔧', '🛠️', '🔩', '🛞', '🧰', '⚙️', '🔨'
    ]
  },
  {
    key: 'fee',
    label: '通行',
    icons: ['🅿️', '🛣️', '🎫', '🚦', '🏁', '🛡️', '🧾', '📄', '💳', '💰', '📋']
  },
  {
    key: 'car',
    label: '车型',
    // emoji 的车型自带固有色：🚗蓝轿车 / 🚙蓝SUV / 🚐白MPV / 🛻蓝灰皮卡 /
    // 🏎️红跑车 / 🚕黄出租 / 🚚蓝货车 / 🚌黄巴士。要任意颜色请用自定义上传。
    icons: ['🚗', '🚙', '🚐', '🛻', '🏎️', '🚕', '🚚', '🚌', '🛵', '🏍️', '🚲', '🛴']
  },
  {
    key: 'other',
    label: '其他',
    icons: ['🎨', '💡', '🏷️', '🔆', '📌', '🎵', '🅾️', '❓']
  }
];

/** 扁平列表（兼容旧调用方，也用于「图标是否合法」校验） */
export const PRESET_ICONS: string[] = ICON_GROUPS.reduce(
  (all, g) => all.concat(g.icons),
  [] as string[]
);

/** 旧标识符 → emoji（兼容历史数据） */
const LEGACY_ICON_MAP: Record<string, string> = {
  oil: '🛢️',
  maintain: '🔧',
  fix: '🛠️',
  ev: '⚡',
  p: '🅿️',
  ticket: '🧾',
  wash: '🧼',
  toll: '🛣️',
  car: '🚗'
};

/** 展示：把 icon 值转成可显示的 emoji（图片路径原样返回） */
export function displayIcon(icon: string): string {
  if (!icon) return '📌';
  if (LEGACY_ICON_MAP[icon]) return LEGACY_ICON_MAP[icon];
  return icon;
}

/** 是否图片图标（自定义上传的图片路径） */
export function isImageIcon(icon: string): boolean {
  return (
    icon.startsWith('wxfile://') ||
    icon.startsWith('http://') ||
    icon.startsWith('https://') ||
    icon.startsWith('/') ||
    icon.endsWith('.png') ||
    icon.endsWith('.jpg') ||
    icon.endsWith('.jpeg')
  );
}

/** 兼容旧的 iconEmoji 调用 */
export function iconEmoji(key: string): string {
  return displayIcon(key);
}
