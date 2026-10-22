// 保养 Tab：显示置顶车辆（未置顶则最近使用）的保养事项
import { getStorage } from '../../store/index';
import { listCars } from '../../services/car.service';
import { getPinnedCarId } from '../../services/user.service';
import { ensureMaintainTemplates, getMaintainProgress } from '../../services/maintain-record.service';
import { Car } from '../../types/models';

/** 取置顶车辆；未置顶时回退到最近使用的车辆 */
function pickActiveCar(storage: ReturnType<typeof getStorage>): Car | null {
  const cars = listCars(storage);
  if (!cars.length) return null;
  const pinnedId = getPinnedCarId(storage);
  const pinned = cars.find(c => c.sourceId === pinnedId);
  if (pinned) return pinned;
  return [...cars].sort((a, b) => b.updatedAt - a.updatedAt)[0];
}

Page({
  data: {
    hasCar: false,
    carName: '',
    mileages: 0,
    isPinned: false,
    soonItems: [] as Array<{ name: string; remainText: string; progressPercent: number }>,
    allCount: 0
  },
  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 0 });
    }
    this.load();
  },
  load() {
    const storage = getStorage();
    const car = pickActiveCar(storage);
    if (!car) {
      this.setData({ hasCar: false });
      return;
    }
    ensureMaintainTemplates(storage, car.sourceId);
    const progress = getMaintainProgress(storage, car.sourceId, Date.now());
    const soonItems = progress
      .filter(p => p.urgent)
      .sort((a, b) => a.progress - b.progress)
      .map(p => ({
        name: p.maintain.name,
        remainText:
          p.remainDays !== null
            ? `剩余 ${p.remainDays} 天`
            : p.remainMileage !== null
              ? `剩余 ${p.remainMileage} km`
              : '',
        progressPercent: Math.round(p.progress * 100)
      }));
    this.setData({
      hasCar: true,
      carName: car.name,
      mileages: car.mileages,
      isPinned: getPinnedCarId(storage) === car.sourceId,
      soonItems,
      allCount: progress.length
    });
  },
  onOpenManage() {
    const car = pickActiveCar(getStorage());
    if (car) {
      wx.navigateTo({ url: `/pages/maintain-manage/index?id=${car.sourceId}` });
    }
  },
  onOpenDetail() {
    const car = pickActiveCar(getStorage());
    if (car) {
      wx.navigateTo({ url: `/pages/vehicle-detail/index?id=${car.sourceId}` });
    }
  }
});
