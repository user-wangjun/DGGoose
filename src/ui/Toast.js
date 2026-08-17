/**
 * Toast 轻提示组件（对应 PRD §7.6 通用 UI）
 * 显示一条提示文本，2 秒后自动消失；支持手动关闭与回调。
 * 采用 DOM 渲染，挂载到指定容器（通常为 #ui-root）。
 */
export class Toast {
  /**
   * 创建 Toast 实例
   * @param {Object} options - 配置项
   * @param {HTMLElement} options.container - 挂载容器
   * @param {number} options.duration - 显示时长（毫秒），默认 2000
   */
  constructor({ container, duration = 2000 }) {
    this.container = container;
    this.duration = duration;
    this.element = null;
    this.timer = null;
    this.onCloseCallback = null;
  }

  /**
   * 显示 Toast 提示
   * @param {string} message - 提示文本
   * @param {Function} [onClose] - 关闭回调
   */
  show(message, onClose) {
    // 先清除已有 Toast，避免堆叠
    this.hide();
    this.onCloseCallback = onClose || null;

    this.element = document.createElement('div');
    this.element.setAttribute('data-toast', '');
    this.element.style.cssText = `
      position: fixed; top: 20%; left: 50%; transform: translateX(-50%);
      z-index: 9000; padding: 12px 24px; border-radius: 8px;
      background: rgba(0,0,0,0.75); color: #fff; font-size: 16px;
      pointer-events: none; opacity: 0;
      transition: opacity 0.3s ease; text-align: center; max-width: 80vw;
    `;
    this.element.textContent = message;
    this.container.appendChild(this.element);

    // 触发淡入
    requestAnimationFrame(() => {
      if (this.element) this.element.style.opacity = '1';
    });

    // 定时自动消失
    this.timer = setTimeout(() => this.hide(), this.duration);
  }

  /**
   * 隐藏并移除 Toast
   */
  hide() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
      this.element = null;
    }
    if (this.onCloseCallback) {
      const cb = this.onCloseCallback;
      this.onCloseCallback = null;
      cb();
    }
  }

  /**
   * 销毁实例，清理资源
   */
  destroy() {
    this.hide();
    this.container = null;
  }
}
