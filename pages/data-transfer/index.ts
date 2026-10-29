// 数据导入导出（.icar JSON 备份/恢复，支持粘贴 + 选文件）
import { getStorage } from '../../store/index';
import { exportBundle, importBundle } from '../../services/io.service';
import { ensurePrivacyAuthorize } from '../../utils/privacy';

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
  /** 导出为 .json 文件：写入用户目录后通过文件分享消息发出 */
  onExportFile() {
    const json = exportBundle(getStorage());
    const d = new Date();
    const pad = (n: number) => (n < 10 ? '0' + n : '' + n);
    const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
    const fileName = `iCar-backup-${stamp}.json`;
    const filePath = `${wx.env.USER_DATA_PATH}/${fileName}`;
    try {
      wx.getFileSystemManager().writeFileSync(filePath, json, 'utf-8');
    } catch (e) {
      wx.showToast({ title: '生成文件失败', icon: 'none' });
      return;
    }
    wx.shareFileMessage({
      filePath,
      fileName,
      success: () => wx.showToast({ title: '已生成，请选择会话发送', icon: 'none' }),
      fail: () => wx.showToast({ title: '分享失败，请改用复制方式', icon: 'none' })
    });
  },
  async onChooseFile() {
    const ok = await ensurePrivacyAuthorize();
    if (!ok) {
      wx.showToast({ title: '同意隐私协议后才能选择文件', icon: 'none' });
      return;
    }
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
      },
      fail: () => wx.showToast({ title: '未选择文件', icon: 'none' })
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
