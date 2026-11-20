// AI SKILL 分包：镜像一致性 + 官方限额 + 契约对齐
//
// 三类容易静默失效的问题：
// ① 主包 domain 改了、`skills/icar/lib` 没同步 → AI 算出的数字和 App 不一致；
// ② mcp.json 里声明的接口名与 index.ts 注册的不一致 → 模型能"看到"却调不到；
// ③ 超过官方体积限额（AGENTS.md 10KB / SKILL.md 16KB / mcp.json 24KB / page-meta 8KB）
//    → 上传或运行时被截断，且不会有明确报错。
const fsx = require('fs') as any;
const pathx = require('path') as any;
const BufferCtor: any = require('buffer').Buffer;

function read(rel: string): string {
  return fsx.readFileSync(rel, 'utf-8');
}

function bytes(text: string): number {
  return BufferCtor.byteLength(text, 'utf8');
}

function exists(rel: string): boolean {
  return fsx.existsSync(rel);
}

/** 需要与主包保持逐字节一致的镜像文件（与 scripts/sync-skill-lib.js 的 FILES 对应） */
const MIRRORED = [
  'types/models.ts',
  'utils/number.ts',
  'utils/date.ts',
  'utils/id.ts',
  'domain/fuel.service.ts',
  'domain/stats.service.ts',
  'domain/maintain.service.ts'
];

describe('SKILL 数据层镜像一致性（skills-src，TS 源）', () => {
  it.each(MIRRORED)('%s 与主包逐字节一致', rel => {
    const source = read(rel);
    const copy = read(`skills-src/icar/lib/${rel}`);
    expect(copy).toBe(source);
  });

  it('镜像目录里没有多余文件（避免同步脚本漏删）', () => {
    const dirs = ['types', 'utils', 'domain'];
    const actual: string[] = [];
    for (const d of dirs) {
      const dir = pathx.join('skills-src/icar/lib', d);
      for (const name of fsx.readdirSync(dir)) {
        actual.push(`${d}/${name}`);
      }
    }
    expect(actual.sort()).toEqual(MIRRORED.slice().sort());
  });
});

describe('编译产物（skills/icar 下必须是纯 JS）', () => {
  const RUNTIME_JS = [
    'skills/icar/index.js',
    'skills/icar/apis/queryStats.js',
    'skills/icar/apis/queryMaintain.js',
    'skills/icar/apis/addCost.js',
    'skills/icar/lib/store.js'
  ];

  it('运行时文件全部存在，且没有任何 .ts 残留（真机会把 .ts 当 JS 加载并报 Invalid token）', () => {
    for (const f of RUNTIME_JS) {
      expect(fsx.existsSync(f)).toBe(true);
    }
    const tsFiles = walkTs('skills');
    expect(tsFiles).toEqual([]);
  });

  function walkTs(dir: string): string[] {
    const out: string[] = [];
    if (!fsx.existsSync(dir)) return out;
    for (const e of fsx.readdirSync(dir, { withFileTypes: true })) {
      const full = `${dir}/${e.name}`;
      if (e.isDirectory()) out.push(...walkTs(full));
      else if (e.name.endsWith('.ts')) out.push(full);
    }
    return out;
  }

  it('产物头部是合法 CommonJS（不是 TS 原文）', () => {
    for (const f of RUNTIME_JS) {
      const src = read(f);
      expect(src).toContain('"use strict"');
      expect(src).not.toMatch(/^\s*import\s|\binterface\s+\w+\s*\{/);
    }
  });
});

describe('官方体积限额', () => {
  it('AGENTS.md ≤ 10000 字节', () => {
    expect(bytes(read('AGENTS.md'))).toBeLessThanOrEqual(10000);
  });

  it('SKILL.md ≤ 16000 字节', () => {
    expect(bytes(read('skills/icar/SKILL.md'))).toBeLessThanOrEqual(16000);
  });

  it('mcp.json ≤ 24000 字节（剔除 outputSchema 与空白后计算）', () => {
    const json = JSON.parse(read('skills/icar/mcp.json'));
    for (const api of json.apis) delete api.outputSchema;
    const compact = JSON.stringify(json).replace(/\s+/g, '');
    expect(bytes(compact)).toBeLessThanOrEqual(24000);
  });

  it('page-meta.json ≤ 8000 字节', () => {
    expect(bytes(read('agent/page-meta.json'))).toBeLessThanOrEqual(8000);
  });
});

describe('契约对齐：mcp.json ↔ index.ts ↔ app.json', () => {
  const mcp = JSON.parse(read('skills/icar/mcp.json'));
  // TS 源在 skills-src；产物在 skills（契约测试校验源码，产物另由冒烟脚本守护）
  const indexSrc = read('skills-src/icar/index.ts');
  const appJson = JSON.parse(read('app.json'));

  it('声明的接口名与注册的接口名完全一致', () => {
    const declared = mcp.apis.map((a: any) => a.name).sort();
    // ES2017 lib 没有 matchAll，用 match + 字符串裁剪
    const registered = (indexSrc.match(/registerAPI\('[^']+'/g) || [])
      .map(s => s.replace("registerAPI('", '').replace("'", ''))
      .sort();
    expect(registered).toEqual(declared);
    expect(declared).toEqual(['addCost', 'queryMaintain', 'queryStats']);
  });

  it('每个接口都有 name / description / inputSchema（对象）', () => {
    for (const api of mcp.apis) {
      expect(typeof api.name).toBe('string');
      expect(api.description.length).toBeGreaterThan(10);
      expect(api.inputSchema.type).toBe('object');
    }
  });

  it('page-link 字段必须配同级 x-link-text-field，且指向 string 字段', () => {
    for (const api of mcp.apis) {
      const props = api.outputSchema && api.outputSchema.properties;
      if (!props) continue;
      for (const [key, schema] of Object.entries<any>(props)) {
        if (schema.format !== 'page-link') continue;
        expect(schema.type).toBe('string');
        const textField = schema['x-link-text-field'];
        expect(typeof textField).toBe('string');
        expect(props[textField]).toBeTruthy();
        expect(props[textField].type).toBe('string');
        expect(key).not.toBe(textField);
      }
    }
  });

  it('app.json 的 skill path 与 createSkill 的入参一致', () => {
    const skill = appJson.agent.skills[0];
    expect(skill.path).toBe('skills/icar');
    // index.ts 用常量 SKILL_PATH 传入，两者必须同值
    expect(indexSrc).toContain(`const SKILL_PATH = '${skill.path}'`);
    expect(indexSrc).toContain('createSkill(SKILL_PATH)');
  });

  it('app.json 配了独立分包与按需注入', () => {
    expect(appJson.lazyCodeLoading).toBe('requiredComponents');
    const pkg = appJson.subPackages.find((p: any) => p.root === 'skills');
    expect(pkg).toBeTruthy();
    expect(pkg.independent).toBe(true);
  });

  it('app.json 引用的 AGENTS.md / page-meta.json 都真实存在', () => {
    expect(exists(appJson.agent.instruction)).toBe(true);
    expect(exists(appJson.agent.pageMetadata)).toBe(true);
  });
});

describe('原子接口的边界行为', () => {
  const addCostSrc = read('skills-src/icar/apis/addCost.ts');
  const queryStatsSrc = read('skills-src/icar/apis/queryStats.ts');

  it('addCost 金额非法时先追问，不默认成 0 元', () => {
    expect(addCostSrc).toContain('缺少有效金额');
    expect(addCostSrc).toContain('amount <= 0');
  });

  it('addCost 写库后回读确认，再宣布成功', () => {
    expect(addCostSrc).toContain("list<Cost>('costs')");
    expect(addCostSrc).toContain('写入本地存储失败');
  });

  it('queryStats 复用主包 buildStats，而不是本地重写公式', () => {
    expect(queryStatsSrc).toContain('buildStats');
    expect(queryStatsSrc).not.toMatch(/costs\.reduce|amount\s*\//);
  });
});
