// 原子接口：查询某辆车在某维度下的支出与能耗统计
//
// 口径与统计页完全一致——直接复用主包的 domain/stats.service（镜像在 ../lib），
// 不在这里重写任何计算公式，避免「AI 说 8200、统计页显示 8100」。
import { buildStats, StatsRange } from '../lib/domain/stats.service';
import {
  energyLabel,
  pickCar,
  readCars,
  readCategories,
  readConsumptions,
  readCosts,
  readRefuels
} from '../lib/store';

interface Args {
  /** 车辆名称，可不传（默认置顶车 / 第一辆车） */
  carName?: string;
  /** 统计维度：year（默认）/ month / all */
  rangeType?: 'year' | 'month' | 'all';
  year?: number;
  month?: number;
}

function rangeLabel(range: StatsRange): string {
  if (range.type === 'all') return '全部时间';
  if (range.type === 'year') return `${range.year} 年`;
  return `${range.year} 年 ${range.month} 月`;
}

export async function queryStats(args: Args = {}): Promise<AgentApiResult> {
  const cars = readCars();
  if (!cars.length) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: '用户还没有添加任何车辆，无法统计。请引导用户在「车辆」页点右上角「＋」添加车辆后再查询。'
        }
      ]
    };
  }

  const car = pickCar(cars, args.carName || '');
  if (!car) {
    return {
      isError: true,
      content: [{ type: 'text', text: `没有找到名为「${args.carName}」的车辆。` }]
    };
  }

  const now = new Date();
  const type = args.rangeType === 'month' || args.rangeType === 'all' ? args.rangeType : 'year';
  const range: StatsRange =
    type === 'all'
      ? { type: 'all' }
      : type === 'month'
        ? { type: 'month', year: args.year || now.getFullYear(), month: args.month || now.getMonth() + 1 }
        : { type: 'year', year: args.year || now.getFullYear() };

  const costs = readCosts().filter(c => c.carSourceId === car.sourceId);
  const refuels = readRefuels().filter(r => r.carSourceId === car.sourceId);
  const segs = readConsumptions().filter(s => s.carSourceId === car.sourceId);
  const categories = readCategories();

  const snap = buildStats(range, costs, refuels, segs, categories, car);
  const label = rangeLabel(range);
  const isEv = car.energyType === 'ev';

  const total = snap.expense.total.toFixed(2);
  const perKm = snap.expense.perKm.toFixed(3);
  const perKmExFuel = snap.expense.perKmExFuel.toFixed(3);
  const energyName = isEv ? '电耗' : '油耗';
  const consumption = isEv ? snap.electricity.avgConsumption : snap.fuel.avgConsumption;

  const text =
    `${car.name}（${energyLabel(car)}）${label}支出 ¥${total}，` +
    `每公里 ¥${perKm}（不含能耗费用 ¥${perKmExFuel}）；` +
    `${energyName} ${consumption.toFixed(2)} ${isEv ? 'kWh/100km' : 'L/100km'}，` +
    `有效里程 ${snap.mileage.increased} km。`;

  return {
    isError: false,
    content: [{ type: 'text', text }],
    structuredContent: {
      carName: car.name,
      energyType: energyLabel(car),
      rangeLabel: label,
      totalExpense: total,
      perKm,
      perKmExFuel,
      avgConsumption: consumption.toFixed(2),
      consumptionUnit: isEv ? 'kWh/100km' : 'L/100km',
      mileageIncreased: String(snap.mileage.increased),
      // page-link：让回复正文里出现「#小程序：车记本/查看统计详情」
      pagePath: `/pages/statistics/index?id=${car.sourceId}&range=year`,
      linkText: '查看统计详情'
    }
  };
}
