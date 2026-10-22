// 微信存储绑定：把 wx.getStorageSync 等适配为 StorageLike（仅小程序运行时使用）
import { StorageLike } from './storage.adapter';

export function createWxStorageLike(): StorageLike {
  return {
    get: (key: string) => wx.getStorageSync(key),
    set: (key: string, value: unknown) => wx.setStorageSync(key, value),
    remove: (key: string) => wx.removeStorageSync(key),
    keys: () => wx.getStorageInfoSync().keys
  };
}
