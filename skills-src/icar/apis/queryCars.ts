// 原子接口：列出用户的车辆
//
// 回答「我有几辆车」「我的车叫什么」这类问题；
// 也是模型在多车场景下选 `carName` 的依据（先说清有哪些车，再记账）。
import { energyLabel, pickCar, readCars, getUser } from '../lib/store';

export async function queryCars(): Promise<AgentApiResult> {
  const cars = readCars();
  if (!cars.length) {
    return {
      isError: false,
      content: [
        {
          type: 'text',
          text: '用户还没有添加任何车辆。可以引导用户到「车辆」页点右上角「＋」添加第一辆车。'
        }
      ],
      structuredContent: { count: '0', items: '', pagePath: '/pages/index/index', linkText: '去添加车辆' }
    };
  }

  const pinnedId = getUser()?.pinnedCarId;
  const rows = cars.map(c => ({
    name: c.name,
    energyType: energyLabel(c),
    mileages: String(c.mileages || 0),
    pinned: c.sourceId === pinnedId
  }));

  // 置顶车排最前，其余保持原顺序（与「车辆」页观感一致）
  rows.sort((a, b) => Number(b.pinned) - Number(a.pinned));

  const items = rows
    .map(r => `${r.name}（${r.energyType}，${r.mileages} km${r.pinned ? '，置顶' : ''}）`)
    .join('；');

  const text =
    rows.length === 1
      ? `用户有 1 辆车：${items}。`
      : `用户有 ${rows.length} 辆车：${items}。`;

  return {
    isError: false,
    content: [{ type: 'text', text }],
    structuredContent: {
      count: String(rows.length),
      items,
      pagePath: '/pages/index/index',
      linkText: '查看我的车辆'
    }
  };
}
