// 支出服务：记支出 + 类别管理（BR-10 预设只读、有流水不可删）
import { Category, Cost } from '../types/models';
import { StorageAdapter } from '../repositories/storage.adapter';
import { genId } from '../utils/id';

export interface CostForm {
  carSourceId: string;
  categorySourceId: string;
  amount: number;
  costDate: number;
  remark?: string;
}

export function saveCost(storage: StorageAdapter, form: CostForm): Cost {
  const now = Date.now();
  const cost: Cost = {
    sourceId: genId('costs'),
    sourcePlatform: 'mp',
    carSourceId: form.carSourceId,
    categorySourceId: form.categorySourceId,
    amount: form.amount,
    costDate: form.costDate,
    remark: form.remark ?? '',
    maintainHandleSourceId: '',
    repairSourceId: '',
    fuelRecordSourceId: '',
    createdAt: now,
    updatedAt: now,
    deleted: false
  };
  return storage.insert<Cost>('costs', cost);
}

/** 编辑手动记的支出 */
export function updateCost(storage: StorageAdapter, sourceId: string, form: CostForm): Cost {
  const cost = storage.get<Cost>('costs', sourceId);
  if (!cost || cost.deleted) throw new Error('记录不存在');
  cost.categorySourceId = form.categorySourceId;
  cost.amount = form.amount;
  cost.costDate = form.costDate;
  cost.remark = form.remark ?? '';
  cost.updatedAt = Date.now();
  storage.update<Cost>('costs', cost);
  return cost;
}

/** 删除手动记的支出（软删） */
export function removeCost(storage: StorageAdapter, sourceId: string): void {
  storage.softDelete('costs', sourceId);
}

export function listCosts(storage: StorageAdapter, carSourceId?: string): Cost[] {
  return storage
    .list<Cost>('costs')
    .filter(c => !c.deleted && (!carSourceId || c.carSourceId === carSourceId))
    .sort((a, b) => b.costDate - a.costDate);
}

// ---------- 类别 ----------
export function listCategories(storage: StorageAdapter): Category[] {
  return storage
    .list<Category>('categories')
    .filter(c => !c.deleted)
    // 单一排序：类别管理页已合并为一组，预设/自定义不再分段。
    // 若仍按「预设在前」排，用户把预设拖到自定义项下面会立刻弹回原位。
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.createdAt - b.createdAt);
}

/**
 * 记支出可选的类别：visible=true 的**支出类**类别（支出预设 + 自定义）。
 *
 * 必须排除系统预设（presetType 非空：加油/充电/保养/维修）：
 * 它们由各自的专用表单自动生成支出，若在这里也能选，用户会重复记同一笔消费
 * （先记一次「加油」，再在支出里选「加油」记一次）。
 */
export function listSpendCategories(storage: StorageAdapter): Category[] {
  return listCategories(storage).filter(c => c.visible !== false && !c.presetType);
}

/**
 * 编辑支出时定位类别（页面与单测共用）：
 * - 编辑态按原 categorySourceId 精确定位，命中即选中
 * - 找不到原类别（已软删/数据异常）时锁定，selectedIndex = -1，
 *   由调用方保留原 categorySourceId，绝不回退到第一项而串改类别
 * - 新建态默认选第一项
 */
/** 是否已有同名类别（大小写不敏感；excludeId 用于编辑时排除自身） */
export function hasCategoryName(
  storage: StorageAdapter,
  name: string,
  excludeId?: string
): boolean {
  const target = name.trim().toLowerCase();
  return listCategories(storage).some(
    c => c.sourceId !== excludeId && c.name.trim().toLowerCase() === target
  );
}

export function resolveCategorySelection(
  cats: Array<{ sourceId: string }>,
  originalId: string,
  editing: boolean
): { selectedIndex: number; locked: boolean } {
  if (editing) {
    const idx = cats.findIndex(c => c.sourceId === originalId);
    return idx >= 0
      ? { selectedIndex: idx, locked: false }
      : { selectedIndex: -1, locked: true };
  }
  return { selectedIndex: cats.length ? 0 : -1, locked: false };
}

export function getCategory(storage: StorageAdapter, sourceId: string): Category | null {
  const cat = storage.get<Category>('categories', sourceId);
  return cat && !cat.deleted ? cat : null;
}

export function addCategory(storage: StorageAdapter, name: string, icon: string): Category {
  const now = Date.now();
  // 与「可见的支出类别」同一序列编号（系统预设另处一段，不参与）
  const siblings = listCategories(storage).filter(c => !c.presetType);
  const sortOrder = siblings.length ? Math.max(...siblings.map(c => c.sortOrder ?? 0)) + 1 : 0;
  const cat: Category = {
    sourceId: genId('category'),
    sourcePlatform: 'mp',
    name: name.trim(),
    icon,
    isPreset: false,
    presetType: '',
    visible: true,
    sortOrder,
    createdAt: now,
    updatedAt: now,
    deleted: false
  };
  return storage.insert<Category>('categories', cat);
}

/**
 * 类别排序：在同组（预设 / 自定义）内上移或下移一位。
 * 交换后按新顺序重写整组 sortOrder，保证连续且唯一。
 */
export function moveCategory(storage: StorageAdapter, sourceId: string, direction: 'up' | 'down'): boolean {
  const cat = getCategory(storage, sourceId);
  if (!cat) return false;
  // 兄弟集 = 全部「支出类别」（系统预设之外）。类别管理页已合并为一组，
  // 预设与自定义必须在同一序列内换位，否则拖到对方区间会被弹回。
  // 系统预设不展示也不参与；对它调用直接失败。
  if (cat.presetType) return false;
  const siblings = listCategories(storage).filter(c => !c.presetType);
  const idx = siblings.findIndex(c => c.sourceId === sourceId);
  const target = direction === 'up' ? idx - 1 : idx + 1;
  if (idx < 0 || target < 0 || target >= siblings.length) return false;

  const arr = [...siblings];
  const tmp = arr[idx];
  arr[idx] = arr[target];
  arr[target] = tmp;

  const now = Date.now();
  arr.forEach((c, i) => {
    if (c.sortOrder !== i) {
      c.sortOrder = i;
      c.updatedAt = now;
      storage.update('categories', c);
    }
  });
  return true;
}

/**
 * 一次拖动跨越 N 行的批量换位（R-12）：整组 sortOrder 只重写一次，
 * 避免手指快速滑动时连续 N 次写库 + N 次列表重排导致触摸序列中断。
 */
export function moveCategoryBy(
  storage: StorageAdapter,
  sourceId: string,
  steps: number
): boolean {
  if (!steps) return false;
  const cat = getCategory(storage, sourceId);
  if (!cat) return false;
  // 兄弟集 = 全部「支出类别」（系统预设之外）。类别管理页已合并为一组，
  // 预设与自定义必须在同一序列内换位，否则拖到对方区间会被弹回。
  // 系统预设不展示也不参与；对它调用直接失败。
  if (cat.presetType) return false;
  const siblings = listCategories(storage).filter(c => !c.presetType);
  const idx = siblings.findIndex(c => c.sourceId === sourceId);
  if (idx < 0) return false;
  const target = Math.min(siblings.length - 1, Math.max(0, idx + steps));
  if (target === idx) return false;

  const arr = [...siblings];
  const [item] = arr.splice(idx, 1);
  arr.splice(target, 0, item);
  const now = Date.now();
  arr.forEach((c, i) => {
    if (c.sortOrder !== i) {
      c.sortOrder = i;
      c.updatedAt = now;
      storage.update('categories', c);
    }
  });
  return true;
}

export function updateCategory(storage: StorageAdapter, sourceId: string, name: string, icon: string): void {
  const cat = getCategory(storage, sourceId);
  // 预设与自定义现在同等对待，只有系统预设（加油/充电/保养/维修）不可改名：
  // 它们由专用表单按 presetType 自动归类，改名会让用户以为能改归属。
  if (!cat || cat.presetType) return;
  cat.name = name.trim();
  cat.icon = icon;
  cat.updatedAt = Date.now();
  storage.update('categories', cat);
}

/** 更换类别图标（预设与自定义均可） */
export function setCategoryIcon(storage: StorageAdapter, sourceId: string, icon: string): void {
  const cat = getCategory(storage, sourceId);
  if (!cat) return;
  cat.icon = icon;
  cat.updatedAt = Date.now();
  storage.update('categories', cat);
}

/** 设置类别是否在"记支出"中显示（预设与自定义均可开关） */
export function setCategoryVisible(storage: StorageAdapter, sourceId: string, visible: boolean): void {
  const cat = getCategory(storage, sourceId);
  if (!cat) return;
  cat.visible = visible;
  cat.updatedAt = Date.now();
  storage.update('categories', cat);
}

export interface RemoveResult {
  ok: boolean;
  message?: string;
}

export function removeCategory(storage: StorageAdapter, sourceId: string): RemoveResult {
  const cat = getCategory(storage, sourceId);
  if (!cat) return { ok: false, message: '类别不存在' };
  // 支出预设与自定义一致，允许删除（删除后不会被 seed 重建）；
  // 系统预设仍保护：它们靠 presetType 承载自动归类，删了加油/保养就无法归类。
  if (cat.presetType) return { ok: false, message: '系统分类不能删除' };
  const count = listCosts(storage).filter(c => c.categorySourceId === sourceId).length;
  if (count > 0) return { ok: false, message: `该类别下有 ${count} 条支出记录，请先修改类别` };
  storage.softDelete('categories', sourceId);
  return { ok: true };
}
