import { BADGES } from '../data/badges.js';
import { EVENT } from '../config.js';

/** 持久化存储键（不含 gxe: 前缀，由 StorageService 统一拼接） */
const STORAGE_KEY = 'badges';

/**
 * 印记收集系统（对应 PRD §5 F10）
 *
 * 负责 7 枚东莞印记的解锁、去重、持久化与事件通知。
 * 通过 EventBus 向 UI 层广播收集动效与全收集成就，
 * 通过 StorageService 实现跨会话持久化。
 */
export class BadgeSystem {
  /**
   * @param {Object} deps - 依赖注入
   * @param {StorageService} deps.storage - 持久化存储服务
   * @param {EventBus} deps.eventBus - 事件总线
   */
  constructor({ storage, eventBus }) {
    this.storage = storage;
    this.eventBus = eventBus;
    // 启动时从存档恢复已解锁列表，保证跨会话连续性
    this.unlockedIds = this._loadUnlocked();
  }

  /**
   * 解锁指定印记
   * 校验合法性后去重写入，并广播收集动效事件；
   * 若全部收集则额外广播"莞城通"成就事件。
   * @param {string} id - 印记 id
   * @returns {boolean} 解锁成功返回 true，id无效或已解锁返回 false
   */
  unlock(id) {
    // 无效 id 直接拒绝，避免脏数据写入
    const badge = this._findBadge(id);
    if (!badge) {
      return false;
    }

    // 已解锁则跳过，保证不重复计数与不重复触发动效
    if (this.isUnlocked(id)) {
      return false;
    }

    this.unlockedIds.push(id);
    this._saveUnlocked();

    // 广播收集动效事件，UI 层据此播放 0.8s 动画
    this.eventBus.emit(EVENT.BADGE_GET, { badge });

    // 全收集时点亮"莞城通"成就
    if (this.isAllCollected()) {
      this.eventBus.emit(EVENT.BADGE_ALL, { achievement: '莞城通' });
    }

    return true;
  }

  /**
   * 检查印记是否已解锁
   * @param {string} id - 印记 id
   * @returns {boolean}
   */
  isUnlocked(id) {
    return this.unlockedIds.includes(id);
  }

  /**
   * 获取已解锁印记的完整数据列表
   * @returns {Array<Object>} 已解锁的 badge 对象数组
   */
  getUnlocked() {
    return BADGES.filter((badge) => this.unlockedIds.includes(badge.id));
  }

  /**
   * 获取收集进度
   * @returns {{ collected: number, total: number, percent: number }}
   */
  getProgress() {
    const collected = this.unlockedIds.length;
    const total = BADGES.length;
    return {
      collected,
      total,
      percent: total === 0 ? 0 : (collected / total) * 100,
    };
  }

  /**
   * 获取印记信息（防剧透）
   * 已解锁返回完整信息，未解锁仅返回基础信息（不含 how/desc）。
   * @param {string} id - 印记 id
   * @returns {Object|null} 印记信息对象，未知 id 返回 null
   */
  getBadgeInfo(id) {
    const badge = this._findBadge(id);
    if (!badge) {
      return null;
    }

    // 未解锁时隐藏获取方式与描述，防止剧透
    if (!this.isUnlocked(id)) {
      return {
        id: badge.id,
        name: badge.name,
        chapter: badge.chapter,
      };
    }

    return { ...badge };
  }

  /**
   * 检查是否已全部收集
   * @returns {boolean}
   */
  isAllCollected() {
    return this.unlockedIds.length === BADGES.length;
  }

  /**
   * 重置所有解锁记录（用于新游戏或调试）
   */
  reset() {
    this.unlockedIds = [];
    this._saveUnlocked();
  }

  /**
   * 从持久化存储加载已解锁列表
   * 存档损坏时降级为空数组，不影响游戏运行
   * @private
   * @returns {string[]}
   */
  _loadUnlocked() {
    return this.storage.get(STORAGE_KEY, []);
  }

  /**
   * 将已解锁列表写入持久化存储
   * @private
   */
  _saveUnlocked() {
    this.storage.set(STORAGE_KEY, this.unlockedIds);
  }

  /**
   * 根据 id 查找印记定义
   * @private
   * @param {string} id - 印记 id
   * @returns {Object|undefined}
   */
  _findBadge(id) {
    return BADGES.find((badge) => badge.id === id);
  }
}
