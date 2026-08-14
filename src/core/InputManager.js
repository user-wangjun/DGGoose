import { JOYSTICK_RUN_THRESHOLD } from '../config.js';

/**
 * 输入抽象层（对应 PRD §6.2 关键技术需求 1）
 * 将触控输入与开发期键盘回退统一转换为"方向向量 + 动作事件"，游戏逻辑不感知具体设备。
 * - 虚拟摇杆 → 方向向量（8 方向归一化）
 * - 点击/触控动作 → interact 动作事件（由场景组件接入）
 * - 系统返回或开发期 Escape → pause 动作事件
 * - 键盘 WSAD/方向键与 Shift 仅作为开发回退
 */
export class InputManager {
  constructor() {
    /** @type {Set<string>} 当前按下的移动键 */
    this.keys = new Set();
    /** @type {{x: number, y: number}} 虚拟摇杆注入的向量（已归一化） */
    this.joystickVector = { x: 0, y: 0 };
    /** @type {boolean} Shift 是否按下 */
    this.shiftDown = false;
    /** @type {Set<Function>} 动作事件回调集合 */
    this.actionCallbacks = new Set();
    /** @type {EventTarget|null} 当前挂载的事件目标 */
    this.target = null;
    // 箭头函数绑定 this，便于 add/removeEventListener
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
  }

  /**
   * 挂载键盘监听到指定目标元素
   * @param {EventTarget} target - DOM 元素（默认 window）
   */
  mount(target = window) {
    this.target = target;
    target.addEventListener('keydown', this._onKeyDown);
    target.addEventListener('keyup', this._onKeyUp);
  }

  /**
   * 卸载键盘监听，清空所有输入状态
   */
  unmount() {
    if (this.target) {
      this.target.removeEventListener('keydown', this._onKeyDown);
      this.target.removeEventListener('keyup', this._onKeyUp);
      this.target = null;
    }
    this.keys.clear();
    this.joystickVector = { x: 0, y: 0 };
    this.shiftDown = false;
  }

  /**
   * 获取当前输入向量（摇杆 + 开发期键盘回退统一输出）
   * 摇杆有输入时优先使用摇杆值（模拟量更精确），否则回退到键盘离散方向
   * @returns {{x: number, y: number, run: boolean}}
   */
  getVector() {
    const joystickMag = Math.hypot(this.joystickVector.x, this.joystickVector.y);

    // 摇杆有输入时优先使用摇杆
    if (joystickMag > 0.001) {
      return {
        x: this.joystickVector.x,
        y: this.joystickVector.y,
        run: this.shiftDown || joystickMag > JOYSTICK_RUN_THRESHOLD,
      };
    }

    // 回退到键盘方向
    let x = 0;
    let y = 0;
    if (this.keys.has('w') || this.keys.has('ArrowUp')) y -= 1;
    if (this.keys.has('s') || this.keys.has('ArrowDown')) y += 1;
    if (this.keys.has('a') || this.keys.has('ArrowLeft')) x -= 1;
    if (this.keys.has('d') || this.keys.has('ArrowRight')) x += 1;

    // 对角线归一化，保证速度一致
    const mag = Math.hypot(x, y);
    if (mag > 0) {
      x /= mag;
      y /= mag;
    }

    return { x, y, run: this.shiftDown };
  }

  /**
   * 虚拟摇杆注入方向向量到同一通道
   * @param {number} x - X 分量（-1 ~ 1，已归一化）
   * @param {number} y - Y 分量（-1 ~ 1，已归一化）
   */
  setJoystickVector(x, y) {
    this.joystickVector = { x, y };
  }

  /**
   * 订阅动作事件（interact / pause）
   * @param {Function} callback - 回调函数，参数为动作名
   */
  onAction(callback) {
    this.actionCallbacks.add(callback);
  }

  /**
   * 取消订阅动作事件
   * @param {Function} callback - 要移除的回调
   */
  offAction(callback) {
    this.actionCallbacks.delete(callback);
  }

  /**
   * keydown 事件处理：更新按键状态、触发动作事件
   * @param {KeyboardEvent} e
   * @private
   */
  _onKeyDown(e) {
    const key = e.key;
    const isSpace = key === ' ' || e.code === 'Space';
    const isEscape = key === 'Escape' || e.code === 'Escape';

    // 动作键直接触发事件，e.repeat 防止按住时重复触发
    if (isSpace) {
      // 即使是重复 keydown 也要拦截默认行为，避免焦点按钮产生原生 click/页面滚动。
      e.preventDefault?.();
      if (!e.repeat) this._emitAction('interact');
      return;
    }
    if (isEscape) {
      // Escape 只作为游戏暂停/返回动作，不应触发浏览器级默认行为。
      e.preventDefault?.();
      if (e.repeat) return;

      // 控件自己正在处理 Escape 时，不要把一次关闭/取消操作升级成返回主菜单。
      const target = e.target;
      if (target?.closest?.('button, input, textarea, select, a, [contenteditable="true"]')) {
        return;
      }

      this._emitAction('pause');
      return;
    }
    if (key === 'Shift') {
      this.shiftDown = true;
      return;
    }

    // 方向键统一转小写，兼容 CapsLock 开启时的 'W'/'A'/'S'/'D'
    this.keys.add(key.length === 1 ? key.toLowerCase() : key);
  }

  /**
   * keyup 事件处理：移除按键状态
   * @param {KeyboardEvent} e
   * @private
   */
  _onKeyUp(e) {
    const key = e.key;
    if (key === 'Shift') {
      this.shiftDown = false;
      return;
    }
    // 与 keydown 一致，统一转小写
    this.keys.delete(key.length === 1 ? key.toLowerCase() : key);
  }

  /**
   * 派发动作事件给所有订阅者
   * @param {string} action - 动作名（'interact' | 'pause'）
   * @private
   */
  _emitAction(action) {
    for (const cb of [...this.actionCallbacks]) {
      // 对话框等上层交互可以消费动作，避免同一按键继续落到场景玩法层。
      if (cb(action) === true) break;
    }
  }
}
