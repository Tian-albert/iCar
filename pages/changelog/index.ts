// 更新日志页
//
// 版本数据来自 services/changelog.service.ts 的内置常量（本地优先，不拉云端）。
// 打开本页即视为「已看过最新版本」：meta.lastSeenVersion 写入后，
// 设置页「更新日志」入口的 NEW 小标消失。
import { getStorage } from '../../store/index';
import { CHANGELOG, markChangelogSeen } from '../../services/changelog.service';

Page({
  data: {
    log: CHANGELOG
  },
  onShow() {
    // 放在 onShow 而不是 onLoad：冒烟测试等环境里 onShow 时的存储才是就绪的，
    // 与其他页面「onShow 里读 storage」的惯例一致。
    markChangelogSeen(getStorage());
  }
});
