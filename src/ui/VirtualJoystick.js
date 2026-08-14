/**
 * 虚拟摇杆（对应 PRD §6.1 移动端输入 + Task 1.2）
 *
 * 视觉和触控仍绑定在同一组 data-joystick-* 元素上：底座负责接收指针，
 * 摇杆头只负责跟随偏移；移动端交互键复用现有 Space/interact 通道。Pointer Events 使用指针捕获，并保留 window 级
 * 兜底清理，避免浏览器在指针离开视口、取消捕获或失焦时留下“卡住”的输入。
 * 输出 {x,y} 归一化向量；拉满判定 run（>0.92R）。
 */

import { JOYSTICK_RUN_THRESHOLD } from '../config.js';

/** 默认摇杆最大移动半径（px），保留原有 getVector() 语义。 */
const DEFAULT_RADIUS = 34;
const DEFAULT_STICK_SIZE = 52;
const MIN_STICK_SIZE = 44;
const MAX_STICK_SIZE = 58;
const JOYSTICK_Z_INDEX = 40;
const RELEASE_TRANSITION = 'transform 180ms cubic-bezier(0.22, 0.82, 0.32, 1)';

/**
 * 组件自包含样式。正式视觉直接作用于真实交互元素，不创建脱离热区的装饰图片。
 * safe-area 和短横屏规则放在组件样式中，避免依赖外层页面是否额外加载 CSS。
 */
const JOYSTICK_STYLES = `
  [data-joystick-base].gxe-virtual-joystick {
    /* 画布在超宽横屏中会以 16:9 居中留黑边；控件必须落在同一个画框内，
       不能继续固定在 viewport 边缘，否则手机上会像“后续黑屏”。 */
    --joystick-left: max(
      calc(var(--gxe-game-frame-left, calc((100vw - min(100vw, 177.7778vh)) / 2)) + 14px),
      calc(env(safe-area-inset-left, 0px) + 14px)
    );
    --joystick-bottom: max(
      calc(var(--gxe-game-frame-bottom, calc((100vh - min(100vh, 56.25vw)) / 2)) + 14px),
      calc(env(safe-area-inset-bottom, 0px) + 14px)
    );
    position: fixed;
    left: var(--joystick-left);
    bottom: var(--joystick-bottom);
    z-index: 40;
    box-sizing: border-box;
    border-radius: 50%;
    border: 2px solid rgba(91, 55, 36, 0.82);
    background:
      radial-gradient(circle at 50% 42%, rgba(255, 249, 228, 0.78) 0 42%, transparent 43%),
      radial-gradient(circle at 50% 50%, rgba(239, 213, 170, 0.86) 0 67%, rgba(183, 130, 76, 0.32) 68% 73%, transparent 74%),
      linear-gradient(145deg, rgba(255, 244, 213, 0.78), rgba(205, 157, 103, 0.62));
    box-shadow:
      inset 0 2px 0 rgba(255, 255, 255, 0.72),
      inset 0 -7px 12px rgba(104, 62, 35, 0.18),
      0 7px 0 rgba(94, 53, 31, 0.12),
      0 10px 18px rgba(48, 27, 18, 0.2);
    overflow: hidden;
    isolation: isolate;
    pointer-events: auto;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
    -webkit-tap-highlight-color: transparent;
    transition: filter 140ms ease, opacity 140ms ease;
    opacity: 0.74;
  }

  [data-joystick-base].gxe-virtual-joystick::before {
    content: "";
    position: absolute;
    inset: 9px;
    z-index: -1;
    border: 1px dashed rgba(120, 75, 43, 0.3);
    border-radius: 50%;
    pointer-events: none;
  }

  [data-joystick-base].gxe-virtual-joystick[data-joystick-state="pressed"] {
    opacity: 0.9;
    filter: brightness(1.04) saturate(1.06);
    box-shadow:
      inset 0 2px 0 rgba(255, 255, 255, 0.82),
      inset 0 -7px 12px rgba(104, 62, 35, 0.2),
      0 0 0 4px rgba(231, 119, 73, 0.14),
      0 8px 18px rgba(48, 27, 18, 0.24);
  }

  [data-joystick-base].gxe-virtual-joystick[data-joystick-state="dragging"] {
    opacity: 0.97;
    filter: brightness(1.08) saturate(1.12);
    box-shadow:
      inset 0 2px 0 rgba(255, 255, 255, 0.86),
      inset 0 -7px 12px rgba(104, 62, 35, 0.22),
      0 0 0 5px rgba(218, 78, 58, 0.16),
      0 9px 20px rgba(48, 27, 18, 0.27);
  }

  [data-joystick-base].gxe-virtual-joystick[data-joystick-state="released"] {
    opacity: 0.76;
    filter: saturate(0.98);
  }

  [data-joystick-base].gxe-virtual-joystick[data-joystick-state="disabled"] {
    opacity: 0.38;
    pointer-events: none;
    filter: saturate(0.55);
  }

  [data-joystick-base].gxe-virtual-joystick[data-joystick-state="hidden"] {
    opacity: 0;
    pointer-events: none;
  }

  [data-joystick-stick].gxe-virtual-joystick__stick {
    position: absolute;
    top: 50%;
    left: 50%;
    box-sizing: border-box;
    border-radius: 50%;
    border: 2px solid rgba(112, 45, 35, 0.88);
    background:
      radial-gradient(ellipse at 50% 28%, rgba(255, 243, 202, 0.78) 0 6%, transparent 7%),
      radial-gradient(circle at 37% 46%, rgba(255, 235, 184, 0.74) 0 4.6%, transparent 5.8%),
      radial-gradient(circle at 63% 46%, rgba(255, 235, 184, 0.74) 0 4.6%, transparent 5.8%),
      linear-gradient(145deg, #ee8653 0%, #d44d40 58%, #ad3037 100%);
    box-shadow:
      inset 0 2px 0 rgba(255, 245, 209, 0.64),
      inset 0 -6px 8px rgba(113, 38, 36, 0.25),
      0 4px 0 rgba(105, 44, 33, 0.18),
      0 7px 12px rgba(61, 29, 25, 0.24);
    pointer-events: none;
    will-change: transform;
    transition: transform 180ms cubic-bezier(0.22, 0.82, 0.32, 1), filter 140ms ease;
  }

  [data-joystick-interact].gxe-virtual-joystick__action {
    --joystick-action-right: max(
      calc(var(--gxe-game-frame-right, calc((100vw - min(100vw, 177.7778vh)) / 2)) + 14px),
      calc(env(safe-area-inset-right, 0px) + 14px)
    );
    --joystick-action-bottom: max(
      calc(var(--gxe-game-frame-bottom, calc((100vh - min(100vh, 56.25vw)) / 2)) + 14px),
      calc(env(safe-area-inset-bottom, 0px) + 14px)
    );
    position: fixed;
    right: var(--joystick-action-right);
    bottom: var(--joystick-action-bottom);
    z-index: 40;
    width: 68px;
    height: 68px;
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 6px 8px;
    border: 2px solid rgba(112, 45, 35, 0.82);
    border-radius: 50%;
    background: linear-gradient(145deg, rgba(255, 244, 213, 0.96), rgba(218, 91, 63, 0.94));
    box-shadow:
      inset 0 2px 0 rgba(255, 250, 226, 0.72),
      inset 0 -5px 8px rgba(113, 38, 36, 0.18),
      0 4px 0 rgba(105, 44, 33, 0.16),
      0 7px 12px rgba(61, 29, 25, 0.2);
    color: #5b3724;
    font: 700 14px/1 inherit;
    letter-spacing: 0.06em;
    white-space: nowrap;
    cursor: pointer;
    pointer-events: auto;
    touch-action: manipulation;
    user-select: none;
    -webkit-user-select: none;
    -webkit-tap-highlight-color: transparent;
    transition: transform 120ms ease, filter 120ms ease, opacity 120ms ease;
  }

  [data-joystick-interact].gxe-virtual-joystick__action[data-joystick-action-state="pressed"],
  [data-joystick-interact].gxe-virtual-joystick__action:active {
    filter: brightness(1.08) saturate(1.1);
    transform: translateY(-1px) scale(0.96);
  }

  [data-joystick-interact].gxe-virtual-joystick__action:disabled,
  [data-joystick-interact].gxe-virtual-joystick__action[hidden] {
    display: none !important;
    opacity: 0;
    pointer-events: none;
  }

  [data-joystick-base].gxe-virtual-joystick[data-joystick-state="pressed"] [data-joystick-stick],
  [data-joystick-base].gxe-virtual-joystick[data-joystick-state="dragging"] [data-joystick-stick] {
    filter: brightness(1.1) saturate(1.14);
  }

  [data-joystick-base].gxe-virtual-joystick[data-joystick-state="pressed"] [data-joystick-stick],
  [data-joystick-base].gxe-virtual-joystick[data-joystick-state="dragging"] [data-joystick-stick] {
    transition: none;
  }

  @media (max-width: 960px) and (max-height: 460px) and (orientation: landscape) {
    [data-joystick-base].gxe-virtual-joystick {
      --joystick-left: max(
        calc(var(--gxe-game-frame-left, calc((100vw - min(100vw, 177.7778vh)) / 2)) + 10px),
        calc(env(safe-area-inset-left, 0px) + 10px)
      );
      --joystick-bottom: max(
        calc(var(--gxe-game-frame-bottom, calc((100vh - min(100vh, 56.25vw)) / 2)) + 8px),
        calc(env(safe-area-inset-bottom, 0px) + 8px)
      );
    }

    [data-joystick-interact].gxe-virtual-joystick__action {
      --joystick-action-right: max(
        calc(var(--gxe-game-frame-right, calc((100vw - min(100vw, 177.7778vh)) / 2)) + 10px),
        calc(env(safe-area-inset-right, 0px) + 10px)
      );
      --joystick-action-bottom: max(
        calc(var(--gxe-game-frame-bottom, calc((100vh - min(100vh, 56.25vw)) / 2)) + 8px),
        calc(env(safe-area-inset-bottom, 0px) + 8px)
      );
    }
  }

  @media (prefers-reduced-motion: reduce) {
    [data-joystick-base].gxe-virtual-joystick,
    [data-joystick-stick].gxe-virtual-joystick__stick,
    [data-joystick-interact].gxe-virtual-joystick__action {
      transition: none !important;
    }
  }
`;

/**
 * 纯函数：偏移量 → 归一化向量
 * 截断到半径范围内，归一化到 -1~1，拉满（>0.92R）标记 run。
 * @param {number} dx - X 偏移量（相对圆心）
 * @param {number} dy - Y 偏移量（相对圆心）
 * @param {number} radius - 摇杆最大移动半径
 * @returns {{x: number, y: number, run: boolean}}
 */
export function offsetToVector(dx, dy, radius = DEFAULT_RADIUS) {
  const safeRadius = Math.max(1, Number(radius) || DEFAULT_RADIUS);
  const dist = Math.hypot(dx, dy);
  if (dist === 0) {
    return { x: 0, y: 0, run: false };
  }

  const clampedDist = Math.min(dist, safeRadius);
  const scale = clampedDist / dist / safeRadius;
  const x = dx * scale;
  const y = dy * scale;
  const magnitude = Math.hypot(x, y);
  const run = magnitude > JOYSTICK_RUN_THRESHOLD;

  return { x, y, run };
}

/**
 * 虚拟摇杆组件
 * 挂载到容器元素，监听 Pointer Events，输出归一化向量。
 */
export class VirtualJoystick {
  /**
   * @param {Object} options
   * @param {HTMLElement} options.container - 挂载容器
   * @param {number} [options.radius=34] - 向量最大半径（px）
   */
  constructor({ container, radius = DEFAULT_RADIUS }) {
    this.container = container;
    this.radius = Math.max(1, Number(radius) || DEFAULT_RADIUS);
    this.stickSize = Math.min(MAX_STICK_SIZE, Math.max(MIN_STICK_SIZE, this.radius * 1.5));
    this.baseSize = this.radius * 2 + this.stickSize;
    this.active = false;
    this.enabled = true;
    this.state = 'idle';
    this.reducedMotion = this._prefersReducedMotion();
    this.centerX = 0;
    this.centerY = 0;
    this.activePointerId = null;
    this.currentVector = { x: 0, y: 0, run: false };
    this.stickOffset = { x: 0, y: 0 };
    this.baseElement = null;
    this.stickElement = null;
    this.actionElement = null;
    this.styleElement = null;
    this.visibilityObserver = null;
    this._windowListenersAttached = false;

    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
    this._onPointerCancel = this._onPointerCancel.bind(this);
    this._onLostPointerCapture = this._onLostPointerCapture.bind(this);
    this._onWindowBlur = this._onWindowBlur.bind(this);
    this._onActionPointerDown = this._onActionPointerDown.bind(this);
    this._onActionPointerUp = this._onActionPointerUp.bind(this);
    this._onActionClick = this._onActionClick.bind(this);
  }

  /** @private */
  get _window() {
    return this.container?.ownerDocument?.defaultView || globalThis.window;
  }

  /** @private */
  _prefersReducedMotion() {
    const windowObject = this.container?.ownerDocument?.defaultView || globalThis.window;
    return Boolean(
      windowObject
      && typeof windowObject.matchMedia === 'function'
      && windowObject.matchMedia('(prefers-reduced-motion: reduce)').matches,
    );
  }

  /**
   * 挂载：创建正式视觉 DOM、样式和 Pointer Events 监听。
   * @returns {HTMLElement|null} 底座元素
   */
  mount() {
    if (!this.container || this.baseElement) return this.baseElement;

    const ownerDocument = this.container.ownerDocument || document;
    this._injectStyles(ownerDocument);

    this.baseElement = ownerDocument.createElement('div');
    this.baseElement.className = 'gxe-virtual-joystick';
    this.baseElement.setAttribute('data-joystick-base', '');
    this.baseElement.setAttribute('data-joystick-state', 'idle');
    this.baseElement.setAttribute('data-joystick-enabled', 'true');
    this.baseElement.setAttribute('aria-label', '移动摇杆');
    this.baseElement.setAttribute('role', 'application');
    this.baseElement.style.cssText = `
      position: fixed;
      left: var(--joystick-left);
      bottom: var(--joystick-bottom);
      width: ${this.baseSize}px;
      height: ${this.baseSize}px;
      z-index: ${JOYSTICK_Z_INDEX};
      pointer-events: auto;
      touch-action: none;
      overflow: hidden;
    `;
    this.baseElement.style.setProperty('--joystick-diameter', `${this.baseSize}px`);
    this.baseElement.style.setProperty('--joystick-stick-size', `${this.stickSize}px`);

    this.stickElement = ownerDocument.createElement('div');
    this.stickElement.className = 'gxe-virtual-joystick__stick';
    this.stickElement.setAttribute('data-joystick-stick', '');
    this.stickElement.setAttribute('data-joystick-state', 'idle');
    this.stickElement.style.cssText = `
      width: ${this.stickSize}px;
      height: ${this.stickSize}px;
      transform: translate(-50%, -50%);
      transition: ${this.reducedMotion ? 'none' : RELEASE_TRANSITION};
    `;

    this.actionElement = ownerDocument.createElement('button');
    this.actionElement.type = 'button';
    this.actionElement.className = 'gxe-virtual-joystick__action';
    this.actionElement.setAttribute('data-joystick-interact', '');
    this.actionElement.setAttribute('data-joystick-action-state', 'idle');
    this.actionElement.setAttribute('aria-label', '互动');
    this.actionElement.textContent = '互动';

    this.baseElement.appendChild(this.stickElement);
    this.container.append(this.baseElement, this.actionElement);

    this.baseElement.addEventListener('pointerdown', this._onPointerDown);
    this.baseElement.addEventListener('pointerup', this._onPointerUp);
    this.baseElement.addEventListener('pointercancel', this._onPointerCancel);
    this.baseElement.addEventListener('lostpointercapture', this._onLostPointerCapture);
    this.actionElement.addEventListener('pointerdown', this._onActionPointerDown);
    this.actionElement.addEventListener('pointerup', this._onActionPointerUp);
    this.actionElement.addEventListener('pointercancel', this._onActionPointerUp);
    this.actionElement.addEventListener('click', this._onActionClick);
    const MutationObserverConstructor = ownerDocument.defaultView?.MutationObserver || globalThis.MutationObserver;
    if (MutationObserverConstructor) {
      this.visibilityObserver = new MutationObserverConstructor(() => this._syncActionButton());
      this.visibilityObserver.observe(this.baseElement, {
        attributes: true,
        attributeFilter: ['style'],
      });
    }
    this._syncActionButton();
    return this.baseElement;
  }

  /** @private */
  _injectStyles(ownerDocument) {
    this.styleElement = ownerDocument.createElement('style');
    this.styleElement.setAttribute('data-joystick-styles', '');
    this.styleElement.textContent = JOYSTICK_STYLES;
    (ownerDocument.head || ownerDocument.documentElement).appendChild(this.styleElement);
  }

  /**
   * 卸载：移除事件监听、指针捕获、组件 DOM 和自包含样式。
   */
  unmount() {
    this._finishInteraction('released');

    if (this.baseElement) {
      this.baseElement.removeEventListener('pointerdown', this._onPointerDown);
      this.baseElement.removeEventListener('pointerup', this._onPointerUp);
      this.baseElement.removeEventListener('pointercancel', this._onPointerCancel);
      this.baseElement.removeEventListener('lostpointercapture', this._onLostPointerCapture);
      this.actionElement?.removeEventListener('pointerdown', this._onActionPointerDown);
      this.actionElement?.removeEventListener('pointerup', this._onActionPointerUp);
      this.actionElement?.removeEventListener('pointercancel', this._onActionPointerUp);
      this.actionElement?.removeEventListener('click', this._onActionClick);
      if (this.baseElement.parentNode) {
        this.baseElement.parentNode.removeChild(this.baseElement);
      }
    }
    if (this.actionElement?.parentNode) {
      this.actionElement.parentNode.removeChild(this.actionElement);
    }
    this.visibilityObserver?.disconnect();
    this.visibilityObserver = null;
    if (this.styleElement?.parentNode) {
      this.styleElement.parentNode.removeChild(this.styleElement);
    }

    this.baseElement = null;
    this.stickElement = null;
    this.actionElement = null;
    this.styleElement = null;
    this.active = false;
    this.activePointerId = null;
    this.state = 'idle';
    this.stickOffset = { x: 0, y: 0 };
    this.currentVector = { x: 0, y: 0, run: false };
  }

  /** 与其他 UI 组件保持常见的 destroy 命名，同时保留原有 unmount API。 */
  destroy() {
    this.unmount();
  }

  /**
   * 设置是否可操作；不可操作时不产生向量，并保留 disabled 状态契约。
   * @param {boolean} enabled
   */
  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    if (!this.enabled) {
      this._finishInteraction('disabled');
      this._setState('disabled');
      if (this.baseElement) {
        this.baseElement.setAttribute('data-joystick-enabled', 'false');
        this.baseElement.setAttribute('aria-disabled', 'true');
      }
    } else if (this.baseElement) {
      this.baseElement.setAttribute('data-joystick-enabled', 'true');
      this.baseElement.removeAttribute('aria-disabled');
      if (this.state === 'disabled') this._setState('idle');
    }
    this._syncActionButton();
    return this;
  }

  /**
   * 设置显隐；主循环也会通过 baseElement.style.display 的现有策略自动同步 hidden 状态。
   * @param {boolean} visible
   */
  setVisible(visible) {
    if (!this.baseElement) return this;
    if (visible) {
      this.baseElement.style.display = '';
      this.baseElement.setAttribute('aria-hidden', 'false');
      if (this.state === 'hidden') this._setState(this.enabled ? 'idle' : 'disabled');
    } else {
      this._finishInteraction('hidden');
      this.baseElement.style.display = 'none';
      this.baseElement.setAttribute('aria-hidden', 'true');
      this._setState('hidden');
    }
    this._syncActionButton();
    return this;
  }

  /** 是否激活中。 */
  isActive() {
    return this.active;
  }

  /** 当前视觉/交互状态。 */
  getState() {
    this._syncVisibilityState();
    this._syncActionButton();
    return this.state;
  }

  /**
   * 获取当前向量
   * @returns {{x: number, y: number, run: boolean}}
   */
  getVector() {
    const hidden = this._syncVisibilityState();
    this._syncActionButton();
    if (!this.baseElement || !this.enabled || hidden) {
      return { x: 0, y: 0, run: false };
    }
    return { ...this.currentVector };
  }

  /** @private */
  _syncVisibilityState() {
    if (!this.baseElement) return true;
    const hidden = this.baseElement.style.display === 'none';
    if (hidden) {
      if (this.active) this._finishInteraction('hidden');
      if (this.state !== 'hidden') this._setState('hidden');
      return true;
    }
    if (this.state === 'hidden') this._setState(this.enabled ? 'idle' : 'disabled');
    return false;
  }

  /**
   * 俯视场景已有 TopdownController 情境交互键时，不重复显示本组件的通用键。
   * 工厂侧视序章没有 HUD，则保留此键并通过 Space/interact 通道触发原有逻辑。
   * @private
   */
  _syncActionButton() {
    if (!this.actionElement) return;
    const ownerDocument = this.container?.ownerDocument;
    const topdownPrompt = ownerDocument?.querySelector?.('[data-topdown-interaction]');
    const promptRect = topdownPrompt?.getBoundingClientRect?.();
    // TopdownController 的 HUD 在所有俯视章节都会常驻 DOM，投篮阶段也只是
    // 把它隐藏。不能仅凭 HUD 是否存在就隐藏移动端动作键，否则手机没有
    // 键盘时既不能推进对白，也不能在没有靠近目标时发起互动。
    // 目标提示真正可见时使用提示框自己的按钮，避免同屏出现两个动作键。
    const promptVisible = Boolean(
      topdownPrompt
      && getComputedStyle(topdownPrompt).display !== 'none'
      && Number(promptRect?.width) > 0
      && Number(promptRect?.height) > 0,
    );
    // 某些阶段（例如篮球投篮）需要玩家直接拖拽画布对象，不能让通用
    // interact 键替玩家选择一条预设路线。阶段代码用这个标记临时收起按钮，
    // 退出阶段后再移除标记，由这里统一恢复可见性/可用性。
    const actionSuppressed = this.actionElement.hasAttribute('data-joystick-action-suppressed');
    const hidden = actionSuppressed || promptVisible || !this.enabled || this.baseElement?.style.display === 'none';
    this.actionElement.hidden = hidden;
    this.actionElement.disabled = actionSuppressed || !this.enabled || promptVisible;
    this.actionElement.setAttribute('aria-hidden', hidden ? 'true' : 'false');
    if (hidden) this.actionElement.setAttribute('data-joystick-action-state', 'idle');
  }

  /** @private */
  _onActionPointerDown(event) {
    if (!this.actionElement || this.actionElement.disabled || this._syncVisibilityState()) return;
    if (event.cancelable) event.preventDefault();
    event.stopPropagation();
    this.actionElement.setAttribute('data-joystick-action-state', 'pressed');
  }

  /** @private */
  _onActionPointerUp(event) {
    event.stopPropagation();
    this.actionElement?.setAttribute('data-joystick-action-state', 'idle');
  }

  /**
   * 点击交互键时只合成现有 Space 键动作，不直接调用任何场景方法，
   * 因此 DialogueBox、FactoryScene 和 TopdownController 仍沿用原有消费顺序。
   * @private
   */
  _onActionClick(event) {
    if (!this.actionElement || this.actionElement.disabled || this._syncVisibilityState()) return;
    if (event.cancelable) event.preventDefault();
    event.stopPropagation();
    const windowObject = this._window;
    if (!windowObject?.dispatchEvent) return;
    const actionEvent = typeof windowObject.KeyboardEvent === 'function'
      ? new windowObject.KeyboardEvent('keydown', {
        key: ' ',
        code: 'Space',
        bubbles: true,
        cancelable: true,
      })
      : new Event('keydown', { bubbles: true, cancelable: true });
    windowObject.dispatchEvent(actionEvent);
    this.actionElement.setAttribute('data-joystick-action-state', 'idle');
  }

  /** @private */
  _setState(nextState) {
    this.state = nextState;
    if (this.baseElement) this.baseElement.setAttribute('data-joystick-state', nextState);
    if (this.stickElement) {
      this.stickElement.setAttribute('data-joystick-state', nextState);
      if (this.reducedMotion || nextState === 'pressed' || nextState === 'dragging') {
        this.stickElement.style.transition = 'none';
      } else {
        this.stickElement.style.transition = RELEASE_TRANSITION;
      }
    }
  }

  /** @private */
  _getPointerId(event) {
    return Number.isFinite(event?.pointerId) ? event.pointerId : null;
  }

  /** @private */
  _isCurrentPointer(event) {
    const pointerId = this._getPointerId(event);
    return this.activePointerId === null || pointerId === null || pointerId === this.activePointerId;
  }

  /** @private */
  _attachWindowListeners() {
    if (this._windowListenersAttached || !this._window) return;
    this._window.addEventListener('pointermove', this._onPointerMove);
    this._window.addEventListener('pointerup', this._onPointerUp);
    this._window.addEventListener('pointercancel', this._onPointerCancel);
    this._window.addEventListener('blur', this._onWindowBlur);
    this._windowListenersAttached = true;
  }

  /** @private */
  _detachWindowListeners() {
    if (!this._windowListenersAttached || !this._window) return;
    this._window.removeEventListener('pointermove', this._onPointerMove);
    this._window.removeEventListener('pointerup', this._onPointerUp);
    this._window.removeEventListener('pointercancel', this._onPointerCancel);
    this._window.removeEventListener('blur', this._onWindowBlur);
    this._windowListenersAttached = false;
  }

  /** @private */
  _capturePointer(pointerId) {
    if (!this.baseElement || pointerId === null || typeof this.baseElement.setPointerCapture !== 'function') return;
    try {
      this.baseElement.setPointerCapture(pointerId);
    } catch {
      // 某些嵌入式/测试环境不支持 pointer capture，window 兜底监听仍然有效。
    }
  }

  /** @private */
  _releasePointer(pointerId) {
    if (!this.baseElement || pointerId === null || typeof this.baseElement.releasePointerCapture !== 'function') return;
    try {
      if (typeof this.baseElement.hasPointerCapture !== 'function' || this.baseElement.hasPointerCapture(pointerId)) {
        this.baseElement.releasePointerCapture(pointerId);
      }
    } catch {
      // 指针已被浏览器取消时 releasePointerCapture 可能抛错，清理逻辑仍需继续。
    }
  }

  /**
   * pointerdown：记录圆心，进入 pressed，激活摇杆。
   * @param {PointerEvent} event
   * @private
   */
  _onPointerDown(event) {
    if (!this.baseElement || !this.enabled || this._syncVisibilityState()) return;
    if (this.active && !this._isCurrentPointer(event)) return;

    if (event.cancelable) event.preventDefault();
    this.active = true;
    this.activePointerId = this._getPointerId(event);
    const rect = this.baseElement.getBoundingClientRect();
    this.centerX = rect.left + rect.width / 2;
    this.centerY = rect.top + rect.height / 2;
    this._setState('pressed');
    this._attachWindowListeners();
    this._capturePointer(this.activePointerId);
    this._updateVector(event.clientX, event.clientY);
  }

  /**
   * pointermove：更新向量；按下后第一次移动才进入 dragging，保持 pressed 可观测。
   * @param {PointerEvent} event
   * @private
   */
  _onPointerMove(event) {
    if (!this.active || !this._isCurrentPointer(event)) return;
    this._setState('dragging');
    this._updateVector(event.clientX, event.clientY);
  }

  /** @private */
  _onPointerUp(event) {
    if (!this.active || !this._isCurrentPointer(event)) return;
    this._finishInteraction('released', event);
  }

  /** @private */
  _onPointerCancel(event) {
    if (!this.active || !this._isCurrentPointer(event)) return;
    this._finishInteraction('released', event);
  }

  /** @private */
  _onLostPointerCapture(event) {
    if (!this.active || !this._isCurrentPointer(event)) return;
    this._finishInteraction('released', event);
  }

  /** @private */
  _onWindowBlur() {
    if (this.active) this._finishInteraction('released');
  }

  /** @private */
  _finishInteraction(nextState = 'released', event = null) {
    if (!this.active && !['hidden', 'disabled'].includes(nextState)) return;
    if (event && !this._isCurrentPointer(event)) return;

    const pointerId = this.activePointerId;
    this.active = false;
    this.activePointerId = null;
    this.currentVector = { x: 0, y: 0, run: false };
    this._detachWindowListeners();
    this._releasePointer(pointerId);
    this._renderStick(0, 0);
    this._setState(nextState);
  }

  /**
   * 更新向量并移动摇杆头。视觉位移和向量使用同一个截断结果，确保摇杆头不会越过底座最大半径。
   * @param {number} clientX
   * @param {number} clientY
   * @private
   */
  _updateVector(clientX, clientY) {
    if (!this.stickElement) return;
    const dx = clientX - this.centerX;
    const dy = clientY - this.centerY;
    this.currentVector = offsetToVector(dx, dy, this.radius);

    const dist = Math.hypot(dx, dy);
    const scale = dist > this.radius ? this.radius / dist : 1;
    this._renderStick(dx * scale, dy * scale);
  }

  /** @private */
  _renderStick(x, y) {
    this.stickOffset = { x, y };
    if (!this.stickElement) return;
    if (x === 0 && y === 0) {
      this.stickElement.style.transform = 'translate(-50%, -50%)';
    } else {
      this.stickElement.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
    }
  }
}
