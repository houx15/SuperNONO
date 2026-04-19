// Content.jsx — dummy meeting data. Speaker labels only (no names, no meeting metadata shown on screen).

window.MEETING_HISTORY = [
  { id: 'mtg_8f3a', title: 'Q2 strategy review', date: '今天 · 14:00', duration: '42m', tag: 'Strategy', active: true },
  { id: 'mtg_7c2b', title: 'Design critique · Onboarding v3', date: '昨天 · 10:30', duration: '58m', tag: 'Design' },
  { id: 'mtg_6a19', title: '1:1 with Wei Lin', date: '周一 · 16:00', duration: '31m', tag: '1:1' },
  { id: 'mtg_5d0e', title: 'Eng all-hands', date: '上周五 · 09:00', duration: '1h 12m', tag: 'All-hands' },
  { id: 'mtg_4b88', title: 'Customer discovery · Acme Co.', date: '4月12日', duration: '47m', tag: 'Research' },
  { id: 'mtg_3f71', title: 'Pricing workshop round 2', date: '4月10日', duration: '1h 04m', tag: 'Pricing' },
  { id: 'mtg_2c4a', title: '投资人跟进会', date: '4月8日', duration: '38m', tag: 'Fundraise' },
  { id: 'mtg_1a22', title: 'Roadmap planning Q2', date: '4月3日', duration: '1h 30m', tag: 'Strategy' },
];

window.MEETING_DATA = {
  summaries: [
    {
      time: '14:00 — 14:06',
      topic: 'Q1 回顾与用户留存数据',
      text: 'Q1 关键指标：DAU 增长 38%，但第 30 日留存仍停留在 21%。讨论指出 onboarding 流失主要发生在第二步的权限授权环节，移动端尤为严重。团队同意将这一阶段流失视为本季度最优先的修复项。',
      speakers: ['Speaker 1', 'Speaker 3', 'Speaker 2'],
      state: 'done',
    },
    {
      time: '14:06 — 14:13',
      topic: '新市场：东南亚 vs. 日本',
      text: '讨论了下一步地域扩张的两个候选方向。东南亚胜在人口基数与竞争较弱，但 ARPU 偏低；日本用户付费意愿更强，但本地化和合规成本显著高于预期。倾向于先以新加坡为桥头堡，半年内再决定是否进入日本。',
      speakers: ['Speaker 2', 'Speaker 4', 'Speaker 1'],
      state: 'done',
    },
  ],

  aiExchange: {
    question: '东南亚主要 SaaS 竞品在新加坡的定价区间是多少？',
    answer: '新加坡市场头部三家工具类 SaaS 的月费大致落在 <strong>12 – 28 美元</strong> 区间，企业版约 <strong>45 – 80 美元</strong>。竞品 Notable 在过去 6 个月采取了<strong>按席位递减的阶梯定价</strong>，对 10 人以上团队折扣幅度最高达 <strong>40%</strong>。',
    cites: ['pricing.notion', 'g2.com · Notable', 'web · 2024 SaaS SEA Report'],
  },

  activeSummary: {
    time: '14:13 — 14:19',
    topic: '定价结构：按席位 vs. 按用量',
    text: '有人提出参考竞品的阶梯席位模型，也有担心对早期小团队不友好。目前倾向于混合模型：基础席位费 + 用量 soft cap',
    speakers: ['Speaker 4', 'Speaker 1'],
    state: 'active',
  },

  liveLines: [
    { speaker: 'Speaker 1', text: '所以我觉得我们应该先把东南亚市场跑通，再考虑日本' },
    { speaker: 'Speaker 2', text: '对，但定价结构上可能不能照搬北美那一套，得做本地化' },
    { speaker: 'Speaker 3', text: '其实我更担心的是客服时区的问题，尤其是企业客户' },
    { speaker: 'Speaker 4', text: '我们可以先用异步支持，响应时间控制在 4 小时以内应该够了' },
    { speaker: 'Speaker 1', text: '嘿 Nono，查一下新加坡那边主要竞品的定价区间' },
  ],

  export: {
    title: 'Q2 strategy review · 产品策略讨论',
    date: '2026-04-18',
    duration: '00:42:18',
    attendees: '4',
    wordcount: '1,842 字',
    docmeta: '2026-04-18 · 14:00 – 15:32',
    agenda: [
      'Q1 回顾与用户留存数据',
      '新市场扩张：东南亚 vs. 日本',
      '定价结构：席位 vs. 用量',
      '下一阶段执行计划',
    ],
    decisions: [
      '确认 Q2 首要目标为 onboarding 第二步流失修复（目标：第 30 日留存 21% → 30%）',
      '地域扩张：先进入新加坡，日本延后至 Q3 评估',
      '采用混合定价：基础席位费 + 用量 soft cap',
    ],
    actions: [
      { owner: 'Speaker 3', task: 'onboarding 权限流重设计，下周三 review', tag: 'Design' },
      { owner: 'Speaker 4', task: '定价模型 v1 草案 + 敏感度测算', tag: 'Pricing' },
      { owner: 'Speaker 2', task: '新加坡本地合规清单 & 支付渠道调研', tag: 'Launch' },
      { owner: 'Speaker 1', task: '向董事会汇报 Q2 OKR 更新', tag: 'Ops' },
    ],
  },
};
