// 单车基础信息
//
// 评测场景「查看车辆详情与用车记录」里，记录查询已覆盖一半，
// 另一半是「这辆车的基本情况」：什么类型、跑了多少、买多久了、几项保养、今年花了多少。
// 没有这个接口，模型只能拿全车汇总硬答，页面也落不到具体一辆车。
import { Car } from '../lib/types/models';
import { energyLabel, readCars, readCosts, readHandles, readLogs, readMaintains, resolveCarStrict } from '../lib/store';
import { calcRemaining, findLastHandle, isRemainOverdue } from '../lib/domain/maintain.service';

interface Args {
  /** 哪辆车；只有一辆时可省略 */
  carName?: string;
}

function ymd(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${(d.getMonth() + 1 < 10 ? '0' : '') + (d.getMonth() + 1)}-${(d.getDate() < 10 ? '0' : '') + d.getDate()}`;
}

const DAY = 86400000;

/** 保养项统计：总数 / 待处理（超期 + 临近） */
function maintainStatOf(car: Car, now: number) {
  const handles = readHandles();
  const logs = readLogs();
  const items = readMaintains().filter(m => m.carSourceId === car.sourceId);
  let pending = 0;
  for (const m of items) {
    const r = calcRemaining(m, findLastHandle(m, logs, handles), car, now, {
      mileage: car.maintainSoonMileage,
      days: car.maintainSoonDays
    });
    if (isRemainOverdue(r.remainMileage, r.remainDays) || r.urgent) pending += 1;
  }
  return { total: items.length, pending };
}

export async function queryCarDetail(args: Args = {}): Promise<AgentApiResult> {
  const cars = readCars();
  if (!cars.length) {
    return {
      isError: true,
      content: [{ type: 'text', text: '用户还没有添加车辆。请引导先在「车辆」页添加车辆。' }],
      handoff: () => ({ query: '', payload: { carCount: 0 } })
    };
  }

  const asked = (args.carName || '').trim();
  const matched = resolveCarStrict(cars, asked);

  // 多车又没说哪辆：问清楚，别拿第一辆的档案糊弄
  if (!matched.car) {
    const names = cars.map(c => c.name).join('、');
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: asked
            ? `没有找到名为「${asked}」的车辆。现有车辆：${names}。请让用户确认是哪一辆。`
            : `用户有 ${cars.length} 辆车（${names}），要查哪一辆的详情？请先问清楚再调用。`
        }
      ],
      handoff: () => ({ query: '', payload: { carCount: cars.length, question: 'which-car' } })
    };
  }

  const car = matched.car;
  const now = Date.now();
  const stat = maintainStatOf(car, now);

  const year = new Date(now).getFullYear();
  const yearStart = new Date(year, 0, 1).getTime();
  const yearExpense = readCosts()
    .filter(c => c.carSourceId === car.sourceId && !c.deleted && c.costDate >= yearStart && c.costDate <= now)
    .reduce((s, c) => s + c.amount, 0);

  const serviceDays = car.initDate ? Math.max(0, Math.floor((now - car.initDate) / DAY)) : null;

  const parts = [
    `${car.name}（${energyLabel(car)}）`,
    `当前里程 ${car.mileages} km`,
    serviceDays === null ? '' : `购车 ${ymd(car.initDate)}（${serviceDays} 天）`,
    stat.total > 0 ? `保养 ${stat.total} 项${stat.pending > 0 ? `，其中 ${stat.pending} 项待处理` : '，全部在周期内'}` : '还没有配置保养项',
    `${year} 年支出 ¥${yearExpense.toFixed(2)}`
  ].filter(Boolean);

  const text = `${parts.join('；')}。`;

  return {
    isError: false,
    content: [{ type: 'text', text }],
    structuredContent: {
      carName: car.name,
      energyType: energyLabel(car),
      mileages: String(car.mileages),
      initDate: car.initDate ? ymd(car.initDate) : '',
      serviceDays: serviceDays === null ? '' : String(serviceDays),
      maintainTotal: String(stat.total),
      maintainPending: String(stat.pending),
      yearExpense: yearExpense.toFixed(2),
      pagePath: `pages/vehicle-detail/index?id=${car.sourceId}`,
      linkText: '查看车辆详情'
    },
    handoff: () => ({
      query: `id=${encodeURIComponent(car.sourceId)}`,
      payload: { carId: car.sourceId, carName: car.name }
    })
  };
}
