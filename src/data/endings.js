/**
 * 结局数据（对应剧情分支设计 v4 §4 结局体系）
 *
 * 6 个结局 CG：5 个场景结局（中途选"留下"）+ 1 个真结局（全程未留）。
 * 每个结局定义标题、文案、对应印记与所属场景，供 EndingCG 组件渲染。
 */

export const ENDINGS = [
  {
    id: 'basketball_life',
    title: '篮球人生',
    scene: 'ch1',
    badge: 'training_camp',
    achievement: '篮球新星',
    narration: '莞小鹅选择了留下。球馆的灯光为它而亮，汗水浸透了每一寸地板。从笨拙的第一次投篮到游刃有余的转身过人，它成了篮球馆里最矮却最拼的球员。教练说："身高不是问题，热爱才是。"',
    epilogue: '——结局 · 篮球人生——',
  },
  {
    id: 'lychee_heir',
    title: '荔枝传人',
    scene: 'ch2',
    badge: 'lychee_gardener',
    achievement: '岭南果农',
    narration: '莞小鹅选择了留下。果农阿婆手把手教它修剪枝叶、辨识果熟。春来花开满园，夏至红果压枝。它学会了"农民真伟大"——每一颗荔枝都是汗水浇灌的甜蜜。阿婆说："种地要用心，果子才会甜。"',
    epilogue: '——结局 · 荔枝传人——',
  },
  {
    id: 'goose_heir',
    title: '烧鹅传人',
    scene: 'ch3',
    badge: 'goose_chef',
    achievement: '烧鹅师傅',
    narration: '莞小鹅选择了留下。老板收起了追打它的扫帚，递来一把菜刀。"同类相食"的笑点变成了最认真的拜师学艺。从腌制到烤制，它学到了莞式烧鹅的每一道工序。老板说："你是烧鹅造型的潮玩，却把烧鹅做得比谁都好，这大概就是命运。"',
    epilogue: '——结局 · 烧鹅传人——',
  },
  {
    id: 'tech_star',
    title: '科技新星',
    scene: 'ch4',
    badge: 'developer',
    achievement: '研发新星',
    narration: '莞小鹅选择了留下。工业园的玻璃幕墙映出它小小的身影。它跟着工程师调试机械臂，和工人一起拧螺丝。科技兴国的口号在它心中生根发芽——"每一颗螺丝都拧得出汗水的重量"。它发现，自己这个被生产出来的玩具，也能参与创造未来。',
    epilogue: '——结局 · 科技新星——',
  },
  {
    id: 'college_freshman',
    title: '大学新生',
    scene: 'ch5',
    badge: 'student',
    achievement: '莘莘学子',
    narration: '莞小鹅选择了留下。它坐在 DGUT 的教室里，第一次翻开课本。学姐的话在耳边回响："你有选择的权利。"它选择了用知识武装自己。图书馆的灯为它亮到深夜，校道上的落叶见证了它的成长。教育兴邦，从这一刻起不再只是标语。',
    epilogue: '——结局 · 大学新生——',
  },
  {
    id: 'intro_dongguan',
    title: '介绍东莞',
    scene: 'finale',
    badge: 'lake',
    achievement: '莞城宣传大使',
    narration: '莞小鹅一路走来，看过篮球馆的欢呼、荔枝园的甜蜜、烧鹅店的烟火、工厂的力量、校园的灯火。它没有在任何一站停留——因为它想看遍整座城。此刻，站在松山湖的黄昏里，它做出了最大的格局之选：留下来，把这座城市的故事讲给全世界听。这，就是莞小鹅作为东莞烧鹅文化"宣传大使"的使命。',
    epilogue: '——真结局 · 介绍东莞——',
  },
];

/**
 * 根据结局 id 查找结局数据
 * @param {string} id - 结局 id
 * @returns {Object|undefined}
 */
export function getEndingById(id) {
  return ENDINGS.find((ending) => ending.id === id);
}

/**
 * 根据场景 id 查找对应的结局（用于"留下"抉择结算）
 * @param {string} sceneId - 场景/章节 id（如 'ch1'）
 * @returns {Object|undefined}
 */
export function getEndingByScene(sceneId) {
  return ENDINGS.find((ending) => ending.scene === sceneId);
}
