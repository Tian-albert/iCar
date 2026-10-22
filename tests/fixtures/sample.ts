// 从真实导出样本 manifest.json 加载数据，用于领域层单测（金标准数据）
import { Car, DataBundle } from '../../types/models';

// 样本 manifest 不含 initMileages（v1.2 新增），按迁移回填 0
const manifest = require('../../iCar-export-20261021-170555.icar/manifest.json') as {
  data: Record<string, any>;
};

const raw = manifest.data;

function withInitMileages(car: Car): Car {
  return { ...car, initMileages: car.initMileages ?? 0 };
}

export const sample: DataBundle = {
  cars: (raw.cars as Car[]).map(withInitMileages),
  categories: raw.categories,
  maintains: raw.maintains,
  maintainHandles: raw.maintainHandles,
  maintainLogs: raw.maintainLogs,
  costs: raw.costs,
  repairRecords: raw.repairRecords,
  fuelRecords: raw.fuelRecords,
  fuelConsumptions: raw.fuelConsumptions
};

export const sampleCar: Car = sample.cars[0];
