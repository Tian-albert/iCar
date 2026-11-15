// 图标裁剪几何 + 预设图标集
//
// 裁剪算错的后果是「裁出来有白边」或「裁歪了」，真机上才看得出来。
// 这里用纯函数穷举极端尺寸，把不变式钉死。
import {
  CROP_OUTPUT_SIZE,
  MAX_ZOOM,
  MIN_ZOOM,
  clampOffset,
  clampZoom,
  computeDisplay,
  computeSourceRect,
  coverBaseScale,
  isCroppable,
  zoomAroundCenter,
  CropSource
} from '../utils/image-crop';
import { ICON_GROUPS, PRESET_ICONS, displayIcon, isImageIcon } from '../utils/icons';
import { baseName, buildKeepSet, findOrphans, isManagedIconFile } from '../utils/icon-store';

const VP = 300; // 视口边长（px）

describe('覆盖缩放：必须铺满视口', () => {
  it('横图按高度定基准缩放', () => {
    // 800×400，宽方向需要 0.375，高方向需要 0.75 → 取大者
    expect(coverBaseScale({ width: 800, height: 400 }, VP)).toBeCloseTo(0.75, 6);
  });

  it('竖图按宽度定基准缩放', () => {
    expect(coverBaseScale({ width: 400, height: 800 }, VP)).toBeCloseTo(0.75, 6);
  });

  it('正方形按任一边', () => {
    expect(coverBaseScale({ width: 600, height: 600 }, VP)).toBeCloseTo(0.5, 6);
  });

  it('zoom=1 时显示尺寸两个方向都不小于视口（不留白）', () => {
    const cases: CropSource[] = [
      { width: 800, height: 400 },
      { width: 400, height: 800 },
      { width: 1920, height: 1080 },
      { width: 1, height: 1 }
    ];
    for (const src of cases) {
      const d = computeDisplay(src, VP, 1);
      expect(d.displayW).toBeGreaterThanOrEqual(VP - 1e-6);
      expect(d.displayH).toBeGreaterThanOrEqual(VP - 1e-6);
    }
  });

  it('非法尺寸返回 0，不抛异常', () => {
    expect(coverBaseScale({ width: 0, height: 100 }, VP)).toBe(0);
    expect(coverBaseScale({ width: 100, height: -5 }, VP)).toBe(0);
    expect(coverBaseScale({ width: NaN, height: 100 }, VP)).toBe(0);
    expect(isCroppable({ width: 0, height: 0 })).toBe(false);
    expect(isCroppable({ width: 10, height: 10 })).toBe(true);
  });
});

describe('位移钳制：不许拖出白边', () => {
  it('横向多余空间被限制在 [vp-displayW, 0]', () => {
    const src: CropSource = { width: 800, height: 400 };
    const d = computeDisplay(src, VP, 1);
    const minX = VP - d.displayW;

    const far = clampOffset({ zoom: 1, offsetX: 9999, offsetY: 0 }, src, VP);
    expect(far.offsetX).toBe(0);

    const farNeg = clampOffset({ zoom: 1, offsetX: -9999, offsetY: 0 }, src, VP);
    expect(farNeg.offsetX).toBeCloseTo(minX, 6);

    // 竖向在 zoom=1 时刚好贴合，不能动
    expect(far.offsetY).toBe(0);
  });

  it('输出源矩形始终落在原图范围内（穷举极端长宽比）', () => {
    const sizes: CropSource[] = [
      { width: 12000, height: 300 },
      { width: 300, height: 12000 },
      { width: 4000, height: 3000 },
      { width: 1, height: 1 },
      { width: 1080, height: 1080 }
    ];
    const offsets = [-1e6, -500, -10, 0, 10, 500, 1e6];

    for (const src of sizes) {
      for (const z of [MIN_ZOOM, 1.5, MAX_ZOOM]) {
        for (const ox of offsets) {
          for (const oy of offsets) {
            const r = computeSourceRect({ zoom: z, offsetX: ox, offsetY: oy }, src, VP);
            expect(r.sw).toBeGreaterThan(0);
            expect(r.sh).toBeGreaterThan(0);
            // 不能采到图外，否则会出现透明/黑边
            expect(r.sx).toBeGreaterThanOrEqual(-1e-6);
            expect(r.sy).toBeGreaterThanOrEqual(-1e-6);
            expect(r.sx + r.sw).toBeLessThanOrEqual(src.width + 1e-6);
            expect(r.sy + r.sh).toBeLessThanOrEqual(src.height + 1e-6);
            // 正方形裁剪
            expect(Math.abs(r.sw - r.sh)).toBeLessThan(1e-6);
          }
        }
      }
    }
  });
});

describe('源矩形计算正确性', () => {
  it('横图居中裁剪：取中间的正方形，边长等于原图高度', () => {
    const src: CropSource = { width: 800, height: 400 };
    const d = computeDisplay(src, VP, 1);
    const centered = clampOffset(
      { zoom: 1, offsetX: (VP - d.displayW) / 2, offsetY: (VP - d.displayH) / 2 },
      src,
      VP
    );
    const r = computeSourceRect(centered, src, VP);
    expect(r.sw).toBeCloseTo(400, 6);
    expect(r.sh).toBeCloseTo(400, 6);
    expect(r.sx).toBeCloseTo(200, 6); // 左右各切掉 200
    expect(r.sy).toBeCloseTo(0, 6);
  });

  it('正方形图 zoom=1 取全图', () => {
    const src: CropSource = { width: 400, height: 400 };
    const d = computeDisplay(src, VP, 1);
    const centered = clampOffset(
      { zoom: 1, offsetX: (VP - d.displayW) / 2, offsetY: (VP - d.displayH) / 2 },
      src,
      VP
    );
    const r = computeSourceRect(centered, src, VP);
    expect(r.sx).toBeCloseTo(0, 6);
    expect(r.sy).toBeCloseTo(0, 6);
    expect(r.sw).toBeCloseTo(400, 6);
  });

  it('放大后取样区域变小（确实是「裁得更紧」）', () => {
    const src: CropSource = { width: 800, height: 400 };
    const at1 = computeSourceRect({ zoom: 1, offsetX: -150, offsetY: 0 }, src, VP);
    const at2 = computeSourceRect({ zoom: 2, offsetX: -150, offsetY: 0 }, src, VP);
    expect(at2.sw).toBeLessThan(at1.sw);
    expect(at2.sw).toBeCloseTo(at1.sw / 2, 6);
  });

  it('输出尺寸常量是 256', () => {
    expect(CROP_OUTPUT_SIZE).toBe(256);
  });
});

describe('缩放锚点：双指缩放时画面不往角落跑', () => {
  /** 视口中心对应的源图坐标 */
  function centerInSource(src: CropSource, state: { zoom: number; offsetX: number; offsetY: number }) {
    const safe = clampOffset(state, src, VP);
    const d = computeDisplay(src, VP, safe.zoom);
    const ratio = src.width / d.displayW;
    return {
      x: (VP / 2 - safe.offsetX) * ratio,
      y: (VP / 2 - safe.offsetY) * ratio
    };
  }

  it('放大前后，视口中心仍是同一处内容', () => {
    const src: CropSource = { width: 1200, height: 800 };
    const d = computeDisplay(src, VP, 1);
    const start = clampOffset(
      { zoom: 1, offsetX: (VP - d.displayW) / 2, offsetY: (VP - d.displayH) / 2 },
      src,
      VP
    );
    const before = centerInSource(src, start);
    const after = zoomAroundCenter(start, src, VP, 2.5);
    const afterCenter = centerInSource(src, after);

    expect(afterCenter.x).toBeCloseTo(before.x, 4);
    expect(afterCenter.y).toBeCloseTo(before.y, 4);
  });

  it('zoom 被限制在 [1, MAX_ZOOM]', () => {
    expect(clampZoom(0.2)).toBe(MIN_ZOOM);
    expect(clampZoom(99)).toBe(MAX_ZOOM);
    expect(clampZoom(NaN)).toBe(MIN_ZOOM);
  });

  it('缩小到 1 倍时不会出现空白', () => {
    const src: CropSource = { width: 800, height: 400 };
    const zoomedOut = zoomAroundCenter({ zoom: 3, offsetX: -100, offsetY: -50 }, src, VP, 0.1);
    expect(zoomedOut.zoom).toBe(MIN_ZOOM);
    const d = computeDisplay(src, VP, zoomedOut.zoom);
    expect(d.displayW).toBeGreaterThanOrEqual(VP - 1e-6);
    expect(d.displayH).toBeGreaterThanOrEqual(VP - 1e-6);
  });
});

describe('预设图标集', () => {
  it('分组齐全（占比/支出/车型/其他）', () => {
    const keys = ICON_GROUPS.map(g => g.key);
    expect(keys).toContain('energy');
    expect(keys).toContain('care');
    expect(keys).toContain('fee');
    expect(keys).toContain('car');
    expect(keys).toContain('other');
  });

  it('扁平列表 = 各分组之和，且数量显著多于原来的 20 个', () => {
    const sum = ICON_GROUPS.reduce((n, g) => n + g.icons.length, 0);
    expect(PRESET_ICONS.length).toBe(sum);
    expect(PRESET_ICONS.length).toBeGreaterThan(40);
  });

  it('同一分组内图标不重复（wx:key="*this" 要求唯一）', () => {
    for (const g of ICON_GROUPS) {
      expect(new Set(g.icons).size).toBe(g.icons.length);
    }
  });

  it('覆盖常见的支出场景（洗车 / 贴膜 / 停车 / 保险 / 罚款）', () => {
    // 洗车 🧽、贴膜/玻璃 🪟、停车 🅿️、保险 🛡️、罚单/票据 🧾
    for (const icon of ['🧽', '🪟', '🅿️', '🛡️', '🧾']) {
      expect(PRESET_ICONS).toContain(icon);
    }
  });

  it('覆盖常见车型（轿车 / SUV / MPV / 皮卡 / 跑车 / 摩托）', () => {
    for (const icon of ['🚗', '🚙', '🚐', '🛻', '🏎️', '🏍️']) {
      expect(PRESET_ICONS).toContain(icon);
    }
  });

  it('每个分组都有非空 label 与至少 5 个图标', () => {
    for (const g of ICON_GROUPS) {
      expect(g.label.length).toBeGreaterThan(0);
      expect(g.icons.length).toBeGreaterThanOrEqual(5);
    }
  });
});

describe('自定义图标文件的生命周期', () => {
  const fsx = require('fs') as any;

  it('baseName 同时兼容 / 与 \\', () => {
    expect(baseName('/a/b/icon-1.png')).toBe('icon-1.png');
    expect(baseName('C:\\tmp\\icon-2.png')).toBe('icon-2.png');
    expect(baseName('icon-3.png')).toBe('icon-3.png');
    expect(baseName('')).toBe('');
  });

  it('只认自己命名规则的文件，别的一概不碰', () => {
    expect(isManagedIconFile('icon-1699999999999.png')).toBe(true);
    expect(isManagedIconFile('icon-1.jpg')).toBe(true);
    // 以下都不是本模块生成的，即使看起来像也不删
    expect(isManagedIconFile('logo.png')).toBe(false);
    expect(isManagedIconFile('icon-abc.png')).toBe(false);
    expect(isManagedIconFile('my-icon-1.png')).toBe(false);
    expect(isManagedIconFile('icon-1.png.bak')).toBe(false);
  });

  it('keep 集合只收受管理的文件名，emoji 与外部路径忽略', () => {
    const keep = buildKeepSet([
      '🚗',
      'wxfile://tmp_abc.jpg',
      '/assets/logo.png',
      'wxfile://usr/icon-111.png',
      'wxfile://usr/icon-222.png'
    ]);
    expect(keep).toEqual(['icon-111.png', 'icon-222.png']);
  });

  it('findOrphans 保留被引用的，挑出没被引用的', () => {
    const files = ['icon-1.png', 'icon-2.png', 'icon-3.png', 'logo.png', 'readme.txt'];
    const orphans = findOrphans(files, ['icon-2.png']);
    // logo.png / readme.txt 不在管理范围，不动
    expect(orphans.sort()).toEqual(['icon-1.png', 'icon-3.png']);
  });

  it('全部被引用时不产生孤儿', () => {
    expect(findOrphans(['icon-1.png'], ['icon-1.png'])).toEqual([]);
  });

  it('清理必须用未过滤 deleted 的原始列表（回收站恢复后图标还在用）', () => {
    const src: string = fsx.readFileSync('utils/icon-store.ts', 'utf-8');
    // 用 storage.list 而非 listCars / listCategories / listMaintains
    expect(src).toContain("storage.list<Car>('cars')");
    expect(src).toContain("storage.list<Category>('categories')");
    expect(src).toContain("storage.list<Maintain>('maintains')");
    expect(src).not.toContain('listCars(');
    expect(src).not.toContain('listCategories(');
  });

  it('清理失败不阻塞启动（整体 try/catch 且返回 0）', () => {
    const src: string = fsx.readFileSync('utils/icon-store.ts', 'utf-8');
    expect(src).toMatch(/export function cleanupOrphanIcons[\s\S]*try\s*\{/);
    expect(src).toMatch(/catch[\s\S]{0,120}return 0;/);
  });

  it('启动时延后清理，不拖慢首屏', () => {
    const app: string = fsx.readFileSync('app.ts', 'utf-8');
    expect(app).toContain('cleanupOrphanIcons');
    expect(app).toContain('setTimeout');
  });
});

describe('图标类型判定（沿用既有语义）', () => {
  it('旧标识符仍能映射到 emoji', () => {
    expect(displayIcon('car')).toBe('🚗');
    expect(displayIcon('wash')).toBe('🧼');
    expect(displayIcon('')).toBe('📌');
  });

  it('沙盒路径被认作图片图标', () => {
    expect(isImageIcon('wxfile://tmp_123.png')).toBe(true);
    expect(isImageIcon('/assets/logo.png')).toBe(true);
    expect(isImageIcon('🚗')).toBe(false);
  });
});
