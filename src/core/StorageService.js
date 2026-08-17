import { STORAGE_PREFIX } from '../config.js';

/** 默认单槽容量上限：8KB（对应 PRD §6.3） */
const DEFAULT_MAX_BYTES = 8192;

/**
 * 本地存储服务
 * 封装 localStorage，统一 gxe: 前缀，JSON 序列化，写入超限时回滚并抛错。
 */
export class StorageService {
  /**
   * @param {number} maxBytes - 单值最大字节数，默认 8KB
   */
  constructor(maxBytes = DEFAULT_MAX_BYTES) {
    this.maxBytes = maxBytes;
  }

  /**
   * 读取数据，JSON 反序列化
   * 损坏的 JSON 静默降级为默认值，避免游戏崩溃
   * @param {string} key - 存储键（不含前缀）
   * @param {*} [defaultValue=null] - 读取失败时的返回值
   * @returns {*} 反序列化后的值
   */
  get(key, defaultValue = null) {
    const raw = localStorage.getItem(this._fullKey(key));
    if (raw === null) {
      return defaultValue;
    }
    try {
      return JSON.parse(raw);
    } catch {
      // 损坏的存档不影响游戏运行，降级为默认值
      return defaultValue;
    }
  }

  /**
   * 写入数据，JSON 序列化
   * 超过 maxBytes 时回滚（不写入）并抛错，调用方负责提示用户清理
   * @param {string} key - 存储键（不含前缀）
   * @param {*} value - 要序列化的值
   * @param {number} [maxBytes] - 可选覆盖单次写入的容量上限
   * @throws {Error} 超出容量限制时抛出
   */
  set(key, value, maxBytes) {
    const limit = maxBytes ?? this.maxBytes;
    const fullKey = this._fullKey(key);
    const serialized = JSON.stringify(value);

    // 使用 Blob.size 精确测量 UTF-8 字节长度（含中文字符按 3 字节计算）
    const byteSize = this._byteLength(serialized);
    if (byteSize > limit) {
      throw new Error(`存储超限: ${byteSize}B > ${limit}B (key=${key})`);
    }

    try {
      localStorage.setItem(fullKey, serialized);
    } catch (e) {
      // localStorage 写入失败（如隐私模式或已满），抛错让上层处理
      throw new Error(`存储写入失败: ${e.message}`);
    }
  }

  /**
   * 删除指定键
   * @param {string} key
   */
  remove(key) {
    localStorage.removeItem(this._fullKey(key));
  }

  /**
   * 拼接完整存储键
   * @private
   */
  _fullKey(key) {
    return `${STORAGE_PREFIX}${key}`;
  }

  /**
   * 计算字符串 UTF-8 字节长度
   * @private
   */
  _byteLength(str) {
    return new Blob([str]).size;
  }
}
