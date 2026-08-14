import { describe, it, expect } from 'vitest';
import { CHAPTERS } from '../../src/data/chapters.js';
import { BADGES, BADGE_TYPE } from '../../src/data/badges.js';
import { DIALOGUES } from '../../src/data/dialogues.js';
import { HOTSPOTS, getHotspotsByScene } from '../../src/data/hotspots.js';
import { ENDINGS, getEndingById, getEndingByScene } from '../../src/data/endings.js';

describe('章节数据', () => {
  it('共 7 个章节（1 序章 + 5 正章 + 1 终章）', () => {
    expect(CHAPTERS).toHaveLength(7);
  });

  it('每个章节字段齐全（id/name/scene/badge/tag/time）', () => {
    for (const ch of CHAPTERS) {
      expect(ch).toHaveProperty('id');
      expect(ch).toHaveProperty('name');
      expect(ch).toHaveProperty('scene');
      expect(ch).toHaveProperty('badge');
      expect(ch).toHaveProperty('tag');
      expect(ch).toHaveProperty('time');
    }
  });

  it('章节 id 唯一', () => {
    const ids = CHAPTERS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // M5: ch1~ch5 必须有抉择点定义
  it('ch1~ch5 每章有 choice 抉择点定义', () => {
    const choiceChapters = CHAPTERS.filter((ch) => ch.choice);
    expect(choiceChapters).toHaveLength(5);
    for (const ch of choiceChapters) {
      expect(ch.choice).toHaveProperty('label');
      expect(ch.choice).toHaveProperty('ending');
      expect(ch.choice).toHaveProperty('badge');
      expect(typeof ch.choice.label).toBe('string');
      expect(ch.choice.label.length).toBeGreaterThan(0);
    }
  });

  it('序章和终章无 choice 字段', () => {
    const prologue = CHAPTERS.find((ch) => ch.id === 'prologue');
    const finale = CHAPTERS.find((ch) => ch.id === 'finale');
    expect(prologue.choice).toBeUndefined();
    expect(finale.choice).toBeUndefined();
  });

  it('每章 choice.badge 在 BADGES 中存在', () => {
    const badgeIds = BADGES.map((b) => b.id);
    for (const ch of CHAPTERS) {
      if (ch.choice) {
        expect(badgeIds).toContain(ch.choice.badge);
      }
    }
  });

  it('每章 choice.ending 在 ENDINGS 中存在', () => {
    const endingIds = ENDINGS.map((e) => e.id);
    for (const ch of CHAPTERS) {
      if (ch.choice) {
        expect(endingIds).toContain(ch.choice.ending);
      }
    }
  });
});

describe('印记数据', () => {
  // M5: 印记从 7 枚扩展为 12 枚（6 沿途 + 6 结局）
  it('共 12 枚印记（6 沿途 + 6 结局）', () => {
    expect(BADGES).toHaveLength(12);
    const journeyBadges = BADGES.filter((b) => b.type === BADGE_TYPE.JOURNEY);
    const endingBadges = BADGES.filter((b) => b.type === BADGE_TYPE.ENDING);
    expect(journeyBadges).toHaveLength(6);
    expect(endingBadges).toHaveLength(6);
  });

  it('每个印记字段齐全（id/name/chapter/how/desc/type）', () => {
    for (const b of BADGES) {
      expect(b).toHaveProperty('id');
      expect(b).toHaveProperty('name');
      expect(b).toHaveProperty('chapter');
      expect(b).toHaveProperty('how');
      expect(b).toHaveProperty('desc');
      expect(b).toHaveProperty('type');
    }
  });

  it('每枚印记关联到合法的章节 id', () => {
    const chapterIds = CHAPTERS.map((c) => c.id);
    for (const b of BADGES) {
      expect(chapterIds).toContain(b.chapter);
    }
  });

  // M5: 沿途印记 id 与对应章节的 badge 字段一致
  it('沿途印记 id 与对应章节的 badge 字段一致', () => {
    const chapterBadgeMap = new Map(CHAPTERS.map((c) => [c.id, c.badge]));
    const journeyBadges = BADGES.filter((b) => b.type === BADGE_TYPE.JOURNEY);
    for (const b of journeyBadges) {
      expect(b.id).toBe(chapterBadgeMap.get(b.chapter));
    }
  });

  // M5: 结局印记 id 唯一（一次游玩仅 1 枚）
  it('结局印记 id 全局唯一', () => {
    const endingBadges = BADGES.filter((b) => b.type === BADGE_TYPE.ENDING);
    const ids = endingBadges.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // M5: 结局印记对应章节的 choice.badge
  it('每枚结局印记对应某章 choice.badge 或终章 badge', () => {
    const choiceBadges = CHAPTERS.filter((ch) => ch.choice).map((ch) => ch.choice.badge);
    const finaleBadge = CHAPTERS.find((ch) => ch.id === 'finale').badge;
    const expectedEndingBadges = [...choiceBadges, finaleBadge];
    const endingBadges = BADGES.filter((b) => b.type === BADGE_TYPE.ENDING);
    for (const b of endingBadges) {
      expect(expectedEndingBadges).toContain(b.id);
    }
  });
});

describe('结局数据', () => {
  it('共 6 个结局（5 场景 + 1 真结局）', () => {
    expect(ENDINGS).toHaveLength(6);
  });

  it('每个结局字段齐全（id/title/scene/badge/achievement/narration/epilogue）', () => {
    for (const e of ENDINGS) {
      expect(e).toHaveProperty('id');
      expect(e).toHaveProperty('title');
      expect(e).toHaveProperty('scene');
      expect(e).toHaveProperty('badge');
      expect(e).toHaveProperty('achievement');
      expect(e).toHaveProperty('narration');
      expect(e).toHaveProperty('epilogue');
      expect(e.narration.length).toBeGreaterThan(0);
    }
  });

  it('结局 id 唯一', () => {
    const ids = ENDINGS.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('每条结局的 badge 在 BADGES 中存在且为结局类型', () => {
    const endingBadges = BADGES.filter((b) => b.type === BADGE_TYPE.ENDING);
    const endingBadgeIds = endingBadges.map((b) => b.id);
    for (const e of ENDINGS) {
      expect(endingBadgeIds).toContain(e.badge);
    }
  });

  it('getEndingById 返回正确结局', () => {
    const ending = getEndingById('basketball_life');
    expect(ending).toBeDefined();
    expect(ending.title).toBe('篮球人生');
  });

  it('getEndingById 对不存在 id 返回 undefined', () => {
    expect(getEndingById('nonexistent')).toBeUndefined();
  });

  it('getEndingByScene 返回对应场景结局', () => {
    const ending = getEndingByScene('ch1');
    expect(ending).toBeDefined();
    expect(ending.id).toBe('basketball_life');
  });

  it('getEndingByScene 对终章返回介绍东莞真结局', () => {
    const ending = getEndingByScene('finale');
    expect(ending).toBeDefined();
    expect(ending.id).toBe('intro_dongguan');
  });

  it('getEndingByScene 对无抉择场景返回 undefined', () => {
    expect(getEndingByScene('prologue')).toBeUndefined();
  });

  it('真结局为介绍东莞（intro_dongguan）', () => {
    const trueEnding = ENDINGS.find((e) => e.scene === 'finale');
    expect(trueEnding).toBeDefined();
    expect(trueEnding.id).toBe('intro_dongguan');
    expect(trueEnding.badge).toBe('lake');
  });
});

describe('对话数据', () => {
  it('所有 7 章对话键存在', () => {
    const keys = Object.keys(DIALOGUES);
    for (const ch of CHAPTERS) {
      expect(keys).toContain(ch.id);
    }
  });

  it('每章对话非空', () => {
    for (const ch of CHAPTERS) {
      expect(DIALOGUES[ch.id].length).toBeGreaterThan(0);
    }
  });

  it('每条对话结构合法（who/txt/tags）', () => {
    for (const ch of CHAPTERS) {
      for (const line of DIALOGUES[ch.id]) {
        expect(line).toHaveProperty('who');
        expect(line).toHaveProperty('txt');
        expect(line).toHaveProperty('tags');
        expect(Array.isArray(line.tags)).toBe(true);
        expect(typeof line.txt).toBe('string');
        expect(line.txt.length).toBeGreaterThan(0);
      }
    }
  });

  it('事件标记引用合法事件名', () => {
    // 校验所有 event 字段使用合法的命名格式（namespace:action）
    const validEventPattern = /^[a-z_]+:[a-z_]+$/;
    for (const ch of CHAPTERS) {
      for (const line of DIALOGUES[ch.id]) {
        if (line.event) {
          expect(line.event).toMatch(validEventPattern);
        }
      }
    }
  });

  // M5: ch1~ch5 必须包含 choice:start 抉择事件
  it('ch1~ch5 对话包含 choice:start 抉择事件', () => {
    const choiceChapters = ['ch1', 'ch2', 'ch3', 'ch4', 'ch5'];
    for (const chId of choiceChapters) {
      const hasChoiceStart = DIALOGUES[chId].some((line) => line.event === 'choice:start');
      expect(hasChoiceStart).toBe(true);
    }
  });

  it('ch3 收尾评价偷盗逃跑表现，不应声称莞小鹅已经会做烧鹅', () => {
    const choiceLine = DIALOGUES.ch3.find((line) => line.event === 'choice:start');
    expect(choiceLine?.txt).toContain('胆子不小，跑得也挺快');
    expect(choiceLine?.txt).not.toContain('手艺不错');
  });

  // M5: finale 必须包含走马灯结算事件
  it('finale 对话包含 choice:resolve 结算事件', () => {
    const hasResolve = DIALOGUES.finale.some((line) => line.event === 'choice:resolve');
    expect(hasResolve).toBe(true);
  });
});

describe('互动点数据', () => {
  it('共 6 个互动点（工业园区 3 + DGUT 3）', () => {
    expect(HOTSPOTS).toHaveLength(6);
  });

  it('每个互动点字段齐全（id/scene/name/text/x/y）', () => {
    for (const spot of HOTSPOTS) {
      expect(spot).toHaveProperty('id');
      expect(spot).toHaveProperty('scene');
      expect(spot).toHaveProperty('name');
      expect(spot).toHaveProperty('text');
      expect(spot).toHaveProperty('x');
      expect(spot).toHaveProperty('y');
    }
  });

  it('互动点 id 唯一', () => {
    const ids = HOTSPOTS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('互动点所属场景为 ch4 或 ch5', () => {
    for (const spot of HOTSPOTS) {
      expect(['ch4', 'ch5']).toContain(spot.scene);
    }
  });

  it('工业园区（ch4）有 3 个互动点', () => {
    expect(getHotspotsByScene('ch4')).toHaveLength(3);
  });

  it('DGUT（ch5）有 3 个互动点', () => {
    expect(getHotspotsByScene('ch5')).toHaveLength(3);
  });

  it('getHotspotsByScene 对不存在场景返回空数组', () => {
    expect(getHotspotsByScene('unknown')).toEqual([]);
  });
});
