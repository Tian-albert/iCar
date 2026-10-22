// 数据导入导出（.icar JSON 备份/恢复，支持粘贴 + 选文件）
import { getStorage } from '../../store/index';
import { exportBundle, importBundle } from '../../services/io.service';

Page({
  data: {
    jsonText: ''
  },
  onExport() {
    const json = exportBundle(getStorage());
    wx.setClipboardData({
      data: json,
      success: () => wx.showToast({ title: '已复制到剪贴板，请粘贴保存', icon: 'none' })
    });
  },
  onChooseFile() {
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['json'],
      success: res => {
        const file = res.tempFiles[0];
        wx.getFileSystemManager().readFile({
          filePath: file.path,
          encoding: 'utf-8',
          success: r => {
            this.setData({ jsonText: r.data as string });
            this.doImport(r.data as string);
          },
          fail: () => wx.showToast({ title: '读取文件失败', icon: 'none' })
        });
      }
    });
  },
  onInput(e: WechatMiniprogram.TextareaInput) {
    this.setData({ jsonText: e.detail.value });
  },
  onImport() {
    this.doImport(this.data.jsonText);
  },
  doImport(json: string) {
    const text = (json || '').trim();
    if (!text) {
      wx.showToast({ title: '请先粘贴或选择备份数据', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '导入数据',
      content: '将合并到现有数据（相同记录按更新时间较新者覆盖），确定导入吗？',
      confirmColor: '#3B6FF6',
      success: res => {
        if (!res.confirm) return;
        const result = importBundle(getStorage(), text);
        if (result.ok) {
          wx.showToast({
            title: `导入成功：新增${result.added} 更新${result.updated} 跳过${result.skipped}`,
            icon: 'none'
          });
        } else {
          wx.showToast({ title: result.message || '导入失败', icon: 'none' });
        }
      }
    });
  }
});
