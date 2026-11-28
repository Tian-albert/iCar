// 临时脚本：注册 queryExpiring / queryCarDetail 的 mcp 声明
const fs = require('fs');
const FILE = 'skills/icar/mcp.json';
const json = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const has = n => json.apis.some(a => a.name === n);

if (!has('queryExpiring')) {
  json.apis.push({
    name: 'queryExpiring',
    description:
      '查车辆的到期提醒：保险到期、年检到期、保养超期/临期。用户问「有什么要到期的」「保险什么时候到期」「年检还有多久」时用。只读。',
    _meta: { ui: { pagePath: 'pages/maintain-all/index' } },
    inputSchema: {
      type: 'object',
      properties: {
        carName: { type: 'string', description: '车辆名称。多辆车又没说时不要传，会汇总全部车辆' },
        days: { type: 'number', description: '多少天内算「即将到期」，默认 30' }
      }
    },
    outputSchema: {
      type: 'object',
      properties: {
        scope: { type: 'string' },
        carName: { type: 'string' },
        count: { type: 'string' },
        overdueCount: { type: 'string' },
        items: { type: 'string' },
        linkText: { type: 'string' },
        pagePath: { type: 'string', format: 'page-link', 'x-link-text-field': 'linkText' }
      }
    }
  });
}

if (!has('queryCarDetail')) {
  json.apis.push({
    name: 'queryCarDetail',
    description:
      '查某一辆车的基础信息：类型、当前里程、购车日期与服役天数、保养项数与待处理数、今年支出。用户问「我那辆车什么情况」「跑了多少公里了」时用。只读。',
    _meta: { ui: { pagePath: 'pages/vehicle-detail/index' } },
    inputSchema: {
      type: 'object',
      properties: {
        carName: { type: 'string', description: '哪辆车；只有一辆时可省略，多辆必须指定' }
      }
    },
    outputSchema: {
      type: 'object',
      properties: {
        carName: { type: 'string' },
        energyType: { type: 'string' },
        mileages: { type: 'string' },
        initDate: { type: 'string' },
        serviceDays: { type: 'string' },
        maintainTotal: { type: 'string' },
        maintainPending: { type: 'string' },
        yearExpense: { type: 'string' },
        linkText: { type: 'string' },
        pagePath: { type: 'string', format: 'page-link', 'x-link-text-field': 'linkText' }
      }
    }
  });
}

// 保险/年检到期日通过 updateCar 维护
const upd = json.apis.find(a => a.name === 'updateCar');
if (upd && !upd.inputSchema.properties.insuranceExpireText) {
  upd.inputSchema.properties.insuranceExpireText = {
    type: 'string',
    description: '保险到期日 YYYY-MM-DD；空串表示清空'
  };
  upd.inputSchema.properties.inspectExpireText = {
    type: 'string',
    description: '年检到期日 YYYY-MM-DD；空串表示清空'
  };
}

fs.writeFileSync(FILE, `${JSON.stringify(json, null, 2)}\n`, 'utf8');
console.log('apis:', json.apis.length, json.apis.map(a => a.name).join(', '));
console.log('mcp size:', Buffer.byteLength(fs.readFileSync(FILE)));
