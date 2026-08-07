import { EVENT } from '../config.js';
import { applyButtonStyle } from './ButtonTheme.js';

/**
 * 通用抉择覆盖层组件（对应剧情分支设计 v4 §3 抉择规则）
 *
 * 从松山湖现有抉择覆盖层抽取为通用组件，供五场景接入。
 * 提供标题 + 两按钮（留下 / 继续探寻），支持按钮置灰态。
 */
export class ChoiceOverlay {
  /**
   * @param {Object} deps
   * @param {EventBus} deps.eventBus - 事件总线
   * @param {HTMLElement} deps.container - UI 挂载容器
   */
  constructor({ eventBus, container }) {
    this.eventBus = eventBus;
    this.container = container;
    /** @type {HTMLElement|null} */
    this.element = null;
    /** 当前场景 id，点击按钮时随事件广播 */
    this._sceneId = null;
    // 预绑定 this，确保 addEventListener / removeEventListener 引用一致
    this._onStayClick = this._onStayClick.bind(this);
    this._onContinueClick = this._onContinueClick.bind(this);
  }

  /**
   * 显示抉择覆盖层
   * @param {Object} options
   * @param {string} options.title - 抉择提示标题
   * @param {string} options.stayLabel - "留下"按钮文案
   * @param {string} options.continueLabel - "继续"按钮文案
   * @param {boolean} options.stayDisabled - "留下"按钮是否置灰（已选过其他场景时 true）
   * @param {string} options.sceneId - 当前场景 id（用于事件广播）
   */
  show({ title, stayLabel, continueLabel, stayDisabled, sceneId }) {
    // 先清理已有覆盖层，避免重复挂载
    this.hide();

    this._sceneId = sceneId;

    this.element = document.createElement('div');
    this.element.setAttribute('data-choice-overlay', '');
    this.element.style.cssText = `
      position: fixed; inset: 0; z-index: 300;
      display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      background: rgba(0, 0, 0, 0.6); pointer-events: auto;
    `;

    // 标题区域
    const titleEl = document.createElement('div');
    titleEl.setAttribute('data-choice-title', '');
    titleEl.textContent = title;
    titleEl.style.cssText = `
      color: #fff; font-size: 24px; font-weight: bold;
      margin-bottom: 32px; text-align: center;
      text-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
    `;
    this.element.appendChild(titleEl);

    // 按钮容器
    const btnContainer = document.createElement('div');
    btnContainer.style.cssText = 'display: flex; gap: 24px;';

    // "留下"按钮：沿用主按钮的暖色行动层级
    const stayBtn = document.createElement('button');
    stayBtn.setAttribute('data-choice-stay', '');
    stayBtn.textContent = stayLabel;
    stayBtn.disabled = stayDisabled;
    applyButtonStyle(stayBtn, { variant: 'primary', size: 'lg' });
    if (!stayDisabled) {
      stayBtn.addEventListener('click', this._onStayClick);
    }
    btnContainer.appendChild(stayBtn);

    // "继续"按钮：使用次级深色板，不再引入独立的冷蓝按钮体系
    const continueBtn = document.createElement('button');
    continueBtn.setAttribute('data-choice-continue', '');
    continueBtn.textContent = continueLabel;
    applyButtonStyle(continueBtn, { variant: 'secondary', size: 'lg' });
    continueBtn.addEventListener('click', this._onContinueClick);
    btnContainer.appendChild(continueBtn);

    this.element.appendChild(btnContainer);
    this.container.appendChild(this.element);
  }

  /**
   * 隐藏并销毁覆盖层，移除 DOM 元素和事件监听
   */
  hide() {
    if (this.element) {
      // 移除前先摘除事件监听，防止残留引用导致内存泄漏
      const stayBtn = this.element.querySelector('[data-choice-stay]');
      if (stayBtn) {
        stayBtn.removeEventListener('click', this._onStayClick);
      }
      const continueBtn = this.element.querySelector('[data-choice-continue]');
      if (continueBtn) {
        continueBtn.removeEventListener('click', this._onContinueClick);
      }

      if (this.element.parentNode) {
        this.element.parentNode.removeChild(this.element);
      }
      this.element = null;
    }
    this._sceneId = null;
  }

  /**
   * "留下"按钮点击回调，广播 CHOICE_STAY 事件
   * @private
   */
  _onStayClick() {
    this.eventBus.emit(EVENT.CHOICE_STAY, { sceneId: this._sceneId });
  }

  /**
   * "继续"按钮点击回调，广播 CHOICE_CONTINUE 事件
   * @private
   */
  _onContinueClick() {
    this.eventBus.emit(EVENT.CHOICE_CONTINUE, { sceneId: this._sceneId });
  }
}
