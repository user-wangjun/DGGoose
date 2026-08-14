import { PLAYER_SPEEDS } from '../config.js';

/** 行走速度（px/s），从全局配置读取 */
const WALK_SPEED = PLAYER_SPEEDS.WALK;
/** 奔跑速度（px/s） */
const RUN_SPEED = PLAYER_SPEEDS.RUN;

/**
 * 角色控制器（对应 PRD §6.2 + Task 1.5）
 * 输入向量 → 位移，边界钳制，朝向翻转，动画状态联动（待机/行走/奔跑）。
 * 位置与速度只读暴露，防止外部直接修改内部状态。
 */
export class PlayerController {
  /**
   * @param {Object} options
   * @param {number} options.x - 初始 X 坐标
   * @param {number} options.y - 初始 Y 坐标
   * @param {Object} options.bounds - 活动边界
   * @param {number} options.bounds.width - 边界宽度
   * @param {number} options.bounds.height - 边界高度
   */
  constructor({ x, y, bounds }) {
    this._x = x;
    this._y = y;
    this._bounds = bounds;
    /** @type {number} 朝向：1=右，-1=左 */
    this._facing = 1;
    /** @type {{x: number, y: number}} 当前速度向量 */
    this._velocity = { x: 0, y: 0 };
    /** @type {string} 动画状态：idle / walk / run */
    this._animState = 'idle';
  }

  /** X 坐标（只读） */
  get x() {
    return this._x;
  }

  /** Y 坐标（只读） */
  get y() {
    return this._y;
  }

  /** 朝向（只读） */
  get facing() {
    return this._facing;
  }

  /** 动画状态（只读） */
  get animState() {
    return this._animState;
  }

  /** 位置副本（不可通过返回值修改内部状态） */
  get position() {
    return { x: this._x, y: this._y };
  }

  /** 速度副本 */
  get velocity() {
    return { x: this._velocity.x, y: this._velocity.y };
  }

  /**
   * 设置位置（用于场景切换、检查点恢复、测试）
   * @param {number} x
   * @param {number} y
   */
  setPosition(x, y) {
    this._x = x;
    this._y = y;
  }

  /** 返回角色继续游戏所需的最小完整状态。 */
  getSaveState() {
    return {
      x: this._x,
      y: this._y,
      velocity: { ...this._velocity },
      facing: this._facing,
      animState: this._animState,
    };
  }

  /** 恢复角色位置、运动状态和朝向；不读取输入，避免恢复首帧发生跳变。 */
  restoreSaveState(state) {
    if (!state || typeof state !== 'object') return;
    if (Number.isFinite(state.x)) this._x = Math.max(0, Math.min(this._bounds.width, state.x));
    if (Number.isFinite(state.y)) this._y = Math.max(0, Math.min(this._bounds.height, state.y));
    if (Number.isFinite(state.velocity?.x)) this._velocity.x = state.velocity.x;
    if (Number.isFinite(state.velocity?.y)) this._velocity.y = state.velocity.y;
    if (state.facing === 1 || state.facing === -1) this._facing = state.facing;
    if (['idle', 'walk', 'run'].includes(state.animState)) this._animState = state.animState;
  }

  /**
   * 将外部碰撞解析后的实际位移同步回角色运动状态。
   * TopdownController 先由本控制器计算期望位移，再做碰撞裁剪；如果裁剪后
   * 仍保留旧速度/行走状态，角色虽然站在原地，序列帧和后续逻辑却会继续认为
   * 它在移动，贴墙时就会产生持续漂移感。
   * @param {{x:number,y:number}} from - 碰撞解析前的位置
   * @param {{x:number,y:number}} to - 碰撞解析后的实际位置
   * @param {number} deltaTime - 帧间隔（秒）
   * @param {{run?:boolean}} [requestedVector] - 原始输入，仅用于保留 walk/run 状态
   */
  syncResolvedMovement(from, to, deltaTime, requestedVector = {}) {
    const safeDelta = Math.max(0, Number(deltaTime) || 0);
    if (safeDelta <= 0) {
      this._velocity.x = 0;
      this._velocity.y = 0;
      this._animState = 'idle';
      return;
    }

    const deltaX = (to.x - from.x) / safeDelta;
    const deltaY = (to.y - from.y) / safeDelta;
    this._velocity.x = deltaX;
    this._velocity.y = deltaY;

    if (Math.hypot(deltaX, deltaY) <= 0.01) {
      this._animState = 'idle';
    } else {
      this._animState = requestedVector.run ? 'run' : 'walk';
    }
  }

  /**
   * 每帧更新：读取输入向量 → 计算位移 → 边界钳制 → 更新朝向与动画状态
   * @param {number} deltaTime - 帧间隔（秒）
   * @param {{getVector: Function}} input - 输入管理器（或桩对象）
   */
  update(deltaTime, input) {
    const vector = input.getVector();

    // 选择速度档
    const speed = vector.run ? RUN_SPEED : WALK_SPEED;

    // 计算速度向量
    this._velocity.x = vector.x * speed;
    this._velocity.y = vector.y * speed;

    // 位移
    this._x += this._velocity.x * deltaTime;
    this._y += this._velocity.y * deltaTime;

    // 边界钳制
    if (this._x < 0) this._x = 0;
    if (this._x > this._bounds.width) this._x = this._bounds.width;
    if (this._y < 0) this._y = 0;
    if (this._y > this._bounds.height) this._y = this._bounds.height;

    // 朝向：有水平输入时更新
    if (vector.x > 0.01) {
      this._facing = 1;
    } else if (vector.x < -0.01) {
      this._facing = -1;
    }

    // 动画状态联动
    const isMoving = Math.hypot(vector.x, vector.y) > 0.01;
    if (!isMoving) {
      this._animState = 'idle';
    } else if (vector.run) {
      this._animState = 'run';
    } else {
      this._animState = 'walk';
    }
  }
}
