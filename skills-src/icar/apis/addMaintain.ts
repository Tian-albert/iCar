// 记一次保养（保养项 + 里程 + 费用联动）
//
// 与主包 saveMaintainHandle 同语义，少一步就会长期错账：
//   MaintainHandle（本次保养） → MaintainLog（按保养项各一条关联流水）
//   → Cost（选填金额，挂 maintainHandleSourceId）→ 回写车辆里程
//
// 保养项必须已存在：AI 不能凭空造一个新的保养项，否则周期是编的，
// 以后的剩余量全错。找不到就报错并列出该车已有的项。
import { calcRemaining, findLastHandle, formatRemainText } from '../lib/domain/maintain.service';
import { Cost, MaintainHandle, MaintainLog } from '../lib/types/models';
import { genId } from '../lib/utils/id';
import {
  energyLabel,
  insert,
  readCars,
  readCategories,
  readHandles,
  readLogs,
  readMaintains,
  resolveCarStrict,
  update
} from '../lib/store';

interface Args {
  /** 车辆名称；多辆车又没说时不要传，先问用户 */
  carName?: string;
  /** 保养项名称，如「机油机滤」。必填——不能凭空造项 */
  maintainName?: string;
  /** 保养时的总里程 km；不传沿用车辆当前里程 */
  mileage?: number;
  /** 费用（元）；选填，传了就记一笔保养类支出 */
  amount?: number;
  /** YYYY-MM-DD，默认今天 */
  dateText?: string;
  remark?: string;
}

function parseDate(text: string | undefined, now: number): number {
  if (!text) return now;
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text.trim());
  if (!m) return now;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
}

export async function addMaintain(args: Args = {}): Promise<AgentApiResult> {
  const now = Date.now();
  const cars = readCars();
  if (!cars.length) {
    return {
      isError: true,
      content: [{ type: 'text', text: '用户还没有添加车辆，无法记录保养。请引导先在「车辆」页添加车辆。' }],
      handoff: () => ({ query: 'rangeType=all', payload: { carCount: 0, question: 'no-car' } })
    };
  }

  // 写操作不允许静默挑车：保养记错车会把周期与里程全打乱
  const { car, reason } = resolveCarStrict(cars, args.carName || '');
  if (!car) {
    const names = cars.map(c => c.name).join('、');
    const askHandoff = () => ({
      query: 'rangeType=all',
      payload: { carCount: cars.length, question: 'which-car', names }
    });
    if (reason === 'ambiguous') {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `用户有 ${cars.length} 辆车（${names}），还没说给哪一辆记保养。请先问「哪辆车」，拿到车名后再调用本接口，不要替用户选。`
          }
        ],
        handoff: askHandoff
      };
    }
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: `没有找到名为「${args.carName}」的车辆。现有车辆：${names}。请让用户确认是哪一辆后重试。`
        }
      ],
      handoff: askHandoff
    };
  }

  const items = readMaintains().filter(m => m.carSourceId === car.sourceId);
  const names = items.map(m => m.name);
  const asked = (args.maintainName || '').trim();

  if (!asked) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text:
            `${car.name} 现有保养项：${names.join('、') || '（还没有配置保养项）'}。` +
            `保养要记到具体某一项上，请先问用户「做的是哪一项」，拿到名称后再调用。`
        }
      ],
      handoff: () => ({ query: `id=${encodeURIComponent(car.sourceId)}`, payload: { carName: car.name } })
    };
  }

  const exact = items.find(m => m.name === asked);
  const target = exact || items.find(m => m.name.includes(asked) || asked.includes(m.name));
  if (!target) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text:
            `${car.name} 没有叫「${asked}」的保养项。现有保养项：${names.join('、') || '（空）'}。` +
            `请让用户确认是哪一项，或引导到「保养项管理」页先添加这一项——不要自己造一个新项。`
        }
      ],
      handoff: () => ({ query: `id=${encodeURIComponent(car.sourceId)}`, payload: { carName: car.name } })
    };
  }

  const makeDate = parseDate(args.dateText, now);
  const makeMileages = Number(args.mileage) > 0 ? Number(args.mileage) : car.mileages;

  const handle: MaintainHandle = {
    sourceId: genId('maintain-handle'),
    sourcePlatform: 'mp',
    carSourceId: car.sourceId,
    makeDate,
    makeMileages,
    makeEVMileages: 0,
    makeHEVMileages: 0,
    remark: args.remark || '',
    costSourceId: '',
    createdAt: now,
    updatedAt: now,
    deleted: false
  };
  insert<MaintainHandle>('maintainHandles', handle);

  // 每个保养项一条关联流水：findLastHandle 靠它找「上次保养」
  const log: MaintainLog = {
    sourceId: genId('maintain-log'),
    sourcePlatform: 'mp',
    carSourceId: car.sourceId,
    maintainSourceId: target.sourceId,
    handleSourceId: handle.sourceId,
    makeDate,
    makeMileages,
    totalMileages: makeMileages,
    makeEVMileages: 0,
    makeHEVMileages: 0,
    mileageSource: 'total',
    remark: args.remark || '',
    createdAt: now,
    updatedAt: now,
    deleted: false
  };
  insert<MaintainLog>('maintainLogs', log);

  // 选填金额 → 保养类支出（与主包同一套关联字段）
  const amount = Number(args.amount);
  let amountSaved = 0;
  if (isFinite(amount) && amount > 0) {
    const category = readCategories().find(c => c.presetType === 'maintain' && !c.deleted);
    if (category) {
      const cost: Cost = {
        sourceId: genId('costs'),
        sourcePlatform: 'mp',
        carSourceId: car.sourceId,
        categorySourceId: category.sourceId,
        amount,
        costDate: makeDate,
        remark: args.remark || `${target.name} 保养`,
        maintainHandleSourceId: handle.sourceId,
        repairSourceId: '',
        fuelRecordSourceId: '',
        createdAt: now,
        updatedAt: now,
        deleted: false
      };
      insert<Cost>('costs', cost);
      handle.costSourceId = cost.sourceId;
      update<MaintainHandle>('maintainHandles', handle);
      amountSaved = amount;
    }
  }

  // 回写车辆里程：保养通常发生在当前里程，里程涨了要同步，否则剩余量偏小
  if (makeMileages > car.mileages) {
    car.mileages = makeMileages;
    car.updatedAt = now;
    update('cars', car);
  }

  // 重置后的剩余量（与保养页同一份 calcRemaining）
  const remain = calcRemaining(
    target,
    findLastHandle(target, readLogs(), readHandles()),
    car,
    now,
    { mileage: car.maintainSoonMileage, days: car.maintainSoonDays }
  );
  const remainText = formatRemainText(remain.remainMileage, remain.remainDays);

  const amountPart = amountSaved > 0 ? `，花费 ¥${amountSaved.toFixed(2)}` : '';
  const text =
    `已记录：${car.name}（${energyLabel(car)}）保养「${target.name}」，里程 ${makeMileages} km${amountPart}。` +
    `这一项已重置周期，下次${remainText}。`;

  return {
    isError: false,
    content: [{ type: 'text', text }],
    structuredContent: {
      carName: car.name,
      maintainName: target.name,
      mileage: String(makeMileages),
      amount: amountSaved.toFixed(2),
      remainText,
      cycleText: target.cycleMileages ? `每 ${target.cycleMileages} km` : '',
      pagePath: `pages/entry/index?carId=${car.sourceId}&tab=maintain`,
      linkText: '查看保养进度'
    },
    // 页面接力：这辆车的保养进度区块
    handoff: () => ({
      query: `carId=${encodeURIComponent(car.sourceId)}&tab=maintain`,
      payload: { carName: car.name, maintainName: target.name, remainText }
    })
  };
}
