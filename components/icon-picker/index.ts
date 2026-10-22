// 图标选择器弹层：预设 emoji + 自定义上传图片
import { PRESET_ICONS } from '../../utils/icons';

Component({
  properties: {
    show: { type: Boolean, value: false }
  },
  data: {
    icons: PRESET_ICONS
  },
  methods: {
    noop() {},
    onClose() {
      this.triggerEvent('close');
    },
    onSelect(e: WechatMiniprogram.TouchEvent) {
      const icon = e.currentTarget.dataset.icon as string;
      this.triggerEvent('select', { icon });
    },
    onCustom() {
      wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        success: res => {
          const temp = res.tempFiles[0].tempFilePath;
          const ext = temp.includes('.') ? temp.slice(temp.lastIndexOf('.')) : '.png';
          const dest = `${wx.env.USER_DATA_PATH}/icon-${Date.now()}${ext}`;
          try {
            wx.getFileSystemManager().copyFileSync(temp, dest);
            this.triggerEvent('select', { icon: dest });
          } catch (e) {
            this.triggerEvent('select', { icon: temp });
          }
        }
      });
    }
  }
});
