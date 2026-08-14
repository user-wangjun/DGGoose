import { SETTINGS_DEFAULTS, EVENT } from '../config.js';

/** 防抖延迟（毫秒）：快速拖动滑杆时只在停止后写入一次，减少 localStorage I/O */
const DEBOUNCE_DELAY = 150;

/** localStorage 存储键名（StorageService 会自动拼接 gxe: 前缀） */
const STORAGE_KEY = 'settings';

/** 合法的语言选项，首版仅简中完整可用，其余为占位 */
const VALID_LANGS = ['zh-CN', 'zh-TW', 'en'];

/** 数值型字段的取值范围约束 */
const NUMERIC_RANGES = {
  bgm: { min: 0, max: 100 },
  sfx: { min: 0, max: 100 },
  textSpeed: { min: 1, max: 60 },
};

/**
 * 设置服务（对应 PRD §5 F12）
 * 管理游戏全局设置（音量/语速/语言/震动），内存即时生效、存储延迟写入。
 * 通过 EventBus 广播变更，联动 AudioManager 等下游模块。
 */
export class SettingsService {
  /**
   * @param {Object} deps - 依赖注入
   * @param {StorageService} deps.storage - 持久化存储服务
   * @param {EventBus} deps.eventBus - 事件总线
   */
  constructor({ storage, eventBus }) {
    this.storage = storage;
    this.eventBus = eventBus;
    /** 防抖定时器 ID，null 表示无待写入任务 */
    this._debounceTimer = null;
    /** 内存中的设置数据，即时读写、延迟持久化 */
    this._settings = this._loadFromStorage();
  }

  /**
   * 获取单个设置项
   * @param {string} key - 设置键名
   * @returns {*} 设置值，未知键返回 null
   */
  get(key) {
    if (!(key in this._settings)) {
      return null;
    }
    return this._settings[key];
  }

  /**
   * 获取全部设置（返回副本，防止外部直接修改内部状态）
   * @returns {Object} 设置对象的浅拷贝
   */
  getAll() {
    return { ...this._settings };
  }

  /**
   * 设置单个项：内存即时更新、事件即时广播、持久化延迟写入
   * @param {string} key - 设置键名
   * @param {*} value - 新值（会经过范围校验）
   */
  set(key, value) {
    // 未知字段直接忽略，避免污染设置对象
    if (!(key in SETTINGS_DEFAULTS)) {
      return;
    }

    const clampedValue = this._clampValue(key, value);
    this._settings[key] = clampedValue;

    // 即时通知下游模块（AudioManager 等），无需等待持久化
    this.eventBus.emit(EVENT.SETTING_CHANGE, { key, value: clampedValue });

    this._schedulePersist();
  }

  /**
   * 批量设置多个字段，内部逐字段调用 set 以复用校验与事件逻辑
   * @param {Object} values - 键值对
   */
  setAll(values) {
    for (const [key, value] of Object.entries(values)) {
      this.set(key, value);
    }
  }

  /**
   * 重置为默认值，逐字段恢复以确保每个字段都触发事件通知
   */
  reset() {
    for (const [key, value] of Object.entries(SETTINGS_DEFAULTS)) {
      this.set(key, value);
    }
  }

  /**
   * 强制立即持久化（节流未执行时立即写入，用于页面卸载等场景）
   */
  flush() {
    if (this._debounceTimer !== null) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }
    this._persist();
  }

  /**
   * 范围校验：根据字段类型将值约束到合法区间
   * @param {string} key - 设置键名
   * @param {*} value - 原始值
   * @returns {*} 校验后的值
   * @private
   */
  _clampValue(key, value) {
    // 数值型字段：钳制到 [min, max] 区间
    if (key in NUMERIC_RANGES) {
      const { min, max } = NUMERIC_RANGES[key];
      return Math.max(min, Math.min(max, Number(value)));
    }

    // 语言字段：枚举校验，非法值回退默认避免界面空白
    if (key === 'lang') {
      return VALID_LANGS.includes(value) ? value : SETTINGS_DEFAULTS.lang;
    }

    // 震动开关：强制转为布尔
    if (key === 'shake') {
      return Boolean(value);
    }

    return value;
  }

  /**
   * 从存储加载设置，合并默认值以兼容新增字段
   * @returns {Object} 合并后的设置对象
   * @private
   */
  _loadFromStorage() {
    const stored = this.storage.get(STORAGE_KEY, null);
    // 存储为空或损坏时降级为默认值
    if (!stored || typeof stored !== 'object') {
      return { ...SETTINGS_DEFAULTS };
    }
    // 先铺默认值再覆盖存储值，保证新增字段有默认值
    return { ...SETTINGS_DEFAULTS, ...stored };
  }

  /**
   * 安排延迟持久化（防抖：清除上一次定时器后重新计时）
   * 快速连续 set 时只在最后一次调用 150ms 后写入一次
   * @private
   */
  _schedulePersist() {
    if (this._debounceTimer !== null) {
      clearTimeout(this._debounceTimer);
    }
    this._debounceTimer = setTimeout(() => {
      this._debounceTimer = null;
      // 延迟回调没有同步调用方可以接收异常；持久化失败由 flush() 的同步路径
      // 继续抛出，后台防抖写入则记录错误，避免页面/测试环境销毁后产生未处理异常。
      try {
        this._persist();
      } catch (error) {
        this._lastPersistError = error;
      }
    }, DEBOUNCE_DELAY);
  }

  /**
   * 执行持久化写入
   * @private
   */
  _persist() {
    this.storage.set(STORAGE_KEY, this._settings);
  }
}
