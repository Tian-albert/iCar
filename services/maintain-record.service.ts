// 保养记录服务：保养项模板 + 保养执行保存 + 保养进度计算
import { Car, Category, Cost, Maintain, MaintainHandle, MaintainLog } from '../types/models';
import { StorageAdapter } from '../repositories/storage.adapter';
import { calcRemaining, findLastHandle, MaintainThresholds, DEFAULT_MAINTAIN_THRESHOLDS } from '../domain/maintain.service';
import { genId } from '../utils/id';

/** 默认保养项模板（设计报告 4.2.3 CRV 模板） */
const DEFAULT_TEMPLATES: Array<Pick<Maintain, 'name' | 'cycleMileages' | 'cycleDays' | 'cycleMonths' | 'cycleUnit' | 'cycleValue'>> = [
  { name: '机油机滤', cycleMileages: 10000, cycleDays: 360, cycleMonths: 12, cycleUnit: 'month', cycleValue: 12 },
  { name: '空调滤芯', cycleMileages: 20000, cycleDays: 720, cycleMonths: 24, cycleUnit: 'month', cycleValue: 24 },
  { name: '空气滤芯', cycleMileages: 20000, cycleDays: 0, cycleMonths: 0, cycleUnit: '', cycleValue: 0 },
  { name: '刹车油', cycleMileages: 40000, cycleDays: 1440, cycleMonths: 48, cycleUnit: 'month', cycleValue: 48 },
  { name: '火花塞', cycleMileages: 50000, cycleDays: 0, cycleMonths: 0, cycleUnit: '', cycleValue: 0 },
  { name: '变速箱油', cycleMileages: 60000, cycleDays: 0, cycleMonths: 0, cycleUnit: '', cycleValue: 0 }
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

/** 为车辆 seed 默认保养项模板（幂等：已有保养项则跳过） */
export function ensureMaintainTemplates(storage: StorageAdapter, carSourceId: string): void {
  const existing = listMaintains(storage, carSourceId);
  if (existing.length > 0) return;
  const now = Date.now();
  for (const tpl of DEFAULT_TEMPLATES) {
    const maintain: Maintain = {
      sourceId: genId('maintain'),
      sourcePlatform: 'mp',
      carSourceId,
      name: tpl.name,
      icon: '',
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

export function listMaintains(storage: StorageAdapter, carSourceId: string): Maintain[] {
  return storage
    .list<Maintain>('maintains')
    .filter(m => m.carSourceId === carSourceId && !m.deleted);
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

  // 重建 logs：软删旧的，插入新的（保养项选择可能变化）
  const oldLogs = storage
    .list<MaintainLog>('maintainLogs')
    .filter(l => l.handleSourceId === sourceId && !l.deleted);
  for (const l of oldLogs) storage.softDelete('maintainLogs', l.sourceId);
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
  return handle;
}

/** 删除保养执行：软删 handle + logs + 关联支出 */
export function removeMaintainHandle(storage: StorageAdapter, sourceId: string): void {
  const handle = storage.get<MaintainHandle>('maintainHandles', sourceId);
  if (!handle || handle.deleted) return;
  storage.softDelete('maintainHandles', sourceId);
  const logs = storage
    .list<MaintainLog>('maintainLogs')
    .filter(l => l.handleSourceId === sourceId && !l.deleted);
  for (const l of logs) storage.softDelete('maintainLogs', l.sourceId);
  if (handle.costSourceId) storage.softDelete('costs', handle.costSourceId);
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
  const maintains = listMaintains(storage, carSourceId);
  const logs = storage.list<MaintainLog>('maintainLogs').filter(l => !l.deleted);
  const handles = storage.list<MaintainHandle>('maintainHandles').filter(h => !h.deleted);
  const car = storage.get<any>('cars', carSourceId);
  const thresholds = getMaintainThresholds(storage, carSourceId);

  return maintains.map(m => {
    const lastHandle = findLastHandle(m, logs, handles);
    return calcRemaining(m, lastHandle, car, today, thresholds);
  });
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
