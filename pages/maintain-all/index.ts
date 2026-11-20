// 全车保养（所有车的临期 / 超期项）
//
// 为什么单独一页：概览只能放前几条，多车用户看不到其它车的待办；
// 而「保养管理页」是按单车 + 保养项周期维护的，语义不同，不能混用。
import { getStorage } from '../../store/index';
import { listCars } from '../../services/car.service';
import { formatCycle, getMaintainProgressBatch, MaintainProgressItem } from '../../services/maintain-record.service';
import { formatRemainText, isRemainOverdue } from '../../domain/maintain.service';
import { applyPageSkin } from '../../utils/skin';

interface ItemView {
  key: string;
  name: string;
  remainText: string;
  level: 'bad' | 'warn' | 'ok';
  /** 剩余比例（进度条宽度） */
  width: string;
  cycleText: string;
}

interface GroupView {
  carSourceId: string;
  carName: string;
  carMeta: string;
  items: ItemView[];
  pendingCount: number;
  /** 该车是否还有待处理项（筛选「待处理」时用来决定是否显示） */
  hasPending: boolean;
}

Page({
  data: {
    pageStyle: '',
    /** pending = 只看超期+临期；all = 全部 */
    filter: 'pending' as 'pending' | 'all',
    groups: [] as GroupView[],
    pendingTotal: 0,
    allTotal: 0,
    loaded: false
  },

  onLoad() {
    applyPageSkin(this);
  },

  onShow() {
    this.load();
  },

  load() {
    const storage = getStorage();
    const cars = listCars(storage);
    const today = Date.now();
    const batch = getMaintainProgressBatch(
      storage,
      cars.map(c => c.sourceId),
      today
    );

    let pendingTotal = 0;
    let allTotal = 0;

    const groups: GroupView[] = cars.map(car => {
      const items = batch[car.sourceId] || [];
      const views: ItemView[] = items.map(it => {
        const bad = isRemainOverdue(it.remainMileage, it.remainDays);
        const level: 'bad' | 'warn' | 'ok' = bad ? 'bad' : it.urgent ? 'warn' : 'ok';
        return {
          key: it.maintain.sourceId,
          name: it.maintain.name,
          remainText: formatRemainText(it.remainMileage, it.remainDays),
          level,
          width: `${Math.max(4, Math.min(100, Math.round(it.progress * 100)))}%`,
          cycleText: formatCycle(it.maintain)
        };
      });
      const pendingCount = views.filter(v => v.level !== 'ok').length;
      allTotal += views.length;
      pendingTotal += pendingCount;
      return {
        carSourceId: car.sourceId,
        carName: car.name,
        carMeta: `${car.mileages} km`,
        items: views,
        pendingCount,
        hasPending: pendingCount > 0
      };
    });

    this.setData({ groups, pendingTotal, allTotal, loaded: true });
  },

  onFilterChange(e: WechatMiniprogram.TouchEvent) {
    const filter = e.currentTarget.dataset.filter as 'pending' | 'all';
    this.setData({ filter });
  },

  /** 点车名或某个保养项 → 该车的详情页（保养进度区块） */
  onTapCar(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    if (!id) return;
    wx.navigateTo({ url: `/pages/vehicle-detail/index?id=${id}&section=maintain` });
  }
});
