// iCar 应用入口
import { getStorage } from './store/index';

App<IAppOption>({
  onLaunch() {
    // 初始化存储：schema 迁移 + 预设类别种子 + 索引对账
    getStorage();
    console.log('[iCar] onLaunch');
  },
  globalData: {}
});
