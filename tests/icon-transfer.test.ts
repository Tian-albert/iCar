// 自定义图标随备份迁移：勾选时打包为 base64，导入时写回沙盒；
// 未勾选或写回失败时清空 icon，让 UI 回落 emoji 而不是裂图。
import { StorageAdapter, StorageLike } from '../repositories/storage.adapter';
import { seedPresetCategories } from '../repositories/seed';
import { createCar } from '../services/car.service';
import { exportBundle, importBundle, ICON_EXPORT_MAX_CHARS } from '../services/io.service';
import { addCategory, listCategories } from '../services/cost.service';

// 项目未引入 @types/node，这里显式声明以便挂载 wx 桩
declare const global: any;

function createMemoryStorage(): StorageLike {
  const map = new Map<string, unknown>();
  return {
    get: k => map.get(k),
    set: (k, v) => { map.set(k, v); },
    remove: k => { map.delete(k); },
    keys: () => [...map.keys()]
  };
}

const DATA = '/data';
const ICON = 'icon-1699999999999.png';
const ICON_PATH = `${DATA}/${ICON}`;
const ICON_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

let files: Map<string, string>;

beforeEach(() => {
  files = new Map();
  const fsMock = {
    readdirSync: () => [...files.keys()].map(k => k.replace(`${DATA}/`, '')),
    readFileSync: (p: string) => {
      const v = files.get(p);
      if (v === undefined) throw new Error('ENOENT');
      return v;
    },
    writeFileSync: (p: string, data: string) => { files.set(p, data); },
    accessSync: (p: string) => {
      if (!files.has(p)) throw new Error('ENOENT');
    },
    unlinkSync: (p: string) => { files.delete(p); }
  };
  (global as any).wx = {
    env: { USER_DATA_PATH: DATA },
    getFileSystemManager: () => fsMock
  };
});

afterEach(() => {
  delete (global as any).wx;
});

/** 造一个带自定义图标类别的库 */
function buildWithIcon(customIconPath: string) {
  const a = new StorageAdapter(createMemoryStorage());
  seedPresetCategories(a);
  createCar(a, { name: '车', mileages: 100, initDate: Date.now(), energyType: 'fuel' });
  addCategory(a, '带图类别', customIconPath);
  return a;
}

describe('导出：是否打包图标', () => {
  it('默认不打包，imageMode 为 file', () => {
    files.set(ICON_PATH, ICON_B64);
    const a = buildWithIcon(ICON_PATH);

    const manifest = JSON.parse(exportBundle(a));
    expect(manifest.icons).toBeUndefined();
    expect(manifest.options.imageMode).toBe('file');
  });

  it('勾选后把图标读成 base64 放进 icons，imageMode 为 base64', () => {
    files.set(ICON_PATH, ICON_B64);
    const a = buildWithIcon(ICON_PATH);

    const manifest = JSON.parse(exportBundle(a, { includeIcons: true }));
    expect(manifest.options.imageMode).toBe('base64');
    expect(manifest.icons[ICON]).toBe(ICON_B64);
  });

  it('图标文件读不出来时跳过，不影响导出', () => {
    const a = buildWithIcon(ICON_PATH); // 沙盒里没有这个文件
    const manifest = JSON.parse(exportBundle(a, { includeIcons: true }));
    expect(manifest.icons).toBeUndefined();
    expect(manifest.options.imageMode).toBe('file');
  });

  it('图标体积超限时明确报错，而不是静默丢弃', () => {
    files.set(ICON_PATH, 'x'.repeat(ICON_EXPORT_MAX_CHARS + 10));
    const a = buildWithIcon(ICON_PATH);

    expect(() => exportBundle(a, { includeIcons: true })).toThrow(/图标过多/);
  });
});

describe('导入：图标还原与回落', () => {
  it('备份带了图标，导入后写回沙盒并保留路径', () => {
    files.set(ICON_PATH, ICON_B64);
    const bundle = exportBundle(buildWithIcon(ICON_PATH), { includeIcons: true });

    const b = new StorageAdapter(createMemoryStorage());
    seedPresetCategories(b);
    files.clear(); // 模拟换机：本机没有这个文件

    importBundle(b, bundle, 'replace');

    const cat = listCategories(b).find(c => c.name === '带图类别')!;
    expect(cat.icon).toBe(ICON_PATH);
    expect(files.get(ICON_PATH)).toBe(ICON_B64);
  });

  it('备份没带图标、本机也没有文件：清空 icon 回落 emoji', () => {
    files.set(ICON_PATH, ICON_B64);
    const bundle = exportBundle(buildWithIcon(ICON_PATH)); // 不带图标

    const b = new StorageAdapter(createMemoryStorage());
    seedPresetCategories(b);
    files.clear();

    importBundle(b, bundle, 'replace');

    const cat = listCategories(b).find(c => c.name === '带图类别')!;
    // 留着原路径只会显示裂图，清空后 displayIcon('') 回落 📌
    expect(cat.icon).toBe('');
  });

  it('备份没带图标但本机文件仍在：保留本地路径（同机合并不误伤）', () => {
    files.set(ICON_PATH, ICON_B64);
    const bundle = exportBundle(buildWithIcon(ICON_PATH));

    const b = buildWithIcon(ICON_PATH);
    importBundle(b, bundle, 'merge');

    const cat = listCategories(b).find(c => c.name === '带图类别')!;
    expect(cat.icon).toBe(ICON_PATH);
  });

  it('emoji 图标不受影响', () => {
    const a = new StorageAdapter(createMemoryStorage());
    seedPresetCategories(a);
    const bundle = exportBundle(a);

    const b = new StorageAdapter(createMemoryStorage());
    seedPresetCategories(b);
    importBundle(b, bundle, 'merge');

    const cat = listCategories(b).find(c => c.name === '停车')!;
    expect(cat.icon).toBe('p'); // 仍是 emoji 键，未被清空
  });
});

describe('导出页开关', () => {
  const wxml: string = require('fs').readFileSync(
    'pages/data-transfer/index.wxml',
    'utf-8'
  );
  const ts: string = require('fs').readFileSync('pages/data-transfer/index.ts', 'utf-8');

  it('提供「包含自定义图标」开关', () => {
    expect(wxml).toContain('包含自定义图标');
    expect(wxml).toContain('bindchange="onToggleIcons"');
  });

  it('两个导出入口都带上图标选项', () => {
    expect(ts).toContain('includeIcons: this.data.includeIcons');
    expect((ts.match(/this\.buildBundle\(\)/g) || []).length).toBe(2);
  });
});
