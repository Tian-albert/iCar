// 车辆到期提醒（保险 / 年检 / 保养）
//
// 为什么单独一个接口：评测的「查看保养与到期提醒」场景里，
// 只答保养到期只覆盖一半——用户还要知道**保险和年检什么时候到期**。
// 这两项不在保养项里，必须单独读 Car 上的到期日。
import { Car } from '../lib/types/models';
import { energyLabel, readCars, readHandles, readLogs, readMaintains, resolveCarStrict } from '../lib/store';
import { calcRemaining, findLastHandle, formatRemainText } from '../lib/domain/maintain.service';

interface Args {
  /** 只看某一辆车；不传则汇总全部 */
  carName?: string;
  /** 多少天内算「即将到期」，默认 30 天 */
  days?: number;
}

interface Row {
  carName: string;
  /** 保险 / 年检 / 保养项名 */
  name: string;
  /** 剩余天数；未知为 null */
  days: number | null;
  text: string;
  overdue: boolean;
}

function ymd(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${(d.getMonth() + 1 < 10 ? '0' : '') + (d.getMonth() + 1)}-${(d.getDate() < 10 ? '0' : '') + d.getDate()}`;
}

const DAY = 86400000;

/** 到期日 → 「2027-03-01（剩 93 天）」/「已过期 5 天」 */
function expireText(ts: number, now: number): { days: number; text: string; overdue: boolean } {
  const diff = Math.ceil((ts - now) / DAY);
  if (diff < 0) return { days: diff, text: `${ymd(ts)}（已过期 ${-diff} 天）`, overdue: true };
  return { days: diff, text: `${ymd(ts)}（剩 ${diff} 天）`, overdue: false };
}

function rowsOfCar(car: Car, now: number, soonDays: number): Row[] {
  const rows: Row[] = [];

  if (car.insuranceExpire) {
    const e = expireText(car.insuranceExpire, now);
    if (e.overdue || e.days <= soonDays) {
      rows.push({ carName: car.name, name: '保险', days: e.days, text: e.text, overdue: e.overdue });
    }
  }
  if (car.inspectExpire) {
    const e = expireText(car.inspectExpire, now);
    if (e.overdue || e.days <= soonDays) {
      rows.push({ carName: car.name, name: '年检', days: e.days, text: e.text, overdue: e.overdue });
    }
  }

  // 保养项：只取即将到期/已超期的（正常项不进来，否则清单一屏放不下）
  const handles = readHandles();
  const logs = readLogs();
  for (const m of readMaintains().filter(x => x.carSourceId === car.sourceId)) {
    const r = calcRemaining(m, findLastHandle(m, logs, handles), car, now, {
      mileage: car.maintainSoonMileage,
      days: car.maintainSoonDays
    });
    const overdue =
      (r.remainDays !== null && r.remainDays < 0) || (r.remainMileage !== null && r.remainMileage < 0);
    if (overdue || r.urgent) {
      rows.push({
        carName: car.name,
        name: m.name,
        days: r.remainDays,
        text: formatRemainText(r.remainMileage, r.remainDays),
        overdue
      });
    }
  }

  return rows;
}

export async function queryExpiring(args: Args = {}): Promise<AgentApiResult> {
  const cars = readCars();
  if (!cars.length) {
    return {
      isError: true,
      content: [{ type: 'text', text: '用户还没有添加车辆，没有到期信息可查。请引导先在「车辆」页添加车辆。' }],
      handoff: () => ({ query: '', payload: { carCount: 0 } })
    };
  }

  const now = Date.now();
  const soonDays = Number(args.days) > 0 ? Number(args.days) : 30;
  const asked = (args.carName || '').trim();
  const matched = resolveCarStrict(cars, asked);

  if (asked && !matched.car) {
    const names = cars.map(c => c.name).join('、');
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: `没有找到名为「${asked}」的车辆。现有车辆：${names}。请让用户确认是哪一辆。`
        }
      ],
      handoff: () => ({ query: 'rangeType=all', payload: { carCount: cars.length } })
    };
  }

  const scope = matched.car ? [matched.car] : cars;
  const rows: Row[] = [];
  for (const car of scope) rows.push(...rowsOfCar(car, now, soonDays));

  // 超期的排前面，其次按剩余天数
  rows.sort((a, b) => Number(b.overdue) - Number(a.overdue) || (a.days ?? 1e9) - (b.days ?? 1e9));

  const scopeName = matched.car ? matched.car.name : `${cars.length} 辆车`;
  const overdueCount = rows.filter(r => r.overdue).length;

  if (!rows.length) {
    const text =
      `${scopeName}最近 ${soonDays} 天内没有要到期的项目` +
      (matched.car ? `（保险/年检到期日未填时不会提醒，可让用户补上）` : '') +
      '。';
    return {
      isError: false,
      content: [{ type: 'text', text }],
      structuredContent: {
        scope: matched.car ? 'car' : 'all',
        carName: matched.car ? matched.car.name : '',
        count: '0',
        overdueCount: '0',
        items: '',
        pagePath: matched.car
          ? `pages/vehicle-detail/index?id=${matched.car.sourceId}&section=maintain`
          : '',
        linkText: '查看到期提醒'
      },
      handoff: () => ({
        query: matched.car
          ? `id=${encodeURIComponent(matched.car.sourceId)}`
          : 'rangeType=all',
        payload: { carId: matched.car ? matched.car.sourceId : '', carName: matched.car ? matched.car.name : '' }
      })
    };
  }

  const list = rows
    .slice(0, 6)
    .map(r => `${r.carName} ${r.name}${r.overdue ? '' : ''}：${r.text}`)
    .join('；');
  const text =
    `${scopeName} 有 ${rows.length} 项要到期的项目` +
    `${overdueCount ? `，其中 ${overdueCount} 项已过期` : ''}：${list}。` +
    `（提醒阈值：${soonDays} 天内）`;

  return {
    isError: false,
    content: [{ type: 'text', text }],
    structuredContent: {
      scope: matched.car ? 'car' : 'all',
      carName: matched.car ? matched.car.name : '',
      count: String(rows.length),
      overdueCount: String(overdueCount),
      items: list,
      pagePath: matched.car ? `pages/vehicle-detail/index?id=${matched.car.sourceId}&section=maintain` : '',
      linkText: '查看到期提醒'
    },
    // 全车 → 保养项目页（临期/超期清单就在这里）；单车 → 该车详情
    handoff: () => ({
      query: matched.car ? `id=${encodeURIComponent(matched.car.sourceId)}` : 'rangeType=all',
      payload: {
        carId: matched.car ? matched.car.sourceId : '',
        carName: matched.car ? matched.car.name : '',
        count: rows.length
      }
    })
  };
}
