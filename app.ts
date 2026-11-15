// iCar 应用入口
import { getStorage } from './store/index';
import { cleanupOrphanIcons } from './utils/icon-store';

App<IAppOption>({
  onLaunch() {
    // 初始化存储：schema 迁移 + 预设类别种子 + 索引对账
    const storage = getStorage();

    // 清理不再被引用的自定义图标文件。
    // 必须延后执行：文件系统扫描会拖慢启动，而启动耗时直接影响首屏。
    setTimeout(() => {
      cleanupOrphanIcons(storage);
    }, 2000);
  },
  globalData: {}
});
