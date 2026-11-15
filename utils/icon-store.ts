// 自定义图标文件的生命周期
//
// 背景：裁剪页每次导出都会生成 icon-<时间戳>.png，用户反复重裁就会不断堆文件。
// 图标渲染只有 20~30px，单个文件虽小，但一年几百个也是白占沙盒。
//
// 策略：启动时延后清理「沙盒里存在、但没有任何实体引用」的图标文件。
// 只动本模块命名规则内的文件（icon-数字.png），其它一概不碰。
import { StorageAdapter } from '../repositories/storage.adapter';
import { Car, Category, Maintain } from '../types/models';

/** 本模块管理的文件名前缀 */
export const ICON_FILE_PREFIX = 'icon-';

const MANAGED_RE = /^icon-\d+\.(png|jpg|jpeg)$/i;

/** 取路径中的文件名（同时兼容 / 与 \） */
export function baseName(p: string): string {
  if (!p) return '';
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return i >= 0 ? p.slice(i + 1) : p;
}

/** 是否由裁剪流程生成、可以安全删除的图标文件 */
export function isManagedIconFile(name: string): boolean {
  return MANAGED_RE.test(name);
}

/** 从实体的 icon 字段汇总出「需保留」的文件名 */
export function buildKeepSet(icons: Array<string | undefined | null>): string[] {
  const out: string[] = [];
  for (const icon of icons) {
    if (!icon) continue;
    const name = baseName(icon);
    if (name && isManagedIconFile(name)) out.push(name);
  }
  return out;
}

/** 从沙盒文件列表里挑出孤儿（受管理、但没人引用） */
export function findOrphans(files: string[], keep: string[]): string[] {
  const keepSet = new Set(keep);
  return files.filter(f => isManagedIconFile(f) && !keepSet.has(f));
}

/**
 * 清理孤儿图标文件。
 *
 * 注意：必须用**未过滤 deleted** 的原始列表算 keep —— 回收站里的条目
 * 一旦被恢复，其图标还要用；只按「未删除」算会把它们的图删掉。
 */
export function cleanupOrphanIcons(storage: StorageAdapter): number {
  try {
    const fs = wx.getFileSystemManager();
    const dir = wx.env.USER_DATA_PATH;

    const icons: Array<string | undefined> = [
      ...storage.list<Car>('cars').map(c => c.icon),
      ...storage.list<Category>('categories').map(c => c.icon),
      ...storage.list<Maintain>('maintains').map(m => m.icon)
    ];

    const keep = buildKeepSet(icons);
    const files: string[] = fs.readdirSync(dir);
    const orphans = findOrphans(files, keep);

    for (const f of orphans) {
      try {
        fs.unlinkSync(`${dir}/${f}`);
      } catch (e) {
        // 单个删除失败不影响其它
      }
    }
    return orphans.length;
  } catch (e) {
    // 清理失败绝不阻塞启动
    return 0;
  }
}
