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

// 3. 未注册场景：**平台按小程序能力动态判定是否要求**（车记本实测：不要求）。
//    若平台判定需要，规则是 1 条 private_data + 1 条 product_service、上限 2 条。
//    这里只做一致性检查，不作为硬性失败——以评测工具的实际检测结果为准。
if (unregistered.length) {
  const hasPrivate = unregistered.some(c => has(c, 'private_data'));
  const hasService = unregistered.some(c => has(c, 'product_service'));
  if (hasPrivate !== hasService) {
    errors.push('未注册用例必须同时包含 private_data 与 product_service 各一条');
  }
  if (unregistered.length > 2) warn.push(`未注册用例 ${unregistered.length} 条，官方上限 2 条`);
} else {
  warn.push('当前无未注册用例；若平台检测判定需要（涉及私有数据），需补 1 条 private_data + 1 条 product_service');
}

// 4. 原子接口覆盖度 ≥85%（按关键词粗判，官方由模型判定）
const API_HINTS = {
  queryCars: /几辆车|哪些车|车库|有纯电|是混动/,
  queryStats: /花了多少|花费|每公里|油耗|电耗|跑了多少公里|油费|支出|成本/,
  queryMaintain: /该保养|保养吗|还剩多少|超期|要保养/,
  queryRecords: /记录|都记了|明细|记过什么/,
  addCost: /记一笔|记一下|记上|补记|补录|停车\s*\d|洗车\s*\d|高速费/,
  addRefuel: /加满|加了|加油|充电|升|度/,
  addMaintain: /记一次保养|换了|做了.*保养|保养花了/,
  addCar: /加一辆|新增一辆|提了一辆|又买了.*车/,
  updateCar: /改名|改成|改一下|修改/,
  queryExpiring: /到期|过期|年检|保险.*(什么时候|到期)/,
  queryCarDetail: /买了多久|服役|档案|这辆车.*(情况|信息)/,
  queryFaq: /备份|换手机|恢复|会丢|怎么用|使用说明/
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

// 6. 时间标签：≥4 条，且要覆盖平台判定的 8 类时间语义
//
// 平台检测说明里明确列了这 8 类（实测因「尚缺 模糊时段（7/8）」被驳回）：
// 基准参照 / 偏移量 / 节假日相关 / 完整日期 / 星期 / 时刻 / 组合 / 模糊时段
const TIME_CATEGORIES = {
  基准参照: /今天|昨天|前天|明天|本周/,
  偏移量: /上个月|下个月|去年|前年|明年|半个月|这一年|这一年下来|最近一年/,
  节假日相关: /国庆|春节|中秋|五一|元旦|清明|端午/,
  完整日期: /\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*[日号]/,
  星期: /周[一二三四五六日天]|星期[一二三四五六日天]/,
  时刻: /\d{1,2}\s*点|上午|下午|晚上|早上/,
  模糊时段: /前阵子|前段时间|前些天|前几天|这两天|这阵子|那会儿|月初|月底|年底|最近(?!.*(半个月|一年))/
};

function timeCatsOf(intent) {
  const hit = Object.keys(TIME_CATEGORIES).filter(k => TIME_CATEGORIES[k].test(intent));
  // 组合：同一句里出现 ≥2 类时间表达（如「上周五下午 3 点」）
  if (hit.length >= 2) hit.push('组合');
  return hit;
}

const timeTagged = cases.filter(c => has(c, 'time'));
if (timeTagged.length < 4) {
  warn.push(`时间标签仅 ${timeTagged.length} 条（若平台判定需要，要求 ≥4 条且覆盖 8 类表达）`);
}

const coveredCats = new Set();
for (const c of timeTagged) {
  for (const k of timeCatsOf(c.intent)) coveredCats.add(k);
}
const ALL_TIME_CATS = Object.keys(TIME_CATEGORIES).concat('组合');
const missingCats = ALL_TIME_CATS.filter(k => !coveredCats.has(k));
if (missingCats.length) {
  errors.push(
    `时间语义覆盖 ${ALL_TIME_CATS.length - missingCats.length}/8，尚缺：${missingCats.join('、')}` +
      `（平台会以同样口径驳回）`
  );
}

// 7. 用例多样性：同一「数字/车名」重复率
const amounts = positive
  // 紧贴字母的数字是车型名（小鹏 P7、唐 DM-i），不是数据实体；
  // 用后向断言排除，否则 P7 会被当成「数字 7 重复 6 次」误报
  .map(c => (c.intent.match(/(?<![A-Za-z])\d+(?:\.\d+)?/g) || []).join(','))
  .filter(Boolean);
const counter = {};
for (const a of amounts) for (const n of a.split(',')) counter[n] = (counter[n] || 0) + 1;
const maxRepeat = Math.max(0, ...Object.values(counter));

// ---- 输出 ----
console.log(`文件：${path.relative(process.cwd(), FILE)}`);
console.log(`总数 ${cases.length}　正例 ${positive.length}　负例 ${negative.length}　未注册 ${unregistered.length}`);
console.log(`接口覆盖 ${covered.length}/${Object.keys(API_HINTS).length}（${(coverage * 100).toFixed(0)}%）：${covered.join(', ')}`);
console.log(`复杂用例 ${complex.length}（${(complexRatio * 100).toFixed(0)}%）`);
console.log(
  `时间标签 ${timeTagged.length} 条　语义覆盖 ${ALL_TIME_CATS.filter(k => coveredCats.has(k)).length}/8` +
    `（${ALL_TIME_CATS.filter(k => coveredCats.has(k)).join('、')}）　数字最大重复 ${maxRepeat} 次`
);
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
