// 图标工具：预设 emoji 图标集 + 旧标识符兼容 + 自定义图片图标判断

/** 预设图标（emoji），供支出类别/车辆/保养项选择 */
export const PRESET_ICONS = [
  '🛢️', '🔧', '🛠️', '⚡', '🅿️', '🧾', '🧼', '🛣️',
  '🛞', '🧰', '🪛', '🔩', '💡', '🔋', '🚗', '🛵',
  '📌', '💰', '🧽', '🛡️'
];

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
