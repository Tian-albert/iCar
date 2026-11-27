#!/usr/bin/env node
/**
 * 把主包的纯逻辑层镜像到 AI SKILL 的 TS 源目录（skills-src/icar/lib）。
 *
 * 为什么需要这一步：SKILL 必须放在 independent 分包里，而独立分包按微信分包规则
 * 不依赖主包（这正是"主包没加载时 AI 也能调起它"的前提），所以 `services/` /
 * `domain/` 不能被 SKILL `require`。
 *
 * 做法：**按目录结构原样镜像**，不重写任何 import —— 只要相对路径的相对关系不变，
 * `../types/models`、`./fuel.service` 在副本里仍然成立。
 *
 * 镜像的是 TS 源文件；构建链是：
 *   主包源码 → 本脚本镜像到 skills-src/icar/lib → tsc 产出 JS → skills/icar/**（真机加载）
 *
 * 代价是存在两份代码，因此必须用 `tests/skill-lib-sync.test.ts` 做漂移校验：
 * 源文件改了但没同步，测试立刻红。
 *
 * 用法：
 *   node scripts/sync-skill-lib.js          复制（覆盖）
 *   node scripts/sync-skill-lib.js --check  只校验，不一致时退出码 1
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
// TS 源码在 skills-src/icar/lib（构建时经 tsc 产出 JS 到 skills/icar），
// 但镜像校验仍以「与主包源码逐字节一致」为准 —— 同步的是 TS 源文件。
const DEST_ROOT = path.join(ROOT, 'skills-src', 'icar', 'lib');

/** 需要镜像的文件（相对仓库根目录）。新增依赖时必须同步加到这里。 */
const FILES = [
  'types/models.ts',
  'utils/number.ts',
  'utils/date.ts',
  'utils/id.ts',
  'domain/fuel.service.ts',
  'domain/stats.service.ts',
  'domain/maintain.service.ts',
  'domain/date-range.ts'
];

const checkOnly = process.argv.includes('--check');
const drift = [];
let copied = 0;

for (const rel of FILES) {
  const src = path.join(ROOT, rel);
  const dest = path.join(DEST_ROOT, rel);

  if (!fs.existsSync(src)) {
    console.error(`[sync-skill-lib] 源文件不存在：${rel}`);
    process.exit(1);
  }

  const srcText = fs.readFileSync(src, 'utf8');
  const destText = fs.existsSync(dest) ? fs.readFileSync(dest, 'utf8') : null;

  if (srcText === destText) continue;

  if (checkOnly) {
    drift.push(rel);
    continue;
  }

  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, srcText, 'utf8');
  copied++;
  console.log(`[sync-skill-lib] 已同步 ${rel}`);
}

if (checkOnly) {
  if (drift.length) {
    console.error('[sync-skill-lib] 以下文件与主包不一致，请运行 npm run sync:skill：');
    for (const f of drift) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log('[sync-skill-lib] 全部一致');
} else {
  console.log(`[sync-skill-lib] 完成，更新 ${copied} 个文件`);
}
