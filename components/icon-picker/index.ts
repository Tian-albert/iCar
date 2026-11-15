// 图标选择器弹层：分组预设 emoji + 自定义上传（走裁剪页）
import { ICON_GROUPS, IconGroup } from '../../utils/icons';
import { ensurePrivacyAuthorize } from '../../utils/privacy';
import { getStorage } from '../../store/index';
import {
  addCustomIcon,
  listCustomIconPaths,
  removeCustomIcon
} from '../../services/custom-icon.service';

/** 末尾追加的「自定义」分栏 key */
const CUSTOM_KEY = 'custom';

interface TabItem {
  key: string;
  label: string;
}

Component({
  properties: {
    show: { type: Boolean, value: false }
  },
  data: {
    tabs: [] as TabItem[],
    /** 当前分栏 */
    activeKey: '',
    /** 当前分栏的预设 emoji 列表 */
    icons: [] as string[],
    /** 自定义分栏的图片路径列表 */
    customIcons: [] as string[],
    /** 是否处于自定义分栏 */
    isCustomTab: false
  },

  lifetimes: {
    // 刻意不用 observers：observers 在首次属性注入时就会触发，
    // 此处只需在挂载时读一次登记表，切换分栏时再刷新即可。
    attached() {
      const tabs: TabItem[] = ICON_GROUPS.map((g: IconGroup) => ({
        key: g.key,
        label: g.label
      }));
      tabs.push({ key: CUSTOM_KEY, label: '自定义' });

      const first = ICON_GROUPS[0];
      // 始终默认停在第一个预设分栏：一打开就跳到「自定义」会让人找不到预设图标
      this.setData({
        tabs,
        activeKey: first.key,
        icons: first.icons,
        isCustomTab: false,
        customIcons: this.loadCustomIcons()
      });
    }
  },

  methods: {
    noop() {},

    loadCustomIcons(): string[] {
      try {
        return listCustomIconPaths(getStorage());
      } catch (e) {
        return [];
      }
    },

    onClose() {
      this.triggerEvent('close');
    },

    /** 切分栏 */
    onTab(e: WechatMiniprogram.TouchEvent) {
      const key = e.currentTarget.dataset.key as string;
      if (key === CUSTOM_KEY) {
        this.setData({
          activeKey: CUSTOM_KEY,
          icons: [],
          isCustomTab: true,
          // 每次进入都刷新：用户可能刚删掉或新增过
          customIcons: this.loadCustomIcons()
        });
        return;
      }

      const group = ICON_GROUPS.filter(g => g.key === key)[0];
      if (!group) return;
      this.setData({
        activeKey: group.key,
        icons: group.icons,
        isCustomTab: false
      });
    },

    onSelect(e: WechatMiniprogram.TouchEvent) {
      const icon = e.currentTarget.dataset.icon as string;
      this.triggerEvent('select', { icon });
    },

    /** 长按自定义图标：删除（图标库会越攒越多，必须留出口） */
    onLongPressCustom(e: WechatMiniprogram.TouchEvent) {
      const path = e.currentTarget.dataset.icon as string;
      wx.showModal({
        title: '删除这个图标？',
        content: '已使用该图标的车辆/类别会变回默认图标。',
        confirmText: '删除',
        confirmColor: '#F5474F',
        success: res => {
          if (!res.confirm) return;
          try {
            removeCustomIcon(getStorage(), path);
          } catch (err) {
            // 登记表异常不应阻塞交互
          }
          this.setData({ customIcons: this.loadCustomIcons() });
        }
      });
    },

    /**
     * 自定义图标：先选图，再进裁剪页。
     * 不做裁剪的话，一张 4000×3000 的照片会被原样存下来，
     * 而图标实际只按 20~30px 渲染——既占存储又拖慢列表。
     */
    async onCustom() {
      const ok = await ensurePrivacyAuthorize();
      if (!ok) {
        wx.showToast({ title: '同意隐私协议后才能选择图片', icon: 'none' });
        return;
      }

      wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType: ['album', 'camera'],
        sizeType: ['compressed'],
        success: res => {
          const temp = res.tempFiles[0].tempFilePath;
          wx.navigateTo({
            url: `/pages/icon-crop/index?src=${encodeURIComponent(temp)}`,
            events: {
              cropped: (path: string) => {
                // 裁剪页回传的是已落到沙盒的路径：先登记进图标库，再回传给表单
                try {
                  addCustomIcon(getStorage(), path);
                } catch (e) {
                  // 登记失败仍让用户用上这次裁剪结果
                }
                this.setData({
                  customIcons: this.loadCustomIcons(),
                  activeKey: CUSTOM_KEY,
                  icons: [],
                  isCustomTab: true
                });
                this.triggerEvent('select', { icon: path });
              }
            },
            fail: () => wx.showToast({ title: '无法打开裁剪页', icon: 'none' })
          });
        },
        // 用户取消选择不提示，避免误以为出错
        fail: () => {}
      });
    }
  }
});
