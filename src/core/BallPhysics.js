/**
 * 投篮物理引擎（对应 PRD §5 F5 + Task 3.3）
 *
 * 纯逻辑模块，不依赖 DOM/Canvas，可在 Node 环境独立测试。
 * 负责：球的抛物线运动、篮筐浮动、进球判定、蓄力计算、计时器。
 *
 * 默认保留 PRD 旧版的浮动篮筐模型；篮球馆正式场景显式使用
 * `shotModel: 'sideview'`，把侧视篮板/篮筐纳入出手拦截预测。
 * 当前 Blumgi 风格正式关卡另外覆盖固定篮筐和平台布局。
 *
 * 物理参数（来自 PRD §5 F5）：
 * - 重力加速度：430 px/s²
 * - 初速公式：vx = 120 + power * 3.1, vy = -(210 + power * 4.0)
 * - 蓄力速率：65 点/秒，范围 0~100
 * - 篮筐浮动区间：画布高度 10%~34%
 * - 进球判定：球下落穿越篮圈平面且球心通过扣除球半径后的有效开口；
 *   篮板反弹后从篮圈后侧回到开口时，按连续轨迹补判一次
 * - 目标：60 秒内投进 5 球
 * - 交互：支持传统蓄力出手，也支持拖拽方向/距离驱动的弹射出手
 * - Blumgi 风格关卡：可选静态平台碰撞和每关切换投掷点/篮筐
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
const BACKBOARD_OFFSET_X = 24;
const BACKBOARD_OFFSET_Y = -74;
const BACKBOARD_WIDTH = 18;
const BACKBOARD_HEIGHT = 110;
/** 篮圈两侧的碰撞点（侧视图用两颗小圆形刚体近似篮圈边缘）。
 * 现有侧视 PNG 的可见篮圈宽度约为 68px；半宽不能继续沿用旧的 28px，
 * 否则篮筐到达上限时，命中开口边缘的球会先被“空气中的窄碰撞体”弹走。
 */
const RIM_RADIUS = 3;
const RIM_HALF_WIDTH = 34;
/** 侧视横穿篮圈中心线时，允许球心落在篮圈下缘的视觉穿网容差。 */
const SIDE_VIEW_BELOW_TOLERANCE = 16;
/** 上方只保留极小离散误差，避免球尚未到达篮圈平面就横穿 X 线被计分。 */
const SIDE_VIEW_ABOVE_TOLERANCE = 2;
/** 篮板回弹路线穿过篮圈中心线时的纵向容差，覆盖球径与离散帧。 */
const BANK_SHOT_VERTICAL_TOLERANCE = 16;
/** 碰撞参数：反弹系数与切向摩擦 */
const DEFAULT_RESTITUTION = 0.78;
const DEFAULT_FLOOR_RESTITUTION = 0.55;
const DEFAULT_FRICTION = 0.86;
/** 最大子步长，避免高速球单帧穿过篮板 */
const MAX_PHYSICS_STEP = 1 / 120;
/** 低速落地阈值，避免篮球在地面无限微跳 */
const MIN_BOUNCE_SPEED = 70;
/** 侧视投篮用的飞行时间范围；蓄力改变弧线和到达速度，但目标始终明确。 */
const SIDE_VIEW_FLIGHT_TIME_MAX = 1.95;
const SIDE_VIEW_FLIGHT_TIME_MIN = 1.65;
/** 拖拽瞄准的最大有效距离；超出后只保留方向，不继续增加速度。 */
const AIM_MAX_DRAG_DISTANCE = 180;
/** 最短拖拽对应的出手速度，避免轻微误触完全没有反馈。 */
const AIM_MIN_SPEED = 260;
/** 满距离拖拽对应的出手速度，保证从左侧投掷点可以够到篮筐。 */
const AIM_MAX_SPEED = 780;
/** Blumgi 风格平台的反弹与摩擦略高于地面，让平台成为可控的弹射面。 */
const PLATFORM_RESTITUTION = 0.82;
const PLATFORM_FRICTION = 0.92;

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
   * @param {number} [config.ballStartX=120] - 场景投掷点 X 坐标
   * @param {number} [config.ballStartY=580] - 场景投掷点 Y 坐标
   * @param {'legacy'|'sideview'} [config.shotModel='legacy'] - 投篮初速模型
 * @param {number|null} [config.scoreWindowHalfWidth=null] - 有效开口半宽覆盖值
 * @param {boolean} [config.hoopMotionEnabled=true] - 是否启用篮筐上下浮动
 * @param {number|null} [config.hoopY=null] - 固定篮筐 Y 坐标，传入后覆盖浮动区间中心
 * @param {Array<Object>} [config.platforms=[]] - 只参与球物理的水平平台矩形
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
    ballStartX = BALL_START_X,
    ballStartY = BALL_START_Y,
    ballRadius = DEFAULT_BALL_RADIUS,
    floorY = DEFAULT_FLOOR_Y,
    restitution = DEFAULT_RESTITUTION,
    floorRestitution = DEFAULT_FLOOR_RESTITUTION,
    friction = DEFAULT_FRICTION,
    shotModel = 'legacy',
    scoreWindowHalfWidth = null,
    hoopMotionEnabled = true,
    hoopY = null,
    platforms = [],
  }) {
    this._canvasWidth = canvasWidth;
    this._canvasHeight = canvasHeight;
    this._hoopX = hoopX;
    this._gravity = gravity;
    this._chargeRate = chargeRate;
    this._scoreThreshold = scoreThreshold;
    this._ballStartX = ballStartX;
    this._ballStartY = ballStartY;
    this._ballRadius = ballRadius;
    this._floorY = floorY;
    this._restitution = restitution;
    this._floorRestitution = floorRestitution;
    this._friction = friction;
    this._shotModel = shotModel;
    this._scoreWindowHalfWidthOverride = Number.isFinite(scoreWindowHalfWidth)
      ? Math.max(0, scoreWindowHalfWidth)
      : null;
    this._hoopMotionEnabled = hoopMotionEnabled !== false;
    this._platforms = this._normalizePlatforms(platforms);

    // 篮筐浮动区间（像素坐标）
    this._hoopMinY = canvasHeight * hoopRangeMin;
    this._hoopMaxY = canvasHeight * hoopRangeMax;

    // 球状态
    this._ballX = this._ballStartX;
    this._ballY = this._ballStartY;
    this._ballVx = 0;
    this._ballVy = 0;
    this._ballFlying = false;
    this._scoredThisFlight = false;
    this._backboardTouchedThisFlight = false;
    this._scoreEventPending = false;
    this._lastCollision = null;
    this._collisionThisSubstep = null;

    // 蓄力
    this._charge = 0;

    // 篮筐状态
    this._hoopY = Number.isFinite(hoopY)
      ? hoopY
      : (this._hoopMinY + this._hoopMaxY) / 2;
    if (Number.isFinite(hoopY)) {
      this._hoopMinY = hoopY;
      this._hoopMaxY = hoopY;
    }
    this._hoopDirection = 1;
    // 场景先推进移动篮筐、再推进篮球；保留推进前的 Y，避免篮筐自身
    // 在两帧之间穿过篮球时把真正的穿筐时刻漏掉。
    this._previousHoopY = this._hoopY;

    // 游戏状态
    this._score = 0;
    this._timer = GAME_DURATION;
  }

  /**
   * 过滤关卡平台配置，避免测试或运行时输入把 NaN 带进物理循环。
   * @param {Array<Object>} platforms
   * @returns {Array<{x:number,y:number,width:number,height:number}>}
   * @private
   */
  _normalizePlatforms(platforms) {
    if (!Array.isArray(platforms)) return [];
    return platforms
      .filter((platform) => platform && [platform.x, platform.y, platform.width, platform.height]
        .every((value) => Number.isFinite(value) && value >= 0))
      .map((platform) => ({
        x: platform.x,
        y: platform.y,
        width: platform.width,
        height: platform.height,
      }));
  }

  /**
   * 切换 Blumgi 风格小关卡的投掷点、篮筐和平台，不重置总得分/倒计时。
   * 传统篮球馆调用方不使用此方法，因此不会改变旧版侧视行为。
   * @param {Object} level
   * @param {number} [level.ballStartX]
   * @param {number} [level.ballStartY]
   * @param {number} [level.hoopX]
   * @param {number} [level.hoopY]
   * @param {number} [level.floorY]
   * @param {boolean} [level.hoopMotionEnabled]
   * @param {Array<Object>} [level.platforms]
   */
  setLevel({
    ballStartX,
    ballStartY,
    hoopX,
    hoopY,
    floorY,
    hoopMotionEnabled,
    platforms,
  } = {}) {
    if (Number.isFinite(ballStartX)) this._ballStartX = ballStartX;
    if (Number.isFinite(ballStartY)) this._ballStartY = ballStartY;
    if (Number.isFinite(hoopX)) this._hoopX = hoopX;
    if (Number.isFinite(floorY)) this._floorY = floorY;
    if (typeof hoopMotionEnabled === 'boolean') this._hoopMotionEnabled = hoopMotionEnabled;
    if (platforms !== undefined) this._platforms = this._normalizePlatforms(platforms);
    if (Number.isFinite(hoopY)) {
      this._hoopMinY = hoopY;
      this._hoopMaxY = hoopY;
      this._hoopY = hoopY;
    }
    this._hoopDirection = 1;
    this._previousHoopY = this._hoopY;
    this.resetBall();
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

  /**
   * 直接设置蓄力值，供拖拽瞄准 UI 将拖拽距离同步到共享力度条。
   * @param {number} value - 蓄力值（0~100）
   */
  setCharge(value) {
    const numericValue = Number.isFinite(value) ? value : 0;
    this._charge = Math.max(0, Math.min(100, numericValue));
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

    if (this._shotModel === 'sideview') {
      // 侧视模式以篮筐预计到达的拦截点反解初速度。这样蓄力仍会改变
      // 飞行时间与抛物线，篮筐上下移动也不会与判定层脱节。
      const flightTime = this._getSideViewFlightTime(clampedPower);
      const horizontalDistance = this._hoopX - this._ballStartX;
      const targetY = this._predictHoopY(flightTime);
      const verticalDistance = targetY - this._ballStartY;
      return {
        vx: horizontalDistance / flightTime,
        vy: (verticalDistance - 0.5 * this._gravity * flightTime * flightTime) / flightTime,
      };
    }

    return {
      vx: 120 + clampedPower * 3.1,
      vy: -(210 + clampedPower * 4.0),
    };
  }

  /**
   * 将拖拽向量转换为弹射初速度。
   *
   * 方向直接沿拖拽方向，距离映射为力度；这样桌面鼠标和移动端手指
   * 使用同一套交互，不依赖 DOM 或 Canvas。
   *
   * @param {Object} vector
   * @param {number} vector.dx - 从篮球指向拖拽终点的 X 分量
   * @param {number} vector.dy - 从篮球指向拖拽终点的 Y 分量
   * @param {number} [vector.maxDragDistance=180] - 满力度所需的拖拽距离
   * @param {number} [vector.minSpeed=260] - 最短有效拖拽的速度
   * @param {number} [vector.maxSpeed=780] - 满力度拖拽的速度
   * @returns {{vx:number,vy:number,power:number,distance:number,speed:number}}
   */
  getLaunchVelocityFromAim({
    dx = 0,
    dy = 0,
    maxDragDistance = AIM_MAX_DRAG_DISTANCE,
    minSpeed = AIM_MIN_SPEED,
    maxSpeed = AIM_MAX_SPEED,
  } = {}) {
    const safeDx = Number.isFinite(dx) ? dx : 0;
    const safeDy = Number.isFinite(dy) ? dy : 0;
    const distance = Math.hypot(safeDx, safeDy);
    const safeMaxDistance = Math.max(1, Number.isFinite(maxDragDistance) ? maxDragDistance : AIM_MAX_DRAG_DISTANCE);
    const safeMinSpeed = Number.isFinite(minSpeed) ? minSpeed : AIM_MIN_SPEED;
    const safeMaxSpeed = Math.max(safeMinSpeed, Number.isFinite(maxSpeed) ? maxSpeed : AIM_MAX_SPEED);

    if (distance <= 0.0001) {
      return { vx: 0, vy: 0, power: 0, distance: 0, speed: 0 };
    }

    const clampedDistance = Math.min(distance, safeMaxDistance);
    const power = (clampedDistance / safeMaxDistance) * 100;
    const speed = safeMinSpeed + (safeMaxSpeed - safeMinSpeed) * (power / 100);
    return {
      vx: (safeDx / distance) * speed,
      vy: (safeDy / distance) * speed,
      power,
      distance: clampedDistance,
      speed,
    };
  }

  /**
   * 投球：按当前蓄力值或外部拖拽速度计算初速并发射
   * @param {Object} [options]
   * @param {{vx:number,vy:number}} [options.velocity] - 拖拽瞄准产生的初速度
   * @returns {{vx: number, vy: number}} 球的初始速度
   */
  throwBall({ velocity = null } = {}) {
    const power = this._charge;
    const hasCustomVelocity = velocity
      && Number.isFinite(velocity.vx)
      && Number.isFinite(velocity.vy);
    const launchVelocity = hasCustomVelocity
      ? { vx: velocity.vx, vy: velocity.vy }
      : this.getLaunchVelocity(power);
    this._ballVx = launchVelocity.vx;
    this._ballVy = launchVelocity.vy;
    this._ballFlying = true;
    this._scoredThisFlight = false;
    this._backboardTouchedThisFlight = false;
    this._scoreEventPending = false;
    this._lastCollision = null;
    this._charge = 0;
    return launchVelocity;
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
      const previousHoopY = i === 0 ? this._previousHoopY : this._hoopY;

      // 半隐式 Euler 积分：先更新速度，再更新位置。
      this._ballVy += this._gravity * step;
      this._ballX += this._ballVx * step;
      this._ballY += this._ballVy * step;

      // 先记录未经碰撞修正的直穿轨迹。侧视玩法中穿过有效开口的时刻就是
      // 进球时刻，后续同一物理子步的篮板/篮圈接触不能把它改判为未中。
      const crossedScoreWindow = this._checkScoreCrossing(previousX, previousY, previousHoopY);
      const sideViewScoreContact = this._shotModel === 'sideview'
        && this._checkSideViewScoreContact(previousX, previousY, previousHoopY);
      // 篮板反弹后的球会从右向左回到篮圈；它可能已经越过了原本的
      // 水平篮圈线，因此额外检查“回穿篮圈中心线”的连续轨迹。
      let bankShotScore = this._checkBackboardReturnScore(
        previousX,
        previousY,
        previousHoopY,
      );

      // 侧视模式下，球已经在本子步连续轨迹中穿过有效进球窗口时，
      // 进球优先于同一子步末端的浮台/地面碰撞。第 4 关右上浮台的顶面
      // 与篮圈下缘相邻，若继续解析碰撞，会出现“已进球但同时撞障碍物”
      // 的状态。这里不放宽有效开口，也不修改篮筐或平台配置，只结束这次
      // 已经成立的穿筐事件，让场景在同一帧复位篮球/切换关卡。
      const scoreBeforeCollision = this._shotModel === 'sideview'
        && (crossedScoreWindow || sideViewScoreContact || bankShotScore);
      if (scoreBeforeCollision) {
        this._registerScore();
        break;
      }

      // 静态碰撞体：背板、篮圈边缘、地面。
      this._collisionThisSubstep = null;
      this._resolveCollisions(previousX, previousY);

      // 旧版模型保留“被篮板/篮圈反弹后不能误判”的严格规则；侧视模型的
      // 可见开口与移动目标是唯一判定源，允许同一子步末尾的视觉边缘接触。
      // 如果本子步刚刚撞到篮板，碰撞修正后的状态才会出现“已反弹回篮圈”
      // 的有效路线；再补一次检查，避免篮板碰撞把得分窗口截断。
      if (!bankShotScore) {
        bankShotScore = this._checkBackboardReturnScore(
          previousX,
          previousY,
          previousHoopY,
        );
      }

      if ((crossedScoreWindow || sideViewScoreContact || bankShotScore)
        && (this._shotModel === 'sideview' || !this._collisionThisSubstep)) {
        this._registerScore();
        // 得分事件交给场景消费，停止本次物理步，保证 HUD/反馈与穿筐时刻同步。
        break;
      }

      // 出界检测放在碰撞之后，避免刚撞到背板的球被提前重置。
      if (this.isBallOutOfBounds()) {
        this._ballFlying = false;
      }
    }

    this._previousHoopY = this._hoopY;
  }

  /**
   * 计算当前蓄力或外部拖拽速度对应的预测轨迹（不修改真实球状态）。
   * @param {Object} [options]
   * @param {number} [options.power] - 蓄力值，默认使用当前蓄力
   * @param {number} [options.duration] - 预测时长（秒）
   * @param {number} [options.step] - 采样间隔（秒）
   * @param {number} [options.maxPoints] - 最多采样点数
   * @param {{vx:number,vy:number}|null} [options.velocity] - 拖拽瞄准产生的初速度
   * @param {{x:number,y:number}} [options.origin] - 轨迹起点，默认使用当前篮球位置
   * @returns {{points: Array<{x:number,y:number}>, velocity: {vx:number,vy:number}, hoop: {x:number,y:number}}}
   */
  getTrajectoryPreview({
    power = this._charge,
    duration = 3.5,
    step = 0.06,
    maxPoints = 64,
    velocity: customVelocity = null,
    origin = null,
  } = {}) {
    const hasCustomVelocity = customVelocity
      && Number.isFinite(customVelocity.vx)
      && Number.isFinite(customVelocity.vy);
    const velocity = hasCustomVelocity
      ? { vx: customVelocity.vx, vy: customVelocity.vy }
      : this.getLaunchVelocity(power);
    const launchOrigin = origin
      && Number.isFinite(origin.x)
      && Number.isFinite(origin.y)
      ? { x: origin.x, y: origin.y }
      : this.getBallPosition();

    let interceptTime = null;
    if (!hasCustomVelocity && this._shotModel === 'sideview') {
      interceptTime = this._getSideViewFlightTime(power);
    } else if (hasCustomVelocity && velocity.vx > 0 && this._hoopX > launchOrigin.x) {
      interceptTime = (this._hoopX - launchOrigin.x) / velocity.vx;
    }

    const target = interceptTime !== null && interceptTime > 0
      ? { x: this._hoopX, y: this._predictHoopY(interceptTime) }
      : this.getHoopPosition();
    const points = [];
    const pointCount = Math.min(maxPoints, Math.ceil(duration / step) + 1);

    for (let i = 0; i < pointCount; i += 1) {
      const time = i * step;
      const x = launchOrigin.x + velocity.vx * time;
      const y = launchOrigin.y + velocity.vy * time + 0.5 * this._gravity * time * time;
      points.push({ x, y });

      // 画布外的部分不再绘制，避免辅助线铺满整个画面。
      if (x > this._canvasWidth + 50 || y > this._canvasHeight + 50 || y < -120) break;
    }

    return {
      points,
      velocity,
      hoop: this.getHoopPosition(),
      target,
      interceptTime,
    };
  }

  /**
   * 侧视投篮的蓄力到飞行时间映射；单独抽出以保证轨迹辅助与真实出手一致。
   * @param {number} power - 蓄力值（0~100）
   * @returns {number}
   * @private
   */
  _getSideViewFlightTime(power) {
    const clampedPower = Math.max(0, Math.min(100, power));
    return SIDE_VIEW_FLIGHT_TIME_MAX
      - (clampedPower / 100) * (SIDE_VIEW_FLIGHT_TIME_MAX - SIDE_VIEW_FLIGHT_TIME_MIN);
  }

  /**
   * 预测篮筐在指定秒数后的 Y 坐标，按真实的边界反向规则分段计算。
   * 这只用于出手瞄准/轨迹辅助，不会修改实际篮筐状态。
   * @param {number} deltaTime - 从当前篮筐状态起算的秒数
   * @returns {number}
   * @private
   */
  _predictHoopY(deltaTime) {
    if (!this._hoopMotionEnabled || this._hoopMaxY <= this._hoopMinY) {
      return this._hoopY;
    }

    let remaining = Math.max(0, deltaTime);
    let y = this._hoopY;
    let direction = this._hoopDirection;

    while (remaining > 0) {
      const boundary = direction > 0 ? this._hoopMaxY : this._hoopMinY;
      const distance = Math.abs(boundary - y);
      if (distance < 0.0001) {
        direction *= -1;
        continue;
      }

      const timeToBoundary = distance / HOOP_FLOAT_SPEED;
      if (remaining <= timeToBoundary) {
        return y + direction * HOOP_FLOAT_SPEED * remaining;
      }

      y = boundary;
      remaining -= timeToBoundary;
      direction *= -1;
    }

    return y;
  }

  // ==================== 碰撞模型 ====================

  /**
   * 解析一小步内的静态碰撞体。
   * 背板使用矩形，篮圈两侧使用小圆形，地面使用水平平面。
   * 这组几何体会跟随篮筐的 Y 坐标移动。
   * @private
   */
  _resolveCollisions(previousX = this._ballX, previousY = this._ballY) {
    this._collideWithBackboard();
    this._collideWithRimPoint(this._hoopX - RIM_HALF_WIDTH);
    this._collideWithRimPoint(this._hoopX + RIM_HALF_WIDTH);
    this._collideWithPlatforms(previousX, previousY);
    this._collideWithFloor();
  }

  /**
   * 水平平台碰撞：采用连续轨迹穿越平台顶面的判定，避免高速篮球直接穿透薄平台。
   * Blumgi 风格关卡主要依赖平台的顶部反弹；侧面不做隐形墙体处理，保持拖拽路线可读。
   * @param {number} previousX - 子步前球心 X
   * @param {number} previousY - 子步前球心 Y
   * @private
   */
  _collideWithPlatforms(previousX, previousY) {
    if (!this._platforms.length || this._ballVy <= 0) return;

    for (const platform of this._platforms) {
      // 最底层平台由独立的地面碰撞处理；避免同一表面被平台和地面重复反弹，
      // 否则篮球会永远保持平台级反弹系数，无法进入“落地后自动复位”状态。
      if (platform.y >= this._floorY) continue;
      const left = platform.x;
      const right = platform.x + platform.width;
      const top = platform.y;
      const crossedTop = previousY + this._ballRadius <= top
        && this._ballY + this._ballRadius >= top;
      const overlapsX = this._ballX + this._ballRadius >= left
        && this._ballX - this._ballRadius <= right;
      if (!crossedTop || !overlapsX) continue;

      this._ballY = top - this._ballRadius;
      this._ballVy = -this._ballVy * PLATFORM_RESTITUTION;
      this._ballVx *= PLATFORM_FRICTION;
      this._lastCollision = 'platform';
      this._collisionThisSubstep = 'platform';
      break;
    }
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
    const bounced = normalX * this._ballVx + normalY * this._ballVy < 0;
    this._bounceOffSurface(normalX, normalY, this._restitution, this._friction);
    this._lastCollision = 'backboard';
    this._collisionThisSubstep = 'backboard';
    if (bounced) this._backboardTouchedThisFlight = true;
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
   * 侧视判定：检查球的连续轨迹是否进入有效开口的水平区间，并在其中
   * 与篮筐下缘的垂直容差相交。这样即使相邻平台在同一物理子步末端先
   * 捕获篮球，也不会把已经进入开口的有效进球漏掉；篮圈/开口几何本身
   * 仍由 `_getScoreWindowHalfWidth()` 提供，不在这里放宽。
   * @param {number} previousX
   * @param {number} previousY
   * @param {number} previousHoopY
   * @returns {boolean}
   * @private
   */
  _checkSideViewScoreContact(previousX, previousY, previousHoopY) {
    if (!this._ballFlying || this._scoredThisFlight || this._ballVx <= 0 || this._ballVy <= 0) return false;

    const horizontalDelta = this._ballX - previousX;
    if (horizontalDelta <= 0) return false;

    const openingHalfWidth = this._getScoreWindowHalfWidth();
    const openingLeft = this._hoopX - openingHalfWidth;
    const openingRight = this._hoopX + openingHalfWidth;
    if (previousX > openingRight || this._ballX < openingLeft) return false;
    const entryRatio = (openingLeft - previousX) / horizontalDelta;
    const exitRatio = (openingRight - previousX) / horizontalDelta;
    const intervalStart = Math.max(0, entryRatio);
    const intervalEnd = Math.min(1, exitRatio);
    if (intervalStart >= intervalEnd) return false;

    const verticalOffsetAt = (ratio) => {
      const ballY = previousY + (this._ballY - previousY) * ratio;
      const hoopY = previousHoopY + (this._hoopY - previousHoopY) * ratio;
      return ballY - hoopY;
    };
    const verticalOffsetStart = verticalOffsetAt(intervalStart);
    const verticalOffsetEnd = verticalOffsetAt(intervalEnd);
    const verticalOffsetMin = Math.min(verticalOffsetStart, verticalOffsetEnd);
    const verticalOffsetMax = Math.max(verticalOffsetStart, verticalOffsetEnd);
    // Use the existing physical opening bound for the final pixel of the
    // swept contact. This absorbs discrete-frame rounding without widening
    // the horizontal opening or changing any rim geometry.
    const belowTolerance = Math.max(
      SIDE_VIEW_BELOW_TOLERANCE,
      this._getScoreWindowHalfWidth(),
    );
    return verticalOffsetMax >= -SIDE_VIEW_ABOVE_TOLERANCE
      && verticalOffsetMin <= belowTolerance;
  }

  /**
   * 篮板反弹后的回穿判定：球先向右撞到篮板，再向左穿过篮圈中心线，
   * 且穿线位置仍在篮圈高度附近，即视为 bank shot 进球。
   *
   * 不能只依赖 `_checkScoreCrossing`：撞板所在子步可能已经让球越过了
   * 原本的水平篮圈线，之后篮球虽然正确回到篮圈，却永远不会再次“从上往下”
   * 穿越这条线。
   *
   * @param {number} previousX - 子步前球心 X
   * @param {number} previousY - 子步前球心 Y
   * @param {number} previousHoopY - 子步前篮圈 Y
   * @returns {boolean}
   * @private
   */
  _checkBackboardReturnScore(previousX, previousY, previousHoopY) {
    if (!this._ballFlying || !this._backboardTouchedThisFlight || this._scoredThisFlight) return false;
    if (this._ballVx >= 0 || this._ballVy <= 0) return false;
    if (previousX <= this._hoopX || this._ballX > this._hoopX) return false;

    const horizontalDelta = this._ballX - previousX;
    if (horizontalDelta >= 0) return false;

    const ratio = Math.max(0, Math.min(1, (this._hoopX - previousX) / horizontalDelta));
    const ballAtHoopX = previousY + (this._ballY - previousY) * ratio;
    const hoopAtHoopX = previousHoopY + (this._hoopY - previousHoopY) * ratio;

    return Math.abs(ballAtHoopX - hoopAtHoopX) <= BANK_SHOT_VERTICAL_TOLERANCE;
  }

  /**
   * 篮圈有效开口的半宽。开口必须扣除篮圈边缘和篮球自身半径，
   * 否则球只要落在视觉篮圈附近就会被计分，即使物理上已经擦到篮圈。
   * @returns {number}
   * @private
   */
  _getScoreWindowHalfWidth() {
    const physicalOpeningHalfWidth = Math.max(0, RIM_HALF_WIDTH - RIM_RADIUS - this._ballRadius);
    const requestedHalfWidth = this._scoreWindowHalfWidthOverride === null
      ? this._scoreThreshold
      : this._scoreWindowHalfWidthOverride;

    return Math.max(
      0,
      Math.min(requestedHalfWidth, physicalOpeningHalfWidth),
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
    this._previousHoopY = this._hoopY;
    if (!this._hoopMotionEnabled) return;
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

  /**
   * 当前是否启用篮筐浮动；场景和调试 UI 用它明确区分侧视固定目标。
   * @returns {boolean}
   */
  isHoopMotionEnabled() {
    return this._hoopMotionEnabled;
  }

  /**
   * 当前使用的出手模型。
   * @returns {'legacy'|'sideview'}
   */
  getShotModel() {
    return this._shotModel;
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
   * @returns {{backboard: {left:number,right:number,top:number,bottom:number}, rim: {front:{x:number,y:number},back:{x:number,y:number},radius:number}, platforms:Array<Object>, floorY:number}}
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
      platforms: this._platforms.map((platform) => ({ ...platform })),
      floorY: this._floorY,
    };
  }

  /**
   * 获取当前关卡平台，供场景绘制与调试使用。
   * @returns {Array<{x:number,y:number,width:number,height:number}>}
   */
  getPlatforms() {
    return this._platforms.map((platform) => ({ ...platform }));
  }

  /**
   * 获取当前有效进球窗口，供场景绘制辅助线时与物理判定保持一致。
   * @returns {{left:number,right:number,halfWidth:number,y:number}}
   */
  getScoreWindow(time = 0) {
    const halfWidth = this._getScoreWindowHalfWidth();
    const y = this._shotModel === 'sideview' && time > 0
      ? this._predictHoopY(time)
      : this._hoopY;
    return {
      left: this._hoopX - halfWidth,
      right: this._hoopX + halfWidth,
      halfWidth,
      y,
    };
  }

  /**
   * 获取最近一次碰撞类型，下一次 update 会刷新。
   * @returns {'backboard'|'rim'|'platform'|'floor'|null}
   */
  getLastCollision() {
    return this._lastCollision;
  }

  /**
   * 返回篮球小关卡继续游戏所需的完整物理快照。
   * 几何配置一起写入，保证在不同 Blumgi 小关卡之间离开时不会把球恢复到旧篮筐。
   */
  getSaveState() {
    return {
      geometry: {
        ballStartX: this._ballStartX,
        ballStartY: this._ballStartY,
        hoopX: this._hoopX,
        floorY: this._floorY,
        hoopMotionEnabled: this._hoopMotionEnabled,
        hoopMinY: this._hoopMinY,
        hoopMaxY: this._hoopMaxY,
        platforms: this.getPlatforms(),
      },
      ball: {
        x: this._ballX,
        y: this._ballY,
        vx: this._ballVx,
        vy: this._ballVy,
      },
      ballFlying: this._ballFlying,
      scoredThisFlight: this._scoredThisFlight,
      backboardTouchedThisFlight: this._backboardTouchedThisFlight,
      scoreEventPending: this._scoreEventPending,
      lastCollision: this._lastCollision,
      collisionThisSubstep: this._collisionThisSubstep,
      charge: this._charge,
      hoopY: this._hoopY,
      hoopDirection: this._hoopDirection,
      previousHoopY: this._previousHoopY,
      score: this._score,
      timer: this._timer,
    };
  }

  /** 从快照恢复篮球、篮筐、计时器和一次性碰撞标记。 */
  restoreSaveState(state) {
    if (!state || typeof state !== 'object') return;
    const geometry = state.geometry || {};
    if (Number.isFinite(geometry.ballStartX)) this._ballStartX = geometry.ballStartX;
    if (Number.isFinite(geometry.ballStartY)) this._ballStartY = geometry.ballStartY;
    if (Number.isFinite(geometry.hoopX)) this._hoopX = geometry.hoopX;
    if (Number.isFinite(geometry.floorY)) this._floorY = geometry.floorY;
    if (typeof geometry.hoopMotionEnabled === 'boolean') {
      this._hoopMotionEnabled = geometry.hoopMotionEnabled;
    }
    if (Number.isFinite(geometry.hoopMinY)) this._hoopMinY = geometry.hoopMinY;
    if (Number.isFinite(geometry.hoopMaxY)) this._hoopMaxY = geometry.hoopMaxY;
    if (Array.isArray(geometry.platforms)) this._platforms = this._normalizePlatforms(geometry.platforms);

    const ball = state.ball || {};
    if (Number.isFinite(ball.x)) this._ballX = ball.x;
    if (Number.isFinite(ball.y)) this._ballY = ball.y;
    if (Number.isFinite(ball.vx)) this._ballVx = ball.vx;
    if (Number.isFinite(ball.vy)) this._ballVy = ball.vy;
    this._ballFlying = Boolean(state.ballFlying);
    this._scoredThisFlight = Boolean(state.scoredThisFlight);
    this._backboardTouchedThisFlight = Boolean(state.backboardTouchedThisFlight);
    this._scoreEventPending = Boolean(state.scoreEventPending);
    this._lastCollision = state.lastCollision ?? null;
    this._collisionThisSubstep = state.collisionThisSubstep ?? null;
    if (Number.isFinite(state.charge)) this._charge = Math.max(0, Math.min(100, state.charge));
    if (Number.isFinite(state.hoopY)) this._hoopY = state.hoopY;
    if (state.hoopDirection === 1 || state.hoopDirection === -1) this._hoopDirection = state.hoopDirection;
    if (Number.isFinite(state.previousHoopY)) this._previousHoopY = state.previousHoopY;
    if (Number.isFinite(state.score)) this._score = Math.max(0, state.score);
    if (Number.isFinite(state.timer)) this._timer = Math.max(0, state.timer);
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
    this._backboardTouchedThisFlight = false;
    this._scoreEventPending = false;
    this._lastCollision = null;
  }

  /**
   * 重置球到投掷起始点，或放到指定的关卡坐标
   * @param {{x:number,y:number}|null} [position=null]
   */
  resetBall(position = null) {
    this._ballX = Number.isFinite(position?.x) ? position.x : this._ballStartX;
    this._ballY = Number.isFinite(position?.y) ? position.y : this._ballStartY;
    this._ballVx = 0;
    this._ballVy = 0;
    this._ballFlying = false;
    this._scoredThisFlight = false;
    this._backboardTouchedThisFlight = false;
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
