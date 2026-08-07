import { describe, it, expect } from 'vitest';
import { resolveEnding, isTrueEnding } from '../../src/core/SongshanLogic.js';

/**
 * SongshanLogic 松山湖结算逻辑测试（对应剧情分支设计 v4 §4 结局体系 + Task 5.5）
 *
 * 覆盖结算判定纯函数：
 * - resolveEnding：根据 choice（留下场景 id 或 null）决定结局
 *   · 无 choice → 真结局 intro_dongguan
 *   · 有 choice → 对应场景结局（ch1~ch5 分别映射 5 个场景结局）
 * - isTrueEnding：仅当未选"留下"（choice 为 null）时为真结局
 */
describe('SongshanLogic 松山湖结算逻辑', () => {
  // ==================== resolveEnding 结局判定 ====================

  describe('resolveEnding 结局判定', () => {
    it('无 choice（null）返回真结局 intro_dongguan', () => {
      const result = resolveEnding(null);
      expect(result.endingId).toBe('intro_dongguan');
      expect(result.isTrueEnding).toBe(true);
    });

    it('choice 为 ch1 返回篮球人生结局 basketball_life', () => {
      const result = resolveEnding('ch1');
      expect(result.endingId).toBe('basketball_life');
      expect(result.isTrueEnding).toBe(false);
    });

    it('choice 为 ch2 返回荔枝传人结局 lychee_heir', () => {
      const result = resolveEnding('ch2');
      expect(result.endingId).toBe('lychee_heir');
      expect(result.isTrueEnding).toBe(false);
    });

    it('choice 为 ch3 返回烧鹅传人结局 goose_heir', () => {
      const result = resolveEnding('ch3');
      expect(result.endingId).toBe('goose_heir');
      expect(result.isTrueEnding).toBe(false);
    });

    it('choice 为 ch4 返回科技新星结局 tech_star', () => {
      const result = resolveEnding('ch4');
      expect(result.endingId).toBe('tech_star');
      expect(result.isTrueEnding).toBe(false);
    });

    it('choice 为 ch5 返回大学新生结局 college_freshman', () => {
      const result = resolveEnding('ch5');
      expect(result.endingId).toBe('college_freshman');
      expect(result.isTrueEnding).toBe(false);
    });
  });

  // ==================== isTrueEnding 真结局判定 ====================

  describe('isTrueEnding 真结局判定', () => {
    it('choice 为 null 时返回 true（全程未留，触发真结局）', () => {
      expect(isTrueEnding(null)).toBe(true);
    });

    it('choice 为 ch1 时返回 false（已选留下，非真结局）', () => {
      expect(isTrueEnding('ch1')).toBe(false);
    });
  });
});
