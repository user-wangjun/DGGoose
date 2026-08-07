/**
 * 投篮物理引擎（对应 PRD §5 F5 + Task 3.3）
 *
 * 纯逻辑模块，不依赖 DOM/Canvas，可在 Node 环境独立测试。
 * 负责：球的抛物线运动、篮筐浮动、进球判定、蓄力计算、计时器。
 *
 * 物理参数（来自 PRD §5 F5）：
 * - 重力加速度：430 px/s²
 * - 初速公式：vx = 120 + power * 3.1, vy = -(210 + power * 4.0)
 * - 蓄力速率：65 点/秒，范围 0~100
 * - 篮筐浮动区间：画布高度 10%~34%
 * - 进球判定：球下落穿越篮圈平面且球心通过扣除球半径后的有效开口
 * - 目标：60 秒内投进 5 球
 */

/** 投篮目标球数 */
const TARGET_SCORE = 5;
/** 游戏时长（秒） */
const GAME_DURATION = 60;
/** 篮筐浮动速度（px/s），保证两轮可观察路线 */
const HOOP_FLOAT_SPEED = 50;
/** 球的起始 X 坐标（画布左侧投掷点） */
const BALL_START_X = 120;
/** 球的起始 Y 坐标（画布下方投掷点） */
const BALL_START_Y = 580;
/** 篮球半径（px），场景绘制与碰撞共用 */
const DEFAULT_BALL_RADIUS = 14;
/** 球场地面高度（与 BasketballScene 的地板线一致） */
const DEFAULT_FLOOR_Y = 620;
/** 背板相对篮筐中心的位置，和场景绘制保持一致 */
const BACKBOARD_OFFSET_X = 18;
const BACKBOARD_OFFSET_Y = -50;
const BACKBOARD_WIDTH = 8;
const BACKBOARD_HEIGHT = 80;
/** 篮圈两侧的碰撞点（侧视图用两颗小圆形刚体近似篮圈边缘） */
const RIM_RADIUS = 2;
const RIM_HALF_WIDTH = 28;
/** 碰撞参数：反弹系数与切向摩擦 */
const DEFAULT_RESTITUTION = 0.78;
const DEFAULT_FLOOR_RESTITUTION = 0.55;
const DEFAULT_FRICTION = 0.86;
/** 最大子步长，避免高速球单帧穿过篮板 */
const MAX_PHYSICS_STEP = 1 / 120;
/** 低速落地阈值，避免篮球在地面无限微跳 */
const MIN_BOUNCE_SPEED = 70;

export class BallPhysics {
  /**
   * @param {Object} config - 物理配置
   * @param {number} config.canvasWidth - 画布宽度
   * @param {number} config.canvasHeight - 画布高度
   * @param {number} config.hoopX - 篮筐 X 坐标
   * @param {number} config.gravity - 重力加速度（px/s²）
   * @param {number} config.chargeRate - 蓄力速率（点/秒）
   * @param {number} config.hoopRangeMin - 篮筐浮动下限（画布高度比例）
   * @param {number} config.hoopRangeMax - 篮筐浮动上限（画布高度比例）
   * @param {number} config.scoreThreshold - 进球判定横向阈值（px）
   */
  constructor({
    canvasWidth,
    canvasHeight,
    hoopX,
    gravity,
    chargeRate,
    hoopRangeMin,
    hoopRangeMax,
    scoreThreshold,
    ballRadius = DEFAULT_BALL_RADIUS,
    floorY = DEFAULT_FLOOR_Y,
    restitution = DEFAULT_RESTITUTION,
    floorRestitution = DEFAULT_FLOOR_RESTITUTION,
    friction = DEFAULT_FRICTION,
  }) {
    this._canvasWidth = canvasWidth;
    this._canvasHeight = canvasHeight;
    this._hoopX = hoopX;
    this._gravity = gravity;
    this._chargeRate = chargeRate;
    this._scoreThreshold = scoreThreshold;
    this._ballRadius = ballRadius;
    this._floorY = floorY;
    this._restitution = restitution;
    this._floorRestitution = floorRestitution;
    this._friction = friction;

    // 篮筐浮动区间（像素坐标）
    this._hoopMinY = canvasHeight * hoopRangeMin;
    this._hoopMaxY = canvasHeight * hoopRangeMax;

    // 球状态
    this._ballX = BALL_START_X;
    this._ballY = BALL_START_Y;
    this._ballVx = 0;
    this._ballVy = 0;
    this._ballFlying = false;
    this._scoredThisFlight = false;
    this._scoreEventPending = false;
    this._lastCollision = null;
    this._collisionThisSubstep = null;

    // 蓄力
    this._charge = 0;

    // 篮筐状态
    this._hoopY = (this._hoopMinY + this._hoopMaxY) / 2;
    this._hoopDirection = 1;

    // 游戏状态
    this._score = 0;
    this._timer = GAME_DURATION;
  }

  // ==================== 蓄力 ====================

  /**
   * 蓄力：按时间递增蓄力值，钳制在 0~100
   * @param {number} deltaTime - 帧间隔（秒）
   */
  charge(deltaTime) {
    if (this._ballFlying) return;
    this._charge += this._chargeRate * deltaTime;
    if (this._charge > 100) this._charge = 100;
    if (this._charge < 0) this._charge = 0;
  }

  /**
   * 获取当前蓄力值
   * @returns {number}
   */
  getCharge() {
    return this._charge;
  }

  /**
   * 重置蓄力值
   */
  resetCharge() {
    this._charge = 0;
  }

  // ==================== 投球 ====================

  /**
   * 根据蓄力值计算初速度。轨迹辅助与真正出手都调用这个方法，
   * 确保玩家看到的预测轨迹和实际飞行使用同一套模型。
   * @param {number} power - 蓄力值（0~100）
   * @returns {{vx: number, vy: number}}
   */
  getLaunchVelocity(power = this._charge) {
    const clampedPower = Math.max(0, Math.min(100, power));
    return {
      vx: 120 + clampedPower * 3.1,
      vy: -(210 + clampedPower * 4.0),
    };
  }

  /**
   * 投球：按当前蓄力值计算初速并发射
   * @returns {{vx: number, vy: number}} 球的初始速度
   */
  throwBall() {
    const power = this._charge;
    const velocity = this.getLaunchVelocity(power);
    this._ballVx = velocity.vx;
    this._ballVy = velocity.vy;
    this._ballFlying = true;
    this._scoredThisFlight = false;
    this._scoreEventPending = false;
    this._lastCollision = null;
    this._charge = 0;
    return velocity;
  }

  /**
   * 球是否在飞行中
   * @returns {boolean}
   */
  isBallFlying() {
    return this._ballFlying;
  }

  // ==================== 物理更新 ====================

  /**
   * 更新球的位置和速度（每帧调用）
   * 同时检测出界和进球
   * @param {number} deltaTime - 帧间隔（秒）
   */
  update(deltaTime) {
    if (!this._ballFlying) return;

    const safeDelta = Math.max(0, deltaTime);
    if (safeDelta === 0) return;

    // 将一帧拆成多个物理子步，减少高速篮球穿过篮板或篮圈的概率。
    const substeps = Math.max(1, Math.ceil(safeDelta / MAX_PHYSICS_STEP));
    const step = safeDelta / substeps;
    this._lastCollision = null;

    for (let i = 0; i < substeps && this._ballFlying; i += 1) {
      const previousX = this._ballX;
      const previousY = this._ballY;
      const previousHoopY = this._hoopY;

      // 半隐式 Euler 积分：先更新速度，再更新位置。
      this._ballVy += this._gravity * step;
      this._ballX += this._ballVx * step;
      this._ballY += this._ballVy * step;

      // 先记录未经碰撞修正的穿筐轨迹，避免篮板反弹把球推到篮圈下方后制造假进球。
      const crossedScoreWindow = this._checkScoreCrossing(previousX, previousY, previousHoopY);

      // 静态碰撞体：背板、篮圈边缘、地面。
      this._collisionThisSubstep = null;
      this._resolveCollisions();

      // 只有没有发生碰撞的轨迹，真正穿过篮圈有效开口才算进球。
      if (crossedScoreWindow && !this._collisionThisSubstep) {
        this._registerScore();
        // 得分事件交给场景消费，停止本次物理步，保证 HUD/反馈与穿筐时刻同步。
        break;
      }

      // 出界检测放在碰撞之后，避免刚撞到背板的球被提前重置。
      if (this.isBallOutOfBounds()) {
        this._ballFlying = false;
      }
    }
  }

  /**
   * 计算当前蓄力对应的预测轨迹（不修改真实球状态）。
   * @param {Object} [options]
   * @param {number} [options.power] - 蓄力值，默认使用当前蓄力
   * @param {number} [options.duration] - 预测时长（秒）
   * @param {number} [options.step] - 采样间隔（秒）
   * @param {number} [options.maxPoints] - 最多采样点数
   * @returns {{points: Array<{x:number,y:number}>, velocity: {vx:number,vy:number}, hoop: {x:number,y:number}}}
   */
  getTrajectoryPreview({ power = this._charge, duration = 3.5, step = 0.06, maxPoints = 64 } = {}) {
    const velocity = this.getLaunchVelocity(power);
    const points = [];
    const pointCount = Math.min(maxPoints, Math.ceil(duration / step) + 1);

    for (let i = 0; i < pointCount; i += 1) {
      const time = i * step;
      const x = BALL_START_X + velocity.vx * time;
      const y = BALL_START_Y + velocity.vy * time + 0.5 * this._gravity * time * time;
      points.push({ x, y });

      // 画布外的部分不再绘制，避免辅助线铺满整个画面。
      if (x > this._canvasWidth + 50 || y > this._canvasHeight + 50 || y < -120) break;
    }

    return {
      points,
      velocity,
      hoop: this.getHoopPosition(),
    };
  }

  // ==================== 碰撞模型 ====================

  /**
   * 解析一小步内的静态碰撞体。
   * 背板使用矩形，篮圈两侧使用小圆形，地面使用水平平面。
   * 这组几何体会跟随篮筐的 Y 坐标移动。
   * @private
   */
  _resolveCollisions() {
    this._collideWithBackboard();
    this._collideWithRimPoint(this._hoopX - RIM_HALF_WIDTH);
    this._collideWithRimPoint(this._hoopX + RIM_HALF_WIDTH);
    this._collideWithFloor();
  }

  /**
   * 篮板圆球碰撞：将篮板矩形扩展一个球半径，求最近点并反射速度。
   * @private
   */
  _collideWithBackboard() {
    const left = this._hoopX + BACKBOARD_OFFSET_X;
    const right = left + BACKBOARD_WIDTH;
    const top = this._hoopY + BACKBOARD_OFFSET_Y;
    const bottom = top + BACKBOARD_HEIGHT;
    const closestX = Math.max(left, Math.min(this._ballX, right));
    const closestY = Math.max(top, Math.min(this._ballY, bottom));
    const dx = this._ballX - closestX;
    const dy = this._ballY - closestY;
    const distanceSquared = dx * dx + dy * dy;
    const radiusSquared = this._ballRadius * this._ballRadius;

    if (distanceSquared > radiusSquared) return;

    let distance = Math.sqrt(distanceSquared);
    let normalX = dx;
    let normalY = dy;

    // 球心落在矩形内部时，选择离球当前速度方向相反的法线，
    // 让球从背板内部被推出，而不是出现 NaN 或卡死。
    if (distance === 0) {
      if (this._ballVx > 0) {
        normalX = -1;
        normalY = 0;
      } else if (this._ballVx < 0) {
        normalX = 1;
        normalY = 0;
      } else {
        normalX = this._ballX < (left + right) / 2 ? -1 : 1;
        normalY = 0;
      }
      distance = 1;
    } else {
      normalX /= distance;
      normalY /= distance;
    }

    const penetration = this._ballRadius - distance;
    this._ballX += normalX * penetration;
    this._ballY += normalY * penetration;
    this._bounceOffSurface(normalX, normalY, this._restitution, this._friction);
    this._lastCollision = 'backboard';
    this._collisionThisSubstep = 'backboard';
  }

  /**
   * 篮圈边缘碰撞：用两颗小圆形刚体代表椭圆篮圈的前后边缘。
   * 中间保持开口，球从开口下落时仍可正常进球。
   * @param {number} rimX - 碰撞点 X 坐标
   * @private
   */
  _collideWithRimPoint(rimX) {
    // 球从篮圈上方下落时，允许它先穿过篮圈平面再判定开口进球；
    // 这样篮圈碰撞不会把正中篮筐的球提前顶回去。
    if (this._ballVy > 0 && this._ballY < this._hoopY) return;

    const dx = this._ballX - rimX;
    const dy = this._ballY - this._hoopY;
    const distanceSquared = dx * dx + dy * dy;
    const collisionRadius = this._ballRadius + RIM_RADIUS;

    if (distanceSquared > collisionRadius * collisionRadius) return;

    let distance = Math.sqrt(distanceSquared);
    let normalX = dx;
    let normalY = dy;
    if (distance === 0) {
      normalX = this._ballVx >= 0 ? -1 : 1;
      normalY = 0;
      distance = 1;
    } else {
      normalX /= distance;
      normalY /= distance;
    }

    const penetration = collisionRadius - distance;
    this._ballX += normalX * penetration;
    this._ballY += normalY * penetration;
    this._bounceOffSurface(normalX, normalY, this._restitution, this._friction);
    this._lastCollision = 'rim';
    this._collisionThisSubstep = 'rim';
  }

  /**
   * 地面碰撞：地面有较低反弹系数和水平摩擦，低速时让球停下。
   * @private
   */
  _collideWithFloor() {
    const floorContactY = this._floorY - this._ballRadius;
    if (this._ballY < floorContactY) return;

    this._ballY = floorContactY;
    if (this._ballVy > 0) {
      this._ballVy = -this._ballVy * this._floorRestitution;
      this._ballVx *= this._friction;
      this._lastCollision = 'floor';
      this._collisionThisSubstep = 'floor';

      if (Math.abs(this._ballVy) < MIN_BOUNCE_SPEED) {
        this._ballVy = 0;
        this._ballVx *= 0.45;
      }
    }

    if (this._ballVy === 0 && Math.abs(this._ballVx) < 28) {
      this._ballVx = 0;
      this._ballFlying = false;
    }
  }

  /**
   * 根据碰撞法线分解切向/法向速度并反射。
   * @param {number} normalX
   * @param {number} normalY
   * @param {number} restitution - 法向反弹系数
   * @param {number} friction - 切向摩擦系数
   * @private
   */
  _bounceOffSurface(normalX, normalY, restitution, friction) {
    const normalVelocity = this._ballVx * normalX + this._ballVy * normalY;
    // 球正在离开碰撞体时只做位置修正，不重复施加反弹。
    if (normalVelocity >= 0) return;

    const tangentX = this._ballVx - normalVelocity * normalX;
    const tangentY = this._ballVy - normalVelocity * normalY;
    this._ballVx = tangentX * friction - normalX * normalVelocity * restitution;
    this._ballVy = tangentY * friction - normalY * normalVelocity * restitution;
  }

  /**
   * 检测本次物理子步是否穿越篮圈平面。
   * @param {number} previousX - 子步前球心 X
   * @param {number} previousY - 子步前球心 Y
   * @param {number} previousHoopY - 子步前篮圈 Y
   * @returns {boolean}
   * @private
   */
  _checkScoreCrossing(previousX, previousY, previousHoopY) {
    if (!this._ballFlying || this._scoredThisFlight || this._ballVy <= 0) return false;
    const previousRelativeY = previousY - previousHoopY;
    const currentRelativeY = this._ballY - this._hoopY;
    if (previousRelativeY >= 0 || currentRelativeY < 0) return false;

    // 用线性插值求球心穿过篮圈平面的 X，避免大帧间隔下用终点 X 误判。
    const relativeDeltaY = currentRelativeY - previousRelativeY;
    const crossingRatio = relativeDeltaY > 0 ? -previousRelativeY / relativeDeltaY : 1;
    const crossingX = previousX + (this._ballX - previousX) * crossingRatio;

    return this._isInsideScoreOpening(crossingX);
  }

  /**
   * 篮圈有效开口的半宽。开口必须扣除篮圈边缘和篮球自身半径，
   * 否则球只要落在视觉篮圈附近就会被计分，即使物理上已经擦到篮圈。
   * @returns {number}
   * @private
   */
  _getScoreWindowHalfWidth() {
    return Math.max(
      0,
      Math.min(this._scoreThreshold, RIM_HALF_WIDTH - RIM_RADIUS - this._ballRadius),
    );
  }

  /**
   * 判断球心 X 是否位于篮圈的有效开口内。
   * @param {number} x - 球心 X
   * @returns {boolean}
   * @private
   */
  _isInsideScoreOpening(x) {
    return Math.abs(x - this._hoopX) < this._getScoreWindowHalfWidth();
  }

  /**
   * 记录一次进球。
   * @returns {boolean}
   * @private
   */
  _registerScore() {
    this._score++;
    this._scoredThisFlight = true;
    this._scoreEventPending = true;
    return true;
  }

  // ==================== 篮筐浮动 ====================

  /**
   * 更新篮筐浮动位置（匀速往返）
   * @param {number} deltaTime - 帧间隔（秒）
   */
  updateHoop(deltaTime) {
    this._hoopY += this._hoopDirection * HOOP_FLOAT_SPEED * deltaTime;
    if (this._hoopY >= this._hoopMaxY) {
      this._hoopY = this._hoopMaxY;
      this._hoopDirection = -1;
    } else if (this._hoopY <= this._hoopMinY) {
      this._hoopY = this._hoopMinY;
      this._hoopDirection = 1;
    }
  }

  /**
   * 获取篮筐位置
   * @returns {{x: number, y: number}}
   */
  getHoopPosition() {
    return { x: this._hoopX, y: this._hoopY };
  }

  // ==================== 进球判定 ====================

  /**
   * 检测是否进球：
   * 1. 球正在飞行
   * 2. 球在下落（vy > 0）
   * 3. 球穿越篮圈平面（球 Y 从上方越过篮筐 Y）
   * 4. 横向偏移 |Δx| < 阈值
   * 进球后递增得分
   * @returns {boolean}
   */
  checkScore() {
    if (!this._ballFlying) return false;
    if (this._scoredThisFlight) return false;

    // 球必须下落（vy > 0）才算进球
    if (this._ballVy <= 0) return false;

    // 球 Y 坐标已越过篮筐平面
    if (this._ballY < this._hoopY) return false;

    // 横向判定使用扣除篮球半径后的真实开口，而不是视觉篮圈外沿。
    if (!this._isInsideScoreOpening(this._ballX)) return false;

    // 进球！递增得分并标记本次飞行已计分
    return this._registerScore();
  }

  // ==================== 出界检测 ====================

  /**
   * 球是否飞出画布边界
   * @returns {boolean}
   */
  isBallOutOfBounds() {
    return (
      this._ballX > this._canvasWidth ||
      this._ballX < -50 ||
      this._ballY > this._canvasHeight ||
      this._ballY < -200
    );
  }

  // ==================== 球状态 ====================

  /**
   * 获取球的位置
   * @returns {{x: number, y: number}}
   */
  getBallPosition() {
    return { x: this._ballX, y: this._ballY };
  }

  /**
   * 获取球半径，供场景绘制与碰撞可视化共用。
   * @returns {number}
   */
  getBallRadius() {
    return this._ballRadius;
  }

  /**
   * 获取球的速度
   * @returns {{vx: number, vy: number}}
   */
  getBallVelocity() {
    return { vx: this._ballVx, vy: this._ballVy };
  }

  /**
   * 获取当前碰撞体几何，供调试、测试和辅助绘制使用。
   * @returns {{backboard: {left:number,right:number,top:number,bottom:number}, rim: {front:{x:number,y:number},back:{x:number,y:number},radius:number}, floorY:number}}
   */
  getCollisionGeometry() {
    const left = this._hoopX + BACKBOARD_OFFSET_X;
    const top = this._hoopY + BACKBOARD_OFFSET_Y;
    return {
      backboard: {
        left,
        right: left + BACKBOARD_WIDTH,
        top,
        bottom: top + BACKBOARD_HEIGHT,
      },
      rim: {
        front: { x: this._hoopX - RIM_HALF_WIDTH, y: this._hoopY },
        back: { x: this._hoopX + RIM_HALF_WIDTH, y: this._hoopY },
        radius: RIM_RADIUS,
      },
      floorY: this._floorY,
    };
  }

  /**
   * 获取当前有效进球窗口，供场景绘制辅助线时与物理判定保持一致。
   * @returns {{left:number,right:number,halfWidth:number,y:number}}
   */
  getScoreWindow() {
    const halfWidth = this._getScoreWindowHalfWidth();
    return {
      left: this._hoopX - halfWidth,
      right: this._hoopX + halfWidth,
      halfWidth,
      y: this._hoopY,
    };
  }

  /**
   * 获取最近一次碰撞类型，下一次 update 会刷新。
   * @returns {'backboard'|'rim'|'floor'|null}
   */
  getLastCollision() {
    return this._lastCollision;
  }

  /**
   * 直接设置球的状态（仅供测试与场景恢复使用）
   * @param {number} x - X 坐标
   * @param {number} y - Y 坐标
   * @param {number} vx - X 方向速度
   * @param {number} vy - Y 方向速度
   */
  _setBallState(x, y, vx, vy) {
    this._ballX = x;
    this._ballY = y;
    this._ballVx = vx;
    this._ballVy = vy;
    this._ballFlying = true;
    this._scoredThisFlight = false;
    this._scoreEventPending = false;
    this._lastCollision = null;
  }

  /**
   * 重置球到投掷起始点
   */
  resetBall() {
    this._ballX = BALL_START_X;
    this._ballY = BALL_START_Y;
    this._ballVx = 0;
    this._ballVy = 0;
    this._ballFlying = false;
    this._scoredThisFlight = false;
    this._scoreEventPending = false;
    this._charge = 0;
    this._lastCollision = null;
  }

  // ==================== 计时器 ====================

  /**
   * 获取剩余时间
   * @returns {number}
   */
  getTimer() {
    return this._timer;
  }

  /**
   * 计时器递减
   * @param {number} deltaTime - 帧间隔（秒）
   */
  tickTimer(deltaTime) {
    this._timer -= deltaTime;
    if (this._timer < 0) this._timer = 0;
  }

  /**
   * 时间是否到
   * @returns {boolean}
   */
  isTimeUp() {
    return this._timer <= 0;
  }

  // ==================== 得分与胜利 ====================

  /**
   * 获取当前得分
   * @returns {number}
   */
  getScore() {
    return this._score;
  }

  /**
   * 消费一次穿筐事件。得分数值由物理引擎立即更新，场景用该事件同步播放反馈并复位篮球。
   * @returns {boolean} 本帧是否刚刚产生过进球
   */
  consumeScoreEvent() {
    if (!this._scoreEventPending) return false;
    this._scoreEventPending = false;
    return true;
  }

  /**
   * 直接增加得分（仅供测试使用）
   * @param {number} n - 增加的球数
   */
  _addScore(n) {
    this._score += n;
  }

  /**
   * 是否已达到目标球数
   * @returns {boolean}
   */
  hasWon() {
    return this._score >= TARGET_SCORE;
  }
}
