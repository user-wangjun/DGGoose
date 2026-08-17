import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SaveSystem } from '../../src/core/SaveSystem.js';
import { StorageService } from '../../src/core/StorageService.js';
import { EventBus } from '../../src/core/EventBus.js';
import { EVENT } from '../../src/config.js';

/**
 * SaveSystem 存档系统测试
 * 覆盖自动/手动存档、载入恢复、损坏拒绝、版本校验、删除、槽位列表等核心场景。
 */
describe('SaveSystem 存档系统', () => {
  let storage;
  let eventBus;
  let saveSystem;

  beforeEach(() => {
    // 每个测试前清空 localStorage，保证槽位初始状态干净
    localStorage.clear();
    storage = new StorageService();
    eventBus = new EventBus();
    saveSystem = new SaveSystem({ storage, eventBus, version: 1 });
  });

  describe('autoSave 自动存档', () => {
    it('autoSave 写入 slot1', () => {
      const data = {
        chapter: 'ch1',
        checkpoint: 'start',
        badges: ['factory_cert'],
        settings: { bgm: 70 },
      };

      saveSystem.autoSave(data);

      const result = saveSystem.load('slot1');
      expect(result).not.toBeNull();
      expect(result.chapter).toBe('ch1');
      expect(result.checkpoint).toBe('start');
      expect(result.badges).toEqual(['factory_cert']);
    });

    it('autoSave 自动补充 version 和 timestamp', () => {
      const data = {
        chapter: 'prologue',
        checkpoint: 'middle',
        badges: [],
        settings: { bgm: 70 },
      };

      saveSystem.autoSave(data);

      const result = saveSystem.load('slot1');
      expect(result.version).toBe(1);
      expect(result.timestamp).toEqual(expect.any(Number));
    });

    it('autoSave 覆盖 slot1 旧存档', () => {
      saveSystem.autoSave({
        chapter: 'prologue',
        checkpoint: 'start',
        badges: [],
        settings: {},
      });
      saveSystem.autoSave({
        chapter: 'ch1',
        checkpoint: 'end',
        badges: ['basketball'],
        settings: {},
      });

      const result = saveSystem.load('slot1');
      expect(result.chapter).toBe('ch1');
      expect(result.badges).toEqual(['basketball']);
    });

    it('autoSave 触发 SAVE_WRITE 事件', () => {
      const handler = vi.fn();
      eventBus.on(EVENT.SAVE_WRITE, handler);

      saveSystem.autoSave({
        chapter: 'ch1',
        checkpoint: 'start',
        badges: [],
        settings: {},
      });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ slot: 'slot1', chapter: 'ch1' }),
      );
    });
  });

  describe('manualSave 手动存档', () => {
    it('manualSave 写入指定槽位 slot2', () => {
      const data = {
        chapter: 'ch2',
        checkpoint: 'middle',
        badges: ['basketball'],
        settings: { bgm: 60 },
      };

      saveSystem.manualSave('slot2', data);

      const result = saveSystem.load('slot2');
      expect(result).not.toBeNull();
      expect(result.chapter).toBe('ch2');
    });

    it('manualSave 写入指定槽位 slot3', () => {
      const data = {
        chapter: 'ch3',
        checkpoint: 'end',
        badges: ['roast_goose'],
        settings: { sfx: 50 },
      };

      saveSystem.manualSave('slot3', data);

      const result = saveSystem.load('slot3');
      expect(result).not.toBeNull();
      expect(result.chapter).toBe('ch3');
    });

    it('manualSave 触发 SAVE_WRITE 事件', () => {
      const handler = vi.fn();
      eventBus.on(EVENT.SAVE_WRITE, handler);

      saveSystem.manualSave('slot2', {
        chapter: 'ch1',
        checkpoint: 'start',
        badges: [],
        settings: {},
      });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ slot: 'slot2' }),
      );
    });

    it('manualSave 写入非法槽位时抛错', () => {
      expect(() =>
        saveSystem.manualSave('slot9', {
          chapter: 'ch1',
          checkpoint: 'start',
          badges: [],
          settings: {},
        }),
      ).toThrow();
    });
  });

  describe('load 载入存档', () => {
    it('load 返回完整的存档数据', () => {
      const data = {
        chapter: 'ch3',
        checkpoint: 'end',
        badges: ['roast_goose'],
        settings: { sfx: 50 },
      };

      saveSystem.manualSave('slot3', data);

      const result = saveSystem.load('slot3');
      expect(result).toEqual({
        version: 1,
        chapter: 'ch3',
        checkpoint: 'end',
        badges: ['roast_goose'],
        settings: { sfx: 50 },
        choice: null,
        timestamp: expect.any(Number),
      });
    });

    it('无存档时返回 null', () => {
      expect(saveSystem.load('slot1')).toBeNull();
      expect(saveSystem.load('slot2')).toBeNull();
      expect(saveSystem.load('slot3')).toBeNull();
    });

    it('load 成功时触发 SAVE_LOAD 事件', () => {
      saveSystem.autoSave({
        chapter: 'ch1',
        checkpoint: 'start',
        badges: [],
        settings: {},
      });

      const handler = vi.fn();
      eventBus.on(EVENT.SAVE_LOAD, handler);

      saveSystem.load('slot1');

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ slot: 'slot1', chapter: 'ch1' }),
      );
    });

    it('load 空槽位时不触发 SAVE_LOAD 事件', () => {
      const handler = vi.fn();
      eventBus.on(EVENT.SAVE_LOAD, handler);

      saveSystem.load('slot1');

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('损坏存档拒绝', () => {
    it('JSON 损坏时返回 null', () => {
      // 直接向 localStorage 写入损坏的 JSON
      localStorage.setItem('gxe:save_slot2', '{invalid json');

      expect(saveSystem.load('slot2')).toBeNull();
    });

    it('字段缺失时返回 null', () => {
      // 缺少 checkpoint、badges 等必要字段
      localStorage.setItem(
        'gxe:save_slot2',
        JSON.stringify({ version: 1, chapter: 'ch1' }),
      );

      expect(saveSystem.load('slot2')).toBeNull();
    });

    it('存档非对象类型时返回 null', () => {
      localStorage.setItem('gxe:save_slot2', JSON.stringify('just a string'));

      expect(saveSystem.load('slot2')).toBeNull();
    });
  });

  describe('version 版本校验', () => {
    it('版本不匹配时拒绝载入', () => {
      saveSystem.manualSave('slot2', {
        chapter: 'ch1',
        checkpoint: 'start',
        badges: [],
        settings: {},
      });

      // 手动篡改存档版本号模拟旧版本存档
      const raw = JSON.parse(localStorage.getItem('gxe:save_slot2'));
      raw.version = 999;
      localStorage.setItem('gxe:save_slot2', JSON.stringify(raw));

      expect(saveSystem.load('slot2')).toBeNull();
    });

    it('isCompatible 版本匹配返回 true', () => {
      const saveData = {
        version: 1,
        chapter: 'ch1',
        checkpoint: 'start',
        badges: [],
        settings: {},
        timestamp: Date.now(),
      };

      expect(saveSystem.isCompatible(saveData)).toBe(true);
    });

    it('isCompatible 版本不匹配返回 false', () => {
      const saveData = {
        version: 999,
        chapter: 'ch1',
        checkpoint: 'start',
        badges: [],
        settings: {},
        timestamp: Date.now(),
      };

      expect(saveSystem.isCompatible(saveData)).toBe(false);
    });

    it('isCompatible 字段缺失返回 false', () => {
      expect(saveSystem.isCompatible({ version: 1, chapter: 'ch1' })).toBe(false);
      expect(saveSystem.isCompatible(null)).toBe(false);
    });
  });

  describe('deleteSlot 删除存档', () => {
    it('deleteSlot 后数据消失', () => {
      saveSystem.manualSave('slot2', {
        chapter: 'ch1',
        checkpoint: 'start',
        badges: [],
        settings: {},
      });

      saveSystem.deleteSlot('slot2');

      expect(saveSystem.load('slot2')).toBeNull();
    });

    it('deleteSlot 删除自动存档槽位', () => {
      saveSystem.autoSave({
        chapter: 'ch1',
        checkpoint: 'start',
        badges: [],
        settings: {},
      });

      saveSystem.deleteSlot('slot1');

      expect(saveSystem.load('slot1')).toBeNull();
    });

    it('deleteSlot 不存在的槽位不报错', () => {
      expect(() => saveSystem.deleteSlot('slot2')).not.toThrow();
    });
  });

  describe('listSlots 槽位列表', () => {
    it('listSlots 返回3个槽位状态', () => {
      const slots = saveSystem.listSlots();

      expect(slots).toHaveLength(3);
      expect(slots[0].slot).toBe('slot1');
      expect(slots[1].slot).toBe('slot2');
      expect(slots[2].slot).toBe('slot3');
    });

    it('空槽位 hasSave 为 false', () => {
      const slots = saveSystem.listSlots();

      expect(slots.every((s) => s.hasSave === false)).toBe(true);
    });

    it('有存档的槽位 hasSave 为 true 并附带摘要信息', () => {
      saveSystem.autoSave({
        chapter: 'ch2',
        checkpoint: 'middle',
        badges: ['basketball'],
        settings: {},
      });

      const slots = saveSystem.listSlots();

      expect(slots[0].hasSave).toBe(true);
      expect(slots[0].chapter).toBe('ch2');
      expect(slots[0].timestamp).toEqual(expect.any(Number));
      expect(slots[1].hasSave).toBe(false);
    });

    it('slot1 标记为自动存档类型', () => {
      const slots = saveSystem.listSlots();

      expect(slots[0].type).toBe('auto');
      expect(slots[1].type).toBe('manual');
      expect(slots[2].type).toBe('manual');
    });
  });

  describe('getProgress 存档进度', () => {
    it('无存档时进度为 0', () => {
      expect(saveSystem.getProgress('slot1')).toBe(0);
    });

    it('序章进度约为 14%（1/7）', () => {
      saveSystem.autoSave({
        chapter: 'prologue',
        checkpoint: 'start',
        badges: [],
        settings: {},
      });

      const progress = saveSystem.getProgress('slot1');
      expect(progress).toBeGreaterThan(0);
      expect(progress).toBeLessThanOrEqual(100);
    });

    it('终章进度为 100%（7/7）', () => {
      saveSystem.manualSave('slot2', {
        chapter: 'finale',
        checkpoint: 'end',
        badges: [],
        settings: {},
      });

      expect(saveSystem.getProgress('slot2')).toBe(100);
    });

    it('中间章节进度按比例计算', () => {
      saveSystem.manualSave('slot3', {
        chapter: 'ch3',
        checkpoint: 'middle',
        badges: [],
        settings: {},
      });

      // ch3 是第4章（索引3），进度 = 4/7 ≈ 57%
      const progress = saveSystem.getProgress('slot3');
      expect(progress).toBe(Math.round((4 / 7) * 100));
    });
  });

  describe('choice 剧情抉择字段', () => {
    it('autoSave 时 data 不含 choice，load 返回的 choice 为 null', () => {
      saveSystem.autoSave({
        chapter: 'ch1',
        checkpoint: 'start',
        badges: [],
        settings: {},
      });

      const result = saveSystem.load('slot1');
      expect(result.choice).toBeNull();
    });

    it('autoSave 时 data 包含 choice: "ch1"，load 返回 choice 为 "ch1"', () => {
      saveSystem.autoSave({
        chapter: 'ch1',
        checkpoint: 'start',
        badges: [],
        settings: {},
        choice: 'ch1',
      });

      const result = saveSystem.load('slot1');
      expect(result.choice).toBe('ch1');
    });

    it('后续 autoSave 未传 choice 时保留已经选定的 choice', () => {
      saveSystem.autoSave({
        chapter: 'ch1',
        checkpoint: 'start',
        badges: [],
        settings: {},
      });
      saveSystem.setChoice('slot1', 'ch1');

      saveSystem.autoSave({
        chapter: 'ch2',
        checkpoint: 'start',
        badges: ['basketball'],
        settings: {},
      });

      expect(saveSystem.getChoice('slot1')).toBe('ch1');
    });

    it('setChoice 写入后 getChoice 返回正确值', () => {
      saveSystem.autoSave({
        chapter: 'ch1',
        checkpoint: 'start',
        badges: [],
        settings: {},
      });

      const ok = saveSystem.setChoice('slot1', 'ch1');
      expect(ok).toBe(true);
      expect(saveSystem.getChoice('slot1')).toBe('ch1');
    });

    it('setChoice 唯一性约束：已有 choice 时再次 setChoice 返回 false', () => {
      saveSystem.autoSave({
        chapter: 'ch1',
        checkpoint: 'start',
        badges: [],
        settings: {},
      });

      saveSystem.setChoice('slot1', 'ch1');
      const again = saveSystem.setChoice('slot1', 'ch2');
      expect(again).toBe(false);
      // 原有 choice 不被覆盖
      expect(saveSystem.getChoice('slot1')).toBe('ch1');
    });

    it('getChoice 无存档时返回 null', () => {
      expect(saveSystem.getChoice('slot1')).toBeNull();
      expect(saveSystem.getChoice('slot2')).toBeNull();
    });

    it('clearChoice 后 getChoice 返回 null', () => {
      saveSystem.autoSave({
        chapter: 'ch1',
        checkpoint: 'start',
        badges: [],
        settings: {},
      });
      saveSystem.setChoice('slot1', 'ch1');
      expect(saveSystem.getChoice('slot1')).toBe('ch1');

      saveSystem.clearChoice('slot1');
      expect(saveSystem.getChoice('slot1')).toBeNull();
    });

    it('setChoice 对空槽位返回 false（无存档不能设置）', () => {
      const ok = saveSystem.setChoice('slot1', 'ch1');
      expect(ok).toBe(false);
    });
  });
});
