// 保养记录服务：保养项模板 + 保养执行保存 + 保养进度计算
import { Car, Category, Cost, Maintain, MaintainHandle, MaintainLog } from '../types/models';
import { StorageAdapter } from '../repositories/storage.adapter';
import { calcRemaining, findLastHandle, MaintainThresholds, DEFAULT_MAINTAIN_THRESHOLDS } from '../domain/maintain.service';
import { genId } from '../utils/id';
import { syncMileages } from './car.service';

/** 默认保养项模板（设计报告 4.2.3 CRV 模板） */
/**
 * 默认保养项模板。
 *
 * icon 按「项目实际是什么」选，而不是统一用 🔧 ——
 * 保养记录表单要用图标栅格选项目，全部一样就失去了快速识别的意义。
 * 均为 Emoji 12 及更早字符，避免旧 Android 显示成方框。
 */
const DEFAULT_TEMPLATES: Array<
  Pick<
    Maintain,
    'name' | 'icon' | 'cycleMileages' | 'cycleDays' | 'cycleMonths' | 'cycleUnit' | 'cycleValue'
  >
> = [
  // 机油机滤：油桶
  { name: '机油机滤', icon: '🛢️', cycleMileages: 10000, cycleDays: 360, cycleMonths: 12, cycleUnit: 'month', cycleValue: 12 },
  // 空调滤芯：空调制冷
  { name: '空调滤芯', icon: '❄️', cycleMileages: 20000, cycleDays: 720, cycleMonths: 24, cycleUnit: 'month', cycleValue: 24 },
  // 空气滤芯：进气
  { name: '空气滤芯', icon: '💨', cycleMileages: 20000, cycleDays: 0, cycleMonths: 0, cycleUnit: '', cycleValue: 0 },
  // 刹车油：制动
  { name: '刹车油', icon: '🛑', cycleMileages: 40000, cycleDays: 1440, cycleMonths: 48, cycleUnit: 'month', cycleValue: 48 },
  // 火花塞：点火
  { name: '火花塞', icon: '⚡', cycleMileages: 50000, cycleDays: 0, cycleMonths: 0, cycleUnit: '', cycleValue: 0 },
  // 变速箱油：齿轮
  { name: '变速箱油', icon: '⚙️', cycleMileages: 60000, cycleDays: 0, cycleMonths: 0, cycleUnit: '', cycleValue: 0 }
];

export interface MaintainForm {
  carSourceId: string;
  maintainSourceIds: string[];
  makeDate: number;
  makeMileages: number;
  amount: number | null;
  remark?: string;
}

export interface MaintainProgressItem {
  maintain: Maintain;
  remainMileage: number | null;
  remainDays: number | null;
  progress: number; // 剩余比例 0~1
  urgent: boolean;
}

/** 匹配不到模板时的兜底图标（扳手，与维护语义一致） */
export const FALLBACK_MAINTAIN_ICON = '🔧';

/**
 * 给「图标为空」的保养项按名称补上模板图标。
 *
 * 老版本建模板时 icon 一律写空字符串，界面靠 displayIcon('') 兜底成 📌，
 * 所有项目看起来一模一样。这里按名称回填，用户自己换过的图标不动。
 */
function backfillMaintainIcons(storage: StorageAdapter, list: Maintain[]): void {
  const now = Date.now();
  for (const m of list) {
    if (m.icon && m.icon.trim()) continue;
    const tpl = DEFAULT_TEMPLATES.find(t => t.name === m.name);
    // 匹配不到模板（用户改过名、或自建项）：兜底给扳手。
    // 若留空，displayIcon('') 会统一显示 📌，三列栅格里完全认不出来。
    m.icon = tpl && tpl.icon ? tpl.icon : FALLBACK_MAINTAIN_ICON;
    m.updatedAt = now;
    storage.update('maintains', m);
  }
}

/** 为车辆 seed 默认保养项模板（幂等：已有保养项则只补齐图标） */
export function ensureMaintainTemplates(storage: StorageAdapter, carSourceId: string): void {
  const existing = listMaintains(storage, carSourceId);
  if (existing.length > 0) {
    backfillMaintainIcons(storage, existing);
    return;
  }

  // 这里必须用「含已删除」的全量判断。
  // 若只看未删项，用户把某车的保养项全部删光后，下次进入任一入口
  // （entry / maintain-form / maintain-manage / vehicle-detail）都会被
  // 当成「首次」重新种回 6 个默认项 —— 删不掉，且回收站恢复后出现同名重复。
  // 与预设类别用 categoriesSeeded 守卫「删掉的不重建」是同一个思路。
  const everSeeded = storage
    .list<Maintain>('maintains')
    .some(m => m.carSourceId === carSourceId);
  if (everSeeded) return;

  const now = Date.now();
  for (const tpl of DEFAULT_TEMPLATES) {
    const maintain: Maintain = {
      sourceId: genId('maintain'),
      sourcePlatform: 'mp',
      carSourceId,
      name: tpl.name,
      icon: tpl.icon,
      cycleMileages: tpl.cycleMileages,
      cycleDays: tpl.cycleDays,
      cycleMonths: tpl.cycleMonths,
      cycleUnit: tpl.cycleUnit,
      cycleValue: tpl.cycleValue,
      mileageSource: 'total',
      sortOrder: 0,
      createdAt: now,
      updatedAt: now,
      deleted: false
    };
    storage.insert<Maintain>('maintains', maintain);
  }
}

/**
 * 保养项列表：按 sortOrder 升序，同序按 createdAt 升序。
 * 新增项 sortOrder 恒为 0，若不排序会退化为索引字典序，重启后顺序可能变化。
 */
export function listMaintains(storage: StorageAdapter, carSourceId: string): Maintain[] {
  return storage
    .list<Maintain>('maintains')
    .filter(m => m.carSourceId === carSourceId && !m.deleted)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.createdAt - b.createdAt);
}

export function listMaintainHandles(storage: StorageAdapter, carSourceId: string): MaintainHandle[] {
  return storage
    .list<MaintainHandle>('maintainHandles')
    .filter(h => h.carSourceId === carSourceId && !h.deleted)
    .sort((a, b) => b.makeDate - a.makeDate);
}

export function listMaintainLogs(storage: StorageAdapter, carSourceId: string): MaintainLog[] {
  return storage
    .list<MaintainLog>('maintainLogs')
    .filter(l => l.carSourceId === carSourceId && !l.deleted);
}

function getMaintainCategory(storage: StorageAdapter): Category | null {
  return (
    storage.list<Category>('categories').find(c => !c.deleted && c.presetType === 'maintain') ?? null
  );
}

/** 记一次保养：生成 MaintainHandle + N 条 MaintainLog + 关联 Cost（BR-09） */
export function saveMaintainHandle(storage: StorageAdapter, form: MaintainForm): MaintainHandle {
  const now = Date.now();
  const handle: MaintainHandle = {
    sourceId: genId('maintain-handle'),
    sourcePlatform: 'mp',
    carSourceId: form.carSourceId,
    makeDate: form.makeDate,
    makeMileages: form.makeMileages,
    makeEVMileages: 0,
    makeHEVMileages: 0,
    remark: form.remark ?? '',
    costSourceId: '',
    createdAt: now,
    updatedAt: now,
    deleted: false
  };
  storage.insert<MaintainHandle>('maintainHandles', handle);

  // 每个选中保养项生成一条 MaintainLog
  for (const maintainSourceId of form.maintainSourceIds) {
    const log: MaintainLog = {
      sourceId: genId('maintain-log'),
      sourcePlatform: 'mp',
      carSourceId: form.carSourceId,
      maintainSourceId,
      handleSourceId: handle.sourceId,
      makeDate: form.makeDate,
      makeMileages: form.makeMileages,
      totalMileages: form.makeMileages,
      makeEVMileages: 0,
      makeHEVMileages: 0,
      mileageSource: 'total',
      remark: form.remark ?? '',
      createdAt: now,
      updatedAt: now,
      deleted: false
    };
    storage.insert<MaintainLog>('maintainLogs', log);
  }

  // 选填金额 → 保养类支出流水
  if (form.amount !== null && form.amount > 0) {
    const category = getMaintainCategory(storage);
    if (category) {
      const cost: Cost = {
        sourceId: genId('costs'),
        sourcePlatform: 'mp',
        carSourceId: form.carSourceId,
        categorySourceId: category.sourceId,
        amount: form.amount,
        costDate: form.makeDate,
        remark: form.remark ?? '',
        maintainHandleSourceId: handle.sourceId,
        repairSourceId: '',
        fuelRecordSourceId: '',
        createdAt: now,
        updatedAt: now,
        deleted: false
      };
      storage.insert<Cost>('costs', cost);
      handle.costSourceId = cost.sourceId;
      storage.update<MaintainHandle>('maintainHandles', handle);
    }
  }

  syncMileages(storage, form.carSourceId);
  return handle;
}

/** 编辑保养执行：更新 handle + 重建 logs + 金额联动 */
export function updateMaintainHandle(storage: StorageAdapter, sourceId: string, form: MaintainForm): MaintainHandle {
  const handle = storage.get<MaintainHandle>('maintainHandles', sourceId);
  if (!handle || handle.deleted) throw new Error('记录不存在');
  const now = Date.now();

  handle.makeDate = form.makeDate;
  handle.makeMileages = form.makeMileages;
  handle.remark = form.remark ?? '';
  handle.updatedAt = now;

  // 重建 logs：**物理删除**旧的，插入新的（保养项选择可能变化）。
  // 这里不能用 softDelete —— 那会为每条旧 log 生成一个独立删除批次，
  // 回收站里出现一堆名为「记录」的孤立条目，单独恢复还会造成保养记录重复。
  // 语义上这只是「编辑同一条记录的明细」，不是删除记录本身。
  const oldLogs = storage
    .list<MaintainLog>('maintainLogs')
    .filter(l => l.handleSourceId === sourceId && !l.deleted);
  for (const l of oldLogs) storage.hardDelete('maintainLogs', l.sourceId);
  for (const maintainSourceId of form.maintainSourceIds) {
    const log: MaintainLog = {
      sourceId: genId('maintain-log'),
      sourcePlatform: 'mp',
      carSourceId: form.carSourceId,
      maintainSourceId,
      handleSourceId: handle.sourceId,
      makeDate: form.makeDate,
      makeMileages: form.makeMileages,
      totalMileages: form.makeMileages,
      makeEVMileages: 0,
      makeHEVMileages: 0,
      mileageSource: 'total',
      remark: form.remark ?? '',
      createdAt: now,
      updatedAt: now,
      deleted: false
    };
    storage.insert<MaintainLog>('maintainLogs', log);
  }

  // 金额联动
  const hasAmount = form.amount !== null && form.amount > 0;
  const cost = handle.costSourceId ? storage.get<Cost>('costs', handle.costSourceId) : null;
  if (hasAmount) {
    if (cost && !cost.deleted) {
      cost.amount = form.amount!;
      cost.costDate = form.makeDate;
      cost.remark = form.remark ?? '';
      cost.updatedAt = now;
      storage.update<Cost>('costs', cost);
    } else {
      const category = getMaintainCategory(storage);
      if (category) {
        const newCost: Cost = {
          sourceId: genId('costs'),
          sourcePlatform: 'mp',
          carSourceId: form.carSourceId,
          categorySourceId: category.sourceId,
          amount: form.amount!,
          costDate: form.makeDate,
          remark: form.remark ?? '',
          maintainHandleSourceId: handle.sourceId,
          repairSourceId: '',
          fuelRecordSourceId: '',
          createdAt: now,
          updatedAt: now,
          deleted: false
        };
        storage.insert<Cost>('costs', newCost);
        handle.costSourceId = newCost.sourceId;
      }
    }
  } else if (cost && !cost.deleted) {
    storage.softDelete('costs', cost.sourceId);
    handle.costSourceId = '';
  }

  storage.update<MaintainHandle>('maintainHandles', handle);
  syncMileages(storage, handle.carSourceId);
  return handle;
}

/** 删除保养执行：软删 handle + logs + 关联支出 */
export function removeMaintainHandle(storage: StorageAdapter, sourceId: string): void {
  const handle = storage.get<MaintainHandle>('maintainHandles', sourceId);
  if (!handle || handle.deleted) return;
  const batch = genId('del');
  storage.softDelete('maintainHandles', sourceId, batch);
  const logs = storage
    .list<MaintainLog>('maintainLogs')
    .filter(l => l.handleSourceId === sourceId && !l.deleted);
  for (const l of logs) storage.softDelete('maintainLogs', l.sourceId, batch);
  if (handle.costSourceId) storage.softDelete('costs', handle.costSourceId, batch);
  syncMileages(storage, handle.carSourceId, true);
}

/** 删除保养项模板：连带软删其历史日志，30 天内可在回收站撤销（R-02） */
export function removeMaintain(storage: StorageAdapter, sourceId: string): void {
  const m = storage.get<Maintain>('maintains', sourceId);
  if (!m || m.deleted) return;
  const batch = genId('del');
  storage.softDelete('maintains', sourceId, batch);
  for (const l of storage.list<MaintainLog>('maintainLogs')) {
    if (l.maintainSourceId === sourceId && !l.deleted) {
      storage.softDelete('maintainLogs', l.sourceId, batch);
    }
  }
}

/** 读取某车的保养提醒阈值（缺失时回退默认值） */
export function getMaintainThresholds(storage: StorageAdapter, carSourceId: string): MaintainThresholds {
  const car = storage.get<Car>('cars', carSourceId);
  return {
    mileage: car?.maintainSoonMileage ?? DEFAULT_MAINTAIN_THRESHOLDS.mileage,
    days: car?.maintainSoonDays ?? DEFAULT_MAINTAIN_THRESHOLDS.days
  };
}

/** 设置某车的保养提醒阈值 */
export function setMaintainThresholds(storage: StorageAdapter, carSourceId: string, mileage: number, days: number): void {
  const car = storage.get<Car>('cars', carSourceId);
  if (!car) return;
  car.maintainSoonMileage = mileage;
  car.maintainSoonDays = days;
  car.updatedAt = Date.now();
  storage.update('cars', car);
}

/** 计算某车全部保养项的剩余量（用于保养进度） */
export function getMaintainProgress(
  storage: StorageAdapter,
  carSourceId: string,
  today: number
): MaintainProgressItem[] {
  const batch = getMaintainProgressBatch(storage, [carSourceId], today);
  return batch[carSourceId] || [];
}

/**
 * 批量计算多辆车的保养进度。
 *
 * 概览页要对每辆车算一遍。逐车调用会把 maintainLogs / maintainHandles / cars
 * 三张表各扫 N 遍，实际复杂度是 O(车辆 × 记录)；这里一次取全表、一次建索引，
 * 回到 O(记录)。
 *
 * 顺带修掉一个隐患：车辆被物理清理后 `storage.get('cars')` 返回 null，
 * 旧实现会在 `calcRemaining` 里读 `car.mileages` 抛错。这里直接跳过。
 */
export function getMaintainProgressBatch(
  storage: StorageAdapter,
  carSourceIds: string[],
  today: number
): Record<string, MaintainProgressItem[]> {
  const out: Record<string, MaintainProgressItem[]> = {};
  const ids = new Set(carSourceIds);
  carSourceIds.forEach(id => { out[id] = []; });
  if (!ids.size) return out;

  const cars = new Map<string, Car>();
  for (const c of storage.list<Car>('cars')) {
    if (!c || c.deleted || !ids.has(c.sourceId)) continue;
    cars.set(c.sourceId, c);
  }

  const maintains = storage
    .list<Maintain>('maintains')
    .filter(m => m && !m.deleted && ids.has(m.carSourceId));
  if (!maintains.length) return out;

  const logs = storage
    .list<MaintainLog>('maintainLogs')
    .filter(l => l && !l.deleted && ids.has(l.carSourceId));
  const handles = storage
    .list<MaintainHandle>('maintainHandles')
    .filter(h => h && !h.deleted && ids.has(h.carSourceId));

  // 保养项 → 最近一次执行（等价于 findLastHandle，但只扫一遍日志）
  const handleById = new Map<string, MaintainHandle>();
  for (const h of handles) handleById.set(h.sourceId, h);
  const lastByMaintain = new Map<string, MaintainHandle>();
  for (const l of logs) {
    const h = handleById.get(l.handleSourceId);
    if (!h) continue;
    const current = lastByMaintain.get(l.maintainSourceId);
    if (!current || h.makeDate >= current.makeDate) lastByMaintain.set(l.maintainSourceId, h);
  }

  for (const m of maintains) {
    const car = cars.get(m.carSourceId);
    if (!car) continue; // 车已不存在：跳过，避免读 undefined
    const thresholds: MaintainThresholds = {
      mileage: car.maintainSoonMileage ?? DEFAULT_MAINTAIN_THRESHOLDS.mileage,
      days: car.maintainSoonDays ?? DEFAULT_MAINTAIN_THRESHOLDS.days
    };
    out[m.carSourceId].push(
      calcRemaining(m, lastByMaintain.get(m.sourceId) || null, car, today, thresholds)
    );
  }

  // 与原 listMaintains 的顺序保持一致：sortOrder → createdAt
  for (const id of carSourceIds) {
    out[id].sort((a, b) => {
      const x = a.maintain;
      const y = b.maintain;
      return (x.sortOrder ?? 0) - (y.sortOrder ?? 0) || x.createdAt - y.createdAt;
    });
  }
  return out;
}

/** 保养周期表单（里程周期 或 时间周期[月/年]，二者至少填一项） */
export interface MaintainCycleForm {
  name: string;
  cycleMileages: number; // 0 表示不按里程
  timeUnit: 'month' | 'year' | ''; // 时间单位，'' 表示不按时间
  timeValue: number; // 时间数值（月 1-18 / 年 1-10）
  icon?: string; // 图标（emoji 或图片路径）
}

/** 周期文本，如 "10000km / 12月"、"20000km / 3年"、"20000km"、"12月" */
export function formatCycle(m: Maintain): string {
  const parts: string[] = [];
  if (m.cycleMileages > 0) parts.push(`${m.cycleMileages}km`);
  const time = formatTimeCycle(m);
  if (time) parts.push(time);
  return parts.length ? parts.join(' / ') : '自定义周期';
}

function formatTimeCycle(m: Maintain): string | null {
  const months = m.cycleMonths;
  // 超过 18 个月且能被 12 整除时用"年"展示，否则用"月"
  if (months > 18 && months % 12 === 0) return `${months / 12}年`;
  if (months > 0) return `${months}月`;
  if (m.cycleDays > 0) return `${m.cycleDays}天`;
  return null;
}

function buildCycleFields(form: MaintainCycleForm) {
  // 统一换算成"月"存储：年 × 12，月 × 1
  const months =
    form.timeUnit === 'year' ? form.timeValue * 12 : form.timeUnit === 'month' ? form.timeValue : 0;
  return {
    cycleMileages: form.cycleMileages,
    cycleDays: months > 0 ? months * 30 : 0,
    cycleMonths: months,
    cycleUnit: (form.timeUnit || (form.cycleMileages > 0 ? 'km' : '')) as Maintain['cycleUnit'],
    cycleValue: form.timeUnit ? form.timeValue : form.cycleMileages
  };
}

export function getMaintain(storage: StorageAdapter, sourceId: string): Maintain | null {
  const m = storage.get<Maintain>('maintains', sourceId);
  return m && !m.deleted ? m : null;
}

/** 添加自定义保养项 */
export function addMaintain(storage: StorageAdapter, carSourceId: string, form: MaintainCycleForm): Maintain {
  const now = Date.now();
  const maintain: Maintain = {
    sourceId: genId('maintain'),
    sourcePlatform: 'mp',
    carSourceId,
    name: form.name.trim(),
    icon: form.icon ?? '',
    ...buildCycleFields(form),
    mileageSource: 'total',
    sortOrder: 0,
    createdAt: now,
    updatedAt: now,
    deleted: false
  };
  return storage.insert<Maintain>('maintains', maintain);
}

/** 修改保养项周期 */
export function updateMaintainCycle(storage: StorageAdapter, sourceId: string, form: MaintainCycleForm): void {
  const m = getMaintain(storage, sourceId);
  if (!m) return;
  m.name = form.name.trim();
  if (form.icon !== undefined) m.icon = form.icon;
  Object.assign(m, buildCycleFields(form));
  m.updatedAt = Date.now();
  storage.update('maintains', m);
}
