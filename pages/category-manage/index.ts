// 支出类别管理：图标可更换、显示开关、长按右侧手柄拖动排序
import { getStorage } from '../../store/index';
import {
  listCategories,
  addCategory,
  updateCategory,
  removeCategory,
  setCategoryVisible,
  setCategoryIcon,
  moveCategory
} from '../../services/cost.service';
import { iconEmoji, isImageIcon } from '../../utils/icons';

/** 单行高度（rpx），与 .row 的 min-height 保持一致 */
const ROW_HEIGHT_RPX = 108;

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
    pickingId: '',
    dragging: false,
    dragId: ''
  },
  onLoad() {
    // 行高换算（rpx → px），用于拖动时计算跨越了几行
    try {
      const info = wx.getSystemInfoSync();
      (this as any).rowHeightPx = (ROW_HEIGHT_RPX / 750) * info.windowWidth;
    } catch (e) {
      (this as any).rowHeightPx = 54;
    }
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
  /** 手指按下手柄：记录起始 Y */
  onHandleTouchStart(e: WechatMiniprogram.TouchEvent) {
    (this as any).dragStartY = e.touches[0].clientY;
  },
  /** 长按手柄：进入拖动排序态 */
  onDragStart(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    this.setData({ dragging: true, dragId: id });
    wx.vibrateShort({ type: 'light' });
  },
  /** 拖动中：按垂直位移换算跨越行数，实时上下移动 */
  onDragMove(e: WechatMiniprogram.TouchEvent) {
    if (!this.data.dragging) return;
    const self = this as any;
    const rowH: number = self.rowHeightPx || 54;
    const startY: number = self.dragStartY ?? e.touches[0].clientY;
    const steps = Math.round((e.touches[0].clientY - startY) / rowH);
    if (steps === 0) return;

    const dir: 'up' | 'down' = steps > 0 ? 'down' : 'up';
    const id = this.data.dragId;
    let moved = false;
    for (let i = 0; i < Math.abs(steps); i++) {
      if (moveCategory(getStorage(), id, dir)) moved = true;
    }
    // 仅在真正移动后推进基准，避免拖到顶/底时基准漂移
    if (moved) {
      self.dragStartY = startY + steps * rowH;
      this.load();
    }
  },
  /** 抬手：退出拖动态 */
  onDragEnd() {
    if (!this.data.dragging) return;
    this.setData({ dragging: false, dragId: '' });
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
