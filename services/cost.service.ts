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
    .sort((a, b) => {
      // 预设组在前，组内按 sortOrder 升序
      if (a.isPreset !== b.isPreset) return a.isPreset ? -1 : 1;
      return (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
    });
}

/**
 * 记支出可选的类别：返回所有 visible=true 的类别（预设 + 自定义）。
 * 用户可在类别管理里对任意类别（含加油/保养/维修/停车）开关"是否显示"。
 */
export function listSpendCategories(storage: StorageAdapter): Category[] {
  return listCategories(storage).filter(c => c.visible !== false);
}

export function getCategory(storage: StorageAdapter, sourceId: string): Category | null {
  const cat = storage.get<Category>('categories', sourceId);
  return cat && !cat.deleted ? cat : null;
}

export function addCategory(storage: StorageAdapter, name: string, icon: string): Category {
  const now = Date.now();
  const siblings = listCategories(storage).filter(c => !c.isPreset);
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
  const siblings = listCategories(storage).filter(c => c.isPreset === cat.isPreset);
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

export function updateCategory(storage: StorageAdapter, sourceId: string, name: string, icon: string): void {
  const cat = getCategory(storage, sourceId);
  if (!cat || cat.isPreset) return;
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
  if (cat.isPreset) return { ok: false, message: '预设分类不能删除' };
  const count = listCosts(storage).filter(c => c.categorySourceId === sourceId).length;
  if (count > 0) return { ok: false, message: `该类别下有 ${count} 条支出记录，请先修改类别` };
  storage.softDelete('categories', sourceId);
  return { ok: true };
}
