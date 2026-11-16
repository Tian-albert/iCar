// 数据备份：导出为文件 / 从文件恢复
//
// 只保留文件方式。复制粘贴已移除——JSON 动辄几十上百 KB，剪贴板既容易截断，
// 用户也很难可靠地保存与再次找到，文件是更稳的载体。
import { getStorage } from '../../store/index';
import { exportBundle, importBundle } from '../../services/io.service';
import { ensurePrivacyAuthorize } from '../../utils/privacy';

/** 备份文件名前缀与后缀 */
const FILE_PREFIX = 'iCar-backup-';
const FILE_EXT = 'json';

/** 是否在微信开发者工具中（shareFileMessage 在此环境不可用） */
function isDevTools(): boolean {
  try {
    const info = wx.getSystemInfoSync();
    return info.platform === 'devtools';
  } catch (e) {
    return false;
  }
}

Page({
  data: {
    /** 最近一次导出生成的文件路径，供「保存到手机」使用 */
    lastFilePath: '',
    lastFileName: ''
  },

  /**
   * 导出为文件并调起分享。
   *
   * 注意：wx.shareFileMessage 只在真机可用，开发者工具会直接 fail，
   * 因此这里先做环境与能力判断，避免用户看到莫名其妙的「分享失败」。
   */
  onExportFile() {
    if (isDevTools()) {
      wx.showModal({
        title: '请在真机上导出',
        content:
          '微信开发者工具不支持文件分享接口，请用手机预览（或上传体验版）后再导出备份。',
        showCancel: false
      });
      return;
    }

    if (!wx.canIUse('shareFileMessage')) {
      wx.showModal({
        title: '微信版本过低',
        content: '当前微信版本不支持文件分享，请升级微信后重试。',
        showCancel: false
      });
      return;
    }

    let json: string;
    try {
      json = exportBundle(getStorage());
    } catch (e) {
      wx.showToast({ title: '生成备份失败，请重试', icon: 'none' });
      return;
    }

    const d = new Date();
    const pad = (n: number) => (n < 10 ? '0' + n : '' + n);
    const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(
      d.getHours()
    )}${pad(d.getMinutes())}`;
    const fileName = `${FILE_PREFIX}${stamp}.${FILE_EXT}`;
    const filePath = `${wx.env.USER_DATA_PATH}/${fileName}`;

    try {
      const fs = wx.getFileSystemManager();
      fs.writeFileSync(filePath, json, 'utf-8');
      // 分享前确认文件真的写成功了，否则只会在 shareFileMessage 里拿到模糊的失败
      fs.accessSync(filePath);
    } catch (e) {
      wx.showModal({
        title: '生成文件失败',
        content: '可能是手机存储空间不足，请清理后重试。',
        showCancel: false
      });
      return;
    }

    this.setData({ lastFilePath: filePath, lastFileName: fileName });

    wx.shareFileMessage({
      filePath,
      fileName,
      success: () => {
        wx.showToast({ title: '已发送，建议存到「文件传输助手」', icon: 'none' });
      },
      fail: err => {
        const msg = String((err && (err as any).errMsg) || '');
        // 用户主动取消不算失败，别弹错误
        if (msg.indexOf('cancel') >= 0) return;

        // 分享失败时，至少让用户能把文件留下来（微信的「保存到手机」入口）
        wx.showModal({
          title: '分享未完成',
          content:
            '文件已生成在本机，但没能调起分享。可点击「保存到手机」把文件存下来，再自行发送。',
          confirmText: '保存到手机',
          success: r => {
            if (!r.confirm) return;
            this.saveToAlbum(filePath);
          }
        });
      }
    });
  },

  /** 兜底：把备份文件保存到手机（用户可自行在文件管理里找到并发送） */
  saveToAlbum(filePath: string) {
    if (!filePath) {
      wx.showToast({ title: '请先导出', icon: 'none' });
      return;
    }
    if (!wx.saveFileToDisk) {
      wx.showToast({ title: '当前微信版本不支持保存', icon: 'none' });
      return;
    }
    wx.saveFileToDisk({
      filePath,
      success: () => wx.showToast({ title: '已保存到手机', icon: 'none' }),
      fail: () => wx.showToast({ title: '保存失败', icon: 'none' })
    });
  },

  onSaveToPhone() {
    this.saveToAlbum(this.data.lastFilePath);
  },

  /** 从聊天记录选择备份文件并恢复 */
  async onChooseFile() {
    const ok = await ensurePrivacyAuthorize();
    if (!ok) {
      wx.showToast({ title: '同意隐私协议后才能选择文件', icon: 'none' });
      return;
    }

    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      // 不限定 extension：部分机型转发后后缀可能被改写，
      // 限定过严会让用户「明明选了文件却说没选到」。内容校验由 importBundle 负责。
      success: res => {
        const file = res.tempFiles[0];
        if (!file) return;
        wx.getFileSystemManager().readFile({
          filePath: file.path,
          encoding: 'utf-8',
          success: r => this.doImport(r.data as string),
          fail: () => wx.showToast({ title: '读取文件失败', icon: 'none' })
        });
      },
      // 用户取消不提示
      fail: () => {}
    });
  },

  /** 先让用户选导入方式，再执行 */
  doImport(json: string) {
    const text = (json || '').trim();
    if (!text) {
      wx.showToast({ title: '备份文件为空', icon: 'none' });
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
