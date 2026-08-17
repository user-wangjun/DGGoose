import { getEndingByScene } from '../data/endings.js';

/**
 * 松山湖结算逻辑（对应剧情分支设计 v4 §4 结局体系 + Task 5.5）
 *
 * 伞形多结局结算：玩家在 ch1~ch5 任一场景选"留下"即记录 choice，
 * 终章松山湖走马灯后按 choice 结算对应场景结局；全程未留则触发真结局。
 * 纯函数无副作用，便于 TDD 与多结局组合验证。
 */

/** 真结局 id：全程未选"留下"时触发，对应"介绍东莞"格局之选 */
const TRUE_ENDING_ID = 'intro_dongguan';

/**
 * 结算判定纯函数：根据 choice 决定结局
 * - 有 choice → 返回对应场景的结局 id（如 ch1 → basketball_life）
 * - 无 choice → 返回真结局 intro_dongguan
 * @param {string|null|undefined} choice - 玩家留下场景 id 或 null
 * @returns {{ endingId: string, isTrueEnding: boolean }} 结局判定结果
 */
export function resolveEnding(choice) {
  // 无 choice 视为真结局：玩家全程未停留，想看遍整座城
  if (isTrueEnding(choice)) {
    return { endingId: TRUE_ENDING_ID, isTrueEnding: true };
  }

  // 有 choice → 查找该场景对应的结局
  const ending = getEndingByScene(choice);
  // 数据缺失时回退真结局，保证结算流程不中断
  if (!ending) {
    return { endingId: TRUE_ENDING_ID, isTrueEnding: true };
  }

  return { endingId: ending.id, isTrueEnding: false };
}

/**
 * 判断是否为真结局
 * 仅当玩家未在任何场景选"留下"（choice 为 null/undefined）时为真结局
 * @param {string|null|undefined} choice - 玩家留下场景 id 或 null
 * @returns {boolean}
 */
export function isTrueEnding(choice) {
  return choice === null || choice === undefined;
}
