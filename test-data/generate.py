"""生成 iCar 测试数据（纯油 / 纯电 / 混动 / 三车合并，四份可直接导入的 JSON）。

用法：python test-data/generate.py
输出：
  test-data/icar-test-fuel.json    纯油单车
  test-data/icar-test-ev.json      纯电单车
  test-data/icar-test-hybrid.json  混动单车
  test-data/icar-test-all.json     三车合并（**验证概览页跨车区块用这份**）

设计约束：
- 加油/充电一律「加满/充满」：区间算法依赖锚点，这样才能生成完整区间
- 时间跨度覆盖 2026 全年（1 月 ~ 11 月），可验证月/年/全部三种维度
- **保养项刻意覆盖三种状态**：已超期 / 即将到期 / 正常
  （概览页「保养提醒 · N 项待保养」只有当 remainMileages ≤ 500 或
    remainDays ≤ 15 才算待保养，全部正常的话那个区块永远是空的）
- 保养项带 emoji 图标，与 DEFAULT_TEMPLATES 一致，不依赖 backfill 回填
- cycleUnit / cycleValue 按当前 app 的 buildCycleFields 规则写：
  有月周期 → month + 月数；否则有里程周期 → km + 里程
- 包含自定义支出类别「改装」，验证分类占比图的标签避让
- fuelConsumptions 留空，导入时由系统全量重算，顺带验证派生数据重建

⚠️ 保养天数的「待保养」状态是相对某个日期算的。本脚本以 **2026-11-17** 为基准日；
      隔太久再导入，天周期项的状态会漂移（里程周期项不受影响）。
"""
import json
import os
from datetime import datetime, timedelta

OUT_DIR = os.path.dirname(os.path.abspath(__file__))

# 版本号从 package.json 读取，避免与小程序实际版本不一致
_PKG = os.path.join(os.path.dirname(OUT_DIR), 'package.json')
with open(_PKG, encoding='utf-8') as _f:
    APP_VERSION = json.load(_f)['version']

# 保养状态的基准日（仅用于脚本内自检与文档说明，不写进数据）
REF_TODAY = datetime(2026, 11, 17)

# 预设类别 ID 与 seed.ts 保持一致，导入后会自动合并。
# 前四个是支出预设（用户记支出时可选），后四个是系统预设（由专用表单自动归类）。
# sortOrder 必须与 seed.ts 的实际分配一致：支出预设 0-3，系统预设 100-103。
PRESET_CATEGORIES = [
    ('停车', 'p', '', 0),
    ('高速', 'toll', '', 1),
    ('保险', 'shield', '', 2),
    ('洗车', 'wash', '', 3),
    ('加油', 'oil', 'refuel', 100),
    ('充电', 'ev', 'ev', 101),
    ('保养', 'maintain', 'maintain', 102),
    ('维修', 'fix', 'fix', 103),
]
# 自定义类别，接在支出预设之后
CUSTOM_CATEGORIES = [
    ('改装', '🎨', 4),
]

CAT = {
    'fuel': 'mp:category:加油',
    'ev': 'mp:category:充电',
    'maintain': 'mp:category:保养',
    'fix': 'mp:category:维修',
    'park': 'mp:category:停车',
    'wash': 'mp:category:洗车',
    'toll': 'mp:category:高速',
    'insurance': 'mp:category:保险',
    'mod': 'mp:category:改装',
}


def ts(y, m, d, hh=10, mm=0):
    return int(datetime(y, m, d, hh, mm).timestamp() * 1000)


def base_entity(sid, created):
    return {
        'sourceId': sid,
        'sourcePlatform': 'mp',
        'createdAt': created,
        'updatedAt': created,
        'deleted': False,
    }


def build_categories():
    out = []
    for name, icon, preset, order in PRESET_CATEGORIES:
        e = base_entity(f'mp:category:{name}', ts(2026, 1, 1))
        e.update({
            'name': name,
            'icon': icon,
            'isPreset': True,
            'presetType': preset,
            'visible': True,
            'sortOrder': order,
        })
        out.append(e)
    for name, icon, order in CUSTOM_CATEGORIES:
        e = base_entity(f'mp:category:{name}', ts(2026, 1, 2))
        e.update({
            'name': name,
            'icon': icon,
            'isPreset': False,
            'presetType': '',
            'visible': True,
            'sortOrder': order,
        })
        out.append(e)
    return out


def cycle_fields(km, months):
    """与 app 的 buildCycleFields 同规则，避免导入后周期显示异常。"""
    cycle_days = months * 30 if months > 0 else 0
    if months > 0:
        unit, value = 'month', months
    elif km > 0:
        unit, value = 'km', km
    else:
        unit, value = '', 0
    return cycle_days, unit, value


def build_maintains(car_id, items):
    """items: [(name, icon, cycle_km, cycle_months)]"""
    out = []
    for i, (name, icon, km, months) in enumerate(items):
        e = base_entity(f'mp:maintain:{car_id}:{i}', ts(2026, 1, 5))
        days, unit, value = cycle_fields(km, months)
        e.update({
            'carSourceId': car_id,
            'name': name,
            'icon': icon,
            'cycleMileages': km,
            'cycleDays': days,
            'cycleMonths': months,
            'cycleUnit': unit,
            'cycleValue': value,
            'mileageSource': 'total',
            'sortOrder': i,
        })
        out.append(e)
    return out


def build_maintain_data(car_id, maintains, handles_spec):
    """handles_spec: [(date, mileage, [maintain_index, ...], amount)]"""
    handles, logs, costs = [], [], []
    for hi, (date, mileage, idxs, amount) in enumerate(handles_spec):
        hid = f'mp:maintain-handle:{car_id}:{hi}'
        cid = f'mp:costs:{car_id}:maintain:{hi}'
        cost = base_entity(cid, date)
        cost.update({
            'carSourceId': car_id,
            'categorySourceId': CAT['maintain'],
            'amount': amount,
            'costDate': date,
            'remark': '保养',
            'maintainHandleSourceId': hid,
            'repairSourceId': '',
            'fuelRecordSourceId': '',
        })
        costs.append(cost)

        h = base_entity(hid, date)
        h.update({
            'carSourceId': car_id,
            'makeDate': date,
            'makeMileages': mileage,
            'makeEVMileages': 0,
            'makeHEVMileages': 0,
            'remark': '',
            'costSourceId': cid,
        })
        handles.append(h)

        for mi in idxs:
            lid = f'mp:maintain-log:{car_id}:{hi}:{mi}'
            log = base_entity(lid, date)
            log.update({
                'carSourceId': car_id,
                'maintainSourceId': maintains[mi]['sourceId'],
                'handleSourceId': hid,
                'makeDate': date,
                'makeMileages': mileage,
                'totalMileages': mileage,
                'makeEVMileages': 0,
                'makeHEVMileages': 0,
                'mileageSource': 'total',
                'remark': '',
            })
            logs.append(log)
    return handles, logs, costs


def build_repairs(car_id, spec):
    """spec: [(date, mileage, content, amount)]"""
    out, costs = [], []
    for i, (date, mileage, content, amount) in enumerate(spec):
        rid = f'mp:repair-record:{car_id}:{i}'
        cid = f'mp:costs:{car_id}:repair:{i}'
        cost = base_entity(cid, date)
        cost.update({
            'carSourceId': car_id,
            'categorySourceId': CAT['fix'],
            'amount': amount,
            'costDate': date,
            'remark': content,
            'maintainHandleSourceId': '',
            'repairSourceId': rid,
            'fuelRecordSourceId': '',
        })
        costs.append(cost)

        r = base_entity(rid, date)
        r.update({
            'carSourceId': car_id,
            'content': content,
            'mileage': mileage,
            'repairDate': date,
            'amount': amount,
            'images': [],
            'remark': '',
            'costSourceId': cid,
        })
        out.append(r)
    return out, costs


def build_manual_costs(car_id, spec):
    """spec: [(date, category_key, amount, remark)]"""
    out = []
    for i, (date, cat, amount, remark) in enumerate(spec):
        e = base_entity(f'mp:costs:{car_id}:manual:{i}', date)
        e.update({
            'carSourceId': car_id,
            'categorySourceId': CAT[cat],
            'amount': amount,
            'costDate': date,
            'remark': remark,
            'maintainHandleSourceId': '',
            'repairSourceId': '',
            'fuelRecordSourceId': '',
        })
        out.append(e)
    return out


def build_refuels(car_id, spec, energy_type):
    """spec: [(date, mileage, volume, unit_price, before_pct, after_pct, remark)]"""
    out, costs = [], []
    for i, (date, mileage, volume, price, before, after, remark) in enumerate(spec):
        rid = f'mp:refuel-log:{car_id}:{i}'
        cid = f'mp:costs:{car_id}:refuel:{i}'
        should = round(volume * price, 2)
        cost = base_entity(cid, date)
        cost.update({
            'carSourceId': car_id,
            'categorySourceId': CAT['ev'] if energy_type == 'ev' else CAT['fuel'],
            'amount': should,
            'costDate': date,
            'remark': remark,
            'maintainHandleSourceId': '',
            'repairSourceId': '',
            'fuelRecordSourceId': rid,
        })
        costs.append(cost)

        r = base_entity(rid, date)
        r.update({
            'carSourceId': car_id,
            'energyType': energy_type,
            'fuelDate': date,
            'makeMileages': mileage,
            'makeEVMileages': mileage if energy_type == 'ev' else 0,
            'makeHEVMileages': 0,
            'unitPrice': price,
            'volume': volume,
            'shouldPayAmount': should,
            'actualPayAmount': should,
            'isFull': True,
            'isLowFuel': False,
            'lastRecorded': True,
            'chargeBeforePercent': before,
            'chargeAfterPercent': after,
            'remark': remark,
            'costSourceId': cid,
        })
        out.append(r)
    return out, costs


def build_car(car_id, name, energy, init_date, init_mileages, battery, records):
    e = base_entity(car_id, init_date)
    e.update({
        'name': name,
        'type': 'car',
        'icon': 'car',
        'customIconAssetId': '',
        'initDate': init_date,
        'initMileages': init_mileages,
        'mileages': max(r['makeMileages'] for r in records),
        'evMileages': 0,
        'hevMileages': 0,
        'batteryCapacity': battery,
        'energyType': energy,
        'energyTrackingEnabled': True,
        # 与 app 默认一致：剩余里程 ≤500km 或剩余天数 ≤15 天即视为待保养
        'maintainSoonMileage': 500,
        'maintainSoonDays': 15,
    })
    return e


# ---------------- 保养状态自检（用 Python 复刻 calcRemaining，防手算错） ----------------

def _days_between(a, b):
    return (b.date() - a.date()).days


def report_maintains(car, maintains, handles, logs):
    """打印每项的剩余量与状态，生成时直接看得到待保养项够不够。"""
    state = {}
    for m in maintains:
        related = [h for h in handles
                   if any(l['maintainSourceId'] == m['sourceId'] and l['handleSourceId'] == h['sourceId']
                          for l in logs)]
        last = max(related, key=lambda h: h['makeDate']) if related else None

        base_km = last['makeMileages'] if last else car['initMileages']
        used = car['mileages'] - base_km
        rem_km = m['cycleMileages'] - used if m['cycleMileages'] > 0 else None

        rem_days = None
        if m['cycleDays'] > 0:
            base_date = datetime.fromtimestamp((last['makeDate'] if last else car['initDate']) / 1000)
            rem_days = m['cycleDays'] - _days_between(base_date, REF_TODAY)

        urgent = (
            (rem_km is not None and rem_km <= car['maintainSoonMileage'])
            or (rem_days is not None and rem_days <= car['maintainSoonDays'])
        )
        overdue = (rem_km is not None and rem_km < 0) or (rem_days is not None and rem_days < 0)
        level = '已超期' if overdue else ('待保养' if urgent else '正常')
        state[m['name']] = (rem_km, rem_days, level)

    return state


# ---------------- 三辆车的完整数据 ----------------

def car_fuel():
    """纯油 CRV：5850km，10 次加满。"""
    car_id = 'mp:cars:test-fuel'
    today = datetime(2026, 1, 10)

    refuel_spec = []
    for i in range(10):
        d = today + timedelta(days=i * 32)
        km = i * 650
        vol = 52.0 + (i % 3 - 1) * 1.5
        price = round(7.5 + (i % 4 - 1) * 0.15, 2)
        refuel_spec.append((ts(d.year, d.month, d.day, 9 + i % 8, 15), km, vol, price, 15, 100, ''))
    refuels, refuel_costs = build_refuels(car_id, refuel_spec, 'fuel')

    # 6 项原厂模板 + 3 项常见补充，覆盖三种状态
    maintains = build_maintains(car_id, [
        ('机油机滤', '🛢️', 10000, 12),
        ('空调滤芯', '❄️', 20000, 24),
        ('空气滤芯', '💨', 20000, 0),
        ('刹车油', '🛑', 40000, 48),
        ('火花塞', '⚡', 50000, 0),
        ('变速箱油', '⚙️', 60000, 0),
        ('轮胎换位', '🛞', 5000, 0),      # 从未做过 → 已超期
        ('雨刮片', '🧽', 0, 6),       # 6 个月前做过 → 已超期
        ('玻璃水', '💧', 0, 3),          # 2.5 个月前 → 即将到期
    ])
    handles, logs, m_costs = build_maintain_data(car_id, maintains, [
        (ts(2026, 2, 20), 500, [0], 480.0),
        (ts(2026, 3, 1), 1200, [7], 60.0),
        (ts(2026, 6, 15), 2600, [0, 1], 620.0),
        (ts(2026, 9, 1), 4700, [8], 25.0),
        (ts(2026, 10, 25), 5200, [3], 880.0),
    ])

    repairs, r_costs = build_repairs(car_id, [
        (ts(2026, 4, 8), 1500, '更换雨刮片', 120.0),
        (ts(2026, 7, 22), 3400, '补胎（右后轮）', 60.0),
        (ts(2026, 9, 30), 4800, '更换刹车片', 760.0),
        (ts(2026, 10, 12), 5100, '更换电瓶', 520.0),
        (ts(2026, 11, 5), 5600, '前挡风玻璃修复', 180.0),
    ])

    manual = build_manual_costs(car_id, [
        (ts(2026, 1, 20), 'park', 15.0, '商场停车'),
        (ts(2026, 3, 12), 'toll', 85.0, '高速通行费'),
        (ts(2026, 5, 5), 'wash', 45.0, '精洗'),
        (ts(2026, 6, 18), 'mod', 1200.0, '加装行车记录仪'),
        (ts(2026, 8, 18), 'park', 20.0, '机场停车'),
        (ts(2026, 9, 9), 'insurance', 3800.0, '商业险续保'),
        (ts(2026, 10, 20), 'wash', 38.0, '洗车'),
        (ts(2026, 11, 2), 'toll', 120.0, '长途高速'),
    ])

    car = build_car(car_id, '测试-纯油 CRV', 'fuel', ts(2026, 1, 5), 0, 0, refuels)
    costs = refuel_costs + m_costs + r_costs + manual
    return {
        'car': car, 'maintains': maintains, 'handles': handles, 'logs': logs,
        'repairs': repairs, 'refuels': refuels, 'costs': costs,
    }


def car_ev():
    """纯电 Model Y：5460km，14 次充满。"""
    car_id = 'mp:cars:test-ev'
    today = datetime(2026, 1, 12)

    spec = []
    for i in range(14):
        d = today + timedelta(days=i * 21)
        km = i * 420
        vol = 60.0 + (i % 3 - 1) * 2.0
        price = round(0.8 + (i % 3) * 0.1, 2)
        spec.append((ts(d.year, d.month, d.day, 20, 30), km, vol, price, 18, 100, ''))
    refuels, refuel_costs = build_refuels(car_id, spec, 'ev')

    maintains = build_maintains(car_id, [
        ('空调滤芯', '❄️', 20000, 24),
        ('刹车油', '🛑', 40000, 48),
        ('轮胎换位', '🛞', 10000, 12),
        ('减速器油', '⚙️', 60000, 0),
        ('电池冷却液', '🔋', 0, 48),
        ('雨刮片', '🧽', 0, 6),       # 9 个月前 → 已超期
        ('玻璃水', '💧', 0, 3),          # 近 3 个月 → 即将到期
        ('轮胎气压检查', '🎯', 0, 2),     # 近 2 个月 → 即将到期
    ])
    handles, logs, m_costs = build_maintain_data(car_id, maintains, [
        (ts(2026, 2, 10), 420, [5], 40.0),
        (ts(2026, 2, 25), 840, [0], 320.0),
        (ts(2026, 6, 20), 2940, [2], 180.0),
        (ts(2026, 8, 20), 4620, [6], 20.0),
        (ts(2026, 9, 25), 4900, [7], 15.0),
        (ts(2026, 10, 28), 5040, [1], 690.0),
    ])

    repairs, r_costs = build_repairs(car_id, [
        (ts(2026, 3, 30), 1260, '更换前挡雨刮', 130.0),
        (ts(2026, 7, 10), 3360, '轮胎动平衡', 80.0),
        (ts(2026, 10, 5), 4620, '更换左前大灯总成', 1450.0),
        (ts(2026, 10, 22), 4980, '更换 12V 小电瓶', 480.0),
        (ts(2026, 11, 8), 5320, '后视镜加热维修', 260.0),
    ])

    manual = build_manual_costs(car_id, [
        (ts(2026, 1, 18), 'park', 12.0, '公司停车'),
        (ts(2026, 4, 2), 'wash', 50.0, '洗车'),
        (ts(2026, 5, 20), 'toll', 65.0, '高速'),
        (ts(2026, 7, 5), 'mod', 2400.0, '加装脚垫与车衣'),
        (ts(2026, 8, 8), 'insurance', 4200.0, '商业险续保'),
        (ts(2026, 9, 16), 'park', 30.0, '景区停车'),
        (ts(2026, 10, 30), 'wash', 40.0, '洗车'),
        (ts(2026, 11, 3), 'toll', 95.0, '跨城高速'),
    ])

    car = build_car(car_id, '测试-纯电 Model Y', 'ev', ts(2026, 1, 8), 0, 60, refuels)
    costs = refuel_costs + m_costs + r_costs + manual
    return {
        'car': car, 'maintains': maintains, 'handles': handles, 'logs': logs,
        'repairs': repairs, 'refuels': refuels, 'costs': costs,
    }


def car_hybrid():
    """混动 汉DM-i：5400km，7 次加油 + 12 次充电。"""
    car_id = 'mp:cars:test-hybrid'

    fuel_spec = []
    for i in range(7):
        d = datetime(2026, 1, 15) + timedelta(days=i * 45)
        km = i * 900
        vol = 45.0 + (i % 3 - 1) * 2.0
        price = round(7.6 + (i % 4 - 1) * 0.2, 2)
        fuel_spec.append((ts(d.year, d.month, d.day, 8, 40), km, vol, price, 10, 100, '加油'))
    fuel_records, fuel_costs = build_refuels(car_id, fuel_spec, 'fuel')

    ev_spec = []
    for i in range(12):
        d = datetime(2026, 1, 25) + timedelta(days=i * 26)
        km = 300 + i * 300
        vol = 45.0 + (i % 3 - 1) * 3.0
        price = round(0.9 + (i % 3) * 0.1, 2)
        ev_spec.append((ts(d.year, d.month, d.day, 21, 10), km, vol, price, 30, 100, '充电'))
    ev_records, ev_costs = build_refuels(car_id, ev_spec, 'ev')

    refuels = sorted(fuel_records + ev_records, key=lambda r: r['fuelDate'])

    maintains = build_maintains(car_id, [
        ('机油机滤', '🛢️', 10000, 12),
        ('空调滤芯', '❄️', 20000, 24),
        ('刹车油', '🛑', 40000, 48),
        ('火花塞', '⚡', 50000, 0),
        ('变速箱油', '⚙️', 60000, 0),
        ('空气滤芯', '💨', 20000, 0),
        ('轮胎换位', '🛞', 5000, 0),      # 从未做过 → 已超期
        ('电池散热滤芯', '🔋', 0, 6),     # 9 个月前 → 已超期
        ('玻璃水', '💧', 0, 3),          # 2 个月前 → 正常
        ('轮胎气压检查', '🎯', 0, 2),     # 近 1.5 个月 → 即将到期
    ])
    handles, logs, m_costs = build_maintain_data(car_id, maintains, [
        (ts(2026, 2, 15), 600, [7], 90.0),
        (ts(2026, 3, 5), 900, [0, 1], 520.0),
        (ts(2026, 7, 18), 2700, [0], 430.0),
        (ts(2026, 9, 10), 4800, [8], 20.0),
        (ts(2026, 10, 1), 4950, [9], 15.0),
        (ts(2026, 11, 10), 5300, [0, 2], 1180.0),
    ])

    repairs, r_costs = build_repairs(car_id, [
        (ts(2026, 4, 20), 1800, '更换雨刮片', 110.0),
        (ts(2026, 8, 12), 3600, '四轮定位', 200.0),
        (ts(2026, 10, 15), 4800, '更换前刹车片', 720.0),
        (ts(2026, 10, 28), 5100, '更换雨刮片', 90.0),
        (ts(2026, 11, 12), 5350, '补胎（左后轮）', 70.0),
    ])

    manual = build_manual_costs(car_id, [
        (ts(2026, 2, 6), 'park', 18.0, '地下车库'),
        (ts(2026, 5, 14), 'toll', 78.0, '高速'),
        (ts(2026, 6, 28), 'wash', 48.0, '洗车打蜡'),
        (ts(2026, 7, 20), 'mod', 800.0, '加装后备箱垫'),
        (ts(2026, 8, 30), 'insurance', 3900.0, '商业险续保'),
        (ts(2026, 9, 25), 'park', 25.0, '医院停车'),
        (ts(2026, 10, 18), 'wash', 42.0, '洗车'),
        (ts(2026, 11, 5), 'toll', 110.0, '跨城高速'),
    ])

    car = build_car(car_id, '测试-混动 汉DM-i', 'hybrid', ts(2026, 1, 10), 0, 18, refuels)
    costs = fuel_costs + ev_costs + m_costs + r_costs + manual
    return {
        'car': car, 'maintains': maintains, 'handles': handles, 'logs': logs,
        'repairs': repairs, 'refuels': refuels, 'costs': costs,
    }


def make_bundle(parts):
    """把若干辆车的部件合并成一份导出包。"""
    data = {
        'cars': [p['car'] for p in parts],
        'categories': build_categories(),
        'maintains': [x for p in parts for x in p['maintains']],
        'maintainHandles': [x for p in parts for x in p['handles']],
        'maintainLogs': [x for p in parts for x in p['logs']],
        'costs': [x for p in parts for x in p['costs']],
        'repairRecords': [x for p in parts for x in p['repairs']],
        'fuelRecords': [x for p in parts for x in p['refuels']],
        # 派生数据：导入时会按记录全量重算，此处留空
        'fuelConsumptions': [],
    }
    return {
        'format': 'icar-export',
        'version': 1,
        'source': {'platform': 'mp', 'appVersion': APP_VERSION, 'exportedAt': ts(2026, 11, 17, 20, 0)},
        'options': {'amountUnit': 'yuan', 'timeUnit': 'ms', 'imageMode': 'file', 'package': 'json'},
        'warnings': ['本文件为测试数据，仅用于验证功能与图表展示'],
        'data': data,
    }


def dump(bundle, filename, parts):
    """写文件并打印摘要。parts 只用于打印，不写进 JSON。"""
    path = os.path.join(OUT_DIR, filename)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(bundle, f, ensure_ascii=False, indent=2)

    d = bundle['data']
    cars = d['cars']
    total_km = sum(c['mileages'] for c in cars)
    print(f'\n{filename}')
    print(f'  车辆 {len(cars)} 辆（{", ".join(c["name"] for c in cars)}），总里程 {total_km} km')
    print(f'  保养项 {len(d["maintains"])} / 保养记录 {len(d["maintainHandles"])} / '
          f'保养明细 {len(d["maintainLogs"])}')
    print(f'  维修 {len(d["repairRecords"])} / 加油充电 {len(d["fuelRecords"])} / 支出 {len(d["costs"])}')

    # 逐车打印保养状态，生成时即可确认「待保养」数量够不够
    for p in parts:
        state = report_maintains(p['car'], p['maintains'], p['handles'], p['logs'])
        urgent = [n for n, v in state.items() if v[2] != '正常']
        print(f'  └ {p["car"]["name"]}：待保养 {len(urgent)} 项')
        for name, (rem_km, rem_days, level) in state.items():
            detail = []
            if rem_km is not None:
                detail.append(f'{rem_km:+.0f}km')
            if rem_days is not None:
                detail.append(f'{rem_days:+d}天')
            # Windows 控制台是 GBK，避免用 ▶ 这类字符，否则 print 会抛 UnicodeEncodeError
            mark = '   ' if level == '正常' else '>> '
            print(f'      {mark}{name:<8} {" / ".join(detail):<18} {level}')


def main():
    parts = {'fuel': car_fuel(), 'ev': car_ev(), 'hybrid': car_hybrid()}

    for key, filename in [
        ('fuel', 'icar-test-fuel.json'),
        ('ev', 'icar-test-ev.json'),
        ('hybrid', 'icar-test-hybrid.json'),
    ]:
        dump(make_bundle([parts[key]]), filename, [parts[key]])

    dump(
        make_bundle([parts['fuel'], parts['ev'], parts['hybrid']]),
        'icar-test-all.json',
        [parts['fuel'], parts['ev'], parts['hybrid']]
    )


if __name__ == '__main__':
    main()
