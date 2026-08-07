import { Overlay } from './Overlay.js';
import { applyButtonStyle } from './ButtonTheme.js';

/** 手机/平板横屏操作说明条目，对应 PRD §5 F1 触屏操作 */
const LANDSCAPE_CONTROLS = [
  { keys: '虚拟摇杆', desc: '左下角拖拽控制移动方向，拉满触发奔跑' },
  { keys: '点击', desc: '点击场景物件进行互动' },
];

/**
 * 菜单覆盖层组件（对应 PRD §5 F1）
 * 复用 Overlay 提供的半透明遮罩与点击外部关闭能力，
 * 专门用于展示手机/平板横屏操作指引。
 */
export class MenuOverlay {
  /**
   * @param {Object} options - 配置项
   * @param {HTMLElement} options.container - 挂载容器（通常为 #ui-root）
   * @param {Function} [options.onClose] - 关闭回调
   */
  constructor({ container, onClose }) {
    this.container = container;
    this.onClose = onClose || null;
    this.overlay = null;
    this.element = null;
  }

  /**
   * 构建操作说明内容并挂载到容器
   * 若已有覆盖层存在则先关闭旧的，避免堆叠
   */
  show() {
    // 已有覆盖层时先静默关闭，不触发回调以避免副作用
    if (this.overlay) {
      const oldOverlay = this.overlay;
      this.overlay = null;
      this.element = null;
      oldOverlay.onClose = null;
      oldOverlay.close();
    }

    this.element = this._buildContent();

    this.overlay = new Overlay({
      container: this.container,
      dismissible: true,
      onClose: () => this._handleClose(),
    });
    this.overlay.mount(this.element);
  }

  /**
   * 关闭覆盖层并清理 DOM
   * 无论关闭来源（手动 / 遮罩点击）都会触发 onClose 回调
   */
  close() {
    if (!this.overlay) return;

    // 暂存引用后清空成员，防止 Overlay.close 触发 _handleClose 形成递归
    const overlay = this.overlay;
    this.overlay = null;
    this.element = null;
    overlay.onClose = null;
    overlay.close();

    // 统一触发外部回调
    if (this.onClose) {
      this.onClose();
    }
  }

  /**
   * 销毁实例，释放所有引用
   */
  destroy() {
    this.close();
    this.container = null;
    this.onClose = null;
  }

  // ==================== DOM 构建 ====================

  /**
   * 构建操作说明面板 DOM 结构
   * 包含标题、横屏触控操作区、关闭按钮
   * @returns {HTMLElement}
   * @private
   */
  _buildContent() {
    const panel = document.createElement('div');
    panel.setAttribute('data-menu-overlay', '');
    panel.style.cssText = `
      display: block; width: 460px; max-width: 90vw;
      background: #1e293b; border-radius: 16px; padding: 28px 32px;
      color: #f1f5f9; font-family: inherit; font-size: 15px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.4);
    `;

    panel.appendChild(this._buildTitle());
    panel.appendChild(this._buildLandscapeHint());
    panel.appendChild(this._buildSection('手机/平板横屏操作', LANDSCAPE_CONTROLS));
    panel.appendChild(this._buildCloseButton());

    return panel;
  }

  /**
   * 构建面板标题
   * @returns {HTMLElement}
   * @private
   */
  _buildTitle() {
    const title = document.createElement('h2');
    title.textContent = '操作说明';
    title.style.cssText = 'margin: 0 0 20px 0; font-size: 22px; text-align: center;';
    return title;
  }

  /**
   * 构建设备方向提示，让入口说明与产品支持范围保持一致。
   * @returns {HTMLElement}
   * @private
   */
  _buildLandscapeHint() {
    const hint = document.createElement('p');
    hint.textContent = '请使用手机或平板横屏体验，竖屏时请旋转设备。';
    hint.style.cssText = `
      margin: 0 0 20px 0; color: #cbd5e1; line-height: 1.6;
      text-align: center;
    `;
    return hint;
  }

  /**
   * 构建单个操作说明区块（小标题 + 按键条目列表）
   * @param {string} sectionTitle - 区块标题
   * @param {Array<{keys: string, desc: string}>} items - 操作条目
   * @returns {HTMLElement}
   * @private
   */
  _buildSection(sectionTitle, items) {
    const section = document.createElement('div');
    section.style.cssText = 'margin-bottom: 20px;';

    const heading = document.createElement('h3');
    heading.textContent = sectionTitle;
    heading.style.cssText = `
      margin: 0 0 12px 0; font-size: 17px; color: #94a3b8;
      border-bottom: 1px solid #334155; padding-bottom: 6px;
    `;
    section.appendChild(heading);

    items.forEach((item) => {
      const row = document.createElement('div');
      row.style.cssText = 'display: flex; align-items: center; gap: 12px; margin-bottom: 10px;';

      const keys = document.createElement('span');
      keys.textContent = item.keys;
      keys.style.cssText = `
        flex-shrink: 0; min-width: 130px; padding: 4px 10px;
        background: #334155; border-radius: 6px; text-align: center;
        font-size: 14px; font-weight: 600; color: #e2e8f0;
      `;

      const desc = document.createElement('span');
      desc.textContent = item.desc;
      desc.style.cssText = 'flex: 1; color: #cbd5e1;';

      row.appendChild(keys);
      row.appendChild(desc);
      section.appendChild(row);
    });

    return section;
  }

  /**
   * 构建关闭按钮，点击后关闭整个覆盖层
   * @returns {HTMLElement}
   * @private
   */
  _buildCloseButton() {
    const btn = document.createElement('button');
    btn.textContent = '关闭';
    btn.setAttribute('data-menu-overlay-close', '');
    btn.style.cssText = 'display: block; width: 100%; margin-top: 8px;';
    applyButtonStyle(btn, { variant: 'secondary', size: 'sm', width: 'full' });
    btn.addEventListener('click', () => this.close());
    return btn;
  }

  /**
   * 遮罩点击触发的关闭回调（Overlay 内部调用）
   * Overlay.close 已移除 DOM，此处仅清理引用并通知外部
   * @private
   */
  _handleClose() {
    this.overlay = null;
    this.element = null;
    if (this.onClose) {
      this.onClose();
    }
  }
}
