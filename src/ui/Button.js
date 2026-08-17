import { applyButtonStyle } from './ButtonTheme.js';

/**
 * Button 通用按钮组件（对应 PRD §7.6 通用 UI）
 * 三态按钮：正常 / 置灰（禁用）/ 按下；视觉由统一按钮主题接管。
 */
export class Button {
  /**
   * 创建按钮实例
   * @param {Object} options - 配置项
   * @param {string} options.label - 按钮文本
   * @param {Function} options.onClick - 点击回调
   * @param {boolean} options.disabled - 是否禁用，默认 false
   * @param {string} options.variant - 样式变体：'primary' | 'secondary' | 'danger' | 'ghost'
   * @param {string} options.size - 尺寸：'sm' | 'md' | 'lg' | 'touch'，默认 'md'
   * @param {string} options.width - 宽度：'auto' | 'full'，默认 'auto'
   */
  constructor({ label, onClick, disabled = false, variant = 'primary', size = 'md', width = 'auto' }) {
    this.label = label;
    this.onClick = onClick || null;
    this.disabled = disabled;
    this.variant = variant;
    this.size = size;
    this.width = width;
    this.element = null;
    this.pressed = false;
    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
    this._onPointerCancel = this._onPointerCancel.bind(this);
    this._onPointerLeave = this._onPointerLeave.bind(this);
    this._onPointerClick = this._onPointerClick.bind(this);
  }

  /**
   * 创建并返回按钮 DOM 元素
   * @returns {HTMLButtonElement}
   */
  create() {
    this.element = document.createElement('button');
    this.element.type = 'button';
    this.element.disabled = this.disabled;
    this.element.setAttribute('data-button', '');
    this.element.textContent = this.label;
    this._applyStyles();
    this._updateState();

    this.element.addEventListener('pointerdown', this._onPointerDown);
    this.element.addEventListener('pointerup', this._onPointerUp);
    this.element.addEventListener('pointercancel', this._onPointerCancel);
    this.element.addEventListener('pointerleave', this._onPointerLeave);
    this.element.addEventListener('click', this._onPointerClick);

    return this.element;
  }

  /**
   * 设置禁用状态
   * @param {boolean} disabled
   */
  setDisabled(disabled) {
    this.disabled = disabled;
    if (this.element) {
      this.element.disabled = disabled;
      this._updateState();
    }
  }

  /**
   * 更新按钮文本
   * @param {string} label
   */
  setLabel(label) {
    this.label = label;
    if (this.element) {
      this.element.textContent = label;
    }
  }

  /**
   * 应用基础样式（三态通过 CSS 属性选择器区分）
   */
  _applyStyles() {
    if (!this.element) return;
    applyButtonStyle(this.element, {
      variant: this.variant,
      size: this.size,
      width: this.width,
    });
  }

  /**
   * 根据当前状态更新视觉表现
   */
  _updateState() {
    if (!this.element) return;
    this.element.dataset.state = this.disabled ? 'disabled' : (this.pressed ? 'pressed' : 'idle');
  }

  _onPointerDown() {
    if (this.disabled) return;
    this.pressed = true;
    this._updateState();
  }

  _onPointerUp() {
    this.pressed = false;
    this._updateState();
  }

  /**
   * 指针被系统中断时恢复按钮状态，避免按钮停留在按下视觉。
   * @private
   */
  _onPointerCancel() {
    this.pressed = false;
    this._updateState();
  }

  _onPointerLeave() {
    this.pressed = false;
    this._updateState();
  }

  _onPointerClick() {
    if (this.disabled) return;
    if (this.onClick) this.onClick();
  }

  /**
   * 销毁实例，移除事件监听
   */
  destroy() {
    if (this.element) {
      this.element.removeEventListener('pointerdown', this._onPointerDown);
      this.element.removeEventListener('pointerup', this._onPointerUp);
      this.element.removeEventListener('pointercancel', this._onPointerCancel);
      this.element.removeEventListener('pointerleave', this._onPointerLeave);
      this.element.removeEventListener('click', this._onPointerClick);
      if (this.element.parentNode) {
        this.element.parentNode.removeChild(this.element);
      }
      this.element = null;
    }
    this.onClick = null;
  }
}
