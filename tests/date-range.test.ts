// 模糊时间 → 具体区间
//
// 评测里同一句「这两天」有时算 2 天、有时 3 天，回答看着像答非所问。
// 这里把口径固定下来（2026-11-27 为基准日）：
//   这两天 2 天 / 前两天 3 天 / 这几天 7 天 / 前阵子 30 天
import { resolveVagueRange } from '../domain/date-range';

/** 基准日固定为 2026-11-27 15:00，避免测试随时钟漂移 */
const NOW = new Date(2026, 10, 27, 15, 0, 0).getTime();

function days(text: string): number {
  const r = resolveVagueRange(text, NOW);
  return r ? r.days : -1;
}

describe('resolveVagueRange 口径表', () => {
  it('单日：今天 / 昨天 / 前天', () => {
    expect(days('今天')).toBe(1);
    expect(days('昨天')).toBe(1);
    expect(days('前天')).toBe(1);
    expect(resolveVagueRange('前天', NOW)!.label).toContain('2026-11-25');
  });

  it('这两天 = 2 天，前两天 = 3 天，这几天 = 7 天', () => {
    expect(days('这两天')).toBe(2);
    expect(days('前两天')).toBe(3);
    expect(days('这几天')).toBe(7);
    expect(days('这些天')).toBe(7);
  });

  it('这半个月 = 14 天，前阵子 / 这段时间 = 30 天', () => {
    expect(days('最近半个月')).toBe(14);
    expect(days('前阵子')).toBe(30);
    expect(days('这段时间')).toBe(30);
    expect(days('前些天')).toBe(30);
  });

  it('区间末端钳到今天（不把未来算进来）', () => {
    const r = resolveVagueRange('这两天', NOW)!;
    const endDay = new Date(r.end).getDate();
    expect(endDay).toBe(27);
    expect(new Date(r.end).getMonth()).toBe(10);
  });

  it('label 里写明共几天，供回答回显', () => {
    expect(resolveVagueRange('这两天', NOW)!.label).toContain('共 2 天');
    expect(resolveVagueRange('前两天', NOW)!.label).toContain('共 3 天');
  });

  it('节假日走固定区间', () => {
    const gq = resolveVagueRange('国庆那几天', NOW)!;
    expect(new Date(gq.start).getMonth()).toBe(9);
    expect(new Date(gq.start).getDate()).toBe(1);
    expect(gq.days).toBe(7);
  });

  it('识别不了返回 null（调用方退回原区间，不报错）', () => {
    expect(resolveVagueRange('上个世纪', NOW)).toBeNull();
    expect(resolveVagueRange('', NOW)).toBeNull();
  });
});
