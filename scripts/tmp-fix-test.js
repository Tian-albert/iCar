// 临时脚本：修正测试文件里的重名变量，并把 addMaintain 挂进 loadApis
const fs = require('fs');
const FILE = 'tests/skill-apis.test.ts';

let text = fs.readFileSync(FILE, 'utf8');
// 与 skill-lib-sync.test.ts 的 fsx 冲突（两个文件都是全局脚本作用域）
text = text.split('fsx').join('fsApi');

const anchor = "    addRefuel: require('../skills/icar/apis/addRefuel').addRefuel\n";
if (!text.includes("addMaintain: require")) {
  text = text.replace(anchor, `${anchor}    addMaintain: require('../skills/icar/apis/addMaintain').addMaintain\n`);
}

fs.writeFileSync(FILE, text, 'utf8');
console.log('已修正：fsx→fsApi，loadApis 增加 addMaintain');
