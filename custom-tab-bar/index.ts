// 自定义底部栏：悬浮胶囊 + 液态毛玻璃
//
// 形态参考 iOS 的浮动工具栏：整条脱离屏幕底部，圆角胶囊，
// 四周有留白，背景用 backdrop-filter 模糊下层内容。
//
// 图标不用 emoji：emoji 是彩色字形，无法换色、无法做线性/实心双态，
// 基线在不同机型上也不一致。这里用手绘 SVG 的 base64 data URI
// （小程序 WXML 不支持内联 <svg>）。
import { TAB_ICONS_LINE, TAB_ICONS_FILL } from '../utils/tab-icons';
import { TAB_ICONS_LINE_DARK, TAB_ICONS_FILL_DARK } from '../utils/tab-icons-dark';
import { TAB_ICONS_FILL_WARM } from '../utils/tab-icons-warm';
import { getSkin } from '../utils/skin';
import { SkinKey } from '../types/models';

interface TabItem {
  pagePath: string;
  text: string;
  /** 图标键，对应 TAB_ICONS_* 的 key */
  icon: string;
}

/**
 * 按皮肤取图标集。
 *
 * - A 极简线稿：主图标文件（描边 #6B7486 / 实心品牌蓝）
 * - B 杂志封面：强调色是陶土红，实心态换成暖色版，避免蓝图标配棕红文字
 * - C 深色运动：深底上 #6B7486 对比度仅约 2.6:1，整套换成提亮版
 *
 * 拆成两个附属文件，是为了让主文件 tab-icons.ts 仍满足 8KB 的体积约束。
 */
function iconsFor(skin: SkinKey): { lineIcons: Record<string, string>; fillIcons: Record<string, string> } {
  if (skin === 'c') {
    return { lineIcons: TAB_ICONS_LINE_DARK, fillIcons: TAB_ICONS_FILL_DARK };
  }
  if (skin === 'b') {
    return { lineIcons: TAB_ICONS_LINE, fillIcons: TAB_ICONS_FILL_WARM };
  }
  return { lineIcons: TAB_ICONS_LINE, fillIcons: TAB_ICONS_FILL };
}

Component({
  data: {
    selected: 0,
    /** 当前皮肤，决定底栏底色与图标集 */
    skin: 'a' as SkinKey,
    list: [
      // 该页已由「保养」改为全局「概览」面板（保养提醒作为其中一个区块）
      { pagePath: '/pages/reminder/index', text: '概览', icon: 'overview' },
      { pagePath: '/pages/index/index', text: '车辆', icon: 'car' },
      // 文案改「设置」：本页已无账号体系，只有本机设置与数据管理入口。
      // 图标用齿轮（不再是「用户」语义），仍保持与其他两个图标同一套描边规范。
      { pagePath: '/pages/user/index', text: '设置', icon: 'gear' }
    ] as TabItem[],
    // WXML 里不能直接引用 import 的常量，必须经 data 传入
    lineIcons: TAB_ICONS_LINE,
    fillIcons: TAB_ICONS_FILL
  },
  lifetimes: {
    attached() {
      this.refreshSkin();
    }
  },
  pageLifetimes: {
    // 用户可能在设置页切换皮肤后切回，宿主页面每次显示都要重新对齐
    show() {
      this.refreshSkin();
    }
  },
  methods: {
    /** 同步皮肤：底色走 CSS 类，图标集走 data */
    refreshSkin() {
      const skin = getSkin();
      if (this.data.skin === skin) return;
      const icons = iconsFor(skin);
      this.setData({ skin, lineIcons: icons.lineIcons, fillIcons: icons.fillIcons });
    },
    switchTab(e: WechatMiniprogram.TouchEvent) {
      const path = e.currentTarget.dataset.path as string;
      const index = Number(e.currentTarget.dataset.index);
      if (!path) return;
      wx.switchTab({ url: path });
      this.setData({ selected: index });
    }
  }
});
