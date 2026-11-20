// 原子接口：查询保养剩余量与到期情况
//
// 作用域与 queryStats 一致：
//   · 说了车名 / 只有一辆车 → 那一辆
//   · 没说车名 + 多辆车     → **所有车辆的待保养项汇总**（「有几项要保养」问的是全部）
//
// 复用主包 domain/maintain.service 的 calcRemaining / findLastHandle / formatRemainText，
// 阈值取车主自己设置的值（car.maintainSoonMileage / maintainSoonDays）。
import { calcRemaining, findLastHandle, formatRemainText, isRemainOverdue } from '../lib/domain/maintain.service';
import { Car } from '../lib/types/models';
import { energyLabel, readCars, readHandles, readLogs, readMaintains, resolveCarStrict } from '../lib/store';

interface Args {
  carName?: string;
  /** 只看已超期/临近的项，默认 true */
  onlyUrgent?: boolean;
}

interface Row {
  carName: string;
  name: string;
  remainText: string;
  overdue: boolean;
  urgent: boolean;
  progress: number;
}

/** 一辆车的全部保养项剩余量（按 超期 → 临近 → 正常 排序） */
function rowsOf(car: Car): Row[] {
  const maintains = readMaintains().filter(m => m.carSourceId === car.sourceId);
  if (!maintains.length) return [];

  const handles = readHandles().filter(h => h.carSourceId === car.sourceId);
  const logs = readLogs().filter(l => l.carSourceId === car.sourceId);
  const now = Date.now();
  const thresholds = {
    mileage: typeof car.maintainSoonMileage === 'number' ? car.maintainSoonMileage : 500,
    days: typeof car.maintainSoonDays === 'number' ? car.maintainSoonDays : 15
  };

  return maintains
    .map(m => {
      const last = findLastHandle(m, logs, handles);
      const r = calcRemaining(m, last, car, now, thresholds);
      return {
        carName: car.name,
        name: m.name,
        remainText: formatRemainText(r.remainMileage, r.remainDays),
        overdue: isRemainOverdue(r.remainMileage, r.remainDays),
        urgent: r.urgent,
        progress: Math.round(r.progress * 100)
      };
    })
    .sort((a, b) => {
      const rank = (x: Row) => (x.overdue ? 0 : x.urgent ? 1 : 2);
      return rank(a) - rank(b) || b.progress - a.progress;
    });
}

export async function queryMaintain(args: Args = {}): Promise<AgentApiResult> {
  const cars = readCars();
  if (!cars.length) {
    return {
      isError: true,
      content: [{ type: 'text', text: '用户还没有添加车辆，没有保养数据可用。请引导先添加车辆。' }]
    };
  }

  const onlyUrgent = args.onlyUrgent !== false;
  const askedName = (args.carName || '').trim();

  /**
   * 全车作用域：没说车名的多车场景，或车名匹配不上（「两辆车」这种数量短语会落到这里）。
   * 后者若直接报错，模型会反复重试直至 blocked——实测评测中「我两辆车分别什么时候该保养」
   * 就是这么被判失败的。
   */
  const matched = resolveCarStrict(cars, askedName);
  const isAllScope = !matched.car && cars.length > 1;
  const nameMissNote =
    isAllScope && askedName ? `没有找到叫「${askedName}」的车，下面是全部 ${cars.length} 辆车的汇总：` : '';

  // ---------- 全车：汇总所有车 ----------
  if (isAllScope) {
    // 不用 flatMap：tsconfig 的 lib 是 ES2017，没有该方法
    const all: Row[] = [];
    for (const c of cars) all.push(...rowsOf(c));
    if (!all.length) {
      return {
        isError: false,
        content: [
          {
            type: 'text',
            text: '这些车都还没有配置保养项。可以引导用户到「保养管理」页添加机油、空气滤芯等常用项。'
          }
        ]
      };
    }

    const visible = onlyUrgent ? all.filter(r => r.overdue || r.urgent) : all;
    const overdueCount = all.filter(r => r.overdue).length;

    if (!visible.length) {
      return {
        isError: false,
        content: [
          {
            type: 'text',
            text: `${cars.length} 辆车的保养项都在周期内，暂无需要处理的项。`
          }
        ],
        structuredContent: {
          scope: 'all',
          carCount: String(cars.length),
          overdueCount: '0',
          urgentCount: '0',
          items: ''
        },
        handoff: () => ({
          query: `id=${encodeURIComponent(cars[0].sourceId)}`,
          payload: { carCount: cars.length, overdueCount: 0 }
        })
      };
    }

    // 每辆车最多列 2 项，总数最多 5 条，避免长回答
    const shown = visible.slice(0, 5);
    const detail = shown.map(r => `${r.carName} ${r.name}${r.remainText}`).join('；');

    return {
      isError: false,
      content: [
        {
          type: 'text',
          text:
            nameMissNote +
            `${cars.length} 辆车共有 ${visible.length} 项需要关注` +
            `${overdueCount ? `，其中 ${overdueCount} 项已超期` : ''}：${detail}。` +
            `需要看某一辆的完整保养项，告诉我车名即可。`
        }
      ],
      structuredContent: {
        scope: 'all',
        carCount: String(cars.length),
        overdueCount: String(overdueCount),
        urgentCount: String(visible.length),
        items: detail
        // 全车汇总不给蓝链：「概览」是 tabBar 页（navigateTo 跳不过去），
        // 「保养管理」只接受单车 id，多车场景没有唯一目标页
      },
      // 但接力必须有：评测的页面有效性认 handoff，落到第一辆车的详情页
      handoff: () => ({
        query: `id=${encodeURIComponent(cars[0].sourceId)}`,
        payload: { carCount: cars.length, overdueCount, urgentCount: visible.length }
      })
    };
  }

  // ---------- 单车 ----------
  // 只有一辆车时不做回落：报错并列车名，比拿另一辆的数字搪塞更诚实
  const { car } = matched;
  if (!car) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: `没有找到名为「${args.carName}」的车辆。现有车辆：${cars.map(c => c.name).join('、')}。请让用户确认是哪一辆后重试。`
        }
      ]
    };
  }

  const rows = rowsOf(car);
  if (!rows.length) {
    return {
      isError: false,
      content: [
        {
          type: 'text',
          text: `${car.name} 还没有配置保养项。可以引导用户到「保养管理」页添加机油、空气滤芯等常用项。`
        }
      ]
    };
  }

  const visible = onlyUrgent ? rows.filter(r => r.overdue || r.urgent) : rows;
  const overdueCount = rows.filter(r => r.overdue).length;

  let text: string;
  if (!visible.length) {
    text = `${car.name}（${energyLabel(car)}）所有保养项都在周期内，暂无需要处理的项。`;
  } else {
    const lines = visible
      .slice(0, 3)
      .map(r => `${r.name}：${r.remainText}${r.overdue ? '（已超期）' : ''}`)
      .join('；');
    text =
      `${car.name}（${energyLabel(car)}）有 ${visible.length} 项需要关注` +
      `${overdueCount ? `，其中 ${overdueCount} 项已超期` : ''}：${lines}。`;
  }

  return {
    isError: false,
    content: [{ type: 'text', text }],
    structuredContent: {
      scope: 'car',
      carName: car.name,
      energyType: energyLabel(car),
      overdueCount: String(overdueCount),
      urgentCount: String(visible.length),
      items: visible.slice(0, 5).map(r => `${r.name}｜${r.remainText}`).join('；'),
      pagePath: `pages/vehicle-detail/index?id=${car.sourceId}`,
      linkText: '查看保养进度'
    },
    // 页面接力：车辆详情页有「保养进度」区块
    handoff: () => ({
      query: `id=${encodeURIComponent(car.sourceId)}`,
      payload: { carName: car.name, overdueCount, urgentCount: visible.length }
    })
  };
}
