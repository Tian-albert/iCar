#!/usr/bin/env node
/**
 * 评测集自检：按官方《评测工具》1.4.1 的检测项，在本地先过一遍。
 *
 * 官方检测在评测工具里做（上传后自动跑），但这个脚本能提前发现「提交时才发现」的硬性不合格，
 * 避免来回改文件重传。
 *
 * 用法：node scripts/check-eval-cases.js [文件路径]
 * 默认：docs/ai-eval/eval-cases.json
 */
const fs = require('fs');
const path = require('path');

const FILE = process.argv[2] || path.join(__dirname, '..', 'docs', 'ai-eval', 'eval-cases.json');

let json;
try {
  json = JSON.parse(fs.readFileSync(FILE, 'utf8'));
} catch (e) {
  console.error(`FAIL: 评测文件不是合法 JSON —— ${e.message}`);
  process.exit(1);
}

const cases = Array.isArray(json.cases) ? json.cases : [];
const errors = [];
const warn = [];

const ALLOWED_TAGS = ['unregistered', 'location', 'time', 'negative', 'private_data', 'product_service'];
const tagOf = c => c.tags || [];
const has = (c, t) => tagOf(c).includes(t);

const negative = cases.filter(c => has(c, 'negative'));
const unregistered = cases.filter(c => has(c, 'unregistered'));
const positive = cases.filter(c => !has(c, 'negative') && !has(c, 'unregistered'));

// 1. Intent 数量：微信评测 50~100，正例 40~92，负例 8~10
if (cases.length < 50 || cases.length > 100) {
  errors.push(`Intent 总数 ${cases.length}，要求 50~100`);
}
if (positive.length < 40 || positive.length > 92) {
  errors.push(`正例 ${positive.length}，要求 40~92`);
}
if (negative.length < 8 || negative.length > 10) {
  errors.push(`负例 ${negative.length}，要求 8~10`);
}

// 2. tags 取值必须合法；unregistered 必须再带 private_data / product_service 之一
for (const c of cases) {
  for (const t of tagOf(c)) {
    if (!ALLOWED_TAGS.includes(t)) errors.push(`非法 tag「${t}」：${c.intent}`);
  }
  if (has(c, 'unregistered')) {
    const typed = has(c, 'private_data') || has(c, 'product_service');
    if (!typed) errors.push(`未注册用例缺少类型标签：${c.intent}`);
    if (has(c, 'private_data') && has(c, 'product_service')) {
      errors.push(`未注册用例只能选一种类型：${c.intent}`);
    }
  }
  if (!c.intent || typeof c.intent !== 'string' || c.intent.trim().length < 4) {
    errors.push(`intent 为空或过短：${JSON.stringify(c)}`);
  }
}

// 3. 未注册场景：涉及私有数据需 1 条 private_data + 1 条 product_service
const hasPrivate = unregistered.some(c => has(c, 'private_data'));
const hasService = unregistered.some(c => has(c, 'product_service'));
if (!hasPrivate) errors.push('缺少 private_data 类型的未注册用例');
if (!hasService) errors.push('缺少 product_service 类型的未注册用例');
if (unregistered.length > 2) warn.push(`未注册用例 ${unregistered.length} 条，官方上限 2 条`);

// 4. 原子接口覆盖度 ≥85%（按关键词粗判，官方由模型判定）
const API_HINTS = {
  queryCars: /几辆车|哪些车|车库|有纯电|是混动/,
  queryStats: /花了多少|花费|每公里|油耗|电耗|跑了多少公里|油费|支出|成本/,
  queryMaintain: /保养|机油|滤芯|轮胎/,
  addCost: /记一笔|记一下|记上|补记|补录|停车\s*\d|洗车\s*\d|高速费/,
  addRefuel: /加满|加了|加油|充电|升|度/
};
const covered = Object.keys(API_HINTS).filter(api =>
  positive.some(c => API_HINTS[api].test(c.intent))
);
const coverage = covered.length / Object.keys(API_HINTS).length;
if (coverage < 0.85) {
  const missing = Object.keys(API_HINTS).filter(a => !covered.includes(a));
  errors.push(`原子接口覆盖度 ${(coverage * 100).toFixed(0)}%（要求 ≥85%），未覆盖：${missing.join('、')}`);
}

// 5. 复杂用例 ≥30%：粗判为「同一句里含 2 个以上子句/条件」
const complex = positive.filter(c => {
  const t = c.intent;
  const clauses = (t.match(/[，,。；;]/g) || []).length;
  const multiAsk = /分别|各|顺便|另外|和.*比|比.*多|和.*少|然后/.test(t);
  return clauses >= 1 || multiAsk;
});
const complexRatio = complex.length / positive.length;
if (complexRatio < 0.3) {
  errors.push(`复杂用例占比 ${(complexRatio * 100).toFixed(0)}%，要求 ≥30%`);
}

// 6. 时间标签：≥4 条
const timeTagged = cases.filter(c => has(c, 'time'));
if (timeTagged.length < 4) {
  warn.push(`时间标签仅 ${timeTagged.length} 条（若平台判定需要，要求 ≥4 条且覆盖 8 类表达）`);
}

// 7. 用例多样性：同一「数字/车名」重复率
const amounts = positive
  .map(c => (c.intent.match(/\d+(?:\.\d+)?/g) || []).join(','))
  .filter(Boolean);
const counter = {};
for (const a of amounts) for (const n of a.split(',')) counter[n] = (counter[n] || 0) + 1;
const maxRepeat = Math.max(0, ...Object.values(counter));

// ---- 输出 ----
console.log(`文件：${path.relative(process.cwd(), FILE)}`);
console.log(`总数 ${cases.length}　正例 ${positive.length}　负例 ${negative.length}　未注册 ${unregistered.length}`);
console.log(`接口覆盖 ${covered.length}/${Object.keys(API_HINTS).length}（${(coverage * 100).toFixed(0)}%）：${covered.join(', ')}`);
console.log(`复杂用例 ${complex.length}（${(complexRatio * 100).toFixed(0)}%）`);
console.log(`时间标签 ${timeTagged.length} 条　数字最大重复 ${maxRepeat} 次`);
if (maxRepeat > Math.max(2, Math.ceil(positive.length * 0.05))) {
  warn.push(`某数字重复 ${maxRepeat} 次，可能触发多样性检测（同一实体应 < 5% 正例数）`);
}

if (warn.length) {
  console.log('\n提示：');
  for (const w of warn) console.log(`  ! ${w}`);
}
if (errors.length) {
  console.log('\n未通过：');
  for (const e of errors) console.log(`  x ${e}`);
  process.exit(1);
}
console.log('\n本地自检通过（官方检测以上传后的工具结果为准）');
