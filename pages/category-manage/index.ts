// 支出类别管理：预设（显示开关）+ 自定义（显示开关 + 编辑/删除）+ 图标可更换
import { getStorage } from '../../store/index';
import {
  listCategories,
  addCategory,
  updateCategory,
  removeCategory,
  setCategoryVisible,
  setCategoryIcon
} from '../../services/cost.service';
import { iconEmoji, isImageIcon } from '../../utils/icons';

interface CatView {
  sourceId: string;
  name: string;
  icon: string;
  emoji: string;
  isImage: boolean;
  isPreset: boolean;
  visible: boolean;
}

Page({
  data: {
    presets: [] as CatView[],
    customs: [] as CatView[],
    pickerShow: false,
    pickingId: ''
  },
  onShow() {
    this.load();
  },
  load() {
    const storage = getStorage();
    const view = listCategories(storage).map(c => ({
      sourceId: c.sourceId,
      name: c.name,
      icon: c.icon,
      emoji: iconEmoji(c.icon),
      isImage: isImageIcon(c.icon),
      isPreset: c.isPreset,
      visible: c.visible !== false
    }));
    this.setData({
      presets: view.filter(v => v.isPreset),
      customs: view.filter(v => !v.isPreset)
    });
  },
  onPickIcon(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    this.setData({ pickingId: id, pickerShow: true });
  },
  onIconSelect(e: WechatMiniprogram.CustomEvent) {
    const icon = e.detail.icon as string;
    setCategoryIcon(getStorage(), this.data.pickingId, icon);
    this.setData({ pickerShow: false });
    this.load();
  },
  onPickerClose() {
    this.setData({ pickerShow: false });
  },
  onToggleVisible(e: WechatMiniprogram.SwitchChange) {
    const id = e.currentTarget.dataset.id as string;
    setCategoryVisible(getStorage(), id, e.detail.value);
    this.load();
  },
  onAdd() {
    wx.showModal({
      title: '添加类别',
      editable: true,
      placeholderText: '类别名称',
      success: res => {
        if (res.confirm && res.content && res.content.trim()) {
          addCategory(getStorage(), res.content.trim(), '🧾');
          this.load();
        }
      }
    });
  },
  onEdit(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    const name = e.currentTarget.dataset.name as string;
    wx.showModal({
      title: '编辑类别',
      editable: true,
      content: name,
      success: res => {
        if (res.confirm && res.content && res.content.trim()) {
          updateCategory(getStorage(), id, res.content.trim(), '🧾');
          this.load();
        }
      }
    });
  },
  onDelete(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    const name = e.currentTarget.dataset.name as string;
    wx.showModal({
      title: '删除类别',
      content: `确定删除「${name}」吗？`,
      confirmColor: '#F5474F',
      success: res => {
        if (res.confirm) {
          const r = removeCategory(getStorage(), id);
          if (!r.ok) {
            wx.showToast({ title: r.message || '删除失败', icon: 'none' });
          }
          this.load();
        }
      }
    });
  }
});
