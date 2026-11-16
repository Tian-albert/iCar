// 备份不打包图标：恢复时把本机无法还原的自定义图标换成对应的预设图标。
//
// 背景：实体 icon 存的是本机沙盒路径，导出的是 JSON 不含文件。换机后这些路径
// 必然失效；留着只会裂图，所以导入时按表换成预设图标（车 🚗 / 类别 🧾 / 保养项 🔧）。
import { StorageAdapter, StorageLike } from '../repositories/storage.adapter';
import { seedPresetCategories } from '../repositories/seed';
import { createCar, getCar } from '../services/car.service';
import { exportBundle, importBundle } from '../services/io.service';
import { addCategory, listCategories } from '../services/cost.service';
import { listMaintains, ensureMaintainTemplates } from '../services/maintain-record.service';

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

let files: Set<string>;

beforeEach(() => {
  files = new Set();
  const fsMock = {
    readdirSync: () => [...files].map(p => p.replace(`${DATA}/`, '')),
    readFileSync: (p: string) => {
      if (!files.has(p)) throw new Error('ENOENT');
      return 'x';
    },
    writeFileSync: (p: string) => { files.add(p); },
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

/** 造一个带自定义图标的库（车辆 / 类别 / 保养项各一） */
function buildWithIcon() {
  const a = new StorageAdapter(createMemoryStorage());
  seedPresetCategories(a);

  const car = createCar(a, {
    name: '车',
    mileages: 100,
    initDate: Date.now(),
    energyType: 'fuel'
  });
  // 直接改 icon 字段模拟用户换过自定义图标
  const stored = a.get<any>('cars', car.sourceId)!;
  stored.icon = ICON_PATH;
  a.update('cars', stored);

  addCategory(a, '带图类别', ICON_PATH);
  ensureMaintainTemplates(a, car.sourceId);
  const item = listMaintains(a, car.sourceId)[0];
  item.icon = ICON_PATH;
  a.update('maintains', item);

  return a;
}

describe('导出不打包图标', () => {
  it('备份里没有 icons 字段，imageMode 恒为 file', () => {
    files.add(ICON_PATH);
    const manifest = JSON.parse(exportBundle(buildWithIcon()));

    expect(manifest.icons).toBeUndefined();
    expect(manifest.options.imageMode).toBe('file');
  });

  it('导出内容不含任何 base64 图标数据（体积可控）', () => {
    files.add(ICON_PATH);
    const json = exportBundle(buildWithIcon());
    expect(json).not.toContain('iVBORw0KGgo'); // PNG base64 头
  });
});

describe('导入：自定义图标换成预设图标', () => {
  it('换机后（本机无文件）按实体类型换成预设图标', () => {
    const bundle = exportBundle(buildWithIcon());

    const b = new StorageAdapter(createMemoryStorage());
    seedPresetCategories(b);
    importBundle(b, bundle, 'replace');

    // 车 🚗 / 类别 🧾 / 保养项 🔧 —— 而不是统一 📌
    const car = b.list<any>('cars').filter(c => !c.deleted)[0];
    expect(car.icon).toBe('🚗');

    const cat = listCategories(b).find(c => c.name === '带图类别')!;
    expect(cat.icon).toBe('🧾');

    const item = b.list<any>('maintains').filter(m => !m.deleted)[0];
    expect(item.icon).toBe('🔧');
  });

  it('不会再留下本机失效路径（否则界面裂图）', () => {
    const bundle = exportBundle(buildWithIcon());
    const b = new StorageAdapter(createMemoryStorage());
    seedPresetCategories(b);
    importBundle(b, bundle, 'replace');

    for (const table of ['cars', 'categories', 'maintains']) {
      for (const e of b.list<any>(table).filter(x => !x.deleted)) {
        expect(e.icon).not.toContain('icon-');
      }
    }
  });

  it('本机已有同一文件时继续用本地路径（同机合并不误伤）', () => {
    files.add(ICON_PATH);
    const bundle = exportBundle(buildWithIcon());

    const b = buildWithIcon();
    importBundle(b, bundle, 'merge');

    const cat = listCategories(b).find(c => c.name === '带图类别')!;
    expect(cat.icon).toBe(ICON_PATH);
  });

  it('emoji 类图标原样保留，不被替换', () => {
    const a = new StorageAdapter(createMemoryStorage());
    seedPresetCategories(a);
    const bundle = exportBundle(a);

    const b = new StorageAdapter(createMemoryStorage());
    seedPresetCategories(b);
    importBundle(b, bundle, 'merge');

    expect(listCategories(b).find(c => c.name === '停车')!.icon).toBe('p');
  });

  it('原本就没有图标的实体补上预设图标，不留空', () => {
    const a = new StorageAdapter(createMemoryStorage());
    seedPresetCategories(a);
    const bundle = exportBundle(a);

    const b = new StorageAdapter(createMemoryStorage());
    seedPresetCategories(b);
    importBundle(b, bundle, 'merge');

    // 自定义类别若原本 icon 为空，导入后应拿到 🧾
    addCategory(b, '空图标类别', '');
    const b2 = new StorageAdapter(createMemoryStorage());
    seedPresetCategories(b2);
    importBundle(b2, exportBundle(b), 'replace');
    const restored = listCategories(b2).find(c => c.name === '空图标类别')!;
    expect(restored.icon).toBe('🧾');
  });
});

describe('导出页不再有图标开关', () => {
  const wxml: string = require('fs').readFileSync(
    'pages/data-transfer/index.wxml',
    'utf-8'
  );
  const ts: string = require('fs').readFileSync('pages/data-transfer/index.ts', 'utf-8');

  it('页面说明图标不会被导出', () => {
    expect(wxml).toContain('自定义图标不会被导出');
    expect(wxml).not.toContain('包含自定义图标');
  });

  it('导出调用不再传选项', () => {
    expect(ts).not.toContain('includeIcons');
    expect((ts.match(/exportBundle\(getStorage\(\)\)/g) || []).length).toBe(2);
  });
});
