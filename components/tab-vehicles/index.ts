// 车辆列表页（主界面）
//
// 布局：主车用深色 Hero 承载最高频动作（记一笔 / 统计 / 保养 / 记录），
// 其余车保留「每车一步记账」的紧凑卡片，避免多车时记错车。
import { getStorage } from '../../store/index';
import { listCars } from '../../services/car.service';
import { getPinnedCarId, setPinnedCarId } from '../../services/user.service';
import { listCosts, listCategories } from '../../services/cost.service';
import { getMaintainProgress } from '../../services/maintain-record.service';
import { buildStats } from '../../domain/stats.service';
import { listRefuels, getConsumptions } from '../../services/refuel.service';
import { Car } from '../../types/models';
import { displayIcon, isImageIcon } from '../../utils/icons';
import { serviceDaysSince } from '../../utils/date';
import { pickMainCar } from '../../services/overview.service';

interface CarView extends Car {
  pinned: boolean;
  emoji: string;
  isImage: boolean;
  /** 本月支出（紧凑卡片用） */
  monthCostText: string;
  /** 里程（千分位，与 Hero 保持一致） */
  mileagesText: string;
  /** 保养状态：ok 正常 / warn 临近 / bad 超期 */
  state: 'ok' | 'warn' | 'bad';
  stateText: string;
}

interface HeroView {
  carId: string;
  name: string;
  emoji: string;
  isImage: boolean;
  icon: string;
  energyLabel: string;
  mileagesText: string;
  monthCostText: string;
  /** 平均油耗 / 电耗，取本年 */
  avgText: string;
  avgLabel: string;
  /** 已服役天数（购车日 → 今天）；购车日缺失时为 -- */
  serviceDaysText: string;
  pinned: boolean;
}

function fmtInt(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function fmtMoney(n: number): string {
  const v = Math.round(n * 100) / 100;
  return Number.isInteger(v) ? fmtInt(v) : v.toFixed(2);
}

function energyLabelOf(t: string): string {
  if (t === 'ev') return '纯电';
  if (t === 'hybrid') return '混动';
  return '燃油';
}

/** 把保养进度压成一句话：优先里程，其次天数 */
function maintainSummary(
  progress: Array<{ remainMileage: number | null; remainDays: number | null; progress: number }>
): { text: string; label: string; state: 'ok' | 'warn' | 'bad' } {
  if (progress.length === 0) {
    return { text: '--', label: '保养', state: 'ok' };
  }
  // 剩余比例最小的最紧急
  const urgent = [...progress].sort((a, b) => a.progress - b.progress)[0];
  if (urgent.remainMileage !== null) {
    const v = urgent.remainMileage;
    return {
      text: v < 0 ? `超 ${fmtInt(Math.abs(v))}` : fmtInt(v),
      label: v < 0 ? 'km 已超期' : 'km 剩余',
      state: v < 0 ? 'bad' : 'warn'
    };
  }
  if (urgent.remainDays !== null) {
    const v = urgent.remainDays;
    return {
      text: v < 0 ? `超 ${Math.abs(v)}` : String(v),
      label: v < 0 ? '天 已超期' : '天 剩余',
      state: v < 0 ? 'bad' : 'warn'
    };
  }
  return { text: '--', label: '保养', state: 'ok' };
}

Component({
  data: {
    cars: [] as CarView[],
    hero: null as HeroView | null,
    others: [] as CarView[],
    carCount: 0,
    totalMileageText: '0',
    pendingCount: 0
  },

  lifetimes: {
    attached() {
      (this as any).load();
    }
  },

  methods: {
  /** 宿主页切到本组件时调用：刷新数据 */
  onShown() {
    this.load();
  },

  /** 供宿主页取分享内容 */
  getShareHighlight(): string {
    const hero = this.data.hero;
    return hero ? `我的${hero.name}已行驶 ${hero.mileagesText} km` : '';
  },

  load() {
    const storage = getStorage();
    const now = Date.now();
    const year = new Date(now).getFullYear();
    const monthStart = new Date(year, new Date(now).getMonth(), 1).getTime();
    const cats = listCategories(storage);

    const cars = listCars(storage);
    const pinnedId = getPinnedCarId(storage);
    const mainCar = pickMainCar(cars, pinnedId);

    let totalMileage = 0;
    let pendingCount = 0;

    const views: CarView[] = cars.map(c => {
      totalMileage += c.mileages || 0;

      const costs = listCosts(storage, c.sourceId);
      let monthCost = 0;
      for (const cost of costs) {
        if (cost.costDate >= monthStart && cost.costDate <= now) monthCost += cost.amount;
      }

      const progress = getMaintainProgress(storage, c.sourceId, now);
      const pending = progress.filter(p => p.urgent).length;
      pendingCount += pending;
      const sum = maintainSummary(progress);

      return {
        ...c,
        pinned: c.sourceId === pinnedId,
        emoji: displayIcon(c.icon || 'car'),
        isImage: isImageIcon(c.icon || ''),
        monthCostText: fmtMoney(monthCost),
        mileagesText: fmtInt(c.mileages),
        state: sum.state,
        stateText: pending > 0 ? (sum.state === 'bad' ? '超期' : '临近') : '正常'
      };
    });

    // 主车指标
    let hero: HeroView | null = null;
    if (mainCar) {
      const costs = listCosts(storage, mainCar.sourceId);
      const refuels = listRefuels(storage, mainCar.sourceId);
      const segs = getConsumptions(storage, mainCar.sourceId);
      const snap = buildStats(
        { type: 'year', year },
        costs,
        refuels,
        segs,
        cats,
        mainCar
      );

      let monthCost = 0;
      for (const cost of costs) {
        if (cost.costDate >= monthStart && cost.costDate <= now) monthCost += cost.amount;
      }

      const isEv = mainCar.energyType === 'ev';
      const avgValue = isEv ? snap.electricity.avgConsumption : snap.fuel.avgConsumption;
      const avgMileage = isEv ? snap.mileage.evMileage : snap.mileage.fuelMileage;

      // 已服役天数 = 今天 − 购车日；缺失时为 null，显示 --
      const serviceDays = serviceDaysSince(mainCar.initDate, now);

      hero = {
        carId: mainCar.sourceId,
        name: mainCar.name,
        emoji: displayIcon(mainCar.icon || 'car'),
        isImage: isImageIcon(mainCar.icon || ''),
        icon: mainCar.icon || '',
        energyLabel: energyLabelOf(mainCar.energyType),
        mileagesText: fmtInt(mainCar.mileages),
        monthCostText: fmtMoney(monthCost),
        avgText: avgMileage > 0 ? avgValue.toFixed(2) : '--',
        avgLabel: isEv ? '平均电耗' : '平均油耗',
        serviceDaysText: serviceDays === null ? '--' : fmtInt(serviceDays),
        pinned: pinnedId === mainCar.sourceId
      };
    }

    this.setData({
      cars: views,
      hero,
      others: views.filter(v => v.sourceId !== (hero ? hero.carId : '')),
      carCount: cars.length,
      totalMileageText: fmtInt(totalMileage),
      pendingCount
    });
  },

  // ---------------- 动作 ----------------

  /** 顶部「＋」：添加车辆 */
  onAddCar() {
    wx.navigateTo({ url: '/pages/vehicle-form/index' });
  },

  /** Hero 主卡 / 其他车卡片：进详情 */
  onTapCar(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    wx.navigateTo({ url: `/pages/vehicle-detail/index?id=${id}` });
  },

  /** Hero 大按钮：记一笔 */
  onAddEntry() {
    const hero = this.data.hero;
    if (!hero) return;
    wx.navigateTo({ url: `/pages/entry/index?carId=${hero.carId}` });
  },

  /** Hero：统计 */
  onOpenStatistics() {
    const hero = this.data.hero;
    if (!hero) return;
    wx.navigateTo({ url: `/pages/statistics/index?id=${hero.carId}&range=year` });
  },

  /**
   * Hero：保养 → 保养项管理。
   *
   * 「记一次保养」已经由「记一笔 → 保养 Tab」承担（entry 页内有完整表单），
   * 首页若再放一个记保养入口就是重复。而保养项管理（增删改周期、配图标）
   * 是唯一从首页到不了的配置入口，放在这里正好补位。
   */
  onOpenMaintain() {
    const hero = this.data.hero;
    if (!hero) return;
    wx.navigateTo({ url: `/pages/maintain-manage/index?id=${hero.carId}` });
  },

  /** Hero：记录（该车全部记录） */
  onOpenRecords() {
    const hero = this.data.hero;
    if (!hero) return;
    wx.navigateTo({ url: `/pages/records/index?id=${hero.carId}` });
  },

  /** 其他车卡片的「＋」：直接给这辆车记一笔 */
  onQuickEntry(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    wx.navigateTo({ url: `/pages/entry/index?carId=${id}` });
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
  }
});
