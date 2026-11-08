"""生成 iCar 测试数据（纯油 / 纯电 / 混动 三份可直接导入的 JSON）。

用法：python test-data/generate.py
输出：test-data/icar-test-fuel.json / -ev.json / -hybrid.json

约束（按需求）：
- 保养 / 维修 / 支出 / 加油或充电 各类齐全
- 加油或充电 >= 6 次，其余类别 >= 3 条
- 总里程 >= 5000 km
- 区间算法依赖「加满/充满」锚点，故每条加油/充电记录均为加满
"""
import json
import os
from datetime import datetime, timedelta

OUT_DIR = os.path.dirname(os.path.abspath(__file__))

# 版本号从 package.json 读取，避免与小程序实际版本不一致
_PKG = os.path.join(os.path.dirname(OUT_DIR), 'package.json')
with open(_PKG, encoding='utf-8') as _f:
    APP_VERSION = json.load(_f)['version']

# 预设类别 ID 与 seed.ts 保持一致，导入后会自动合并
PRESET_CATEGORIES = [
    ('加油', 'oil', 'refuel', 0),
    ('保养', 'maintain', 'maintain', 1),
    ('维修', 'fix', 'fix', 2),
    ('停车', 'p', '', 3),
    ('充电', 'ev', 'ev', 4),
]
CUSTOM_CATEGORIES = [
    ('洗车', 'wash', 5),
    ('高速', 'toll', 6),
    ('保险', 'shield', 7),
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


def build_maintains(car_id, items):
    """items: [(name, cycle_km, cycle_days, cycle_months)]"""
    out = []
    for i, (name, km, days, months) in enumerate(items):
        e = base_entity(f'mp:maintain:{car_id}:{i}', ts(2026, 1, 5))
        e.update({
            'carSourceId': car_id,
            'name': name,
            'icon': '',
            'cycleMileages': km,
            'cycleDays': days,
            'cycleMonths': months,
            'cycleUnit': 'month' if months else '',
            'cycleValue': months,
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
        'maintainSoonMileage': 500,
        'maintainSoonDays': 15,
    })
    return e


def make_bundle(cars, maintains, handles, logs, repairs, refuels, costs):
    data = {
        'cars': cars,
        'categories': build_categories(),
        'maintains': maintains,
        'maintainHandles': handles,
        'maintainLogs': logs,
        'costs': costs,
        'repairRecords': repairs,
        'fuelRecords': refuels,
        # 派生数据：导入时会按记录全量重算，此处留空
        'fuelConsumptions': [],
    }
    return {
        'format': 'icar-export',
        'version': 1,
        'source': {'platform': 'mp', 'appVersion': APP_VERSION, 'exportedAt': ts(2026, 11, 8, 20, 0)},
        'options': {'amountUnit': 'yuan', 'timeUnit': 'ms', 'imageMode': 'file', 'package': 'json'},
        'warnings': ['本文件为测试数据，仅用于验证功能与图表展示'],
        'data': data,
    }


# ---------------- 纯油车 ----------------
def gen_fuel():
    car_id = 'mp:cars:test-fuel'
    # 10 次加油，每次约 650km，总里程 5850km
    refuel_spec = []
    for i in range(10):
        km = i * 650
        day = 10 + i * 32
        y, m = 2026 + (day - 1) // 365, 1
        d = datetime(2026, 1, 10) + timedelta(days=i * 32)
        vol = 52.0 + (i % 3 - 1) * 1.5
        price = round(7.5 + (i % 4 - 1) * 0.15, 2)
        refuel_spec.append((ts(d.year, d.month, d.day, 9 + i % 8, 15), km, vol, price, 15, 100, ''))
    refuels, refuel_costs = build_refuels(car_id, refuel_spec, 'fuel')

    maintains = build_maintains(car_id, [
        ('机油机滤', 10000, 360, 12),
        ('空调滤芯', 20000, 720, 24),
        ('空气滤芯', 20000, 0, 0),
        ('刹车油', 40000, 1440, 48),
        ('火花塞', 50000, 0, 0),
        ('变速箱油', 60000, 0, 0),
    ])
    handles, logs, m_costs = build_maintain_data(car_id, maintains, [
        (ts(2026, 2, 20), 500, [0, 2], 568.0),
        (ts(2026, 6, 15), 2600, [0, 1], 620.0),
        (ts(2026, 10, 25), 5200, [0, 3], 880.0),
    ])
    repairs, r_costs = build_repairs(car_id, [
        (ts(2026, 4, 8), 1500, '更换雨刮片', 120.0),
        (ts(2026, 7, 22), 3400, '补胎（右后轮）', 60.0),
        (ts(2026, 9, 30), 4800, '更换刹车片', 760.0),
    ])
    manual = build_manual_costs(car_id, [
        (ts(2026, 1, 20), 'park', 15.0, '商场停车'),
        (ts(2026, 3, 12), 'toll', 85.0, '高速通行费'),
        (ts(2026, 5, 5), 'wash', 45.0, '精洗'),
        (ts(2026, 8, 18), 'park', 20.0, '机场停车'),
        (ts(2026, 9, 9), 'insurance', 3800.0, '商业险续保'),
        (ts(2026, 11, 2), 'toll', 120.0, '长途高速'),
    ])

    car = build_car(car_id, '测试-纯油 CRV', 'fuel', ts(2026, 1, 5), 0, 0, refuels)
    costs = refuel_costs + m_costs + r_costs + manual
    return make_bundle([car], maintains, handles, logs, repairs, refuels, costs)


# ---------------- 纯电车 ----------------
def gen_ev():
    car_id = 'mp:cars:test-ev'
    # 14 次充电，每次约 420km，总里程 5460km
    spec = []
    for i in range(14):
        km = i * 420
        d = datetime(2026, 1, 12) + timedelta(days=i * 21)
        vol = 60.0 + (i % 3 - 1) * 2.0
        price = round(0.8 + (i % 3) * 0.1, 2)
        spec.append((ts(d.year, d.month, d.day, 20, 30), km, vol, price, 18, 100, ''))
    refuels, refuel_costs = build_refuels(car_id, spec, 'ev')

    maintains = build_maintains(car_id, [
        ('空调滤芯', 20000, 720, 24),
        ('刹车油', 40000, 1440, 48),
        ('轮胎换位', 10000, 0, 0),
        ('减速器油', 60000, 0, 0),
    ])
    handles, logs, m_costs = build_maintain_data(car_id, maintains, [
        (ts(2026, 2, 25), 420, [0, 2], 320.0),
        (ts(2026, 6, 20), 2940, [2], 180.0),
        (ts(2026, 10, 28), 5040, [1, 3], 690.0),
    ])
    repairs, r_costs = build_repairs(car_id, [
        (ts(2026, 3, 30), 1260, '更换前挡雨刮', 130.0),
        (ts(2026, 7, 10), 3360, '轮胎动平衡', 80.0),
        (ts(2026, 10, 5), 4620, '更换左前大灯总成', 1450.0),
    ])
    manual = build_manual_costs(car_id, [
        (ts(2026, 1, 18), 'park', 12.0, '公司停车'),
        (ts(2026, 4, 2), 'wash', 50.0, '洗车'),
        (ts(2026, 5, 20), 'toll', 65.0, '高速'),
        (ts(2026, 8, 8), 'insurance', 4200.0, '商业险续保'),
        (ts(2026, 9, 16), 'park', 30.0, '景区停车'),
        (ts(2026, 11, 3), 'toll', 95.0, '跨城高速'),
    ])

    car = build_car(car_id, '测试-纯电 Model Y', 'ev', ts(2026, 1, 8), 0, 60, refuels)
    costs = refuel_costs + m_costs + r_costs + manual
    return make_bundle([car], maintains, handles, logs, repairs, refuels, costs)


# ---------------- 混动车 ----------------
def gen_hybrid():
    car_id = 'mp:cars:test-hybrid'
    # 加油 7 次，每次 900km → 5400km
    fuel_spec = []
    for i in range(7):
        km = i * 900
        d = datetime(2026, 1, 15) + timedelta(days=i * 45)
        vol = 45.0 + (i % 3 - 1) * 2.0
        price = round(7.6 + (i % 4 - 1) * 0.2, 2)
        fuel_spec.append((ts(d.year, d.month, d.day, 8, 40), km, vol, price, 10, 100, '加油'))
    fuel_records, fuel_costs = build_refuels(car_id, fuel_spec, 'fuel')

    # 充电 12 次，每次 300km → 3300km（与加油记录交错，里程不冲突）
    ev_spec = []
    for i in range(12):
        km = 300 + i * 300
        d = datetime(2026, 1, 25) + timedelta(days=i * 26)
        vol = 45.0 + (i % 3 - 1) * 3.0
        price = round(0.9 + (i % 3) * 0.1, 2)
        ev_spec.append((ts(d.year, d.month, d.day, 21, 10), km, vol, price, 30, 100, '充电'))
    ev_records, ev_costs = build_refuels(car_id, ev_spec, 'ev')

    refuels = sorted(fuel_records + ev_records, key=lambda r: r['fuelDate'])

    maintains = build_maintains(car_id, [
        ('机油机滤', 10000, 360, 12),
        ('空调滤芯', 20000, 720, 24),
        ('刹车油', 40000, 1440, 48),
        ('火花塞', 50000, 0, 0),
    ])
    handles, logs, m_costs = build_maintain_data(car_id, maintains, [
        (ts(2026, 3, 5), 900, [0, 1], 520.0),
        (ts(2026, 7, 18), 2700, [0], 430.0),
        (ts(2026, 10, 30), 4500, [0, 2, 3], 1180.0),
    ])
    repairs, r_costs = build_repairs(car_id, [
        (ts(2026, 4, 20), 1800, '更换雨刮片', 110.0),
        (ts(2026, 8, 12), 3600, '四轮定位', 200.0),
        (ts(2026, 10, 15), 4800, '更换前刹车片', 720.0),
    ])
    manual = build_manual_costs(car_id, [
        (ts(2026, 2, 6), 'park', 18.0, '地下车库'),
        (ts(2026, 5, 14), 'toll', 78.0, '高速'),
        (ts(2026, 6, 28), 'wash', 48.0, '洗车打蜡'),
        (ts(2026, 8, 30), 'insurance', 3900.0, '商业险续保'),
        (ts(2026, 9, 25), 'park', 25.0, '医院停车'),
        (ts(2026, 11, 5), 'toll', 110.0, '跨城高速'),
    ])

    car = build_car(car_id, '测试-混动 汉DM-i', 'hybrid', ts(2026, 1, 10), 0, 18, refuels)
    costs = fuel_costs + ev_costs + m_costs + r_costs + manual
    return make_bundle([car], maintains, handles, logs, repairs, refuels, costs)


def dump(bundle, filename):
    path = os.path.join(OUT_DIR, filename)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(bundle, f, ensure_ascii=False, indent=2)
    d = bundle['data']
    print(f'{filename}: 车辆{len(d["cars"])} 保养项{len(d["maintains"])} 保养记录{len(d["maintainHandles"])} '
          f'保养明细{len(d["maintainLogs"])} 维修{len(d["repairRecords"])} '
          f'加油/充电{len(d["fuelRecords"])} 支出{len(d["costs"])} '
          f'总里程{d["cars"][0]["mileages"]}km')


if __name__ == '__main__':
    dump(gen_fuel(), 'icar-test-fuel.json')
    dump(gen_ev(), 'icar-test-ev.json')
    dump(gen_hybrid(), 'icar-test-hybrid.json')
