// 临时脚本：注册 queryFaq
const fs = require('fs');
const FILE = 'skills/icar/mcp.json';
const json = JSON.parse(fs.readFileSync(FILE, 'utf8'));

if (!json.apis.some(a => a.name === 'queryFaq')) {
  json.apis.push({
    name: 'queryFaq',
    description:
      '常见问题：数据备份与换手机、删错了怎么恢复、支出分类怎么改、记错了怎么改、保养周期怎么设、每公里成本与油耗怎么算。用户问「怎么用」类问题时用。只读。',
    _meta: { ui: { pagePath: 'pages/faq/index' } },
    inputSchema: {
      type: 'object',
      properties: {
        question: { type: 'string', description: '用户的问题原话，用于匹配条目' }
      }
    },
    outputSchema: {
      type: 'object',
      properties: {
        matched: { type: 'string' },
        answer: { type: 'string' },
        topics: { type: 'string' },
        linkText: { type: 'string' },
        pagePath: { type: 'string', format: 'page-link', 'x-link-text-field': 'linkText' }
      }
    }
  });
}

fs.writeFileSync(FILE, `${JSON.stringify(json, null, 2)}\n`, 'utf8');
console.log('apis:', json.apis.length);
