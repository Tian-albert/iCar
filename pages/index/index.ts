// 车辆列表页
import { getStorage } from '../../store/index';
import { listCars } from '../../services/car.service';
import { getPinnedCarId, setPinnedCarId } from '../../services/user.service';
import { Car } from '../../types/models';

interface CarView extends Car {
  pinned: boolean;
}

Page({
  data: {
    cars: [] as CarView[]
  },
  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 1 });
    }
    this.load();
  },
  load() {
    const storage = getStorage();
    const pinnedId = getPinnedCarId(storage);
    const cars = listCars(storage).map(c => ({ ...c, pinned: c.sourceId === pinnedId }));
    this.setData({ cars });
  },
  onAddCar() {
    wx.navigateTo({ url: '/pages/vehicle-form/index' });
  },
  onTapCar(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    wx.navigateTo({ url: `/pages/vehicle-detail/index?id=${id}` });
  },
  onTogglePin(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    const storage = getStorage();
    const pinnedId = getPinnedCarId(storage);
    const nextId = pinnedId === id ? '' : id;
    setPinnedCarId(storage, nextId);
    this.load();
    wx.showToast({ title: nextId ? '已置顶' : '已取消置顶', icon: 'none' });
  }
});
