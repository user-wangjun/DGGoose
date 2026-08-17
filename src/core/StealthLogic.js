/**
 * 烧鹅店潜行逻辑引擎（对应 PRD §5 F6 + Task 3.5）
 *
 * 纯逻辑模块，不依赖 DOM/Canvas，可在 Node 环境独立测试。
 * 负责：老板沿可通行节点往返巡逻、手电筒光锥与遮挡判定、被照中即时抓捕、警觉度增减与满值判定、掩体藏匿检测、烧鹅台到达判定。
 *
 * 物理参数（来自 PRD §5 F6）：
 * - 老板巡逻速度：92px/s
 * - 没有节点路线时，巡逻边界：40 ~ canvasWidth-40
 * - 警觉度上升：45/s（在警戒区且未藏好时）
 * - 警觉度下降：20/s（离开警戒区或已藏好时）
 * - 警觉度满值：100，满值触发被抓
 * - 掩体判定距离：26px（距掩体中心 < 26px 算藏好）
 * - 被抓复位时间：1.6s（由场景层定时器处理，本模块仅暴露 isCaught）
 */

/** 老板巡逻左边界（像素），对应 PRD F6 边界下限 */
const PATROL_MIN_X = 40;

/** 手电筒默认有效距离和半角；场景绘制与逻辑检测共用这组数值。 */
export const FLASHLIGHT_DEFAULT_RANGE = 290;
export const FLASHLIGHT_DEFAULT_HALF_ANGLE = 0.42;

/**
 * 光源相对老板脚底坐标的偏移。
 * 角色坐标是脚底碰撞点，不能直接拿来当手电筒灯头，否则光束会从脚下射出。
 * 光源偏移也由逻辑层提供，保证画面和发现判定使用同一个起点。
 */
export const FLASHLIGHT_SOURCE_OFFSET_X = 28;
export const FLASHLIGHT_SOURCE_OFFSET_Y = -20;

/** 将角度归一化到 [-π, π]，保证跨越 -π/π 时仍能正确比较夹角。 */
function normalizeAngle(angle) {
  let normalized = angle;
  while (normalized > Math.PI) normalized -= Math.PI * 2;
  while (normalized < -Math.PI) normalized += Math.PI * 2;
  return normalized;
}

import {
  pointInRect,
  segmentIntersectsRect,
  validateNavigationRoute,
} from './SceneLayout.js';

export class StealthLogic {
  /**
   * @param {Object} config - 潜行配置
   * @param {number} config.canvasWidth - 画布宽度（用于计算巡逻右边界 W-40）
   * @param {number} config.canvasHeight - 画布高度（用于推算老板 Y 与烧鹅台默认位置）
   * @param {number} config.patrolSpeed - 老板巡逻速度（px/s）
   * @param {number} config.alertRate - 警觉度上升速率（点/秒）
   * @param {number} config.alertDecay - 警觉度下降速率（点/秒）
   * @param {number} config.alertMax - 警觉度满值（触发被抓）
   * @param {number} config.coverThreshold - 掩体判定距离（px）
   * @param {number} [config.bossY] - 老板巡逻 Y 坐标，默认画布高度的一半
   * @param {{x:number,y:number,radius:number}} [config.gooseTable] - 烧鹅台位置与判定半径
   * @param {Array<{x:number,y:number}>} [config.patrolRoute] - 可通行巡逻节点，按顺序往返
   * @param {Array<Object>} [config.patrolObstacles] - 会遮挡手电筒的地图实体
   * @param {number} [config.bossRadius=18] - 老板脚底碰撞半径
   */
  constructor({
    canvasWidth,
    canvasHeight,
    patrolSpeed,
    alertRate,
    alertDecay,
    alertMax,
    coverThreshold,
    bossY,
    gooseTable,
    patrolRoute = null,
    patrolObstacles = [],
    bossRadius = 18,
  }) {
    this._canvasWidth = canvasWidth;
    this._canvasHeight = canvasHeight;
    this._patrolSpeed = patrolSpeed;
    this._alertRate = alertRate;
    this._alertDecay = alertDecay;
    this._alertMax = alertMax;
    this._coverThreshold = coverThreshold;
    this._patrolObstacles = Array.isArray(patrolObstacles)
      ? patrolObstacles.filter((obstacle) => obstacle && obstacle.width > 0 && obstacle.height > 0)
      : [];
    this._bossRadius = Math.max(0, Number(bossRadius) || 0);

    // 节点由场景地图提供。少于两个有效节点时退回旧的横向巡逻，保持测试与旧地图兼容。
    const candidateRoute = Array.isArray(patrolRoute)
      ? patrolRoute
        .filter((point) => Number.isFinite(point?.x) && Number.isFinite(point?.y))
        .map((point) => ({ x: point.x, y: point.y }))
      : [];
    this._patrolValidation = validateNavigationRoute(candidateRoute, this._patrolObstacles, {
      radius: this._bossRadius,
      bounds: { left: PATROL_MIN_X, top: 0, right: canvasWidth - PATROL_MIN_X, bottom: canvasHeight },
    });
    // 地图给出的路线若有任何非法节点/线段就整体拒绝，不能让老板沿着
    // 一条部分有效的路线在运行时悄悄穿过柜台；旧调用仍回退到兼容边界巡逻。
    this._patrolRoute = this._patrolValidation.valid ? candidateRoute : [];
    this._hasPatrolRoute = this._patrolRoute.length >= 2;
    this._patrolSegmentIndex = 0;
    this._patrolTravelDirection = 1;

    // 巡逻边界：40 ~ W-40
    this._patrolMinX = PATROL_MIN_X;
    this._patrolMaxX = canvasWidth - PATROL_MIN_X;

    // 老板初始状态：优先从地图路线首节点出发，否则从左边界向右巡逻。
    this._bossX = this._hasPatrolRoute ? this._patrolRoute[0].x : this._patrolMinX;
    this._bossY = this._hasPatrolRoute
      ? this._patrolRoute[0].y
      : bossY !== undefined ? bossY : canvasHeight * 0.5;
    const firstPatrolPoint = this._hasPatrolRoute ? this._patrolRoute[1] : null;
    this._bossAngle = firstPatrolPoint
      ? Math.atan2(firstPatrolPoint.y - this._bossY, firstPatrolPoint.x - this._bossX)
      : 0;
    this._bossDirection = this._getHorizontalDirection(this._bossAngle, 1); // 1 向右，-1 向左

    // 警觉度：0 ~ alertMax
    this._alert = 0;

    // 烧鹅台位置与判定半径，缺省时取画布中央偏上
    this._gooseTable = gooseTable || {
      x: canvasWidth * 0.5,
      y: canvasHeight * 0.28,
      radius: 30,
    };
  }

  // ==================== 老板巡逻 ====================

  /**
   * 更新老板巡逻位置（每帧调用）
   * 按 patrolSpeed 匀速移动，触碰边界后反向
   * @param {number} deltaTime - 帧间隔（秒）
   */
  updateBoss(deltaTime) {
    const safeDelta = Math.max(0, Number(deltaTime) || 0);
    if (safeDelta === 0 || this._patrolSpeed <= 0) return;

    if (this._hasPatrolRoute) {
      this._updateBossAlongRoute(safeDelta);
      return;
    }

    this._bossX += this._bossDirection * this._patrolSpeed * safeDelta;

    // 触碰右边界：钳制并反向为向左
    if (this._bossX >= this._patrolMaxX) {
      this._bossX = this._patrolMaxX;
      this._bossDirection = -1;
    } else if (this._bossX <= this._patrolMinX) {
      // 触碰左边界：钳制并反向为向右
      this._bossX = this._patrolMinX;
      this._bossDirection = 1;
    }

    // 兼容没有 patrolRoute 的旧地图：边界反向时同步手电筒朝向，
    // 避免老板已经翻面但光束仍留在原方向。
    this._bossAngle = this._getFlashlightAngle();
  }

  /**
   * 获取老板当前位置与方向
   * @returns {{x: number, y: number, direction: number, angle: number, flashlightAngle: number, flashlightOrigin: {x: number, y: number}}}
   */
  getBossPosition() {
    return {
      x: this._bossX,
      y: this._bossY,
      direction: this._bossDirection,
      angle: this._bossAngle,
      // angle 是巡逻切线，不能直接作为角色朝向：垂直路段仍要保持左右面向。
      flashlightAngle: this._getFlashlightAngle(),
      flashlightOrigin: this.getFlashlightOrigin(),
    };
  }

  /** 返回老板巡逻与警觉度的完整状态，供潜行场景精确续接。 */
  getSaveState() {
    return {
      boss: {
        x: this._bossX,
        y: this._bossY,
        angle: this._bossAngle,
        direction: this._bossDirection,
      },
      patrolSegmentIndex: this._patrolSegmentIndex,
      patrolTravelDirection: this._patrolTravelDirection,
      alert: this._alert,
    };
  }

  /** 恢复老板在路线中的游标与警觉度，不重置巡逻。 */
  restoreSaveState(state) {
    if (!state || typeof state !== 'object') return;
    const boss = state.boss || state;
    if (Number.isFinite(boss.x)) this._bossX = Math.max(this._patrolMinX, Math.min(this._patrolMaxX, boss.x));
    if (Number.isFinite(boss.y)) this._bossY = boss.y;
    if (Number.isFinite(boss.angle)) this._bossAngle = boss.angle;
    if (boss.direction === 1 || boss.direction === -1) this._bossDirection = boss.direction;
    if (Number.isInteger(state.patrolSegmentIndex)) {
      this._patrolSegmentIndex = this._hasPatrolRoute
        ? Math.max(0, Math.min(this._patrolRoute.length - 1, state.patrolSegmentIndex))
        : 0;
    }
    if (state.patrolTravelDirection === 1 || state.patrolTravelDirection === -1) {
      this._patrolTravelDirection = state.patrolTravelDirection;
    }
    if (Number.isFinite(state.alert)) {
      this._alert = Math.max(0, Math.min(this._alertMax, state.alert));
    }
  }

  /** 返回与老板当前左右朝向一致的手电筒灯头位置。 */
  getFlashlightOrigin() {
    return {
      x: this._bossX + this._bossDirection * FLASHLIGHT_SOURCE_OFFSET_X,
      y: this._bossY + FLASHLIGHT_SOURCE_OFFSET_Y,
    };
  }

  /** 返回场景使用的巡逻路线副本，避免外部修改逻辑内部状态。 */
  getPatrolRoute() {
    return this._patrolRoute.map((point) => ({ ...point }));
  }

  /** 返回导航校验结果，供开发调试与测试显示每个非法节点/线段。 */
  getPatrolValidation() {
    return {
      valid: this._patrolValidation.valid,
      issues: this._patrolValidation.issues.map((issue) => ({ ...issue })),
    };
  }

  /** 老板脚底碰撞半径，供场景调试层和运行时绑定使用。 */
  getBossRadius() {
    return this._bossRadius;
  }

  /**
   * 直接设置老板位置与方向（仅供测试与场景恢复使用）
   * @param {number} x - X 坐标
   * @param {number} direction - 方向：1 向右，-1 向左
   */
  _setBossState(x, direction) {
    this._bossX = x;
    this._bossDirection = direction;
    this._bossAngle = direction < 0 ? Math.PI : 0;
  }

  /** 被抓复位时回到合法巡逻节点，避免在玩家出生点或障碍内部重新出现。 */
  resetPatrol({ index = 0, travelDirection = 1 } = {}) {
    if (!this._hasPatrolRoute) {
      this._bossX = this._patrolMinX;
      this._bossDirection = 1;
      this._bossAngle = 0;
      return this.getBossPosition();
    }

    const safeIndex = Math.max(0, Math.min(Math.floor(index), this._patrolRoute.length - 1));
    this._patrolSegmentIndex = safeIndex;
    this._patrolTravelDirection = travelDirection < 0 ? -1 : 1;
    this._bossX = this._patrolRoute[safeIndex].x;
    this._bossY = this._patrolRoute[safeIndex].y;

    let nextIndex = safeIndex + this._patrolTravelDirection;
    if (nextIndex < 0 || nextIndex >= this._patrolRoute.length) {
      this._patrolTravelDirection *= -1;
      nextIndex = safeIndex + this._patrolTravelDirection;
    }
    const next = this._patrolRoute[nextIndex];
    this._bossAngle = next
      ? Math.atan2(next.y - this._bossY, next.x - this._bossX)
      : 0;
    this._bossDirection = this._getHorizontalDirection(this._bossAngle, this._bossDirection || 1);
    return this.getBossPosition();
  }

  /** 让老板沿节点路线移动；单帧跨越节点时保留剩余距离，避免出现瞬移或停顿。 */
  _updateBossAlongRoute(deltaTime) {
    let remainingDistance = this._patrolSpeed * deltaTime;
    let guard = 0;

    while (remainingDistance > 0.0001 && guard < 10000) {
      guard += 1;
      const nextIndex = this._patrolSegmentIndex + this._patrolTravelDirection;
      if (nextIndex < 0 || nextIndex >= this._patrolRoute.length) {
        this._patrolTravelDirection *= -1;
        continue;
      }

      const target = this._patrolRoute[nextIndex];
      // 当前坐标可能位于上一帧未走完的线段中，必须从真实位置计算剩余距离，
      // 否则跨帧拐角会重复叠加整段位移。
      const deltaX = target.x - this._bossX;
      const deltaY = target.y - this._bossY;
      const segmentLength = Math.hypot(deltaX, deltaY);

      if (segmentLength <= 0.0001) {
        this._patrolSegmentIndex = nextIndex;
        continue;
      }

      const travel = Math.min(remainingDistance, segmentLength);
      const progress = travel / segmentLength;
      this._bossX += deltaX * progress;
      this._bossY += deltaY * progress;
      this._bossAngle = Math.atan2(deltaY, deltaX);
      this._bossDirection = this._getHorizontalDirection(this._bossAngle, this._bossDirection);
      remainingDistance -= travel;

      if (travel >= segmentLength - 0.0001) {
        this._bossX = target.x;
        this._bossY = target.y;
        this._patrolSegmentIndex = nextIndex;
      }
    }
  }

  /** 垂直路段不改变面朝左右方向，避免手电筒在拐角处突然镜像。 */
  _getHorizontalDirection(angle, fallback) {
    if (Math.cos(angle) > 0.0001) return 1;
    if (Math.cos(angle) < -0.0001) return -1;
    return fallback;
  }

  /** 手电筒始终跟随老板的左右面向，而不是跟随巡逻路线的垂直切线。 */
  _getFlashlightAngle() {
    return this._bossDirection < 0 ? Math.PI : 0;
  }

  /**
   * 判断玩家是否处于老板手电筒的可见光锥内。
   * 光锥同时受距离、夹角和地图实体遮挡影响，场景层可直接把结果交给警觉度系统。
   * @param {number} playerX
   * @param {number} playerY
   * @param {Object} [options]
   * @param {number} [options.range=FLASHLIGHT_DEFAULT_RANGE]
   * @param {number} [options.halfAngle=FLASHLIGHT_DEFAULT_HALF_ANGLE]
   * @param {Array<Object>} [options.obstacles=this._patrolObstacles]
   * @returns {boolean}
   */
  isInFlashlight(playerX, playerY, {
    range = FLASHLIGHT_DEFAULT_RANGE,
    halfAngle = FLASHLIGHT_DEFAULT_HALF_ANGLE,
    obstacles = this._patrolObstacles,
  } = {}) {
    const origin = this.getFlashlightOrigin();
    const deltaX = playerX - origin.x;
    const deltaY = playerY - origin.y;
    const distance = Math.hypot(deltaX, deltaY);
    if (distance <= 0.0001 || distance > range) return distance <= range;

    const targetAngle = Math.atan2(deltaY, deltaX);
    if (Math.abs(normalizeAngle(targetAngle - this._getFlashlightAngle())) > halfAngle) return false;

    return !(Array.isArray(obstacles) && obstacles.some((obstacle) => (
      !this._isFlashlightOriginInsideObstacle(obstacle)
      && segmentIntersectsRect(
        origin,
        { x: playerX, y: playerY },
        obstacle,
      )
    )));
  }

  _isFlashlightOriginInsideObstacle(obstacle) {
    return pointInRect(this.getFlashlightOrigin(), obstacle);
  }

  // ==================== 警觉度系统 ====================

  /**
   * 手电筒直接照中且玩家未藏好时立即标记为被抓。
   * 距离、角度和实体遮挡已经由 isInFlashlight 计算；掩体仍然提供免疫。
   * @param {boolean} inDangerZone - 是否被手电筒实际照中
   * @param {boolean} isHidden - 是否已藏好（近掩体）
   * @returns {boolean} 本帧是否触发即时抓捕
   */
  markCaughtIfVisible(inDangerZone, isHidden) {
    if (!inDangerZone || isHidden) return false;

    this._alert = this._alertMax;
    return true;
  }

  /**
   * 更新警觉度（每帧调用）
   * 在警戒区且未藏好时上升，否则下降；钳制在 0 ~ alertMax
   * @param {number} deltaTime - 帧间隔（秒）
   * @param {boolean} inDangerZone - 是否处于警戒区
   * @param {boolean} isHidden - 是否已藏好（近掩体）
   */
  updateAlert(deltaTime, inDangerZone, isHidden) {
    if (inDangerZone && !isHidden) {
      // 被发现：警觉度上升
      this._alert += this._alertRate * deltaTime;
    } else {
      // 离开警戒区或已藏好：警觉度衰减
      this._alert -= this._alertDecay * deltaTime;
    }

    // 钳制到合法区间
    if (this._alert > this._alertMax) this._alert = this._alertMax;
    if (this._alert < 0) this._alert = 0;
  }

  /**
   * 获取当前警觉度
   * @returns {number} 0 ~ alertMax
   */
  getAlert() {
    return this._alert;
  }

  /**
   * 警觉度是否满值（触发被抓）
   * @returns {boolean}
   */
  isCaught() {
    return this._alert >= this._alertMax;
  }

  /**
   * 重置警觉度为 0（被抓复位后调用）
   */
  resetAlert() {
    this._alert = 0;
  }

  // ==================== 掩体判定 ====================

  /**
   * 检测玩家是否近掩体（已藏好）
   * 任一掩体距离 < coverThreshold 即算藏好
   * @param {number} playerX - 玩家 X 坐标
   * @param {number} playerY - 玩家 Y 坐标
   * @param {Array<{x:number,y:number}>} covers - 掩体数组
   * @returns {boolean}
   */
  isNearCover(playerX, playerY, covers) {
    if (!covers || covers.length === 0) return false;

    for (const cover of covers) {
      const dx = playerX - cover.x;
      const dy = playerY - cover.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance < this._coverThreshold) {
        return true;
      }
    }
    return false;
  }

  // ==================== 烧鹅台到达判定 ====================

  /**
   * 检测玩家是否到达烧鹅台（可偷尝）
   * 距烧鹅台中心 < radius 即算到达
   * @param {number} playerX - 玩家 X 坐标
   * @param {number} playerY - 玩家 Y 坐标
   * @returns {boolean}
   */
  isAtGooseTable(playerX, playerY) {
    const dx = playerX - this._gooseTable.x;
    const dy = playerY - this._gooseTable.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    return distance < this._gooseTable.radius;
  }
}
