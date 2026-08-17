/**
 * 移动端投篮轮盘。
 *
 * 与左下 VirtualJoystick 使用独立 DOM 和 pointerId，右手可以单独调整
 * 投篮方向/力度，松手时把归一化向量交给篮球场景处理。
 */

import { offsetToVector } from './VirtualJoystick.js';

const DEFAULT_RADIUS = 34;
const DEFAULT_STICK_SIZE = 52;
const MIN_STICK_SIZE = 44;
const MAX_STICK_SIZE = 58;
const JOYSTICK_Z_INDEX = 40;
const RELEASE_TRANSITION = 'transform 180ms cubic-bezier(0.22, 0.82, 0.32, 1)';

const SHOOTING_JOYSTICK_STYLES = `
  [data-joystick-shoot].gxe-shooting-joystick {
    --joystick-shoot-right: max(
      calc(var(--gxe-game-frame-right, calc((100vw - min(100vw, 177.7778vh)) / 2)) + 14px),
      calc(env(safe-area-inset-right, 0px) + 14px)
    );
    --joystick-shoot-bottom: max(
      calc(var(--gxe-game-frame-bottom, calc((100vh - min(100vh, 56.25vw)) / 2)) + 14px),
      calc(env(safe-area-inset-bottom, 0px) + 14px)
    );
    position: fixed;
    right: var(--joystick-shoot-right);
    bottom: var(--joystick-shoot-bottom);
    z-index: 40;
    box-sizing: border-box;
    border-radius: 50%;
    border: 2px solid rgba(112, 45, 35, 0.86);
    background:
      radial-gradient(circle at 50% 43%, rgba(255, 247, 219, 0.92) 0 39%, transparent 40%),
      radial-gradient(circle at 50% 50%, rgba(255, 197, 106, 0.92) 0 68%, rgba(217, 91, 63, 0.34) 69% 74%, transparent 75%),
      linear-gradient(145deg, rgba(255, 238, 189, 0.96), rgba(226, 106, 65, 0.84));
    box-shadow:
      inset 0 2px 0 rgba(255, 255, 255, 0.8),
      inset 0 -8px 12px rgba(113, 38, 36, 0.2),
      0 7px 0 rgba(105, 44, 33, 0.15),
      0 10px 18px rgba(48, 27, 18, 0.24);
    overflow: hidden;
    isolation: isolate;
    pointer-events: auto;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
    -webkit-tap-highlight-color: transparent;
    transition: filter 140ms ease, opacity 140ms ease;
    opacity: 0.86;
  }

  [data-joystick-shoot].gxe-shooting-joystick::before {
    content: "";
    position: absolute;
    inset: 9px;
    z-index: -1;
    border: 1px dashed rgba(120, 75, 43, 0.34);
    border-radius: 50%;
    pointer-events: none;
  }

  [data-joystick-shoot].gxe-shooting-joystick[data-joystick-shoot-state="pressed"] {
    opacity: 0.95;
    filter: brightness(1.04) saturate(1.06);
    box-shadow:
      inset 0 2px 0 rgba(255, 255, 255, 0.86),
      inset 0 -8px 12px rgba(113, 38, 36, 0.22),
      0 0 0 4px rgba(251, 146, 60, 0.16),
      0 8px 18px rgba(48, 27, 18, 0.27);
  }

  [data-joystick-shoot].gxe-shooting-joystick[data-joystick-shoot-state="dragging"] {
    opacity: 1;
    filter: brightness(1.08) saturate(1.12);
    box-shadow:
      inset 0 2px 0 rgba(255, 255, 255, 0.9),
      inset 0 -8px 12px rgba(113, 38, 36, 0.24),
      0 0 0 5px rgba(34, 197, 94, 0.18),
      0 9px 20px rgba(48, 27, 18, 0.3);
  }

  [data-joystick-shoot].gxe-shooting-joystick[data-joystick-shoot-state="disabled"],
  [data-joystick-shoot].gxe-shooting-joystick[data-joystick-shoot-state="hidden"] {
    opacity: 0;
    pointer-events: none;
  }

  [data-joystick-shoot-stick].gxe-shooting-joystick__stick {
    position: absolute;
    top: 50%;
    left: 50%;
    box-sizing: border-box;
    border-radius: 50%;
    border: 2px solid rgba(112, 45, 35, 0.9);
    background:
      radial-gradient(circle at 34% 33%, rgba(255, 247, 219, 0.92) 0 6%, transparent 7%),
      radial-gradient(circle at 66% 33%, rgba(255, 247, 219, 0.72) 0 6%, transparent 7%),
      radial-gradient(circle at 50% 66%, rgba(255, 238, 189, 0.48) 0 8%, transparent 9%),
      linear-gradient(145deg, #f59e0b 0%, #ea580c 62%, #b9382f 100%);
    box-shadow:
      inset 0 2px 0 rgba(255, 245, 209, 0.72),
      inset 0 -6px 8px rgba(113, 38, 36, 0.28),
      0 4px 0 rgba(105, 44, 33, 0.18),
      0 7px 12px rgba(61, 29, 25, 0.26);
    pointer-events: none;
    will-change: transform;
    transition: transform 180ms cubic-bezier(0.22, 0.82, 0.32, 1), filter 140ms ease;
  }

  [data-joystick-shoot-label].gxe-shooting-joystick__label {
    position: absolute;
    left: 50%;
    bottom: 10px;
    transform: translateX(-50%);
    color: rgba(91, 55, 36, 0.9);
    font: 800 11px/1 sans-serif;
    letter-spacing: 0.08em;
    white-space: nowrap;
    pointer-events: none;
    text-shadow: 0 1px rgba(255, 247, 219, 0.64);
  }

  [data-joystick-shoot].gxe-shooting-joystick[data-joystick-shoot-state="pressed"] [data-joystick-shoot-stick],
  [data-joystick-shoot].gxe-shooting-joystick[data-joystick-shoot-state="dragging"] [data-joystick-shoot-stick] {
    filter: brightness(1.1) saturate(1.14);
    transition: none;
  }

  @media (max-width: 960px) and (max-height: 460px) and (orientation: landscape) {
    [data-joystick-shoot].gxe-shooting-joystick {
      --joystick-shoot-right: max(
        calc(var(--gxe-game-frame-right, calc((100vw - min(100vw, 177.7778vh)) / 2)) + 10px),
        calc(env(safe-area-inset-right, 0px) + 10px)
      );
      --joystick-shoot-bottom: max(
        calc(var(--gxe-game-frame-bottom, calc((100vh - min(100vh, 56.25vw)) / 2)) + 8px),
        calc(env(safe-area-inset-bottom, 0px) + 8px)
      );
    }
  }

  @media (prefers-reduced-motion: reduce) {
    [data-joystick-shoot].gxe-shooting-joystick,
    [data-joystick-shoot-stick].gxe-shooting-joystick__stick {
      transition: none !important;
    }
  }
`;

/**
 * 右下投篮轮盘。回调接收归一化向量 {x, y, run}，屏幕坐标中向下为正。
 */
export class ShootingJoystick {
  constructor({ container, radius = DEFAULT_RADIUS, onMove = null, onRelease = null, onCancel = null } = {}) {
    this.container = container;
    this.radius = Math.max(1, Number(radius) || DEFAULT_RADIUS);
    this.stickSize = Math.min(MAX_STICK_SIZE, Math.max(MIN_STICK_SIZE, this.radius * 1.5));
    this.baseSize = this.radius * 2 + this.stickSize;
    this.onMove = typeof onMove === 'function' ? onMove : null;
    this.onRelease = typeof onRelease === 'function' ? onRelease : null;
    this.onCancel = typeof onCancel === 'function' ? onCancel : null;
    this.enabled = true;
    this.active = false;
    this.state = 'hidden';
    this.reducedMotion = this._prefersReducedMotion();
    this.activePointerId = null;
    this.centerX = 0;
    this.centerY = 0;
    this.currentVector = { x: 0, y: 0, run: false };
    this.stickOffset = { x: 0, y: 0 };
    this.baseElement = null;
    this.stickElement = null;
    this.labelElement = null;
    this.styleElement = null;
    this._windowListenersAttached = false;

    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
    this._onPointerCancel = this._onPointerCancel.bind(this);
    this._onLostPointerCapture = this._onLostPointerCapture.bind(this);
    this._onWindowBlur = this._onWindowBlur.bind(this);
  }

  get _window() {
    return this.container?.ownerDocument?.defaultView || globalThis.window;
  }

  _prefersReducedMotion() {
    const windowObject = this.container?.ownerDocument?.defaultView || globalThis.window;
    return Boolean(
      windowObject
      && typeof windowObject.matchMedia === 'function'
      && windowObject.matchMedia('(prefers-reduced-motion: reduce)').matches,
    );
  }

  mount() {
    if (!this.container || this.baseElement) return this.baseElement;

    const ownerDocument = this.container.ownerDocument || document;
    this.styleElement = ownerDocument.createElement('style');
    this.styleElement.setAttribute('data-shooting-joystick-styles', '');
    this.styleElement.textContent = SHOOTING_JOYSTICK_STYLES;
    (ownerDocument.head || ownerDocument.documentElement).appendChild(this.styleElement);

    this.baseElement = ownerDocument.createElement('div');
    this.baseElement.className = 'gxe-shooting-joystick';
    this.baseElement.setAttribute('data-joystick-shoot', '');
    this.baseElement.setAttribute('data-joystick-shoot-state', 'hidden');
    this.baseElement.setAttribute('aria-label', '投篮轮盘');
    this.baseElement.setAttribute('aria-hidden', 'true');
    this.baseElement.setAttribute('role', 'application');
    this.baseElement.style.cssText = `
      position: fixed;
      right: var(--joystick-shoot-right);
      bottom: var(--joystick-shoot-bottom);
      width: ${this.baseSize}px;
      height: ${this.baseSize}px;
      z-index: ${JOYSTICK_Z_INDEX};
      display: none;
      pointer-events: none;
      touch-action: none;
      overflow: hidden;
    `;

    this.stickElement = ownerDocument.createElement('div');
    this.stickElement.className = 'gxe-shooting-joystick__stick';
    this.stickElement.setAttribute('data-joystick-shoot-stick', '');
    this.stickElement.setAttribute('data-joystick-shoot-state', 'hidden');
    this.stickElement.style.cssText = `
      width: ${this.stickSize}px;
      height: ${this.stickSize}px;
      transform: translate(-50%, -50%);
      transition: ${this.reducedMotion ? 'none' : RELEASE_TRANSITION};
    `;

    this.labelElement = ownerDocument.createElement('span');
    this.labelElement.className = 'gxe-shooting-joystick__label';
    this.labelElement.setAttribute('data-joystick-shoot-label', '');
    this.labelElement.textContent = '投篮';

    this.baseElement.append(this.stickElement, this.labelElement);
    this.container.appendChild(this.baseElement);

    this.baseElement.addEventListener('pointerdown', this._onPointerDown);
    this.baseElement.addEventListener('pointerup', this._onPointerUp);
    this.baseElement.addEventListener('pointercancel', this._onPointerCancel);
    this.baseElement.addEventListener('lostpointercapture', this._onLostPointerCapture);
    return this.baseElement;
  }

  setHandlers({ onMove = null, onRelease = null, onCancel = null } = {}) {
    this.onMove = typeof onMove === 'function' ? onMove : null;
    this.onRelease = typeof onRelease === 'function' ? onRelease : null;
    this.onCancel = typeof onCancel === 'function' ? onCancel : null;
    return this;
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    if (!this.enabled) {
      this._finishInteraction('disabled', null, true);
      this._setState('disabled');
      this.baseElement?.setAttribute('aria-disabled', 'true');
    } else {
      this.baseElement?.removeAttribute('aria-disabled');
      if (this.state === 'disabled') this._setState('idle');
    }
    return this;
  }

  setVisible(visible) {
    if (!this.baseElement) return this;
    if (visible) {
      this.baseElement.style.display = '';
      this.baseElement.style.pointerEvents = this.enabled ? 'auto' : 'none';
      this.baseElement.setAttribute('aria-hidden', 'false');
      if (this.state === 'hidden') this._setState(this.enabled ? 'idle' : 'disabled');
    } else {
      this._finishInteraction('hidden', null, true);
      this.baseElement.style.display = 'none';
      this.baseElement.style.pointerEvents = 'none';
      this.baseElement.setAttribute('aria-hidden', 'true');
      this._setState('hidden');
    }
    return this;
  }

  isActive() {
    return this.active;
  }

  getState() {
    return this.state;
  }

  getVector() {
    if (!this.baseElement || !this.enabled || this.baseElement.style.display === 'none') {
      return { x: 0, y: 0, run: false };
    }
    return { ...this.currentVector };
  }

  unmount() {
    this._finishInteraction('hidden', null, true);
    this._detachWindowListeners();
    if (this.baseElement) {
      this.baseElement.removeEventListener('pointerdown', this._onPointerDown);
      this.baseElement.removeEventListener('pointerup', this._onPointerUp);
      this.baseElement.removeEventListener('pointercancel', this._onPointerCancel);
      this.baseElement.removeEventListener('lostpointercapture', this._onLostPointerCapture);
      this.baseElement.remove();
    }
    this.styleElement?.remove();
    this.baseElement = null;
    this.stickElement = null;
    this.labelElement = null;
    this.styleElement = null;
    this.active = false;
    this.activePointerId = null;
    this.currentVector = { x: 0, y: 0, run: false };
    this.stickOffset = { x: 0, y: 0 };
    this.state = 'hidden';
  }

  destroy() {
    this.unmount();
  }

  _setState(nextState) {
    this.state = nextState;
    this.baseElement?.setAttribute('data-joystick-shoot-state', nextState);
    this.stickElement?.setAttribute('data-joystick-shoot-state', nextState);
    if (this.stickElement) {
      this.stickElement.style.transition = this.reducedMotion || ['pressed', 'dragging'].includes(nextState)
        ? 'none'
        : RELEASE_TRANSITION;
    }
  }

  _getPointerId(event) {
    return Number.isFinite(event?.pointerId) ? event.pointerId : null;
  }

  _isCurrentPointer(event) {
    const pointerId = this._getPointerId(event);
    return this.activePointerId === null || pointerId === null || pointerId === this.activePointerId;
  }

  _attachWindowListeners() {
    if (this._windowListenersAttached || !this._window) return;
    this._window.addEventListener('pointermove', this._onPointerMove);
    this._window.addEventListener('pointerup', this._onPointerUp);
    this._window.addEventListener('pointercancel', this._onPointerCancel);
    this._window.addEventListener('blur', this._onWindowBlur);
    this._windowListenersAttached = true;
  }

  _detachWindowListeners() {
    if (!this._windowListenersAttached || !this._window) return;
    this._window.removeEventListener('pointermove', this._onPointerMove);
    this._window.removeEventListener('pointerup', this._onPointerUp);
    this._window.removeEventListener('pointercancel', this._onPointerCancel);
    this._window.removeEventListener('blur', this._onWindowBlur);
    this._windowListenersAttached = false;
  }

  _capturePointer(pointerId) {
    if (!this.baseElement || pointerId === null || typeof this.baseElement.setPointerCapture !== 'function') return;
    try {
      this.baseElement.setPointerCapture(pointerId);
    } catch {
      // 测试环境或嵌入式浏览器不支持捕获时，窗口级监听仍可完成清理。
    }
  }

  _releasePointer(pointerId) {
    if (!this.baseElement || pointerId === null || typeof this.baseElement.releasePointerCapture !== 'function') return;
    try {
      if (typeof this.baseElement.hasPointerCapture !== 'function' || this.baseElement.hasPointerCapture(pointerId)) {
        this.baseElement.releasePointerCapture(pointerId);
      }
    } catch {
      // 指针已被浏览器取消时 releasePointerCapture 可能抛错。
    }
  }

  _onPointerDown(event) {
    if (!this.baseElement || !this.enabled || this.baseElement.style.display === 'none') return;
    if (this.active && !this._isCurrentPointer(event)) return;
    if (event.cancelable) event.preventDefault();
    event.stopPropagation();
    this.active = true;
    this.activePointerId = this._getPointerId(event);
    const rect = this.baseElement.getBoundingClientRect();
    this.centerX = rect.left + rect.width / 2;
    this.centerY = rect.top + rect.height / 2;
    this._setState('pressed');
    this._attachWindowListeners();
    this._capturePointer(this.activePointerId);
    this._updateVector(event.clientX, event.clientY, event);
  }

  _onPointerMove(event) {
    if (!this.active || !this._isCurrentPointer(event)) return;
    if (event.cancelable) event.preventDefault();
    this._setState('dragging');
    this._updateVector(event.clientX, event.clientY, event);
  }

  _onPointerUp(event) {
    if (!this.active || !this._isCurrentPointer(event)) return;
    if (event.cancelable) event.preventDefault();
    this._finishInteraction('released', event, false);
  }

  _onPointerCancel(event) {
    if (!this.active || !this._isCurrentPointer(event)) return;
    if (event.cancelable) event.preventDefault();
    this._finishInteraction('released', event, true);
  }

  _onLostPointerCapture(event) {
    if (!this.active || !this._isCurrentPointer(event)) return;
    this._finishInteraction('released', event, true);
  }

  _onWindowBlur() {
    if (this.active) this._finishInteraction('released', null, true);
  }

  _finishInteraction(nextState = 'released', event = null, cancelled = false) {
    const wasActive = this.active;
    if (!wasActive && !['hidden', 'disabled'].includes(nextState)) return;

    const pointerId = this.activePointerId;
    const vector = { ...this.currentVector };
    this.active = false;
    this.activePointerId = null;
    this.currentVector = { x: 0, y: 0, run: false };
    this._detachWindowListeners();
    this._releasePointer(pointerId);
    this._renderStick(0, 0);
    this._setState(nextState);

    if (wasActive) {
      if (cancelled) this.onCancel?.(event);
      else this.onRelease?.(vector, event);
    }
  }

  _updateVector(clientX, clientY, event = null) {
    if (!this.stickElement) return;
    const dx = clientX - this.centerX;
    const dy = clientY - this.centerY;
    this.currentVector = offsetToVector(dx, dy, this.radius);
    const dist = Math.hypot(dx, dy);
    const scale = dist > this.radius ? this.radius / dist : 1;
    this._renderStick(dx * scale, dy * scale);
    this.onMove?.({ ...this.currentVector }, event);
  }

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
