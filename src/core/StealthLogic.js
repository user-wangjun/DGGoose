/**
 * 烧鹅店潜行逻辑引擎（对应 PRD §5 F6 + Task 3.5）
 *
 * 纯逻辑模块，不依赖 DOM/Canvas，可在 Node 环境独立测试。
 * 负责：老板匀速往返巡逻、警觉度增减与满值判定、掩体藏匿检测、烧鹅台到达判定。
 *
 * 物理参数（来自 PRD §5 F6）：
 * - 老板巡逻速度：92px/s
 * - 巡逻边界：40 ~ canvasWidth-40
 * - 警觉度上升：45/s（在警戒区且未藏好时）
 * - 警觉度下降：20/s（离开警戒区或已藏好时）
 * - 警觉度满值：100，满值触发被抓
 * - 掩体判定距离：26px（距掩体中心 < 26px 算藏好）
 * - 被抓复位时间：1.6s（由场景层定时器处理，本模块仅暴露 isCaught）
 */

/** 老板巡逻左边界（像素），对应 PRD F6 边界下限 */
const PATROL_MIN_X = 40;

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
  }) {
    this._canvasWidth = canvasWidth;
    this._canvasHeight = canvasHeight;
    this._patrolSpeed = patrolSpeed;
    this._alertRate = alertRate;
    this._alertDecay = alertDecay;
    this._alertMax = alertMax;
    this._coverThreshold = coverThreshold;

    // 巡逻边界：40 ~ W-40
    this._patrolMinX = PATROL_MIN_X;
    this._patrolMaxX = canvasWidth - PATROL_MIN_X;

    // 老板初始状态：从左边界出发，向右巡逻
    this._bossX = this._patrolMinX;
    this._bossY = bossY !== undefined ? bossY : canvasHeight * 0.5;
    this._bossDirection = 1; // 1 向右，-1 向左

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
    this._bossX += this._bossDirection * this._patrolSpeed * deltaTime;

    // 触碰右边界：钳制并反向为向左
    if (this._bossX >= this._patrolMaxX) {
      this._bossX = this._patrolMaxX;
      this._bossDirection = -1;
    } else if (this._bossX <= this._patrolMinX) {
      // 触碰左边界：钳制并反向为向右
      this._bossX = this._patrolMinX;
      this._bossDirection = 1;
    }
  }

  /**
   * 获取老板当前位置与方向
   * @returns {{x: number, y: number, direction: number}}
   */
  getBossPosition() {
    return { x: this._bossX, y: this._bossY, direction: this._bossDirection };
  }

  /**
   * 直接设置老板位置与方向（仅供测试与场景恢复使用）
   * @param {number} x - X 坐标
   * @param {number} direction - 方向：1 向右，-1 向左
   */
  _setBossState(x, direction) {
    this._bossX = x;
    this._bossDirection = direction;
  }

  // ==================== 警觉度系统 ====================

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
