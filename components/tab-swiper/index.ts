// 三个 tab 的内容容器（swiper）
//
// 为什么要组件而不是直接写在页面里：
// 三个 tab 页各自是独立页面（tabBar.list 的 pagePath 不能重复），
// 但它们需要共享同一个 swiper 实现，所以抽成组件，各页只做「薄壳」。
//
// 与底部栏的联动：
// - swiper 的 `transition` 事件给出 dx（swiper-item 位移，正为右滑、负为左滑）
// - 用 dx 算出底部栏指示块该在哪，经 getTabBar() 传过去
// - 指示块连续移动，跟手；高亮图标取最近的那个 tab
import { indicatorOffset, indicatorActiveIndex } from '../../utils/tab-indicator';

/** tab 总数 */
const TAB_COUNT = 3;

/**
 * 计算哪些内容组件需要渲染：当前页 + 相邻页。
 *
 * 只渲染当前页的话，跨页滑动时目标页是空白，滑到位才「啪」一下出现；
 * 全渲染又会让概览页的 canvas 环图常驻。保留相邻页是两者的折中。
 */
function keepFlags(index: number): {
  keep0: boolean;
  keep1: boolean;
  keep2: boolean;
} {
  return {
    keep0: index <= 1,
    keep1: true,
    keep2: index >= 1
  };
}

Component({
  properties: {
    /** 初始停在第几个 tab */
    initial: {
      type: Number,
      value: 0
    }
  },

  data: {
    current: 0,
    /**
     * 每个内容组件是否渲染。
     *
     * 只保留「当前 + 相邻」两页：
     * - 只留当前页 → 跨页滑动时目标页空白，滑到位才出现，观感断裂
     * - 全渲染 → 概览页 canvas 环图常驻抢节点
     */
    keep0: true,
    keep1: true,
    keep2: false,
    /** 每个 tab 的步长（px），实测得到 */
    step: 0
  },

  lifetimes: {
    attached() {
      const init = Math.min(TAB_COUNT - 1, Math.max(0, this.data.initial || 0));
      this.setData(Object.assign({ current: init }, keepFlags(init)));
    },
    ready() {
      this.measureStep();
    }
  },

  methods: {
    /**
     * 实测每个 tab 的步长（px）。
     *
     * 指示块要跟 swiper 精确对齐，步长必须与实际渲染一致，
     * 所以用 SelectorQuery 量，而不是写死换算公式。
     *
     * 底部栏胶囊左右各留 28rpx、内部左右各 8rpx，
     * 指示块宽度 = (屏宽 - 2*28rpx - 2*8rpx) / 3。
     */
    measureStep() {
      this.createSelectorQuery()
        .select('.host-swiper')
        .boundingClientRect((rect: any) => {
          const w = rect && rect.width;
          if (!(w > 0)) return;
          const rpx = w / 750;
          const inner = w - 28 * 2 * rpx - 8 * 2 * rpx;
          this.setData({ step: inner / TAB_COUNT });
          // 步长拿到后重新同步一次指示块
          this.syncTabBar(0, this.data.current);
        })
        .exec();
    },

    /**
     * 把指示块位置同步给底部栏。
     *
     * `during` 为 true 表示滑动中：**只发位移，不发高亮索引**。
     * 高亮索引会切换图标的 src（描边↔实心），每帧变化会让图片反复解码 → 闪烁。
     */
    syncTabBar(dx: number, current: number, during = false) {
      const step = this.data.step;
      if (!(step > 0)) return;

      const offset = indicatorOffset(dx, current, TAB_COUNT, step);
      if (during) {
        // 滑动中：只动位移，图标保持原样，避免 src 变化引发重绘
        this.triggerEvent('indicator', { offset, index: null });
        return;
      }

      const activeIndex = indicatorActiveIndex(dx, current, TAB_COUNT, step);
      this.triggerEvent('indicator', { offset, index: activeIndex });
    },

    /**
     * 底部栏点击：把 swiper 滑到指定 tab。
     *
     * 页面收到事件后调用这个方法（组件暴露给页面调用）。
     */
    switchToTab(index: number) {
      const target = Math.min(TAB_COUNT - 1, Math.max(0, index));
      if (target === this.data.current) {
        // 已在该 tab：直接让指示块归位，避免点击后底块不跟手
        this.syncTabBar(0, target);
        return;
      }
      this.setData(Object.assign({ current: target }, keepFlags(target)));
      this.syncTabBar(0, target);
    },

    /** 页面 onShow 时调用：刷新当前 tab 的内容 */
    notifyCurrent() {
      this.notifyShown(this.data.current);
    },

    /**
     * 手势开始：进入拖动态。
     *
     * 只有拖动态才消费 transition 的 dx —— 这是修闪烁的关键。
     * 松手后的归位动画也会触发 transition，但那时 dragging 已为 false，
     * 这些 dx 会被直接丢弃，指示块保持静止，等 animationfinish 一次落定。
     */
    onUserScrollStart() {
      (this as any)._dragging = true;
      (this as any)._lastOffset = undefined;
    },

    /** 滑动过程中：指示块跟手（仅拖动态生效） */
    onTransition(e: any) {
      if (!(this as any)._dragging) return;

      const dx = (e.detail && e.detail.dx) || 0;
      const step = this.data.step;
      if (!(step > 0)) return;

      const offset = indicatorOffset(dx, this.data.current, TAB_COUNT, step);
      const last = (this as any)._lastOffset;
      if (typeof last === 'number' && Math.abs(offset - last) < 1) return;
      (this as any)._lastOffset = offset;

      this.syncTabBar(dx, this.data.current, true);
    },

    /** 切换完成：更新 current 与渲染范围，并通知内容组件刷新 */
    onChange(e: any) {
      const current = e.detail && e.detail.current;
      if (typeof current !== 'number') return;

      // 手势结束：从现在起丢弃归位动画期间的 transition dx
      (this as any)._dragging = false;

      this.setData(Object.assign({ current }, keepFlags(current)));
      this.syncTabBar(0, current);
      this.notifyShown(current);
    },

    /** 归位动画结束：指示块精确落到目标 tab（动画期间它保持静止） */
    onAnimationFinish(e: any) {
      const current = e.detail && e.detail.current;
      if (typeof current !== 'number') return;

      // 兜底：如果 change 没来（极端情况），这里也要退出拖动态
      (this as any)._dragging = false;
      (this as any)._lastOffset = undefined;

      this.syncTabBar(0, current, false);
    },

    /**
     * 通知当前 tab 的内容组件刷新数据（组件没有 onShow）。
     *
     * 用 triggerEvent 冒泡而不是 selectComponent：
     * selectComponent 只能选中**自己的后代**，而三个内容组件是它的兄弟
     * （分别挂在各自的 swiper-item 里），选不到。
     * 内容组件在 attached 时上报自己的引用，父组件记下来即可。
     */
    notifyShown(index: number) {
      const comp = (this as any)._components?.[index];
      if (comp && typeof comp.onShown === 'function') {
        comp.onShown();
      }
    },

    /** 内容组件上报自己的引用（供刷新时调用） */
    onChildReady(e: any) {
      const index = e.detail && e.detail.index;
      if (typeof index !== 'number') return;
      const map = (this as any)._components || ((this as any)._components = {});
      map[index] = e.detail.instance;
    }
  }
});
