// 临时脚本：把两条行为约束写进 mcp 描述（SKILL.md 已到 16000 上限）
const fs = require('fs');
const FILE = 'skills/icar/mcp.json';
const json = JSON.parse(fs.readFileSync(FILE, 'utf8'));

const addCost = json.apis.find(a => a.name === 'addCost');
if (addCost) {
  addCost.description =
    '记一笔日常支出（停车、高速、洗车、保险、配件等）。' +
    '**类别必须能从已有分类里匹配上**：匹配不到会返回可选类别列表，据此问用户，不要自己归到别的类别里。' +
    '用户没说哪辆车且有多辆车时不要传 carName，先问。';
  addCost.inputSchema.properties.categoryName.description =
    '支出类别名，如「停车」「洗车」「高速」。不确定就先不传/传用户原话，接口会返回可选列表让你问';
}

const qm = json.apis.find(a => a.name === 'queryMaintain');
if (qm) {
  qm.description =
    '查保养项剩余里程/天数与超期情况（单车或全车汇总）。' +
    '用户只问某一项（「机油还能跑多少」）时传 itemName，页面会定位到该项。只读。';
}

fs.writeFileSync(FILE, `${JSON.stringify(json, null, 2)}\n`, 'utf8');
console.log('描述已更新');
