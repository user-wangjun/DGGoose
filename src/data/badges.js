/**
 * 印记数据（对应 PRD §5 F10 印记表 + 剧情分支设计 v4 §5 印记体系）
 *
 * 印记分两类：
 * - 沿途印记（必得）：6 枚，各场景剧情完成自动获得
 * - 结局印记（唯一）：6 枚，松山湖终局按选择结算，一次游玩仅 1 枚
 *
 * 全收集（12 枚）需多周目，收集进度由章节地图与结局面板展示。
 */

/** 沿途印记分类标识 */
export const BADGE_TYPE = {
  JOURNEY: 'journey',
  ENDING: 'ending',
};

export const BADGES = [
  // ==================== 沿途印记（6 枚，必得） ====================
  {
    id: 'factory_cert',
    name: '出厂合格证',
    chapter: 'prologue',
    how: '翻出厂区围墙',
    desc: '从生产线上觉醒的第一份证明',
    type: BADGE_TYPE.JOURNEY,
  },
  {
    id: 'basketball',
    name: '篮球徽章',
    chapter: 'ch1',
    how: '完成篮球馆挑战（进 5 球或领取纪念）',
    desc: '篮球之城的掌声与荣耀',
    type: BADGE_TYPE.JOURNEY,
  },
  {
    id: 'lychee',
    name: '妃子笑',
    chapter: 'ch2',
    how: '解开栅栏门密码',
    desc: '岭南风物的甜蜜馈赠',
    type: BADGE_TYPE.JOURNEY,
  },
  {
    id: 'roast_goose',
    name: '莞香烧鹅',
    chapter: 'ch3',
    how: '偷尝并逃出店门',
    desc: '莞式烟火的味道记忆',
    type: BADGE_TYPE.JOURNEY,
  },
  {
    id: 'industrial',
    name: '工业齿轮',
    chapter: 'ch4',
    how: '组装访客徽章通过安检',
    desc: '科技兴国与工人阶级的致敬',
    type: BADGE_TYPE.JOURNEY,
  },
  {
    id: 'campus',
    name: '校园书签',
    chapter: 'ch5',
    how: '与 DGUT 学长学姐对话',
    desc: '教育兴邦的青春印记',
    type: BADGE_TYPE.JOURNEY,
  },
  // ==================== 结局印记（6 枚，唯一） ====================
  {
    id: 'training_camp',
    name: '训练营',
    chapter: 'ch1',
    how: '篮球馆选"留下"',
    desc: '篮球人生的起点，汗水浇灌梦想',
    type: BADGE_TYPE.ENDING,
  },
  {
    id: 'lychee_gardener',
    name: '荔枝园丁',
    chapter: 'ch2',
    how: '荔枝园选"留下"',
    desc: '荔枝传人的守候，耕耘岭南风物',
    type: BADGE_TYPE.ENDING,
  },
  {
    id: 'goose_chef',
    name: '烧鹅师傅',
    chapter: 'ch3',
    how: '烧鹅店选"留下"',
    desc: '烧鹅传人的手艺，烟火气中的传承',
    type: BADGE_TYPE.ENDING,
  },
  {
    id: 'developer',
    name: '研发者',
    chapter: 'ch4',
    how: '工业园选"留下"',
    desc: '科技新星的光芒，创新驱动未来',
    type: BADGE_TYPE.ENDING,
  },
  {
    id: 'student',
    name: '大学生',
    chapter: 'ch5',
    how: 'DGUT 选"留下"',
    desc: '大学新生的憧憬，知识改变命运',
    type: BADGE_TYPE.ENDING,
  },
  {
    id: 'lake',
    name: '松山湖光',
    chapter: 'finale',
    how: '全程未选"留下"（真结局）',
    desc: '归心之处，湖光映黄昏——介绍东莞，格局之选',
    type: BADGE_TYPE.ENDING,
  },
];
