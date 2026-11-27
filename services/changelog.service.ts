// 更新日志：版本数据 + 「NEW 小标」的读写
//
// 设计约束（本地优先原则）：版本数据是内置常量，不拉云端。
// 发新版本 = 在 CHANGELOG 数组头部加一个条目（最新在最前）。
//
// NEW 小标逻辑：与 meta.lastSeenVersion 比对——
// 不相等说明有用户没看过的版本，设置页入口显示 NEW；
// 用户点进日志页后写入 lastSeenVersion，小标消失。
import { StorageAdapter } from '../repositories/storage.adapter';

export interface ChangelogSection {
  /** 分组名：新增 / 优化 / 修复 */
  title: string;
  items: string[];
}

export interface ChangelogEntry {
  /** 版本号，如 'v1.2.1' */
  ver: string;
  /** 发布日期（YYYY-MM-DD） */
  date: string;
  sections: ChangelogSection[];
}

/** 最新版本在数组最前，页面按此渲染「最新」标签 */
export const CHANGELOG: ChangelogEntry[] = [
  {
    ver: 'v1.2.1',
    date: '2026-11-19',
    sections: [
      {
        title: '新增',
        items: [
          '界面皮肤：极简线稿 / 杂志封面 / 深色运动，可在设置中一键切换',
          '统计页分类环形图与图例支持双向联动，点图例即可高亮对应扇区'
        ]
      },
      {
        title: '优化',
        items: [
          '深色界面下的文字对比度与底栏配色',
          '统计分享图全新设计，三种视觉风格 × 精简/详细两种模式'
        ]
      },
      {
        title: '修复',
        items: ['部分界面文字在深色皮肤下看不清的问题', '若干稳定性问题']
      }
    ]
  },
  {
    ver: 'v1.2.0',
    date: '2026-11-18',
    sections: [
      {
        title: '新增',
        items: [
          '概览页：保养提醒、今年花费、最近记录、出行成本一页看全',
          '多车管理与置顶主车',
          '统计页生成分享图，可发送给朋友或保存',
          '保养到期提醒开关，可在设置中关闭'
        ]
      },
      {
        title: '优化',
        items: [
          '设置页与底部导航栏全新改版',
          '保养超期提醒红色高亮，与概览页一致',
          '记录表单交互与校验优化',
          '图标体系升级，支持自定义图标裁剪'
        ]
      }
    ]
  },
  {
    ver: 'v1.1.0',
    date: '2026-11-05',
    sections: [
      {
        title: '新增',
        items: [
          '保养项管理与保养到期提醒',
          '数据导入导出，本地备份与换机迁移',
          '回收站：删除的数据可恢复'
        ]
      }
    ]
  },
  {
    ver: 'v1.0.0',
    date: '2026-10-28',
    sections: [
      {
        title: '首个版本',
        items: [
          '加油 / 充电 / 保养 / 维修 / 支出五类记录',
          '油耗与每公里成本自动计算',
          '纯本地存储，无会员、无广告'
        ]
      }
    ]
  }
];

/** 最新版本号；空数据（理论上不会）时返回空串，NEW 小标随之隐藏 */
export function getLatestChangelogVersion(): string {
  return CHANGELOG[0]?.ver ?? '';
}

/**
 * 是否有用户没看过的版本。
 *
 * 不比对「是否存在更新的版本」而比对「上次看过的版本号是否等于最新」：
 * 这样降级安装（1.2.1 → 1.2.0）不会误显示 NEW。
 */
export function hasUnseenChangelog(storage: StorageAdapter): boolean {
  const latest = getLatestChangelogVersion();
  if (!latest) return false;
  const meta = storage.getMeta<{ lastSeenVersion?: string }>();
  return meta.lastSeenVersion !== latest;
}

/**
 * 记录「用户已看过该版本日志」。
 *
 * meta 里已有 schemaVersion，必须展开合并而不是整体覆盖，
 * 否则会把迁移版本号抹掉、下次启动重跑一遍迁移。
 */
export function markChangelogSeen(storage: StorageAdapter): void {
  const latest = getLatestChangelogVersion();
  if (!latest) return;
  const meta = storage.getMeta<Record<string, unknown>>();
  if (meta.lastSeenVersion === latest) return;
  storage.setMeta({ ...meta, lastSeenVersion: latest });
}
