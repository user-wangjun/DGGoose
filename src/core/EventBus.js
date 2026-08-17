/**
 * 事件总线：解耦模块间通信
 * 提供 on/off/once/emit/clear 接口，事件名建议使用 config.js 中 EVENT 常量。
 */
export class EventBus {
  constructor() {
    /** @type {Map<string, Set<Function>>} */
    this.listeners = new Map();
  }

  /**
   * 订阅事件
   * @param {string} event - 事件名
   * @param {Function} handler - 回调函数
   */
  on(event, handler) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(handler);
  }

  /**
   * 订阅一次，触发后自动移除
   * @param {string} event - 事件名
   * @param {Function} handler - 回调函数
   */
  once(event, handler) {
    const wrapper = (data) => {
      this.off(event, wrapper);
      handler(data);
    };
    this.on(event, wrapper);
  }

  /**
   * 解绑事件
   * @param {string} event - 事件名
   * @param {Function} handler - 要移除的回调
   */
  off(event, handler) {
    const set = this.listeners.get(event);
    if (set) {
      set.delete(handler);
      if (set.size === 0) {
        this.listeners.delete(event);
      }
    }
  }

  /**
   * 触发事件，通知所有订阅者
   * @param {string} event - 事件名
   * @param {*} [data] - 传递给回调的数据
   */
  emit(event, data) {
    const set = this.listeners.get(event);
    if (!set) return;
    // 复制一份遍历，防止回调中 off 导致迭代异常
    const handlers = [...set];
    for (const handler of handlers) {
      handler(data);
    }
  }

  /**
   * 清空所有订阅
   */
  clear() {
    this.listeners.clear();
  }
}
