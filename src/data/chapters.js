/**
 * 章节数据（对应 PRD §4.2 章节总表 + 剧情分支设计 v4）
 * 每章含 id/name/tag/badge/scene/time 字段，供章节地图与存档系统使用。
 * ch1~ch5 增加 choice 字段定义伞形多结局的抉择点（留下 → 对应结局印记）。
 */
export const CHAPTERS = [
  {
    id: 'prologue',
    name: '序章 · 生产线觉醒',
    scene: '玩具工厂',
    coreEvent: '流水线睁眼，躲开机械臂与传送带，翻墙出逃',
    gameplay: '移动 + 互动教学',
    badge: 'factory_cert',
    tag: '世界工厂',
    time: 3,
  },
  {
    id: 'ch1',
    name: '第一章 · 篮球馆',
    scene: '街头篮球馆',
    coreEvent: '循着运球声进入球馆，投篮过关获得掌声',
    gameplay: '投篮小游戏',
    badge: 'basketball',
    tag: '篮球之城',
    time: 4,
    /** 抉择点：留下训练 → 篮球人生结局 */
    choice: {
      label: '留下训练',
      ending: 'basketball_life',
      badge: 'training_camp',
    },
  },
  {
    id: 'ch2',
    name: '第二章 · 荔枝园',
    scene: '荔枝果园',
    coreEvent: '按指示牌顺序点触荔枝树开门',
    gameplay: '序列点触解谜',
    badge: 'lychee',
    tag: '岭南风物',
    time: 4,
    /** 抉择点：留下种荔枝 → 荔枝传人结局 */
    choice: {
      label: '留下种荔枝',
      ending: 'lychee_heir',
      badge: 'lychee_gardener',
    },
  },
  {
    id: 'ch3',
    name: '第三章 · 烧鹅店',
    scene: '老字号烧鹅店',
    coreEvent: '被烧鹅香气勾进店里，潜行偷尝后仓皇出逃',
    gameplay: '潜行 + 追逐',
    badge: 'roast_goose',
    tag: '莞式烟火',
    time: 5,
    /** 抉择点：留下做烧鹅 → 烧鹅传人结局 */
    choice: {
      label: '留下做烧鹅',
      ending: 'goose_heir',
      badge: 'goose_chef',
    },
  },
  {
    id: 'ch4',
    name: '第四章 · 工业园区',
    scene: '高新园区 + 制造工厂',
    coreEvent: '集齐零件组装访客徽章通过安检',
    gameplay: '收集组合解谜',
    badge: 'industrial',
    tag: '科技兴国 / 工人阶级',
    time: 5,
    /** 抉择点：留下研发 → 科技新星结局 */
    choice: {
      label: '留下研发',
      ending: 'tech_star',
      badge: 'developer',
    },
  },
  {
    id: 'ch5',
    name: '第五章 · DGUT',
    scene: '东莞理工学院校园',
    coreEvent: '与学长学姐对话，领悟教育兴邦',
    gameplay: '观赏互动',
    badge: 'campus',
    tag: '教育兴邦',
    time: 3,
    /** 抉择点：留下入学 → 大学新生结局 */
    choice: {
      label: '留下入学',
      ending: 'college_freshman',
      badge: 'student',
    },
  },
  {
    id: 'finale',
    name: '终章 · 松山湖',
    scene: '松山湖畔',
    coreEvent: '走马灯回顾旅程，按抉择结算对应结局',
    gameplay: '走马灯 + 结算',
    badge: 'lake',
    tag: '归心',
    time: 4,
  },
];
