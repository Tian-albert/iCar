// 账号卡片（服务直达）页面元数据校验
//
// 官方规则：账号卡片用于「**没有合适原子接口**时，按页面元数据引导进小程序」。
// 也就是说——页面没写进 page-meta.json，这类意图就没有卡片可用，评测里会直接记
// 「未配置帐号卡片」。上一轮 24 次失败里很大一部分是这么来的：新建的
// pages/summary、pages/maintain-all 根本没登记，描述也还是功能视角。
//
// 这些断言把「新增页面要登记」「描述要写清用户会怎么问」变成硬约束。
const fsx = require('fs') as any;
const BufferCtor: any = require('buffer').Buffer;

const META_PATH = 'agent/page-meta.json';

function readJson(rel: string): any {
  return JSON.parse(fsx.readFileSync(rel, 'utf-8'));
}

/** 首页、车辆、设置是 tabBar 三栏，任何用户都可能落到这儿 */
const MUST_HAVE = [
  'pages/reminder/index', // 概览
  'pages/index/index', // 我的车辆
  'pages/summary/index', // 数据总览（全车按年/按月）
  'pages/statistics/index', // 单车统计
  'pages/vehicle-detail/index', // 车辆详情
  'pages/maintain-all/index', // 全车保养
  'pages/entry/index', // 记一笔
  'pages/records/index', // 全部记录
  'pages/user/index', // 设置
  'pages/data-transfer/index', // 导入导出
  'pages/recycle-bin/index' // 回收站
];

describe('page-meta.json 结构', () => {
  const meta = readJson(META_PATH);
  const appJson = readJson('app.json');

  it('合法 JSON 且不超过 8000 字节（官方上限）', () => {
    const bytes = BufferCtor.byteLength(fsx.readFileSync(META_PATH, 'utf-8'), 'utf8');
    expect(bytes).toBeLessThanOrEqual(8000);
  });

  it('每个 path 都真实存在于 app.json，且不带前导斜杠', () => {
    for (const p of meta.pages) {
      expect(p.path.startsWith('/')).toBe(false);
      expect(appJson.pages).toContain(p.path);
    }
  });

  it('name / description 都不为空，描述要写成用户能看懂的一句话', () => {
    for (const p of meta.pages) {
      expect(typeof p.name).toBe('string');
      expect(p.name.length).toBeGreaterThan(1);
      expect(typeof p.description).toBe('string');
      // 太短的描述匹配不到意图（模型只看这段文字做判断）
      expect(p.description.length).toBeGreaterThan(15);
      // 必须含中文：英文描述在这套场景里没有召回价值
      expect(/[\u4e00-\u9fa5]/.test(p.description)).toBe(true);
    }
  });

  it('query 必须是 object 型 JSON-Schema，required 必须出现在 properties 里', () => {
    for (const p of meta.pages) {
      if (!p.query) continue;
      expect(p.query.type).toBe('object');
      expect(typeof p.query.properties).toBe('object');
      for (const key of p.query.required || []) {
        expect(p.query.properties[key]).toBeTruthy();
      }
    }
  });
});

describe('page-meta.json 覆盖面', () => {
  const meta = readJson(META_PATH);
  const paths: string[] = meta.pages.map((p: any) => p.path);

  it('关键页面全部登记（新增页面忘了登记＝该场景没有卡片可用）', () => {
    for (const p of MUST_HAVE) {
      expect(paths).toContain(p);
    }
  });

  it('没有重复登记同一页面', () => {
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('数据总览支持按年/按月/全部三个维度（否则「某月花了多少」无处可落）', () => {
    const summary = meta.pages.find((p: any) => p.path === 'pages/summary/index');
    expect(summary).toBeTruthy();
    expect(summary.query.properties.rangeType).toBeTruthy();
    expect(summary.query.properties.year).toBeTruthy();
    expect(summary.query.properties.month).toBeTruthy();
    // 三个参数都有默认值，不能设成必填，否则卡片永远生成不出来
    expect(summary.query.required || []).toEqual([]);
  });

  it('描述里点到用户会说的词，而不是只写功能名', () => {
    const byPath = (p: string) => meta.pages.find((x: any) => x.path === p).description;
    // 「该保养了吗」「有没有超期的」这类问法要能落到全车保养页
    expect(byPath('pages/maintain-all/index')).toContain('超期');
    // 「今年/这个月/每公里」要能落到数据总览
    const summary = byPath('pages/summary/index');
    expect(summary).toContain('每公里');
    expect(summary).toContain('月');
    // 换机迁移是高频疑问，必须能被召回
    expect(byPath('pages/data-transfer/index')).toContain('换手机');
  });
});
