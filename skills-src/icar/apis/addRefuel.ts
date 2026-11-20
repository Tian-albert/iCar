// 原子接口：记一笔加油 / 充电（写操作）
//
// 与主包 services/refuel.service.ts 的 saveRefuel 保持同一套落库语义：
//   RefuelLog → 关联 Cost → 回写 costSourceId → 全量重算油耗区间 → 回写车辆里程
// 少任何一步都会让统计页与 AI 的说法不一致（最常见的是少写 Cost，
// 于是「今年花了多少」少了这笔钱）。
//
// 参数设计取向：用户在对话里通常只说「加了 40 升，花了 320」，
// 不会同时报单价。因此单价与实付允许二选一，缺的那个反算，绝不写 0。
import { computeShouldPay, rebuildConsumptionsGrouped } from '../lib/domain/fuel.service';
import { Cost, EnergyType, FuelConsumption, RefuelLog } from '../lib/types/models';
import { genId } from '../lib/utils/id';
import {
  energyLabel,
  get,
  hardDelete,
  insert,
  list,
  readCars,
  readCategories,
  resolveCarStrict,
  update
} from '../lib/store';

interface Args {
  /** 加油量（升）/ 充电量（kWh），必填 */
  volume?: number | string;
  /** 单价（元/升 或 元/kWh），与 amount 二选一 */
  unitPrice?: number | string;
  /** 实付金额（元），与 unitPrice 二选一 */
  amount?: number | string;
  /** 当前总里程 km，不传则沿用车辆当前里程（会提醒用户可能不准） */
  mileage?: number | string;
  carName?: string;
  /** 是否加满/充满，默认 true（油耗区间成立的前提） */
  isFull?: boolean;
  /** 油量/电量是否偏低 */
  isLowFuel?: boolean;
  /** YYYY-MM-DD，默认今天 */
  dateText?: string;
  remark?: string;
}

function num(v: number | string | undefined): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return Number(v.trim());
  return NaN;
}

function parseDate(text: string | undefined, now: number): number {
  if (!text) return now;
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text.trim());
  if (!m) return now;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
}

/** 与主包 syncMileages 同义：里程取「记录最大值」，且不倒退 */
function syncCarMileage(carId: string, recorded: number): void {
  const car = get<any>('cars', carId);
  if (!car) return;
  const fromRecords = [
    ...list<RefuelLog>('fuelRecords').filter(r => r.carSourceId === carId).map(r => r.makeMileages),
    ...list<any>('maintainHandles').filter(r => r.carSourceId === carId).map(r => r.makeMileages),
    ...list<any>('repairRecords').filter(r => r.carSourceId === carId).map(r => r.mileage)
  ].filter(n => isFinite(n) && n >= 0);

  const derived = fromRecords.length ? Math.max(...fromRecords, recorded) : recorded;
  const next = Math.max(car.mileages || 0, derived);
  if (next !== car.mileages) {
    car.mileages = next;
    car.updatedAt = Date.now();
    update('cars', car);
  }
}

export async function addRefuel(args: Args = {}): Promise<AgentApiResult> {
  const now = Date.now();

  const volume = num(args.volume);
  const unitPrice = num(args.unitPrice);
  const amountIn = num(args.amount);

  // ---- 校验：体积必须有；单价与金额至少有一个，且不能是 0 ----
  if (!isFinite(volume) || volume <= 0) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: '缺少加油量（升）或充电量（kWh）。请先问用户「加了多少升 / 充了多少度」，拿到数字后再调用，不要用 0 代替。'
        }
      ]
    };
  }
  const hasPrice = isFinite(unitPrice) && unitPrice > 0;
  const hasAmount = isFinite(amountIn) && amountIn > 0;
  if (!hasPrice && !hasAmount) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: '缺少金额。请再问一句「花了多少钱」或「单价多少」，两者给一个即可（另一个可以据此反算）。'
        }
      ]
    };
  }

  const cars = readCars();
  if (!cars.length) {
    return {
      isError: true,
      content: [{ type: 'text', text: '用户还没有添加车辆，无法记录。请引导先在「车辆」页添加车辆。' }]
    };
  }
  // 写操作不允许静默挑车：加错车会让油耗区间与支出同时错账
  const { car, reason } = resolveCarStrict(cars, args.carName || '');
  if (!car) {
    const names = cars.map(c => c.name).join('、');
    if (reason === 'ambiguous') {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `用户有 ${cars.length} 辆车（${names}），还没说给哪一辆加。请先问「哪辆车」，拿到车名后再调用本接口，不要替用户选。`
          }
        ]
      };
    }
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: `没有找到名为「${args.carName}」的车辆。现有车辆：${names}。请让用户确认是哪一辆后重试。`
        }
      ]
    };
  }

  const energyType: EnergyType = car.energyType === 'ev' ? 'ev' : 'fuel';
  const unitLabel = energyType === 'ev' ? '元/kWh' : '元/升';
  const volumeUnit = energyType === 'ev' ? 'kWh' : '升';

  // 单价与金额互相反算（四舍五入到 2 位，与主包 round2 一致）
  const price = hasPrice ? Math.round(unitPrice * 100) / 100 : Math.round((amountIn / volume) * 100) / 100;
  const shouldPay = computeShouldPay(price, volume);
  const actualPay = hasAmount ? Math.round(amountIn * 100) / 100 : shouldPay;

  // ---- 类别：加油/充电预设 ----
  const categories = readCategories();
  const wanted = energyType === 'ev' ? 'ev' : 'refuel';
  const category =
    categories.find(c => c.presetType === wanted) ||
    (wanted === 'ev' ? categories.find(c => c.presetType === 'refuel') : undefined);
  if (!category) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: '缺少「加油 / 充电」系统类别（可能被删过）。请引导用户到「设置 → 支出类别管理」恢复后再记录。'
        }
      ]
    };
  }

  // ---- 里程：没给就沿用车辆当前里程，并在回复里说明 ----
  const mileageIn = num(args.mileage);
  const carMileage = Number(car.mileages) || 0;
  const useCarMileage = !isFinite(mileageIn) || mileageIn <= 0;
  const makeMileages = useCarMileage ? carMileage : mileageIn;
  if (makeMileages <= 0) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: '缺少当前里程，无法记录（油耗要靠里程差计算）。请问用户「仪表盘现在多少公里」。'
        }
      ]
    };
  }

  const fuelDate = parseDate(args.dateText, now);
  const isFull = args.isFull !== false;

  const log: RefuelLog = {
    sourceId: genId('refuel-log'),
    sourcePlatform: 'mp',
    carSourceId: car.sourceId,
    energyType,
    fuelDate,
    makeMileages,
    makeEVMileages: 0,
    makeHEVMileages: 0,
    unitPrice: price,
    volume,
    shouldPayAmount: shouldPay,
    actualPayAmount: actualPay,
    isFull,
    isLowFuel: args.isLowFuel === true,
    lastRecorded: true,
    chargeBeforePercent: 0,
    chargeAfterPercent: 0,
    remark: (args.remark || '').trim(),
    costSourceId: '',
    createdAt: now,
    updatedAt: now,
    deleted: false
  };
  insert<RefuelLog>('fuelRecords', log);

  // ---- 关联支出：少写这一步会导致「今年花了多少」漏掉这笔 ----
  const cost: Cost = {
    sourceId: genId('costs'),
    sourcePlatform: 'mp',
    carSourceId: car.sourceId,
    categorySourceId: category.sourceId,
    amount: actualPay,
    costDate: fuelDate,
    remark: log.remark,
    maintainHandleSourceId: '',
    repairSourceId: '',
    fuelRecordSourceId: log.sourceId,
    createdAt: now,
    updatedAt: now,
    deleted: false
  };
  insert<Cost>('costs', cost);

  log.costSourceId = cost.sourceId;
  update<RefuelLog>('fuelRecords', log);

  // ---- 全量重算油耗区间（与主包一致：删旧插新） ----
  const carLogs = list<RefuelLog>('fuelRecords')
    .filter(r => r.carSourceId === car.sourceId)
    .sort((a, b) => a.fuelDate - b.fuelDate);
  const segs = rebuildConsumptionsGrouped(carLogs);
  for (const old of list<FuelConsumption>('fuelConsumptions').filter(s => s.carSourceId === car.sourceId)) {
    hardDelete('fuelConsumptions', old.sourceId);
  }
  for (const s of segs) insert<FuelConsumption>('fuelConsumptions', s);

  syncCarMileage(car.sourceId, makeMileages);

  // ---- 回读确认 ----
  const saved = get<RefuelLog>('fuelRecords', log.sourceId);
  if (!saved) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: '写入本地存储失败（回读不到刚记的那条）。请提示用户重试，或到「记一笔」页手动补记。'
        }
      ]
    };
  }

  // ---- 反馈：把「这次有没有算出油耗」讲清楚 ----
  const mine = segs.filter(s => (s.energyType || 'fuel') === energyType);
  const latest = mine.length ? mine[mine.length - 1] : null;
  const d = new Date(fuelDate);
  const dateLabel = `${d.getMonth() + 1}月${d.getDate()}日`;
  const kindLabel = energyType === 'ev' ? '充电' : '加油';

  let consumptionNote: string;
  if (latest) {
    consumptionNote =
      energyType === 'ev'
        ? `本次算出电耗 ${latest.fuelConsumption.toFixed(2)} kWh/100km（区间 ${latest.mileage} km）。`
        : `本次算出油耗 ${latest.fuelConsumption.toFixed(2)} L/100km（区间 ${latest.mileage} km）。`;
  } else if (!isFull) {
    consumptionNote = '这次没加满，油耗要等下次加满才能算出来。';
  } else {
    consumptionNote = '这是第一次加满记录，再记一次加满就能算出油耗。';
  }

  const mileageNote = useCarMileage
    ? `注：里程沿用了车辆当前里程 ${makeMileages} km，如果这次加油时里程不同，请让用户到记录里改一下。`
    : '';

  return {
    isError: false,
    content: [
      {
        type: 'text',
        text:
          `已记录：${car.name}（${energyLabel(car)}）${kindLabel} ${volume} ${volumeUnit}，` +
          `单价 ¥${price} ${unitLabel}，实付 ¥${actualPay.toFixed(2)}（${dateLabel}）。` +
          consumptionNote +
          (mileageNote ? ` ${mileageNote}` : '')
      }
    ],
    structuredContent: {
      carName: car.name,
      energyType: energyLabel(car),
      kindLabel,
      volume: String(volume),
      volumeUnit,
      unitPrice: price.toFixed(2),
      amount: actualPay.toFixed(2),
      mileage: String(makeMileages),
      dateText: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
      consumption: latest ? latest.fuelConsumption.toFixed(2) : '',
      consumptionUnit: energyType === 'ev' ? 'kWh/100km' : 'L/100km',
      consumptionMileage: latest ? String(latest.mileage) : '',
      pagePath: `pages/vehicle-detail/index?id=${car.sourceId}`,
      linkText: '查看加油记录'
    }
  };
}
