// 数据导入导出（.icar JSON 备份/恢复，支持粘贴 + 选文件）
import { getStorage } from '../../store/index';
import { exportBundle, importBundle } from '../../services/io.service';
import { ensurePrivacyAuthorize } from '../../utils/privacy';

Page({
  data: {
    jsonText: '',
    /** 导出时是否把自定义图标一并打包（base64） */
    includeIcons: false
  },
  onToggleIcons(e: WechatMiniprogram.SwitchChange) {
    this.setData({ includeIcons: e.detail.value });
  },
  /** 统一取导出内容，图标体积超限时给出可操作的提示 */
  buildBundle(): string | null {
    try {
      return exportBundle(getStorage(), { includeIcons: this.data.includeIcons });
    } catch (err) {
      wx.showModal({
        title: '导出失败',
        content: (err as Error).message || '生成备份失败，请重试',
        showCancel: false
      });
      return null;
    }
  },
  onExport() {
    const json = this.buildBundle();
    if (json === null) return;
    wx.setClipboardData({
      data: json,
      success: () => wx.showToast({ title: '已复制到剪贴板，请粘贴保存', icon: 'none' })
    });
  },
  /** 导出为 .json 文件：写入用户目录后通过文件分享消息发出 */
  onExportFile() {
    const json = this.buildBundle();
    if (json === null) return;
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
  /** 先让用户选导入方式，再执行 */
  doImport(json: string) {
    const text = (json || '').trim();
    if (!text) {
      wx.showToast({ title: '请先粘贴或选择备份数据', icon: 'none' });
      return;
    }

    wx.showActionSheet({
      itemList: ['合并导入（保留现有数据）', '覆盖导入（清空现有数据）'],
      success: res => {
        if (res.tapIndex === 0) {
          this.runImport(text, 'merge');
          return;
        }
        if (res.tapIndex === 1) {
          // 覆盖不可撤销，必须二次确认
          wx.showModal({
            title: '覆盖导入',
            content:
              '将先清空本机的车辆、记录与类别，再写入备份数据。此操作不可撤销，建议先导出一份当前数据。',
            confirmText: '仍要覆盖',
            confirmColor: '#F5474F',
            success: r => {
              if (r.confirm) this.runImport(text, 'replace');
            }
          });
        }
      },
      // 用户取消选择，不提示
      fail: () => {}
    });
  },
  runImport(json: string, mode: 'merge' | 'replace') {
    wx.showLoading({ title: mode === 'replace' ? '正在覆盖' : '正在合并', mask: true });
    let result: ReturnType<typeof importBundle>;
    try {
      result = importBundle(getStorage(), json, mode);
    } catch {
      wx.hideLoading();
      wx.showToast({ title: '导入失败，数据格式异常', icon: 'none' });
      return;
    }
    wx.hideLoading();

    if (!result.ok) {
      wx.showToast({ title: result.message || '导入失败', icon: 'none' });
      return;
    }
    wx.showToast({
      title:
        mode === 'replace'
          ? `覆盖完成：写入 ${result.added} 条`
          : `合并完成：新增${result.added} 更新${result.updated} 跳过${result.skipped}`,
      icon: 'none'
    });
  }
});
