import { PLAYER_SPEEDS } from '../config.js';

/** 鹅厂侧视场景共用的物理参数，避免场景绘制和角色碰撞各自猜坐标。 */
export const FACTORY_PHYSICS_DEFAULTS = Object.freeze({
  groundY: 508,
  leftBound: 420,
  wallX: 1042,
  wallRight: 1094,
  worldWidth: 1280,
  postWallRightBound: null,
  playerRadius: 30,
  gravity: 1500,
  jumpVelocity: -500,
  walkSpeed: PLAYER_SPEEDS.WALK,
  runSpeed: PLAYER_SPEEDS.RUN,
  jumpThreshold: -0.35,
});

/** 最大物理子步长，避免帧间隔较大时跳跃轨迹明显穿过地面。 */
const MAX_PHYSICS_STEP = 1 / 120;

/**
 * 鹅厂序章的轻量侧视物理。
 *
 * 这里不能复用俯视场景的自由二维控制：工厂画面里的 Y 轴是高度，
 * 角色必须受地面、重力和围墙约束，向上输入只代表一次跳跃。
 */
export class FactoryPhysics {
  /**
   * @param {Object} [options]
   * @param {number} [options.groundY] - 角色脚底所在的地面高度
   * @param {number} [options.leftBound] - 角色中心的左侧活动边界
   * @param {number} [options.wallX] - 围墙左边缘 X 坐标（兼容旧调用）
   * @param {number} [options.wallRight] - 围墙右边缘 X 坐标
   * @param {number} [options.worldWidth=1280] - 场景逻辑宽度
   * @param {number} [options.postWallRightBound] - 翻墙后角色中心的右边界
   * @param {number} [options.playerRadius] - 用于围墙碰撞的角色半径
   * @param {number} [options.gravity] - 重力加速度（px/s²）
   * @param {number} [options.jumpVelocity] - 起跳瞬间的垂直速度（向上为负）
   * @param {number} [options.walkSpeed] - 行走速度（px/s）
   * @param {number} [options.runSpeed] - 奔跑速度（px/s）
   * @param {number} [options.jumpThreshold] - 判定向上输入的 Y 分量阈值
   */
  constructor(options = {}) {
    const config = { ...FACTORY_PHYSICS_DEFAULTS, ...options };

    this._groundY = config.groundY;
    this._leftBound = config.leftBound;
    this._wallLeft = Number.isFinite(config.wallLeft) ? config.wallLeft : config.wallX;
    this._wallRight = Number.isFinite(config.wallRight) ? config.wallRight : this._wallLeft;
    this._preWallRightBound = Math.max(this._leftBound, this._wallLeft - config.playerRadius);
    this._postWallRightBound = Math.max(
      this._preWallRightBound,
      Number.isFinite(config.postWallRightBound)
        ? config.postWallRightBound
        : config.worldWidth - config.playerRadius,
    );
    this._wallCleared = Boolean(config.wallCleared);
    this._rightBound = this._wallCleared ? this._postWallRightBound : this._preWallRightBound;
    this._gravity = config.gravity;
    this._jumpVelocity = config.jumpVelocity;
    this._walkSpeed = config.walkSpeed;
    this._runSpeed = config.runSpeed;
    this._jumpThreshold = config.jumpThreshold;

    this._x = this._leftBound;
    this._y = this._groundY;
    this._velocity = { x: 0, y: 0 };
    this._facing = 1;
    this._animState = 'idle';
    this._grounded = true;
    this._jumpHeld = false;
  }

  /** X 坐标（角色中心）。 */
  get x() {
    return this._x;
  }

  /** Y 坐标（角色脚底逻辑锚点）。 */
  get y() {
    return this._y;
  }

  /** 当前速度副本。 */
  get velocity() {
    return { x: this._velocity.x, y: this._velocity.y };
  }

  /** 角色是否与地面接触。 */
  get isGrounded() {
    return this._grounded;
  }

  /** 角色是否处于跳跃/下落过程中。 */
  get isJumping() {
    return !this._grounded;
  }

  /** 当前朝向，1 为右，-1 为左。 */
  get facing() {
    return this._facing;
  }

  /** 当前水平移动动画状态。 */
  get animState() {
    return this._animState;
  }

  /** 角色活动范围的右边界，供场景调试或提示使用。 */
  get rightBound() {
    return this._rightBound;
  }

  /** 围墙左边缘，供场景交互判定和翻墙演出定位使用。 */
  get wallLeft() {
    return this._wallLeft;
  }

  /** 围墙右边缘，供翻墙后落点计算使用。 */
  get wallRight() {
    return this._wallRight;
  }

  /** 玩家是否已经完成翻墙并进入右侧活动区。 */
  get wallCleared() {
    return this._wallCleared;
  }

  /**
   * 设置场景切换或检查点位置，同时清除上一段跳跃的垂直速度。
   * @param {number} x
   * @param {number} y
   */
  setPosition(x, y) {
    this._x = this._clampX(x);
    this._y = Math.min(y, this._groundY);
    this._velocity.y = 0;
    this._grounded = this._y >= this._groundY;
    if (this._grounded) this._y = this._groundY;
  }

  /**
   * 翻墙完成后解除墙前水平边界，并把角色放到明确的落地区域。
   * 物理状态在这里一次性切换，避免绘制层越过墙后逻辑仍停留在墙前。
   * @param {{x?:number,y?:number}} [position]
   */
  clearWall({ x = this._x, y = this._groundY } = {}) {
    this._wallCleared = true;
    this._rightBound = this._postWallRightBound;
    this.setPosition(x, y);
  }

  /** 重新锁回墙前边界，供场景重入或测试恢复初始状态。 */
  lockWall() {
    this._wallCleared = false;
    this._rightBound = this._preWallRightBound;
    this._x = this._clampX(this._x);
  }

  /**
   * 根据输入推进物理状态。
   * @param {number} deltaTime - 帧间隔（秒）
   * @param {{getVector: Function}} input - 输入管理器或测试桩
   * @returns {{x:number,y:number,velocity:{x:number,y:number},grounded:boolean,jumping:boolean,facing:number,animState:string}}
   */
  update(deltaTime, input) {
    const vector = input?.getVector?.() || { x: 0, y: 0, run: false };
    const safeDelta = Number.isFinite(deltaTime) ? Math.max(0, deltaTime) : 0;
    const stepCount = Math.max(1, Math.ceil(safeDelta / MAX_PHYSICS_STEP));
    const step = safeDelta / stepCount;

    if (safeDelta === 0) {
      this._jumpHeld = vector.y < this._jumpThreshold;
      this._updateAnimationState(vector);
      return this.getState();
    }

    // 子步内保持同一份输入，既保证移动连续，也避免大帧间隔漏掉地面碰撞。
    for (let i = 0; i < stepCount; i += 1) {
      this._updateStep(step, vector);
    }

    this._updateAnimationState(vector);
    return this.getState();
  }

  /** 执行一个小物理步，角色碰撞规则集中在这里便于测试和维护。 */
  _updateStep(deltaTime, vector) {
    const horizontalInput = this._clamp(Number(vector.x) || 0, -1, 1);
    const speed = vector.run ? this._runSpeed : this._walkSpeed;
    this._velocity.x = horizontalInput * speed;
    this._x = this._clampX(this._x + this._velocity.x * deltaTime);

    const jumpPressed = (Number(vector.y) || 0) < this._jumpThreshold;
    if (jumpPressed && !this._jumpHeld && this._grounded) {
      this._velocity.y = this._jumpVelocity;
      this._grounded = false;
    }
    this._jumpHeld = jumpPressed;

    if (!this._grounded) {
      this._velocity.y += this._gravity * deltaTime;
      this._y += this._velocity.y * deltaTime;

      if (this._y >= this._groundY) {
        this._y = this._groundY;
        this._velocity.y = 0;
        this._grounded = true;
      }
    } else {
      // 地面状态下忽略向下输入，不允许角色钻进地板。
      this._y = this._groundY;
      this._velocity.y = 0;
    }
  }

  /** 根据水平输入同步朝向和行走动画，不把跳跃误当作自由 Y 移动。 */
  _updateAnimationState(vector) {
    const horizontalInput = Number(vector.x) || 0;
    if (horizontalInput > 0.01) {
      this._facing = 1;
    } else if (horizontalInput < -0.01) {
      this._facing = -1;
    }

    if (Math.abs(horizontalInput) <= 0.01) {
      this._animState = 'idle';
    } else if (vector.run) {
      this._animState = 'run';
    } else {
      this._animState = 'walk';
    }
  }

  /** 将角色中心限制在左边界和围墙前的安全位置之间。 */
  _clampX(x) {
    return this._clamp(x, this._leftBound, this._rightBound);
  }

  /** 通用数值钳制，避免异常输入破坏场景坐标。 */
  _clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  /** 返回渲染层需要的状态副本，防止场景直接改写物理内部值。 */
  getState() {
    return {
      x: this._x,
      y: this._y,
      velocity: this.velocity,
      grounded: this._grounded,
      jumping: !this._grounded,
      facing: this._facing,
      animState: this._animState,
      wallCleared: this._wallCleared,
    };
  }

  /** 返回序章侧视物理的完整继续游戏状态。 */
  getSaveState() {
    return {
      ...this.getState(),
      jumpHeld: this._jumpHeld,
    };
  }

  /** 恢复空中速度、地面状态、翻墙边界和动画状态。 */
  restoreSaveState(state) {
    if (!state || typeof state !== 'object') return;
    this._wallCleared = Boolean(state.wallCleared);
    this._rightBound = this._wallCleared ? this._postWallRightBound : this._preWallRightBound;
    if (Number.isFinite(state.x)) this._x = this._clampX(state.x);
    if (Number.isFinite(state.y)) this._y = Math.min(state.y, this._groundY);
    if (Number.isFinite(state.velocity?.x)) this._velocity.x = state.velocity.x;
    if (Number.isFinite(state.velocity?.y)) this._velocity.y = state.velocity.y;
    this._grounded = Boolean(state.grounded);
    this._jumpHeld = Boolean(state.jumpHeld);
    if (state.facing === 1 || state.facing === -1) this._facing = state.facing;
    if (['idle', 'walk', 'run'].includes(state.animState)) this._animState = state.animState;
  }
}
