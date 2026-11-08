// 车辆列表页
import { getStorage } from '../../store/index';
import { listCars } from '../../services/car.service';
import { getPinnedCarId, setPinnedCarId } from '../../services/user.service';
import { Car } from '../../types/models';
import { displayIcon, isImageIcon } from '../../utils/icons';
import { buildShareMessage, buildTimelineMessage, enableShareMenu } from '../../utils/share';

interface CarView extends Car {
  pinned: boolean;
  emoji: string;
  isImage: boolean;
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
    enableShareMenu();
  },
  /** 转发给好友 / 群聊：落地到车辆列表，接收方本地无数据也能正常打开 */
  onShareAppMessage() {
    const cars = this.data.cars;
    return buildShareMessage({
      highlight: cars.length > 0 ? `我的${cars[0].name}已行驶 ${cars[0].mileages} km` : ''
    });
  },
  /** 分享到朋友圈 */
  onShareTimeline() {
    const cars = this.data.cars;
    return buildTimelineMessage({
      highlight: cars.length > 0 ? `我的${cars[0].name}已行驶 ${cars[0].mileages} km` : ''
    });
  },
  load() {
    const storage = getStorage();
    const pinnedId = getPinnedCarId(storage);
    const cars = listCars(storage).map(c => ({
      ...c,
      pinned: c.sourceId === pinnedId,
      emoji: displayIcon(c.icon || 'car'),
      isImage: isImageIcon(c.icon || '')
    }));
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
