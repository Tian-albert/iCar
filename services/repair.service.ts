// 维修服务：记维修（RepairRecord + 关联 Cost，类别=维修）
import { Category, Cost, RepairRecord } from '../types/models';
import { StorageAdapter } from '../repositories/storage.adapter';
import { genId } from '../utils/id';

export interface RepairForm {
  carSourceId: string;
  content: string;
  mileage: number;
  repairDate: number;
  amount: number | null; // 选填
  remark?: string;
  images?: string[];
}

function getRepairCategory(storage: StorageAdapter): Category | null {
  return (
    storage.list<Category>('categories').find(c => !c.deleted && c.presetType === 'fix') ?? null
  );
}

export function saveRepair(storage: StorageAdapter, form: RepairForm): RepairRecord {
  const now = Date.now();
  const record: RepairRecord = {
    sourceId: genId('repair-record'),
    sourcePlatform: 'mp',
    carSourceId: form.carSourceId,
    content: form.content.trim(),
    mileage: form.mileage,
    repairDate: form.repairDate,
    amount: form.amount ?? 0,
    images: form.images ?? [],
    remark: form.remark ?? '',
    costSourceId: '',
    createdAt: now,
    updatedAt: now,
    deleted: false
  };
  storage.insert<RepairRecord>('repairRecords', record);

  // 选填金额：有金额才写支出流水
  if (form.amount !== null && form.amount > 0) {
    const category = getRepairCategory(storage);
    if (category) {
      const cost: Cost = {
        sourceId: genId('costs'),
        sourcePlatform: 'mp',
        carSourceId: form.carSourceId,
        categorySourceId: category.sourceId,
        amount: form.amount,
        costDate: form.repairDate,
        remark: form.content,
        maintainHandleSourceId: '',
        repairSourceId: record.sourceId,
        fuelRecordSourceId: '',
        createdAt: now,
        updatedAt: now,
        deleted: false
      };
      storage.insert<Cost>('costs', cost);
      record.costSourceId = cost.sourceId;
      storage.update<RepairRecord>('repairRecords', record);
    }
  }

  return record;
}

/** 编辑维修记录（含金额与支出流水的增/改/删联动） */
export function updateRepair(storage: StorageAdapter, sourceId: string, form: RepairForm): RepairRecord {
  const record = storage.get<RepairRecord>('repairRecords', sourceId);
  if (!record || record.deleted) throw new Error('记录不存在');

  record.content = form.content.trim();
  record.mileage = form.mileage;
  record.repairDate = form.repairDate;
  record.amount = form.amount ?? 0;
  record.remark = form.remark ?? '';
  record.updatedAt = Date.now();

  const hasAmount = form.amount !== null && form.amount > 0;
  const cost = record.costSourceId ? storage.get<Cost>('costs', record.costSourceId) : null;

  if (hasAmount) {
    if (cost && !cost.deleted) {
      cost.amount = form.amount!;
      cost.costDate = form.repairDate;
      cost.remark = form.content;
      cost.updatedAt = Date.now();
      storage.update<Cost>('costs', cost);
    } else {
      const category = getRepairCategory(storage);
      if (category) {
        const now = Date.now();
        const newCost: Cost = {
          sourceId: genId('costs'),
          sourcePlatform: 'mp',
          carSourceId: form.carSourceId,
          categorySourceId: category.sourceId,
          amount: form.amount!,
          costDate: form.repairDate,
          remark: form.content,
          maintainHandleSourceId: '',
          repairSourceId: record.sourceId,
          fuelRecordSourceId: '',
          createdAt: now,
          updatedAt: now,
          deleted: false
        };
        storage.insert<Cost>('costs', newCost);
        record.costSourceId = newCost.sourceId;
      }
    }
  } else if (cost && !cost.deleted) {
    storage.softDelete('costs', cost.sourceId);
    record.costSourceId = '';
  }

  storage.update<RepairRecord>('repairRecords', record);
  return record;
}

/** 删除维修记录：软删记录 + 关联支出 */
export function removeRepair(storage: StorageAdapter, sourceId: string): void {
  const record = storage.get<RepairRecord>('repairRecords', sourceId);
  if (!record || record.deleted) return;
  storage.softDelete('repairRecords', sourceId);
  if (record.costSourceId) storage.softDelete('costs', record.costSourceId);
}

export function listRepairs(storage: StorageAdapter, carSourceId: string): RepairRecord[] {
  return storage
    .list<RepairRecord>('repairRecords')
    .filter(r => r.carSourceId === carSourceId && !r.deleted)
    .sort((a, b) => b.repairDate - a.repairDate);
}
