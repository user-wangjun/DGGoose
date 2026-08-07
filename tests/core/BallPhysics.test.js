import { describe, it, expect, beforeEach } from 'vitest';
import { BallPhysics } from '../../src/core/BallPhysics.js';

/**
 * BallPhysics 投篮物理引擎测试（对应 PRD §5 F5 + Task 3.3）
 *
 * 覆盖核心物理逻辑：
 * - 球的抛物线运动（重力、初速、位移）
 * - 篮筐浮动（上下移动、边界反转）
 * - 进球判定（下落穿越篮圈平面且 |Δx| < 36）
 * - 蓄力计算（65 点/秒，钳制 0~100）
 * - 球出界检测与重置
 */
describe('BallPhysics 投篮物理引擎', () => {
  let physics;

  beforeEach(() => {
    // 标准配置：画布 1280×720，篮筐在右侧
    physics = new BallPhysics({
      canvasWidth: 1280,
      canvasHeight: 720,
      hoopX: 1000,
      gravity: 430,
      chargeRate: 65,
      hoopRangeMin: 0.10,
      hoopRangeMax: 0.34,
      scoreThreshold: 36,
    });
  });

  // ==================== 初始状态 ====================

  it('初始时球不在飞行状态', () => {
    expect(physics.isBallFlying()).toBe(false);
  });

  it('初始蓄力值为 0', () => {
    expect(physics.getCharge()).toBe(0);
  });

  it('初始得分为 0', () => {
    expect(physics.getScore()).toBe(0);
  });

  it('初始球位置在投掷点', () => {
    const pos = physics.getBallPosition();
    expect(pos.x).toBeGreaterThan(0);
    expect(pos.y).toBeLessThan(720);
  });

  // ==================== 蓄力 ====================

  it('蓄力按 65 点/秒递增', () => {
    physics.charge(1.0); // 1 秒
    expect(physics.getCharge()).toBe(65);
  });

  it('蓄力 0.5 秒后蓄力值为 32.5', () => {
    physics.charge(0.5);
    expect(physics.getCharge()).toBeCloseTo(32.5, 1);
  });

  it('蓄力值钳制在 100 以内', () => {
    physics.charge(2.0); // 2 秒 = 130，应钳制为 100
    expect(physics.getCharge()).toBe(100);
  });

  it('蓄力值不为负', () => {
    physics.charge(-1.0);
    expect(physics.getCharge()).toBe(0);
  });

  it('重置蓄力值为 0', () => {
    physics.charge(1.0);
    physics.resetCharge();
    expect(physics.getCharge()).toBe(0);
  });

  // ==================== 投球与抛物线运动 ====================

  it('投球后球进入飞行状态', () => {
    physics.charge(0.5);
    physics.throwBall();
    expect(physics.isBallFlying()).toBe(true);
  });

  it('投球后蓄力值归零', () => {
    physics.charge(0.5);
    physics.throwBall();
    expect(physics.getCharge()).toBe(0);
  });

  it('球的初速按公式计算 vx=120+p*3.1, vy=-(210+p*4.0)', () => {
    physics.charge(1.0); // 蓄力 65
    const vel = physics.throwBall();
    // p=65: vx = 120 + 65*3.1 = 321.5, vy = -(210 + 65*4.0) = -470
    expect(vel.vx).toBeCloseTo(321.5, 1);
    expect(vel.vy).toBeCloseTo(-470, 1);
  });

  it('蓄力为 0 时初速最小', () => {
    physics.charge(0); // 蓄力 0
    const vel = physics.throwBall();
    // p=0: vx = 120, vy = -210
    expect(vel.vx).toBeCloseTo(120, 1);
    expect(vel.vy).toBeCloseTo(-210, 1);
  });

  it('蓄力满 100 时初速最大', () => {
    physics.charge(2.0); // 钳制为 100
    const vel = physics.throwBall();
    // p=100: vx = 120 + 310 = 430, vy = -(210 + 400) = -610
    expect(vel.vx).toBeCloseTo(430, 1);
    expect(vel.vy).toBeCloseTo(-610, 1);
  });

  it('球受重力影响 vy 递增（向下加速）', () => {
    physics.charge(1.0);
    physics.throwBall();
    const velBefore = physics.getBallVelocity();
    physics.update(0.1); // 0.1 秒
    const velAfter = physics.getBallVelocity();
    // vy 增加 430 * 0.1 = 43
    expect(velAfter.vy - velBefore.vy).toBeCloseTo(43, 1);
  });

  it('球水平方向匀速运动（无空气阻力）', () => {
    physics.charge(1.0);
    physics.throwBall();
    const posBefore = physics.getBallPosition();
    physics.update(0.1);
    const posAfter = physics.getBallPosition();
    const vel = physics.getBallVelocity();
    // 水平位移 = vx * dt
    expect(posAfter.x - posBefore.x).toBeCloseTo(vel.vx * 0.1, 1);
  });

  it('轨迹辅助与真实出手使用同一套初速度模型', () => {
    physics.charge(1.0); // 蓄力 65
    const preview = physics.getTrajectoryPreview({ duration: 0.2, step: 0.1 });

    expect(preview.velocity.vx).toBeCloseTo(321.5, 1);
    expect(preview.velocity.vy).toBeCloseTo(-470, 1);
    expect(preview.points.length).toBeGreaterThan(1);
    // 轨迹计算不应修改真实球状态
    expect(physics.isBallFlying()).toBe(false);
    expect(physics.getBallPosition()).toEqual({ x: 120, y: 580 });
  });

  // ==================== 碰撞模型 ====================

  it('篮球撞到篮板后会沿水平方向反弹', () => {
    const geometry = physics.getCollisionGeometry();
    const boardCenterY = (geometry.backboard.top + geometry.backboard.bottom) / 2;
    physics._setBallState(geometry.backboard.left - 30, boardCenterY, 420, 0);

    physics.update(0.05);

    expect(physics.getLastCollision()).toBe('backboard');
    expect(physics.getBallVelocity().vx).toBeLessThan(0);
    expect(physics.getBallPosition().x).toBeLessThanOrEqual(
      geometry.backboard.left - physics.getBallRadius() + 0.01,
    );
  });

  it('篮球从篮圈下方撞击篮圈边缘后会向下反弹', () => {
    const geometry = physics.getCollisionGeometry();
    physics._setBallState(geometry.rim.front.x, geometry.rim.front.y + 22, 0, -200);

    physics.update(0.05);

    expect(physics.getLastCollision()).toBe('rim');
    expect(physics.getBallVelocity().vy).toBeGreaterThan(0);
  });

  it('篮球落地后会反弹并受到水平摩擦', () => {
    physics._setBallState(500, 600, 80, 220);

    physics.update(0.12);

    expect(physics.getLastCollision()).toBe('floor');
    expect(physics.getBallPosition().y).toBeLessThanOrEqual(606);
    expect(physics.getBallVelocity().vy).toBeLessThan(0);
    expect(physics.getBallVelocity().vx).toBeLessThan(80);
  });

  // ==================== 篮筐浮动 ====================

  it('篮筐 Y 坐标在 10%~34% 画布高度区间内', () => {
    const hoopY = physics.getHoopPosition().y;
    expect(hoopY).toBeGreaterThanOrEqual(720 * 0.10);
    expect(hoopY).toBeLessThanOrEqual(720 * 0.34);
  });

  it('篮筐浮动更新后 Y 坐标仍在区间内', () => {
    for (let i = 0; i < 100; i++) {
      physics.updateHoop(0.05);
      const y = physics.getHoopPosition().y;
      expect(y).toBeGreaterThanOrEqual(720 * 0.10);
      expect(y).toBeLessThanOrEqual(720 * 0.34);
    }
  });

  // ==================== 进球判定 ====================

  it('球从上方下落穿过篮圈有效开口判定为进球', () => {
    // 球已穿越篮圈平面（Y 坐标 >= 篮筐 Y），下落速度向下且位于开口中心
    const hoop = physics.getHoopPosition();
    physics._setBallState(hoop.x, hoop.y + 1, 0, 100); // 穿越篮圈平面，向下飞
    expect(physics.checkScore()).toBe(true);
  });

  it('球水平偏移超过 36 不算进球', () => {
    const hoop = physics.getHoopPosition();
    physics._setBallState(hoop.x + 40, hoop.y - 1, 0, 100); // 偏移 40px
    expect(physics.checkScore()).toBe(false);
  });

  it('球向上运动时不判定进球（必须是下落）', () => {
    const hoop = physics.getHoopPosition();
    physics._setBallState(hoop.x, hoop.y - 1, 0, -100); // 向上飞
    expect(physics.checkScore()).toBe(false);
  });

  it('球未飞行时不判定进球', () => {
    expect(physics.checkScore()).toBe(false);
  });

  it('进球后得分递增', () => {
    const hoop = physics.getHoopPosition();
    physics._setBallState(hoop.x, hoop.y + 1, 0, 100);
    physics.checkScore();
    expect(physics.getScore()).toBe(1);
  });

  it('同一飞行周期内进球只计一次', () => {
    const hoop = physics.getHoopPosition();
    physics._setBallState(hoop.x, hoop.y + 1, 0, 100);
    physics.checkScore();
    physics.checkScore(); // 重复调用
    expect(physics.getScore()).toBe(1);
  });

  it('球擦到篮圈边缘时不应被有效开口判定为进球', () => {
    const hoop = physics.getHoopPosition();
    physics._setBallState(hoop.x + 20, hoop.y + 1, 0, 100);

    expect(physics.checkScore()).toBe(false);
    expect(physics.getScore()).toBe(0);
  });

  it('篮板碰撞把球推过篮圈平面时不应误判为进球', () => {
    const hoop = physics.getHoopPosition();
    // 球的右侧已经接近篮板，向下穿过篮圈高度时会先撞上篮板。
    physics._setBallState(hoop.x + 14, hoop.y - 5, 0, 100);

    physics.update(0.08);

    expect(physics.getLastCollision()).toBe('backboard');
    expect(physics.getScore()).toBe(0);
  });

  it('有效穿筐后产生一次性得分事件', () => {
    const hoop = physics.getHoopPosition();
    physics._setBallState(hoop.x, hoop.y - 5, 0, 100);

    physics.update(0.08);

    expect(physics.getScore()).toBe(1);
    expect(physics.consumeScoreEvent()).toBe(true);
    expect(physics.consumeScoreEvent()).toBe(false);
  });

  // ==================== 出界检测与重置 ====================

  it('球飞出画布右边界检测为出界', () => {
    physics._setBallState(1300, 100, 100, 0); // 超出右边界
    expect(physics.isBallOutOfBounds()).toBe(true);
  });

  it('球飞出画布下边界检测为出界', () => {
    physics._setBallState(500, 800, 0, 100); // 超出下边界
    expect(physics.isBallOutOfBounds()).toBe(true);
  });

  it('球在画布内不算出界', () => {
    physics._setBallState(500, 300, 100, 0);
    expect(physics.isBallOutOfBounds()).toBe(false);
  });

  it('出界后球停止飞行', () => {
    physics.charge(1.0);
    physics.throwBall();
    physics._setBallState(1300, 100, 100, 0);
    physics.update(0.01);
    expect(physics.isBallFlying()).toBe(false);
  });

  it('重置球后恢复初始状态', () => {
    physics.charge(1.0);
    physics.throwBall();
    physics.resetBall();
    expect(physics.isBallFlying()).toBe(false);
    expect(physics.getCharge()).toBe(0);
  });

  // ==================== 计时器 ====================

  it('初始计时器为 60 秒', () => {
    expect(physics.getTimer()).toBe(60);
  });

  it('计时器按 deltaTime 递减', () => {
    physics.tickTimer(5.0);
    expect(physics.getTimer()).toBe(55);
  });

  it('计时器归零后时间到', () => {
    physics.tickTimer(60.0);
    expect(physics.isTimeUp()).toBe(true);
  });

  it('计时器不为零时时间未到', () => {
    physics.tickTimer(30.0);
    expect(physics.isTimeUp()).toBe(false);
  });

  // ==================== 胜利判定 ====================

  it('得分达到 5 球判定胜利', () => {
    physics._addScore(5);
    expect(physics.hasWon()).toBe(true);
  });

  it('得分不足 5 球未胜利', () => {
    physics._addScore(3);
    expect(physics.hasWon()).toBe(false);
  });
});
