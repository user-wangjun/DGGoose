import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadgeSystem } from '../../src/core/BadgeSystem.js';
import { StorageService } from '../../src/core/StorageService.js';
import { EventBus } from '../../src/core/EventBus.js';
import { BADGES } from '../../src/data/badges.js';
import { EVENT } from '../../src/config.js';

/**
 * BadgeSystem 印记收集系统测试
 * 覆盖 F10 印记收集功能的核心逻辑：解锁、去重、进度、全收集成就、
 * 收集动效事件、无效id拒绝、持久化、列表查询、防剧透。
 */
describe('BadgeSystem 印记收集系统', () => {
  let storage;
  let eventBus;
  let badgeSystem;

  beforeEach(() => {
    // 每个测试前清空 localStorage，保证测试隔离
    localStorage.clear();
    storage = new StorageService();
    eventBus = new EventBus();
    badgeSystem = new BadgeSystem({ storage, eventBus });
  });

  // ---------- 解锁与查询 ----------

  it('解锁印记后 isUnlocked 返回 true', () => {
    badgeSystem.unlock('factory_cert');

    expect(badgeSystem.isUnlocked('factory_cert')).toBe(true);
  });

  it('未解锁的印记 isUnlocked 返回 false', () => {
    expect(badgeSystem.isUnlocked('factory_cert')).toBe(false);
  });

  it('unlock 返回 true 表示解锁成功', () => {
    expect(badgeSystem.unlock('factory_cert')).toBe(true);
  });

  // ---------- 去重 ----------

  it('同一 id 多次 unlock 不重复计数', () => {
    badgeSystem.unlock('factory_cert');
    badgeSystem.unlock('factory_cert');
    badgeSystem.unlock('factory_cert');

    expect(badgeSystem.getProgress().collected).toBe(1);
  });

  it('重复 unlock 同一 id 返回 false', () => {
    badgeSystem.unlock('factory_cert');

    expect(badgeSystem.unlock('factory_cert')).toBe(false);
  });

  it('重复 unlock 同一 id 不再次触发 BADGE_GET 事件', () => {
    const handler = vi.fn();
    eventBus.on(EVENT.BADGE_GET, handler);

    badgeSystem.unlock('factory_cert');
    badgeSystem.unlock('factory_cert');

    expect(handler).toHaveBeenCalledTimes(1);
  });

  // ---------- 进度计算 ----------

  // M5: 印记从 7 枚扩展为 12 枚（6 沿途 + 6 结局）
  it('初始进度为 0/12', () => {
    const progress = badgeSystem.getProgress();

    expect(progress.collected).toBe(0);
    expect(progress.total).toBe(12);
  });

  it('解锁 3 个后 progress 为 3/12', () => {
    badgeSystem.unlock('factory_cert');
    badgeSystem.unlock('basketball');
    badgeSystem.unlock('lychee');

    const progress = badgeSystem.getProgress();
    expect(progress.collected).toBe(3);
    expect(progress.total).toBe(12);
  });

  it('getProgress 返回正确的百分比', () => {
    badgeSystem.unlock('factory_cert');
    badgeSystem.unlock('basketball');
    badgeSystem.unlock('lychee');

    const progress = badgeSystem.getProgress();
    // 3/12 = 25%
    expect(progress.percent).toBeCloseTo((3 / 12) * 100, 1);
  });

  // ---------- 全收集成就 ----------

  // M5: 全部 12 枚印记解锁后触发成就
  it('解锁全部 12 个后触发 BADGE_ALL 事件', () => {
    const handler = vi.fn();
    eventBus.on(EVENT.BADGE_ALL, handler);

    BADGES.forEach((badge) => badgeSystem.unlock(badge.id));

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('BADGE_ALL 事件携带"莞城通"成就信息', () => {
    const handler = vi.fn();
    eventBus.on(EVENT.BADGE_ALL, handler);

    BADGES.forEach((badge) => badgeSystem.unlock(badge.id));

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ achievement: '莞城通' })
    );
  });

  it('未全部收集时不触发 BADGE_ALL 事件', () => {
    const handler = vi.fn();
    eventBus.on(EVENT.BADGE_ALL, handler);

    badgeSystem.unlock('factory_cert');
    badgeSystem.unlock('basketball');

    expect(handler).not.toHaveBeenCalled();
  });

  it('isAllCollected 全部收集后返回 true', () => {
    BADGES.forEach((badge) => badgeSystem.unlock(badge.id));

    expect(badgeSystem.isAllCollected()).toBe(true);
  });

  it('isAllCollected 未全部收集时返回 false', () => {
    badgeSystem.unlock('factory_cert');

    expect(badgeSystem.isAllCollected()).toBe(false);
  });

  // ---------- 收集动效事件 ----------

  it('unlock 时触发 BADGE_GET 事件', () => {
    const handler = vi.fn();
    eventBus.on(EVENT.BADGE_GET, handler);

    badgeSystem.unlock('factory_cert');

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('BADGE_GET 事件携带完整 badge 信息', () => {
    const handler = vi.fn();
    eventBus.on(EVENT.BADGE_GET, handler);

    badgeSystem.unlock('factory_cert');

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        badge: expect.objectContaining({
          id: 'factory_cert',
          name: '出厂合格证',
          chapter: 'prologue',
          how: '翻出厂区围墙',
          desc: '从生产线上觉醒的第一份证明',
        }),
      })
    );
  });

  // ---------- 无效 id 拒绝 ----------

  it('unlock 未知 id 时返回 false', () => {
    expect(badgeSystem.unlock('unknown_badge')).toBe(false);
  });

  it('unlock 未知 id 不触发 BADGE_GET 事件', () => {
    const handler = vi.fn();
    eventBus.on(EVENT.BADGE_GET, handler);

    badgeSystem.unlock('unknown_badge');

    expect(handler).not.toHaveBeenCalled();
  });

  it('unlock 未知 id 不增加计数', () => {
    badgeSystem.unlock('unknown_badge');

    expect(badgeSystem.getProgress().collected).toBe(0);
  });

  // ---------- 持久化 ----------

  it('重新创建实例后已解锁的印记仍存在', () => {
    badgeSystem.unlock('factory_cert');
    badgeSystem.unlock('basketball');

    // 用同一 storage 重新创建实例，模拟游戏重启
    const newBadgeSystem = new BadgeSystem({ storage, eventBus });

    expect(newBadgeSystem.isUnlocked('factory_cert')).toBe(true);
    expect(newBadgeSystem.isUnlocked('basketball')).toBe(true);
    expect(newBadgeSystem.getProgress().collected).toBe(2);
  });

  it('重新创建实例后未解锁的印记仍为未解锁', () => {
    badgeSystem.unlock('factory_cert');

    const newBadgeSystem = new BadgeSystem({ storage, eventBus });

    expect(newBadgeSystem.isUnlocked('basketball')).toBe(false);
  });

  // ---------- 已解锁列表 ----------

  it('getUnlocked 返回已解锁的 badge 数组', () => {
    badgeSystem.unlock('factory_cert');
    badgeSystem.unlock('basketball');

    const unlocked = badgeSystem.getUnlocked();

    expect(unlocked).toHaveLength(2);
  });

  it('getUnlocked 返回的元素包含完整 badge 信息', () => {
    badgeSystem.unlock('factory_cert');

    const unlocked = badgeSystem.getUnlocked();

    expect(unlocked[0]).toEqual(
      expect.objectContaining({
        id: 'factory_cert',
        name: '出厂合格证',
      })
    );
  });

  it('未解锁任何印记时 getUnlocked 返回空数组', () => {
    expect(badgeSystem.getUnlocked()).toEqual([]);
  });

  // ---------- 防剧透 ----------

  it('getBadgeInfo 对未解锁的印记仅返回基础信息（不含 desc/how）', () => {
    const info = badgeSystem.getBadgeInfo('factory_cert');

    expect(info).toEqual({
      id: 'factory_cert',
      name: '出厂合格证',
      chapter: 'prologue',
    });
    expect(info).not.toHaveProperty('desc');
    expect(info).not.toHaveProperty('how');
  });

  it('getBadgeInfo 对已解锁的印记返回完整信息', () => {
    badgeSystem.unlock('factory_cert');

    const info = badgeSystem.getBadgeInfo('factory_cert');

    expect(info).toEqual(
      expect.objectContaining({
        id: 'factory_cert',
        name: '出厂合格证',
        how: '翻出厂区围墙',
        desc: '从生产线上觉醒的第一份证明',
      })
    );
  });

  it('getBadgeInfo 对未知 id 返回 null', () => {
    expect(badgeSystem.getBadgeInfo('unknown_badge')).toBeNull();
  });

  // ---------- 重置 ----------

  it('reset 清空所有解锁记录', () => {
    badgeSystem.unlock('factory_cert');
    badgeSystem.unlock('basketball');

    badgeSystem.reset();

    expect(badgeSystem.getProgress().collected).toBe(0);
    expect(badgeSystem.isUnlocked('factory_cert')).toBe(false);
  });

  it('reset 后持久化数据也被清除', () => {
    badgeSystem.unlock('factory_cert');
    badgeSystem.reset();

    const newBadgeSystem = new BadgeSystem({ storage, eventBus });
    expect(newBadgeSystem.isUnlocked('factory_cert')).toBe(false);
  });
});
