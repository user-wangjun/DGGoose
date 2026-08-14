import { getBadgeAssetUrl } from '../data/badgeAssets.js';

const DEFAULT_DURATION_MS = 1500;

/**
 * 场景完成后的印记核验展示。
 * 使用正式彩色徽章、暖金发光背景；玩家按空格或点击继续后才允许继续场景流程。
 */
export class BadgeReveal {
  /**
   * @param {Object} deps - 依赖注入
   * @param {HTMLElement} deps.container - 覆盖层挂载容器
   * @param {number} [deps.durationMs=1500] - 入场动画时长
   */
  constructor({ container, durationMs = DEFAULT_DURATION_MS }) {
    this.container = container;
    this.durationMs = durationMs;
    this.element = null;
    this.onConfirm = null;
    this.inputTarget = null;
    this.confirmButton = null;
    /** 延迟绑定确认键，避免触发收集的当前 keydown 被新覆盖层重复消费。 */
    this._bindTimer = null;
    this._styleInjected = false;
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onConfirmClick = this._onConfirmClick.bind(this);
  }

  /**
   * 展示一枚已获得印记；若资源不存在则不创建错误占位。
   * @param {{id:string,name:string}} badge - 印记数据
   * @param {{onConfirm?: Function}} [options]
   * @returns {HTMLElement|null}
   */
  show(badge, { onConfirm = null } = {}) {
    if (!badge) return null;

    const imageUrl = getBadgeAssetUrl(badge.id, true);
    if (!imageUrl || !this.container) return null;

    this.hide();
    this.onConfirm = typeof onConfirm === 'function' ? onConfirm : null;
    this._injectStyles();

    const root = document.createElement('div');
    root.setAttribute('data-badge-reveal', '');
    root.setAttribute('aria-live', 'polite');
    root.style.cssText = `
      position: fixed; inset: 0; z-index: 5000; pointer-events: auto;
      display: flex; align-items: center; justify-content: center;
      padding: 24px; box-sizing: border-box;
      background: radial-gradient(circle at 50% 44%, rgba(255, 220, 128, 0.42) 0%, rgba(64, 40, 22, 0.72) 34%, rgba(8, 12, 20, 0.88) 100%);
      animation: gxe-badge-reveal ${this.durationMs}ms ease-out forwards;
    `;

    const glow = document.createElement('div');
    glow.setAttribute('data-badge-reveal-glow', '');
    glow.style.cssText = `
      position: absolute; width: min(420px, 82vw); aspect-ratio: 1;
      border-radius: 50%;
      background: radial-gradient(circle, rgba(255, 239, 177, 0.72) 0%, rgba(248, 177, 67, 0.3) 34%, rgba(248, 177, 67, 0) 70%);
      filter: blur(2px); animation: gxe-badge-reveal-glow 1.5s ease-in-out infinite;
    `;
    root.appendChild(glow);

    const card = document.createElement('div');
    card.setAttribute('data-badge-reveal-card', '');
    card.style.cssText = `
      position: relative; display: flex; flex-direction: column; align-items: center;
      width: min(360px, 82vw); padding: 22px 26px 24px; box-sizing: border-box;
      border: 1px solid rgba(255, 226, 151, 0.78); border-radius: 28px;
      background: linear-gradient(160deg, rgba(37, 29, 24, 0.92), rgba(18, 25, 31, 0.88));
      box-shadow: 0 0 0 1px rgba(255, 245, 204, 0.18), 0 0 42px rgba(255, 190, 76, 0.48), 0 18px 56px rgba(0, 0, 0, 0.42);
      text-align: center; transform: translateY(6px);
    `;

    const eyebrow = document.createElement('div');
    eyebrow.textContent = '场景完成 · 印记核验';
    eyebrow.style.cssText = `
      color: #fde7a7; font-size: 14px; letter-spacing: 0.14em;
      margin-bottom: 6px; text-shadow: 0 0 12px rgba(255, 216, 115, 0.7);
    `;
    card.appendChild(eyebrow);

    // 给徽章预留固定画框，避免移动网络尚未返回图片尺寸时整块内容塌陷，
    // 同时提供一个暖金占位章；正式资源加载完成后占位会淡出，失败时也不会
    // 留下一块空白区域。
    const artFrame = document.createElement('div');
    artFrame.setAttribute('data-badge-reveal-art', '');
    artFrame.style.cssText = `
      position: relative; display: grid; place-items: center;
      width: min(184px, 48vw); height: min(184px, 48vw);
      margin: 2px 0 4px;
    `;

    const fallbackArt = document.createElement('div');
    fallbackArt.setAttribute('data-badge-reveal-fallback', '');
    fallbackArt.setAttribute('aria-hidden', 'true');
    fallbackArt.textContent = '徽章';
    fallbackArt.style.cssText = `
      position: absolute; inset: 10%; display: grid; place-items: center;
      border: 3px solid rgba(255, 239, 177, 0.92); border-radius: 50%;
      background: radial-gradient(circle at 35% 28%, #fff4c2 0 9%, transparent 10%),
        radial-gradient(circle at 50% 48%, #f6b94f 0 46%, #c66a2c 47% 63%, #6b3424 64% 67%, #f8d982 68% 100%);
      color: #fff4ce; font-size: 18px; font-weight: 800; letter-spacing: 0.16em;
      text-shadow: 0 2px 4px rgba(78, 36, 20, 0.5);
      box-shadow: 0 0 22px rgba(255, 210, 105, 0.48), inset 0 0 0 5px rgba(255, 245, 204, 0.18);
      transition: opacity 160ms ease;
    `;
    artFrame.appendChild(fallbackArt);

    const image = document.createElement('img');
    image.setAttribute('data-badge-reveal-image', '');
    image.alt = `${badge.name || '东莞'}印记`;
    image.decoding = 'async';
    image.fetchPriority = 'high';
    image.style.cssText = `
      position: relative; z-index: 1; display: block;
      width: 100%; height: 100%; object-fit: contain;
      opacity: 0; filter: drop-shadow(0 0 16px rgba(255, 218, 126, 0.8));
      transition: opacity 160ms ease;
    `;
    image.addEventListener('load', () => {
      image.style.opacity = '1';
      fallbackArt.style.opacity = '0';
    });
    image.addEventListener('error', () => {
      image.style.display = 'none';
      fallbackArt.textContent = '徽章';
      fallbackArt.style.opacity = '1';
    });
    image.src = imageUrl;
    artFrame.appendChild(image);
    card.appendChild(artFrame);

    const name = document.createElement('div');
    name.textContent = badge.name || '东莞印记';
    name.style.cssText = `
      color: #fff4ce; font-size: 24px; font-weight: 700;
      text-shadow: 0 0 16px rgba(255, 214, 112, 0.62);
    `;
    card.appendChild(name);

    const hint = document.createElement('div');
    hint.setAttribute('data-badge-reveal-hint', '');
    hint.textContent = '按空格或点击继续';
    hint.style.cssText = `
      margin-top: 12px; color: rgba(255, 244, 206, 0.78); font-size: 14px;
      letter-spacing: 0.08em;
    `;
    card.appendChild(hint);

    // 键盘空格在手机上不存在；确认按钮必须属于模态层本身，不能复用
    // 被全屏 BadgeReveal 覆盖住的底部虚拟摇杆按钮。
    const confirmButton = document.createElement('button');
    confirmButton.type = 'button';
    confirmButton.setAttribute('data-badge-reveal-confirm', '');
    confirmButton.setAttribute('aria-label', '点击继续');
    confirmButton.textContent = '继续';
    confirmButton.style.cssText = `
      min-width: 128px; min-height: 44px; margin-top: 12px; padding: 9px 22px;
      border: 2px solid rgba(255, 236, 170, 0.94); border-radius: 999px;
      background: linear-gradient(145deg, #ffd978, #e37a3f);
      color: #4b2518; font: 800 15px/1.1 "Microsoft YaHei", sans-serif;
      letter-spacing: 0.08em; cursor: pointer; pointer-events: auto;
      touch-action: manipulation; user-select: none;
      -webkit-user-select: none; -webkit-tap-highlight-color: transparent;
      box-shadow: inset 0 2px 0 rgba(255, 255, 236, 0.72), 0 5px 0 rgba(91, 45, 25, 0.2), 0 8px 18px rgba(0, 0, 0, 0.24);
    `;
    confirmButton.addEventListener('click', this._onConfirmClick);
    card.appendChild(confirmButton);

    root.appendChild(card);
    this.container.appendChild(root);
    this.element = root;
    this.confirmButton = confirmButton;
    // 当前展示可能是在 InputManager 的 keydown 回调中创建；下一轮任务再绑定，
    // 确保用于收集合格证的这一按键不会立即把刚出现的印记层确认掉。
    this._bindTimer = setTimeout(() => {
      this._bindTimer = null;
      if (!this.element) return;
      this.inputTarget = typeof window !== 'undefined' ? window : null;
      this.inputTarget?.addEventListener('keydown', this._onKeyDown, true);
    }, 0);
    return root;
  }

  /** 隐藏当前展示并移除空格确认监听。 */
  hide() {
    if (this._bindTimer !== null) {
      clearTimeout(this._bindTimer);
      this._bindTimer = null;
    }
    this.inputTarget?.removeEventListener('keydown', this._onKeyDown, true);
    this.inputTarget = null;
    if (this.element?.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }
    this.element = null;
    this.confirmButton = null;
    this.onConfirm = null;
  }

  /**
   * 消费一次空格确认；无展示时不触发回调。
   * @returns {boolean} 是否确认成功
   */
  confirm() {
    if (!this.element) return false;
    const callback = this.onConfirm;
    this.hide();
    callback?.();
    return true;
  }

  /** @private */
  _onKeyDown(event) {
    if (!this.element || event.repeat || (event.key !== ' ' && event.code !== 'Space')) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    this.confirm();
  }

  /** @private */
  _onConfirmClick(event) {
    if (event.cancelable) event.preventDefault();
    event.stopPropagation();
    this.confirm();
  }

  /** 销毁组件并释放挂载引用。 */
  destroy() {
    this.hide();
    this.container = null;
  }

  /** @private */
  _injectStyles() {
    if (this._styleInjected) return;
    this._styleInjected = true;

    const style = document.createElement('style');
    style.textContent = `
      @keyframes gxe-badge-reveal {
        0% { opacity: 0; transform: scale(0.94); }
        16% { opacity: 1; transform: scale(1); }
        100% { opacity: 1; transform: scale(1); }
      }
      @keyframes gxe-badge-reveal-glow {
        0%, 100% { transform: scale(0.92); opacity: 0.66; }
        50% { transform: scale(1.08); opacity: 1; }
      }
      @media (max-width: 960px) and (max-height: 460px) and (orientation: landscape) {
        [data-badge-reveal] { padding: 8px; }
        [data-badge-reveal-card] {
          width: min(380px, 86vw) !important;
          padding: 12px 18px 14px !important;
          border-radius: 20px !important;
        }
        [data-badge-reveal-art] {
          width: min(132px, 30vh, 48vw) !important;
          height: min(132px, 30vh, 48vw) !important;
          margin: 0 0 2px !important;
        }
        [data-badge-reveal-image] { width: 100% !important; height: 100% !important; }
        [data-badge-reveal-hint] { margin-top: 6px !important; font-size: 12px !important; }
        [data-badge-reveal-confirm] { min-height: 38px !important; margin-top: 7px !important; padding-block: 7px !important; }
      }
    `;
    document.head.appendChild(style);
  }
}

export { DEFAULT_DURATION_MS };
