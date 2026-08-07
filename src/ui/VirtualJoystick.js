/**
 * 虚拟摇杆（对应 PRD §6.1 移动端输入 + Task 1.2）
 * 使用 Pointer Events（down/move/up + capture），偏移量→向量（半径截断 R=34px）。
 * 输出 {x,y} 归一化向量；拉满判定 run（>0.92R）。触屏才显示。
 */

import { JOYSTICK_RUN_THRESHOLD } from '../config.js';

/** 默认摇杆半径（px），对应 PRD 触摸热区 ≥44px */
const DEFAULT_RADIUS = 34;

/**
 * 纯函数：偏移量 → 归一化向量
 * 截断到半径范围内，归一化到 -1~1，拉满（>0.92R）标记 run
 * @param {number} dx - X 偏移量（相对圆心）
 * @param {number} dy - Y 偏移量（相对圆心）
 * @param {number} radius - 摇杆半径
 * @returns {{x: number, y: number, run: boolean}}
 */
export function offsetToVector(dx, dy, radius = DEFAULT_RADIUS) {
  // 计算偏移距离
  const dist = Math.hypot(dx, dy);
  if (dist === 0) {
    return { x: 0, y: 0, run: false };
  }

  // 截断到半径范围内
  const clampedDist = Math.min(dist, radius);

  // 归一化到 -1~1（截断后的方向不变，幅值 = clampedDist / radius）
  const scale = clampedDist / dist / radius;
  const x = dx * scale;
  const y = dy * scale;

  // 拉满判定：使用全局阈值常量（与 InputManager 共享，避免 DRY 违反）
  const magnitude = Math.hypot(x, y);
  const run = magnitude > JOYSTICK_RUN_THRESHOLD;

  return { x, y, run };
}

/**
 * 虚拟摇杆组件
 * 挂载到容器元素，监听 Pointer Events，输出归一化向量
 */
export class VirtualJoystick {
  /**
   * @param {Object} options
   * @param {HTMLElement} options.container - 挂载容器
   * @param {number} [options.radius=34] - 摇杆半径
   */
  constructor({ container, radius = DEFAULT_RADIUS }) {
    this.container = container;
    this.radius = radius;
    this.active = false;
    this.centerX = 0;
    this.centerY = 0;
    this.currentVector = { x: 0, y: 0, run: false };
    this.baseElement = null;
    this.stickElement = null;
    // 绑定 this
    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
  }

  /**
   * 挂载：创建 DOM 元素并绑定事件
   */
  mount() {
    // 创建底座
    this.baseElement = document.createElement('div');
    this.baseElement.setAttribute('data-joystick-base', '');
    this.baseElement.style.cssText = `
      position: absolute;
      bottom: 20px;
      left: 20px;
      width: ${this.radius * 2}px;
      height: ${this.radius * 2}px;
      border-radius: 50%;
      background: rgba(255,255,255,0.15);
      border: 2px solid rgba(255,255,255,0.3);
      pointer-events: auto;
      touch-action: none;
    `;

    // 创建摇杆头
    this.stickElement = document.createElement('div');
    this.stickElement.setAttribute('data-joystick-stick', '');
    this.stickElement.style.cssText = `
      position: absolute;
      top: 50%;
      left: 50%;
      width: ${this.radius}px;
      height: ${this.radius}px;
      border-radius: 50%;
      background: rgba(255,255,255,0.5);
      transform: translate(-50%, -50%);
      pointer-events: none;
    `;

    this.baseElement.appendChild(this.stickElement);
    this.container.appendChild(this.baseElement);

    this.baseElement.addEventListener('pointerdown', this._onPointerDown);
  }

  /**
   * 卸载：移除事件监听和 DOM 元素
   */
  unmount() {
    if (this.baseElement) {
      this.baseElement.removeEventListener('pointerdown', this._onPointerDown);
      window.removeEventListener('pointermove', this._onPointerMove);
      window.removeEventListener('pointerup', this._onPointerUp);
      if (this.baseElement.parentNode) {
        this.baseElement.parentNode.removeChild(this.baseElement);
      }
      this.baseElement = null;
      this.stickElement = null;
    }
    this.active = false;
    this.currentVector = { x: 0, y: 0, run: false };
  }

  /**
   * 是否激活中
   * @returns {boolean}
   */
  isActive() {
    return this.active;
  }

  /**
   * 获取当前向量
   * @returns {{x: number, y: number, run: boolean}}
   */
  getVector() {
    return { ...this.currentVector };
  }

  /**
   * pointerdown：记录圆心，激活摇杆
   * @param {PointerEvent} e
   * @private
   */
  _onPointerDown(e) {
    this.active = true;
    const rect = this.baseElement.getBoundingClientRect();
    this.centerX = rect.left + rect.width / 2;
    this.centerY = rect.top + rect.height / 2;

    // 捕获后续 move/up 事件到 window
    window.addEventListener('pointermove', this._onPointerMove);
    window.addEventListener('pointerup', this._onPointerUp);

    this._updateVector(e.clientX, e.clientY);
  }

  /**
   * pointermove：更新向量
   * @param {PointerEvent} e
   * @private
   */
  _onPointerMove(e) {
    if (!this.active) return;
    this._updateVector(e.clientX, e.clientY);
  }

  /**
   * pointerup：停止摇杆，向量归零
   * @private
   */
  _onPointerUp() {
    this.active = false;
    this.currentVector = { x: 0, y: 0, run: false };
    window.removeEventListener('pointermove', this._onPointerMove);
    window.removeEventListener('pointerup', this._onPointerUp);

    // 摇杆头回中
    if (this.stickElement) {
      this.stickElement.style.transform = 'translate(-50%, -50%)';
    }
  }

  /**
   * 更新向量并移动摇杆头
   * @param {number} clientX
   * @param {number} clientY
   * @private
   */
  _updateVector(clientX, clientY) {
    const dx = clientX - this.centerX;
    const dy = clientY - this.centerY;
    this.currentVector = offsetToVector(dx, dy, this.radius);

    // 移动摇杆头（截断后的位置）
    const dist = Math.hypot(dx, dy);
    if (dist > this.radius) {
      const scale = this.radius / dist;
      const clampedX = dx * scale;
      const clampedY = dy * scale;
      this.stickElement.style.transform = `translate(calc(-50% + ${clampedX}px), calc(-50% + ${clampedY}px))`;
    } else {
      this.stickElement.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    }
  }
}
