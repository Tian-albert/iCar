// 保存兜底与防重复提交单测（R-09）
import { guardSave, resetSaveGuard } from '../utils/save-guard';

describe('guardSave 防重复提交', () => {
  let toasts: string[] = [];

  beforeEach(() => {
    resetSaveGuard();
    toasts = [];
    (globalThis as any).wx = {
      showToast: ({ title }: { title: string }) => toasts.push(title)
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('节流窗口内的重复调用只执行一次', () => {
    let calls = 0;
    const action = () => {
      calls++;
    };

    expect(guardSave(action)).toBe(true);
    expect(guardSave(action)).toBe(false);
    expect(guardSave(action)).toBe(false);
    expect(calls).toBe(1);
  });

  it('超过节流窗口后可以再次保存', () => {
    let calls = 0;
    const action = () => {
      calls++;
    };
    const nowSpy = jest.spyOn(Date, 'now');
    nowSpy.mockReturnValue(1_000_000);
    expect(guardSave(action)).toBe(true);

    nowSpy.mockReturnValue(1_000_000 + 601);
    expect(guardSave(action)).toBe(true);
    expect(calls).toBe(2);
  });

  it('异常时提示并返回 false，且释放节流窗口允许重试', () => {
    const failing = () => {
      throw new Error('boom');
    };
    expect(guardSave(failing)).toBe(false);
    expect(toasts).toEqual(['保存失败，请检查输入后重试']);

    // 失败后应能立即重试（不被节流挡住）
    let ok = 0;
    expect(guardSave(() => { ok++; })).toBe(true);
    expect(ok).toBe(1);
  });

  it('throttleMs = 0 时不做节流（用于必须连续触发的场景）', () => {
    let calls = 0;
    const action = () => {
      calls++;
    };
    expect(guardSave(action, 0)).toBe(true);
    expect(guardSave(action, 0)).toBe(true);
    expect(calls).toBe(2);
  });
});
