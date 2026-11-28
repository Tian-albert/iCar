// 全车保养（所有车的临期 / 超期项）
//
// 为什么单独一页：概览只能放前几条，多车用户看不到其它车的待办；
// 而「保养管理页」是按单车 + 保养项周期维护的，语义不同，不能混用。
import { getStorage } from '../../store/index';
import { listCars } from '../../services/car.service';
import { formatCycle, getMaintainProgressBatch, MaintainProgressItem } from '../../services/maintain-record.service';
import { formatRemainText, isRemainOverdue } from '../../domain/maintain.service';
import { applyPageSkin } from '../../utils/skin';
import { resolveAgentParams } from '../../utils/agent-handoff';

interface ItemView {
  key: string;
  name: string;
  remainText: string;
  level: 'bad' | 'warn' | 'ok';
  /** 剩余比例（进度条宽度） */
  width: string;
  cycleText: string;
  /** 锚点 id：接力定位用（保养项 sourceId 含冒号，不能直接当选择器） */
  anchor: string;
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
    loaded: false,
    /** 接力指定的保养项（匹配到的那条会高亮） */
    focusKey: ''
  },

  onLoad(options: Record<string, string>) {
    applyPageSkin(this);
    // 三层兜底：URL → handoff.query → handoff.payload
    const { params: q } = resolveAgentParams(this, options);
    (this as any)._focusName = q.name ? decodeURIComponent(q.name) : '';
    (this as any)._focusCar = q.id ? decodeURIComponent(q.id) : '';
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

    const groups: GroupView[] = cars.map((car, gi) => {
      const items = batch[car.sourceId] || [];
      const views: ItemView[] = items.map((it, ii) => {
        const bad = isRemainOverdue(it.remainMileage, it.remainDays);
        const level: 'bad' | 'warn' | 'ok' = bad ? 'bad' : it.urgent ? 'warn' : 'ok';
        return {
          key: it.maintain.sourceId,
          name: it.maintain.name,
          remainText: formatRemainText(it.remainMileage, it.remainDays),
          level,
          width: `${Math.max(4, Math.min(100, Math.round(it.progress * 100)))}%`,
          cycleText: formatCycle(it.maintain),
          // 用序号做锚点：保养项 sourceId 含冒号，直接当 id 选择器会失效
          anchor: `mnt-${gi}-${ii}`
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

    /**
     * 接力指定了某一项（「机油还能跑多少公里」）：切到「全部」视图并滚到该项。
     *
     * 默认是「待处理」视图，正常项不渲染——不切视图就会定位到不存在的节点。
     */
    const focusName = (this as any)._focusName as string;
    const focusCar = (this as any)._focusCar as string;
    let focusKey = '';
    let anchor = '';
    if (focusName) {
      for (const g of groups) {
        if (focusCar && g.carSourceId !== focusCar) continue;
        const hit = g.items.find(it => it.name.includes(focusName) || focusName.includes(it.name));
        if (hit) {
          focusKey = hit.key;
          anchor = hit.anchor;
          break;
        }
      }
    }

    this.setData({ groups, pendingTotal, allTotal, loaded: true, focusKey, ...(anchor ? { filter: 'all' } : {}) });

    if (anchor) {
      const scroll = () => (wx as any).pageScrollTo({ selector: `#${anchor}`, duration: 300, offsetTop: -12 });
      (wx as any).nextTick ? (wx as any).nextTick(scroll) : setTimeout(scroll, 60);
    }
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
