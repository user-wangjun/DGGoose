import { EVENT } from '../config.js';
import { Overlay } from './Overlay.js';
import { applyButtonStyle } from './ButtonTheme.js';

/** 语言选项标签映射，首版简中完整可用，其余为占位 */
const LANG_LABELS = {
  'zh-CN': '简体中文',
  'zh-TW': '繁體中文',
  'en': 'English',
};

/** 重置确认超时（毫秒），超时后自动取消确认状态 */
const RESET_CONFIRM_TIMEOUT = 3000;

/**
 * 设置面板（对应 PRD §5 F12）
 * DOM 组件，包含音量/语速/语言/震动 5 个设置控件及重置按钮。
 * 用户操作即时写入 SettingsService（内存即时生效、存储延迟写入），
 * 通过 EventBus 监听 SETTING_CHANGE 联动 AudioManager。
 */
export class SettingsPanel {
  /**
   * @param {Object} deps - 依赖注入
   * @param {SettingsService} deps.settingsService - 设置服务
   * @param {AudioManager} [deps.audioManager] - 音频管理器（可选，用于即时音量反馈）
   * @param {EventBus} deps.eventBus - 事件总线
   * @param {HTMLElement} deps.container - 挂载容器
   */
  constructor({ settingsService, audioManager, eventBus, container }) {
    this.settingsService = settingsService;
    this.audioManager = audioManager || null;
    this.eventBus = eventBus;
    this.container = container;

    this.element = null;
    this.overlay = null;
    /** 重置确认状态：false=未确认，true=等待二次点击 */
    this._confirmingReset = false;
    this._resetConfirmTimer = null;

    // 绑定事件处理器，确保 this 指向正确
    this._onSettingChange = this._onSettingChange.bind(this);
    this._onBgmInput = this._onBgmInput.bind(this);
    this._onSfxInput = this._onSfxInput.bind(this);
    this._onTextSpeedInput = this._onTextSpeedInput.bind(this);
    this._onLangChange = this._onLangChange.bind(this);
    this._onShakeChange = this._onShakeChange.bind(this);
    this._onResetClick = this._onResetClick.bind(this);
    this._onCloseClick = this._onCloseClick.bind(this);
  }

  /**
   * 构建面板 DOM 并挂载到容器（通过 Overlay 覆盖层）
   * @returns {HTMLElement} 面板根元素
   */
  create() {
    // 构建面板内容
    this.element = this._buildPanel();

    // 使用 Overlay 提供半透明遮罩与点击外部关闭
    this.overlay = new Overlay({
      container: this.container,
      dismissible: true,
      onClose: () => this.hide(),
    });
    this.overlay.mount(this.element);

    // 订阅设置变更事件，联动 AudioManager
    this.eventBus.on(EVENT.SETTING_CHANGE, this._onSettingChange);

    return this.element;
  }

  /**
   * 显示面板
   */
  show() {
    if (!this.element) {
      this.create();
    }
    this.element.style.display = 'block';
    this._syncControls();
  }

  /**
   * 隐藏面板，刷新待写入数据
   */
  hide() {
    if (this.element) {
      this.element.style.display = 'none';
    }
    // 隐藏时强制写入，避免用户关闭后数据丢失
    this.settingsService.flush();
    // 取消重置确认状态
    this._cancelResetConfirm();
  }

  /**
   * 销毁面板，移除所有事件监听与 DOM
   */
  destroy() {
    this.eventBus.off(EVENT.SETTING_CHANGE, this._onSettingChange);
    this._cancelResetConfirm();

    if (this.overlay) {
      this.overlay.destroy();
      this.overlay = null;
    }
    this.element = null;
    this.audioManager = null;
  }

  // ==================== DOM 构建 ====================

  /**
   * 构建完整面板 DOM 结构
   * @returns {HTMLElement}
   * @private
   */
  _buildPanel() {
    const panel = document.createElement('div');
    panel.setAttribute('data-settings-panel', '');
    panel.style.cssText = `
      display: block; width: 420px; max-width: 90vw;
      background: #1e293b; border-radius: 16px; padding: 28px 32px;
      color: #f1f5f9; font-family: inherit; font-size: 15px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.4);
    `;

    panel.appendChild(this._buildTitle());
    panel.appendChild(this._buildSliderRow('bgm', 'BGM 音量', 0, 100));
    panel.appendChild(this._buildSliderRow('sfx', '音效音量', 0, 100));
    panel.appendChild(this._buildSliderRow('textSpeed', '文字速度', 1, 60));
    panel.appendChild(this._buildLangRow());
    panel.appendChild(this._buildShakeRow());
    panel.appendChild(this._buildActions());

    return panel;
  }

  /**
   * 构建面板标题
   * @returns {HTMLElement}
   * @private
   */
  _buildTitle() {
    const title = document.createElement('h2');
    title.textContent = '设置';
    title.style.cssText = 'margin: 0 0 20px 0; font-size: 22px; text-align: center;';
    return title;
  }

  /**
   * 构建滑杆行（bgm/sfx/textSpeed 共用）
   * @param {string} key - 设置键名
   * @param {string} label - 显示标签
   * @param {number} min - 最小值
   * @param {number} max - 最大值
   * @returns {HTMLElement}
   * @private
   */
  _buildSliderRow(key, label, min, max) {
    const row = document.createElement('div');
    row.style.cssText = 'display: flex; align-items: center; gap: 12px; margin-bottom: 16px;';

    const labelEl = document.createElement('label');
    labelEl.textContent = label;
    labelEl.style.cssText = 'flex-shrink: 0; width: 80px;';

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = String(min);
    slider.max = String(max);
    slider.value = String(this.settingsService.get(key));
    slider.setAttribute(`data-${key}-slider`, '');
    slider.style.cssText = 'flex: 1; cursor: pointer; accent-color: #d98a46;';

    // 数值显示，拖动时实时更新
    const valueDisplay = document.createElement('span');
    valueDisplay.textContent = String(this.settingsService.get(key));
    valueDisplay.setAttribute(`data-${key}-value`, '');
    valueDisplay.style.cssText = 'flex-shrink: 0; width: 36px; text-align: right; color: #94a3b8;';

    // 绑定对应的事件处理器
    const handler = this._getSliderHandler(key);
    slider.addEventListener('input', handler);

    row.appendChild(labelEl);
    row.appendChild(slider);
    row.appendChild(valueDisplay);
    return row;
  }

  /**
   * 构建语言选择行（单选按钮组）
   * @returns {HTMLElement}
   * @private
   */
  _buildLangRow() {
    const row = document.createElement('div');
    row.style.cssText = 'display: flex; align-items: center; gap: 12px; margin-bottom: 16px;';

    const labelEl = document.createElement('label');
    labelEl.textContent = '语言';
    labelEl.style.cssText = 'flex-shrink: 0; width: 80px;';

    const radioGroup = document.createElement('div');
    radioGroup.style.cssText = 'display: flex; gap: 16px;';

    const currentLang = this.settingsService.get('lang');
    for (const [langCode, langLabel] of Object.entries(LANG_LABELS)) {
      const wrapper = document.createElement('label');
      wrapper.style.cssText = 'display: flex; align-items: center; gap: 4px; cursor: pointer;';

      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'lang';
      radio.value = langCode;
      radio.checked = (langCode === currentLang);
      radio.setAttribute('data-lang-radio', '');
      radio.style.cssText = 'cursor: pointer; accent-color: #d98a46;';
      radio.addEventListener('change', this._onLangChange);

      const text = document.createElement('span');
      text.textContent = langLabel;

      wrapper.appendChild(radio);
      wrapper.appendChild(text);
      radioGroup.appendChild(wrapper);
    }

    row.appendChild(labelEl);
    row.appendChild(radioGroup);
    return row;
  }

  /**
   * 构建震动开关行
   * @returns {HTMLElement}
   * @private
   */
  _buildShakeRow() {
    const row = document.createElement('div');
    row.style.cssText = 'display: flex; align-items: center; gap: 12px; margin-bottom: 20px;';

    const labelEl = document.createElement('label');
    labelEl.textContent = '屏幕震动';
    labelEl.style.cssText = 'flex-shrink: 0; width: 80px;';

    // 使用 checkbox 模拟开关样式
    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.checked = this.settingsService.get('shake');
    toggle.setAttribute('data-shake-toggle', '');
    toggle.style.cssText = 'width: 44px; height: 24px; appearance: none; border-radius: 12px; background: #475569; cursor: pointer; position: relative; transition: background 0.2s;';
    toggle.addEventListener('change', this._onShakeChange);

    // 开关滑块伪元素通过 JS 样式模拟（jsdom 不支持 ::after）
    this._styleToggle(toggle);

    row.appendChild(labelEl);
    row.appendChild(toggle);

    // 不支持 Vibration API 时显示提示
    if (!('vibrate' in navigator)) {
      const hint = document.createElement('span');
      hint.textContent = '（当前设备不支持）';
      hint.style.cssText = 'color: #64748b; font-size: 13px;';
      row.appendChild(hint);
    }

    return row;
  }

  /**
   * 构建操作按钮区（重置 + 关闭）
   * @returns {HTMLElement}
   * @private
   */
  _buildActions() {
    const actions = document.createElement('div');
    actions.style.cssText = 'display: flex; justify-content: space-between; gap: 12px; margin-top: 8px;';

    // 重置按钮（danger 样式，二次确认）
    const resetBtn = document.createElement('button');
    resetBtn.textContent = '重置设置';
    resetBtn.setAttribute('data-reset-btn', '');
    applyButtonStyle(resetBtn, { variant: 'danger', size: 'sm' });
    resetBtn.addEventListener('click', this._onResetClick);

    // 关闭按钮
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '关闭';
    closeBtn.setAttribute('data-close-btn', '');
    applyButtonStyle(closeBtn, { variant: 'secondary', size: 'sm' });
    closeBtn.addEventListener('click', this._onCloseClick);

    actions.appendChild(resetBtn);
    actions.appendChild(closeBtn);
    return actions;
  }

  // ==================== 事件处理 ====================

  /**
   * 滑杆 input 事件分发器
   * @param {string} key - 设置键名
   * @returns {Function} 对应的事件处理器
   * @private
   */
  _getSliderHandler(key) {
    if (key === 'bgm') return this._onBgmInput;
    if (key === 'sfx') return this._onSfxInput;
    if (key === 'textSpeed') return this._onTextSpeedInput;
    return () => {};
  }

  /**
   * BGM 滑杆拖动：即时更新数值显示与设置
   * @param {Event} e
   * @private
   */
  _onBgmInput(e) {
    const value = Number(e.target.value);
    this._updateValueDisplay('bgm', value);
    this.settingsService.set('bgm', value);
  }

  /**
   * SFX 滑杆拖动：即时更新数值显示与设置
   * @param {Event} e
   * @private
   */
  _onSfxInput(e) {
    const value = Number(e.target.value);
    this._updateValueDisplay('sfx', value);
    this.settingsService.set('sfx', value);
  }

  /**
   * 文字速度滑杆拖动：即时更新数值显示与设置
   * @param {Event} e
   * @private
   */
  _onTextSpeedInput(e) {
    const value = Number(e.target.value);
    this._updateValueDisplay('textSpeed', value);
    this.settingsService.set('textSpeed', value);
  }

  /**
   * 语言切换
   * @param {Event} e
   * @private
   */
  _onLangChange(e) {
    if (e.target.checked) {
      this.settingsService.set('lang', e.target.value);
    }
  }

  /**
   * 震动开关切换
   * 开启时若设备支持 Vibration API，触发短震动作为反馈
   * @param {Event} e
   * @private
   */
  _onShakeChange(e) {
    const enabled = e.target.checked;
    this.settingsService.set('shake', enabled);
    this._styleToggle(e.target);

    // 开启时给一个短震动反馈；不支持 Vibration API 的环境静默忽略
    if (enabled && 'vibrate' in navigator) {
      navigator.vibrate(50);
    }
  }

  /**
   * 重置按钮点击：二次确认机制
   * 第一次点击 → 切换为"确认重置？"等待二次点击
   * 第二次点击 → 执行重置
   * @private
   */
  _onResetClick() {
    if (!this._confirmingReset) {
      // 进入确认状态，修改按钮文本与样式
      this._confirmingReset = true;
      const btn = this.element.querySelector('[data-reset-btn]');
      btn.textContent = '确认重置？';
      btn.dataset.confirming = 'true';
      // 超时自动取消，避免用户误操作后卡在确认状态
      this._resetConfirmTimer = setTimeout(() => {
        this._cancelResetConfirm();
      }, RESET_CONFIRM_TIMEOUT);
      return;
    }

    // 二次确认，执行重置
    this._cancelResetConfirm();
    this.settingsService.reset();
    this._syncControls();
  }

  /**
   * 关闭按钮点击
   * @private
   */
  _onCloseClick() {
    this.hide();
  }

  /**
   * SETTING_CHANGE 事件处理器：联动 AudioManager 音量
   * 无论变更来源（面板操作或代码调用），都确保音频即时响应
   * @param {{key: string, value: *}} data
   * @private
   */
  _onSettingChange(data) {
    if (!this.audioManager) return;

    // 仅处理音量相关字段，转发给 AudioManager
    if (data.key === 'bgm') {
      this.audioManager.setBgmVolume(data.value);
    } else if (data.key === 'sfx') {
      this.audioManager.setSfxVolume(data.value);
    }
  }

  // ==================== 辅助方法 ====================

  /**
   * 同步所有控件到当前设置值（用于面板打开或重置后刷新）
   * @private
   */
  _syncControls() {
    if (!this.element) return;

    const all = this.settingsService.getAll();

    // 同步滑杆与数值显示
    for (const key of ['bgm', 'sfx', 'textSpeed']) {
      const slider = this.element.querySelector(`[data-${key}-slider]`);
      const display = this.element.querySelector(`[data-${key}-value]`);
      if (slider) slider.value = String(all[key]);
      if (display) display.textContent = String(all[key]);
    }

    // 同步语言单选
    const radios = this.element.querySelectorAll('[data-lang-radio]');
    radios.forEach((radio) => {
      radio.checked = (radio.value === all.lang);
    });

    // 同步震动开关
    const toggle = this.element.querySelector('[data-shake-toggle]');
    if (toggle) {
      toggle.checked = all.shake;
      this._styleToggle(toggle);
    }
  }

  /**
   * 更新滑杆旁的数值显示
   * @param {string} key - 设置键名
   * @param {number} value - 当前值
   * @private
   */
  _updateValueDisplay(key, value) {
    const display = this.element?.querySelector(`[data-${key}-value]`);
    if (display) {
      display.textContent = String(value);
    }
  }

  /**
   * 取消重置确认状态，恢复按钮原始文本与样式
   * @private
   */
  _cancelResetConfirm() {
    if (!this._confirmingReset) return;

    this._confirmingReset = false;
    if (this._resetConfirmTimer) {
      clearTimeout(this._resetConfirmTimer);
      this._resetConfirmTimer = null;
    }

    if (this.element) {
      const btn = this.element.querySelector('[data-reset-btn]');
      if (btn) {
        btn.textContent = '重置设置';
        delete btn.dataset.confirming;
      }
    }
  }

  /**
   * 为开关设置开关态样式（jsdom 不支持 CSS 伪元素，用内联样式模拟）
   * @param {HTMLInputElement} toggle
   * @private
   */
  _styleToggle(toggle) {
    if (toggle.checked) {
      toggle.style.background = '#d98a46';
    } else {
      toggle.style.background = '#475569';
    }
  }

}
