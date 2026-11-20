// iCar 应用入口
import { getStorage } from './store/index';
import { cleanupOrphanIcons } from './utils/icon-store';
import { installSkinPatch } from './utils/skin';
import { seedDemoDataIfNeeded } from './services/demo-seed.service';

// 必须在任何页面注册前执行：给 Page() 套一层，统一在 onShow 注入皮肤令牌
installSkinPatch();

App<IAppOption>({
  onLaunch() {
    // 初始化存储：schema 迁移 + 预设类别种子 + 索引对账
    const storage = getStorage();

    // 评测 / 体验环境的空库预置演示数据。
    // 三道闸（release 不注入 / 已有车辆不注入 / 已注入过不重复）见 demo-seed.service.ts；
    // 失败只影响演示观感，绝不能拖垮启动。
    try {
      seedDemoDataIfNeeded(storage, wx.getAccountInfoSync().miniProgram.envVersion);
    } catch (e) {
      console.warn('[demo-seed] 注入失败（忽略）', e);
    }

    // 清理不再被引用的自定义图标文件。
    // 必须延后执行：文件系统扫描会拖慢启动，而启动耗时直接影响首屏。
    setTimeout(() => {
      cleanupOrphanIcons(storage);
    }, 2000);
  },
  globalData: {}
});
