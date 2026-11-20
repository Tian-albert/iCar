// 新增一辆车
//
// 车辆是全部统计的分母：没车什么都查不了。所以这个接口的存在意义是
// 「用户第一次用，说了『我有一辆 CRV』，不用再教他去点页面」。
//
// 只做最小必填：名称 + 能量类型。里程没说不编（默认 0，比编一个数诚实）。
import { Car } from '../lib/types/models';
import { genId } from '../lib/utils/id';
import { energyLabel, insert, readCars } from '../lib/store';

interface Args {
  /** 车辆名称，如「我的 CRV」。必填 */
  name?: string;
  /** 能量类型：fuel 燃油 / ev 纯电 / hybrid 混动。默认 fuel */
  energyType?: 'fuel' | 'ev' | 'hybrid';
  /** 当前总里程 km，不传按 0 记 */
  mileages?: number;
  /** 电池容量 kWh，纯电/混动可传 */
  batteryCapacity?: number;
}

const ICON: Record<string, string> = { fuel: '🚗', ev: '🚙', hybrid: '🚐' };

export async function addCar(args: Args = {}): Promise<AgentApiResult> {
  const name = (args.name || '').trim();
  if (!name) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: '缺少车辆名称。请先问用户「这辆车叫什么」（比如「我的 CRV」），拿到名称后再调用，不要自己编一个。'
        }
      ],
      handoff: () => ({ query: 'rangeType=all', payload: { question: 'car-name' } })
    };
  }

  const cars = readCars();
  // 同名车辆会让后续所有「按车名找车」的逻辑产生歧义，必须挡住
  if (cars.some(c => c.name.trim() === name)) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: `已经有一辆叫「${name}」的车了。请让用户换个名字（比如加上年份或车主），不要重名。`
        }
      ],
      handoff: () => ({ query: 'rangeType=all', payload: { question: 'duplicate-name', name } })
    };
  }

  const energyType: 'fuel' | 'ev' | 'hybrid' =
    args.energyType === 'ev' || args.energyType === 'hybrid' ? args.energyType : 'fuel';
  const mileages = Number(args.mileages) > 0 ? Number(args.mileages) : 0;
  const batteryCapacity =
    (energyType === 'ev' || energyType === 'hybrid') && Number(args.batteryCapacity) > 0
      ? Number(args.batteryCapacity)
      : 0;

  const now = Date.now();
  const car: Car = {
    sourceId: genId('cars'),
    sourcePlatform: 'mp',
    name,
    type: 'car',
    icon: ICON[energyType],
    customIconAssetId: '',
    initDate: now,
    // 建档里程 = 当前里程：这样「增加里程」从 0 开始算，不会把历史里程算进本期
    initMileages: mileages,
    mileages,
    evMileages: 0,
    hevMileages: 0,
    batteryCapacity,
    energyType,
    energyTrackingEnabled: true,
    maintainSoonMileage: 500,
    maintainSoonDays: 15,
    createdAt: now,
    updatedAt: now,
    deleted: false
  };
  insert<Car>('cars', car);

  const mileagePart = mileages > 0 ? `，当前里程 ${mileages} km` : '，还没记里程';
  const text =
    `已添加：${car.name}（${energyLabel(car)}）${mileagePart}。` +
    `现在可以记一笔加油或支出，也能查这辆车的统计与保养。`;

  return {
    isError: false,
    content: [{ type: 'text', text }],
    structuredContent: {
      carName: car.name,
      energyType: energyLabel(car),
      mileages: String(car.mileages),
      carCount: String(cars.length + 1),
      pagePath: `pages/vehicle-detail/index?id=${car.sourceId}`,
      linkText: '查看车辆详情'
    },
    handoff: () => ({
      query: `id=${encodeURIComponent(car.sourceId)}`,
      payload: { carName: car.name, energyType: car.energyType }
    })
  };
}
