// 备份页：只保留「导出文件 / 从文件恢复」，且导出在开发者工具下要给出明确提示。
//
// 背景：wx.shareFileMessage 在微信开发者工具中不可用（必然 fail），
// 且要求基础库 >= 2.16.1。原来直接调用，用户只看到「分享失败」，以为功能坏了。
const fsTransfer = require('fs') as any;

const wxml: string = fsTransfer.readFileSync('pages/data-transfer/index.wxml', 'utf-8');
const ts: string = fsTransfer.readFileSync('pages/data-transfer/index.ts', 'utf-8');
const wxss: string = fsTransfer.readFileSync('pages/data-transfer/index.wxss', 'utf-8');

describe('只保留文件方式', () => {
  it('页面没有「导出并复制」与「粘贴导入」', () => {
    expect(wxml).not.toContain('导出并复制');
    expect(wxml).not.toContain('粘贴导入');
    expect(wxml).not.toContain('textarea');
  });

  it('逻辑里不再有剪贴板与粘贴输入', () => {
    expect(ts).not.toContain('setClipboardData');
    expect(ts).not.toContain('jsonText');
    expect(ts).not.toContain('onInput');
  });

  it('保留导出文件与选择文件恢复两个入口', () => {
    expect(wxml).toContain('导出备份文件');
    expect(wxml).toContain('选择备份文件');
    expect(ts).toContain('shareFileMessage');
    expect(ts).toContain('chooseMessageFile');
  });
});

describe('导出在受限环境下给出可操作提示', () => {
  it('开发者工具中直接提示改用真机，而不是让它 fail', () => {
    expect(ts).toContain('isDevTools');
    expect(ts).toContain('devtools');
    expect(ts).toMatch(/isDevTools\(\)[\s\S]{0,200}showModal/);
  });

  it('低版本微信用 canIUse 兜底', () => {
    expect(ts).toContain("wx.canIUse('shareFileMessage')");
  });

  it('分享前确认文件已写入（accessSync）', () => {
    expect(ts).toContain('accessSync');
    // 必须比对实际调用（wx.shareFileMessage({），否则会命中前面 canIUse 里的同名文本
    const write = ts.indexOf('writeFileSync');
    const share = ts.indexOf('wx.shareFileMessage({');
    expect(write).toBeGreaterThan(0);
    // 写文件之后、调用分享之前，必须有一次 accessSync 校验
    const access = ts.indexOf('accessSync', write);
    expect(access).toBeGreaterThan(write);
    expect(share).toBeGreaterThan(access);
  });

  it('用户取消分享不弹错误', () => {
    expect(ts).toMatch(/indexOf\('cancel'\)/);
  });
});

describe('「保存」按平台分流（saveFileToDisk 仅 PC 端支持）', () => {
  it('检测 PC 端并按平台给不同文案', () => {
    expect(ts).toContain('isPc');
    expect(ts).toContain("info.platform === 'windows'");
    expect(ts).toContain('保存到电脑');
    expect(ts).toContain('再次发送备份');
  });

  it('saveFileToDisk 只在 PC 分支调用，不再作为手机端兜底', () => {
    expect(ts).toContain('saveFileToDisk');
    // 手机端若还调它，必然失败——这正是上一版「保存到手机」报错的原因
    const pcBranch = ts.slice(ts.indexOf('if (this.data.isPc)'));
    const nextFn = pcBranch.indexOf('reshare(');
    expect(nextFn).toBeGreaterThan(0);
    // PC 分支里才有 saveToDisk，手机分支走 reshare
    expect(pcBranch.slice(0, nextFn)).toContain('this.saveToDisk');
  });

  it('手机端走「再次发送」，把文件发到聊天记录', () => {
    expect(ts).toMatch(/reshare\(filePath/);
    expect(ts).toMatch(/reshare\(filePath: string[\s\S]{0,200}shareFileMessage/);
  });

  it('页面不再出现「保存到手机」（该能力在手机上不存在）', () => {
    expect(wxml).not.toContain('保存到手机');
    // 按钮文案是变量，具体值由 TS 按平台给
    expect(wxml).toContain('{{saveLabel}}');
  });

  it('按钮常驻：导出后写入本地记录，重进页面能找回', () => {
    expect(ts).toContain('LAST_FILE_KEY');
    expect(ts).toContain('setStorageSync');
    expect(ts).toContain('getStorageSync');
  });

  it('文件被系统清理时给出明确提示并清空按钮', () => {
    expect(ts).toMatch(/文件已失效/);
    expect(ts).toMatch(/lastFilePath: ''/);
  });

  it('不使用 openDocument 预览（json 不在其类型白名单内）', () => {
    // 官方 fileType 仅支持 doc/docx/xls/xlsx/ppt/pptx/pdf，按 txt 打开会类型报错。
    // 只匹配调用，注释里提到该 API 不算
    expect(ts).not.toMatch(/wx\.openDocument\s*\(/);
  });
});

describe('恢复入口的健壮性', () => {
  it('选文件不限定扩展名（部分机型转发后后缀会被改写）', () => {
    // 限定过严会让用户「明明选了文件却说没选到」
    expect(ts).not.toMatch(/extension:\s*\[/);
  });

  it('恢复仍区分合并与覆盖，覆盖需二次确认', () => {
    expect(ts).toContain("'merge'");
    expect(ts).toContain("'replace'");
    expect(ts).toMatch(/覆盖导入[\s\S]{0,200}仍要覆盖/);
  });
});

describe('样式', () => {
  it('不再有粘贴框相关样式，且无内联 hex', () => {
    expect(wxss).not.toContain('.json-input');
    expect(wxss).not.toMatch(/#[0-9A-Fa-f]{3,8}/);
  });
});
