// 图标选择器弹层：分组预设 emoji + 自定义上传（走裁剪页）
import { ICON_GROUPS } from '../../utils/icons';
import { ensurePrivacyAuthorize } from '../../utils/privacy';

Component({
  properties: {
    show: { type: Boolean, value: false }
  },
  data: {
    groups: ICON_GROUPS,
    /** 当前分栏 */
    activeKey: ICON_GROUPS[0].key,
    /** 当前分栏的图标列表（由 activeKey 派生） */
    icons: ICON_GROUPS[0].icons
  },
  methods: {
    noop() {},

    onClose() {
      this.triggerEvent('close');
    },

    /** 切分栏：图标扩到 50+ 后单屏平铺会变成一堵墙，必须分组 */
    onTab(e: WechatMiniprogram.TouchEvent) {
      const key = e.currentTarget.dataset.key as string;
      const group = ICON_GROUPS.filter(g => g.key === key)[0];
      if (!group) return;
      this.setData({ activeKey: group.key, icons: group.icons });
    },

    onSelect(e: WechatMiniprogram.TouchEvent) {
      const icon = e.currentTarget.dataset.icon as string;
      this.triggerEvent('select', { icon });
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
                // 裁剪页回传的是已落到沙盒的路径
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
