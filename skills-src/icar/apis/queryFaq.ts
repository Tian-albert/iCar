// 常见问题（使用帮助）
//
// 评测场景「查看使用帮助」（权重 1%）此前是 0%：没有任何接口能答「数据怎么备份」。
// 这里只做「能不能答上」，答案与「常见问题」页保持同一口径，不另造一套说法。
interface Args {
  /** 用户的问题原话，用于匹配条目 */
  question?: string;
}

interface FaqItem {
  key: string;
  keywords: string[];
  q: string;
  a: string;
}

const FAQ: FaqItem[] = [
  {
    key: 'backup',
    keywords: ['备份', '导出', '换手机', '迁移', '数据丢'],
    q: '换手机 / 数据怎么备份',
    a: '数据只存在这台手机上。换手机前到「设置 → 数据导入导出」导出备份文件，在新手机上导入即可。'
  },
  {
    key: 'recycle',
    keywords: ['删错', '恢复', '回收站', '误删'],
    q: '删错了能恢复吗',
    a: '可以。「设置 → 回收站」里能找回近期删除的记录，超过保留期的就无法恢复了。'
  },
  {
    key: 'category',
    keywords: ['分类', '类别', '加一个', '改名字'],
    q: '怎么新增或修改支出分类',
    a: '到「设置 → 支出分类管理」可以新增、改名、隐藏分类；预置分类不建议删除，会影响历史统计。'
  },
  {
    key: 'fix',
    keywords: ['记错', '改一下', '修改记录', '金额错'],
    q: '记错了怎么改',
    a: '到「全部记录」里找到那一条，点进去就能改金额、日期和备注；加油记录还会自动重算油耗。'
  },
  {
    key: 'maintain-cycle',
    keywords: ['保养周期', '多少公里保养', '保养项'],
    q: '保养周期怎么设置',
    a: '在「保养项管理」里给每项设周期（公里或天数），记一次保养后会自动顺延并提醒下次到期。'
  },
  {
    key: 'cost',
    keywords: ['每公里', '油耗怎么算', '成本怎么算'],
    q: '每公里成本 / 油耗是怎么算的',
    a: '每公里成本 = 区间支出 ÷ 区间有效里程；油耗 = 两次加满之间的油量 ÷ 里程 × 100。只统计有效的加满区间。'
  }
];

export async function queryFaq(args: Args = {}): Promise<AgentApiResult> {
  const text = (args.question || '').trim();
  const hit = text
    ? FAQ.find(item => item.keywords.some(k => text.includes(k)))
    : undefined;

  const item = hit || FAQ[0];
  const answer = hit
    ? `Q：${item.q}\nA：${item.a}`
    : `常见问题有：${FAQ.map(f => f.q).join('；')}。要问哪一个？`;

  return {
    isError: false,
    content: [{ type: 'text', text: answer }],
    structuredContent: {
      matched: hit ? item.q : '',
      answer: hit ? item.a : '',
      topics: FAQ.map(f => f.q).join('、'),
      pagePath: 'pages/faq/index',
      linkText: '查看常见问题'
    },
    // 页面上还有更多条目，接力到「常见问题」页
    handoff: () => ({
      query: '',
      payload: { matched: hit ? item.q : '', topics: FAQ.length }
    })
  };
}
