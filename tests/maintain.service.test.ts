import { calcRemaining, findLastHandle } from '../domain/maintain.service';
import { sample, sampleCar } from './fixtures/sample';

const TODAY = new Date(2026, 9, 21).getTime(); // 2026-10-21 本地 00:00

function getMaintain(name: string) {
  return sample.maintains.find(m => m.name === name)!;
}

describe('maintain.service 剩余量（样本数据）', () => {
  const lastHandle = findLastHandle(
    getMaintain('机油机滤'),
    sample.maintainLogs,
    sample.maintainHandles
  );

  it('机油机滤（有首保记录 1534km/2026-08-13）→ 剩余 8626km / 291 天', () => {
    const r = calcRemaining(getMaintain('机油机滤'), lastHandle, sampleCar, TODAY);
    expect(r.remainMileage).toBe(8626);
    expect(r.remainDays).toBe(291);
  });

  it('空气滤芯（仅里程周期，无保养记录）→ 剩余 17092km，天数为 null', () => {
    const r = calcRemaining(getMaintain('空气滤芯'), null, sampleCar, TODAY);
    expect(r.remainMileage).toBe(17092);
    expect(r.remainDays).toBeNull();
  });

  it('空调滤芯（20000km/720天，无记录）→ 剩余 17092km / 570 天', () => {
    const r = calcRemaining(getMaintain('空调滤芯'), null, sampleCar, TODAY);
    expect(r.remainMileage).toBe(17092);
    expect(r.remainDays).toBe(570);
  });

  it('无保养记录时基线取 initMileages（非 0 场景）', () => {
    const car = { ...sampleCar, initMileages: 3000, mileages: 2908 };
    const r = calcRemaining(getMaintain('空气滤芯'), null, car, TODAY);
    // 20000 - (2908 - 3000) = 20092
    expect(r.remainMileage).toBe(20092);
  });

  it('进度条 = 剩余比例', () => {
    const r = calcRemaining(getMaintain('空气滤芯'), null, sampleCar, TODAY);
    expect(r.progress).toBeCloseTo(17092 / 20000, 5);
  });

  it('紧急判定：剩余里程 ≤ 500km 或剩余天数 ≤ 15 天', () => {
    const nearMile = { ...sampleCar, mileages: 19550 }; // 空气滤芯 20000 - 19550 = 450 ≤ 500
    expect(calcRemaining(getMaintain('空气滤芯'), null, nearMile, TODAY).urgent).toBe(true);

    const farMile = { ...sampleCar, mileages: 10000 };
    expect(calcRemaining(getMaintain('空气滤芯'), null, farMile, TODAY).urgent).toBe(false);
  });
});
