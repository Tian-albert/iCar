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
      // 无车时不带链接：唯一能引导的「车辆」页是 tabBar 页，navigateTo 跳不过去会静默失败
      structuredContent: { count: '0', items: '' }
    };
  }

  const pinnedId = getUser()?.pinnedCarId;
  const rows = cars.map(c => ({
    sourceId: c.sourceId,
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
      // 链到车辆详情（非 tabBar 页）而不是「车辆」列表页：
      // tabBar 页只能 switchTab，page-link 走 navigateTo 会静默失败
      pagePath: `pages/vehicle-detail/index?id=${rows[0].sourceId}`,
      linkText: '查看车辆详情'
    }
  };
}
