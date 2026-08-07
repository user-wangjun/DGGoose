import { EVENT } from '../config.js';
import { CHAPTERS } from '../data/chapters.js';

/**
 * 存档槽位配置
 * slot1 为自动存档（章完成/小游戏过关自动写入），slot2/slot3 为手动存档。
 */
const SLOT_CONFIG = [
  { slot: 'slot1', type: 'auto', storageKey: 'save_slot1' },
  { slot: 'slot2', type: 'manual', storageKey: 'save_slot2' },
  { slot: 'slot3', type: 'manual', storageKey: 'save_slot3' },
];

/** 存档必要字段，缺失任意一项即视为损坏存档 */
const REQUIRED_FIELDS = ['version', 'chapter', 'checkpoint', 'badges', 'settings', 'timestamp'];

/**
 * 存档系统
 * 管理三个存档槽位（1自动 + 2手动），通过 StorageService 持久化，
 * 通过 EventBus 广播存档写入/载入事件，供 UI 层监听刷新。
 */
export class SaveSystem {
  /**
   * @param {Object} deps - 依赖注入
   * @param {StorageService} deps.storage - 存储服务实例
   * @param {EventBus} deps.eventBus - 事件总线实例
   * @param {number} deps.version - 存档版本号，不匹配的旧存档将被拒绝载入
   */
  constructor({ storage, eventBus, version = 1 }) {
    this.storage = storage;
    this.eventBus = eventBus;
    this.version = version;
  }

  /**
   * 自动存档，固定写入 slot1
   * 触发场景：章节完成、小游戏过关
   * @param {Object} data - 存档数据（chapter/checkpoint/badges/settings）
   */
  autoSave(data) {
    this._writeSlot('slot1', data);
  }

  /**
   * 手动存档，写入玩家选择的槽位
   * @param {string} slot - 槽位标识：'slot2' 或 'slot3'
   * @param {Object} data - 存档数据（chapter/checkpoint/badges/settings）
   */
  manualSave(slot, data) {
    this._validateSlot(slot);
    this._writeSlot(slot, data);
  }

  /**
   * 载入指定槽位的存档
   * 损坏存档、版本不兼容、空槽位均返回 null，不触发 SAVE_LOAD 事件
   * @param {string} slot - 槽位标识
   * @returns {Object|null} 存档数据或 null
   */
  load(slot) {
    const rawData = this._readSlot(slot);
    if (!rawData) return null;

    // 载入成功后通知 UI 层刷新
    this.eventBus.emit(EVENT.SAVE_LOAD, {
      slot,
      chapter: rawData.chapter,
      timestamp: rawData.timestamp,
    });

    return rawData;
  }

  /**
   * 删除指定槽位的存档
   * @param {string} slot - 槽位标识
   */
  deleteSlot(slot) {
    const config = this._getSlotConfig(slot);
    if (!config) return;

    this.storage.remove(config.storageKey);
  }

  /**
   * 获取所有槽位状态列表，供 UI 面板渲染
   * @returns {Array<Object>} 槽位状态数组，每项含 slot/type/hasSave/chapter/timestamp
   */
  listSlots() {
    return SLOT_CONFIG.map((config) => {
      const rawData = this.storage.get(config.storageKey, null);
      // !! 强制转为布尔值，避免 null && ... 返回 null 而非 false
      const hasValidSave = !!(rawData && this.isCompatible(rawData));

      return {
        slot: config.slot,
        type: config.type,
        hasSave: hasValidSave,
        chapter: hasValidSave ? rawData.chapter : null,
        timestamp: hasValidSave ? rawData.timestamp : null,
      };
    });
  }

  /**
   * 计算指定槽位的章节进度百分比
   * 基于存档中 chapter 字段在 CHAPTERS 中的位置，到达终章为 100%
   * @param {string} slot - 槽位标识
   * @returns {number} 0-100 的整数百分比
   */
  getProgress(slot) {
    const saveData = this.load(slot);
    if (!saveData) return 0;

    const chapterIndex = CHAPTERS.findIndex((ch) => ch.id === saveData.chapter);
    if (chapterIndex === -1) return 0;

    return Math.round(((chapterIndex + 1) / CHAPTERS.length) * 100);
  }

  /**
   * 检查存档数据的版本兼容性与字段完整性
   * 版本不匹配或字段缺失均返回 false，用于 load 前的安全校验
   * @param {*} saveData - 待校验的存档数据
   * @returns {boolean}
   */
  isCompatible(saveData) {
    if (!saveData || typeof saveData !== 'object') return false;
    if (saveData.version !== this.version) return false;

    return REQUIRED_FIELDS.every((field) => field in saveData);
  }

  /**
   * 写入存档到指定槽位（内部方法）
   * 负责补充 version、timestamp 和可选的 choice 字段，序列化后交给 StorageService 持久化。
   * choice 未传入时补充 null，保证存档结构一致且旧存档兼容。
   * @param {string} slot - 槽位标识
   * @param {Object} data - 原始存档数据
   * @private
   */
  _writeSlot(slot, data) {
    const config = this._getSlotConfig(slot);
    if (!config) return;

    const saveData = {
      ...data,
      // choice 作为可选字段，未传入时补充 null，保证旧存档结构一致
      choice: data.choice ?? null,
      version: this.version,
      timestamp: Date.now(),
    };

    this.storage.set(config.storageKey, saveData);

    // 写入成功后通知 UI 层刷新
    this.eventBus.emit(EVENT.SAVE_WRITE, {
      slot,
      chapter: saveData.chapter,
      timestamp: saveData.timestamp,
    });
  }

  /**
   * 设置存档中的剧情抉择标识（对应 M5 §3 抉择规则）
   * 读取现有存档，若已有 choice 则拒绝（唯一性约束），否则写入并返回 true。
   * @param {string} slot - 槽位标识
   * @param {string} sceneId - 场景标识（如 'ch1'）
   * @returns {boolean} 成功返回 true，无存档或已有 choice 时返回 false
   */
  setChoice(slot, sceneId) {
    const existing = this._readSlot(slot);
    // 无存档不能设置 choice
    if (!existing) return false;
    // 已有 choice 则拒绝，保证唯一性
    if (existing.choice != null) return false;

    this._writeSlot(slot, { ...existing, choice: sceneId });
    return true;
  }

  /**
   * 读取存档中的剧情抉择标识
   * @param {string} slot - 槽位标识
   * @returns {string|null} 场景标识，无存档或无 choice 时返回 null
   */
  getChoice(slot) {
    const saveData = this._readSlot(slot);
    if (!saveData) return null;
    return saveData.choice ?? null;
  }

  /**
   * 清除存档中的剧情抉择标识（设为 null）
   * @param {string} slot - 槽位标识
   */
  clearChoice(slot) {
    const existing = this._readSlot(slot);
    if (!existing) return;

    this._writeSlot(slot, { ...existing, choice: null });
  }

  /**
   * 读取指定槽位的存档数据（内部方法）
   * 与 load 不同，不触发 SAVE_LOAD 事件，供 setChoice/getChoice/clearChoice 内部使用。
   * @param {string} slot - 槽位标识
   * @returns {Object|null} 存档数据或 null
   * @private
   */
  _readSlot(slot) {
    const config = this._getSlotConfig(slot);
    if (!config) return null;

    const rawData = this.storage.get(config.storageKey, null);
    if (!rawData) return null;

    if (!this.isCompatible(rawData)) return null;

    return rawData;
  }

  /**
   * 校验槽位标识是否合法，非法时抛错防止误写
   * @param {string} slot - 槽位标识
   * @private
   */
  _validateSlot(slot) {
    if (!this._getSlotConfig(slot)) {
      throw new Error(`无效的存档槽位: ${slot}`);
    }
  }

  /**
   * 根据槽位标识查找配置项
   * @param {string} slot - 槽位标识
   * @returns {Object|undefined}
   * @private
   */
  _getSlotConfig(slot) {
    return SLOT_CONFIG.find((config) => config.slot === slot);
  }
}
