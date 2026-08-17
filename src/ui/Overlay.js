/**
 * Overlay 覆盖层组件（对应 PRD §7.6 通用 UI）
 * 半透明遮罩 + 可选关闭回调；用于设置面板、存档面板等弹出场景。
 * 点击遮罩区域触发关闭回调（可通过 options.dismissible 关闭）。
 */
export class Overlay {
  /**
   * 创建覆盖层实例
   * @param {Object} options - 配置项
   * @param {HTMLElement} options.container - 挂载容器
   * @param {boolean} options.dismissible - 点击遮罩是否关闭，默认 true
   * @param {Function} options.onClose - 关闭回调
   */
  constructor({ container, dismissible = true, onClose }) {
    this.container = container;
    this.dismissible = dismissible;
    this.onClose = onClose || null;
    this.element = null;
    this.contentElement = null;
    this._onBackdropClick = this._onBackdropClick.bind(this);
  }

  /**
   * 挂载覆盖层到 DOM
   * @param {HTMLElement} [contentEl] - 可选的已构建内容元素
   */
  mount(contentEl) {
    this.element = document.createElement('div');
    this.element.setAttribute('data-overlay', '');
    this.element.style.cssText = `
      position: fixed; inset: 0; z-index: 8000;
      display: flex; align-items: center; justify-content: center;
      background: rgba(0,0,0,0.6); pointer-events: auto;
    `;

    // 内容容器，阻止冒泡以区分点击目标
    this.contentElement = document.createElement('div');
    this.contentElement.setAttribute('data-overlay-content', '');
    this.contentElement.style.cssText = `
      position: relative; max-width: 90vw; max-height: 90vh;
      overflow: auto; pointer-events: auto;
    `;
    this.contentElement.addEventListener('click', (e) => e.stopPropagation());

    if (contentEl) {
      this.contentElement.appendChild(contentEl);
    }

    this.element.appendChild(this.contentElement);

    if (this.dismissible) {
      this.element.addEventListener('click', this._onBackdropClick);
    }

    this.container.appendChild(this.element);
  }

  /**
   * 获取内容容器，用于动态追加子元素
   * @returns {HTMLElement|null}
   */
  getContentElement() {
    return this.contentElement;
  }

  /**
   * 设置内容元素
   * @param {HTMLElement} contentEl
   */
  setContent(contentEl) {
    if (!this.contentElement) return;
    this.contentElement.innerHTML = '';
    this.contentElement.appendChild(contentEl);
  }

  /**
   * 关闭并移除覆盖层
   */
  close() {
    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }
    this.element = null;
    this.contentElement = null;
    if (this.onClose) {
      this.onClose();
    }
  }

  /**
   * 销毁实例
   */
  destroy() {
    this.close();
    this.container = null;
    this.onClose = null;
  }

  /**
   * 遮罩点击处理（仅 dismissible 为 true 时注册）
   * @param {Event} e
   */
  _onBackdropClick(e) {
    if (e.target === this.element) {
      this.close();
    }
  }
}
