import { describe, it, expect, beforeEach } from 'vitest';
import { BallPhysics } from '../../src/core/BallPhysics.js';

/**
 * BallPhysics 投篮物理引擎测试（对应 PRD §5 F5 + Task 3.3）
 *
 * 覆盖核心物理逻辑：
 * - 球的抛物线运动（重力、初速、位移）
 * - 篮筐浮动（上下移动、边界反转）
 * - 进球判定（有效开口、侧视容差和篮板回弹路线）
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

  it('支持场景按正式背景的投掷点覆盖默认球起点', () => {
    const scenePhysics = new BallPhysics({
      canvasWidth: 1280,
      canvasHeight: 720,
      hoopX: 1100,
      gravity: 430,
      chargeRate: 65,
      hoopRangeMin: 0.42,
      hoopRangeMax: 0.44,
      scoreThreshold: 36,
      ballStartX: 320,
      ballStartY: 580,
    });

    expect(scenePhysics.getBallPosition()).toEqual({ x: 320, y: 580 });
    scenePhysics.charge(1);
    scenePhysics.throwBall();
    scenePhysics.resetBall();
    expect(scenePhysics.getBallPosition()).toEqual({ x: 320, y: 580 });
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

  it('拖拽瞄准将方向和距离映射为可复用的弹射速度', () => {
    const aim = physics.getLaunchVelocityFromAim({ dx: 96, dy: -128 });
    const preview = physics.getTrajectoryPreview({
      velocity: aim,
      origin: physics.getBallPosition(),
      duration: 0.2,
      step: 0.1,
    });

    expect(aim.power).toBeGreaterThan(0);
    expect(aim.power).toBeLessThan(100);
    expect(aim.vx).toBeGreaterThan(0);
    expect(aim.vy).toBeLessThan(0);
    expect(preview.velocity.vx).toBeCloseTo(aim.vx, 5);
    expect(preview.velocity.vy).toBeCloseTo(aim.vy, 5);
    expect(preview.points[0]).toEqual({ x: 120, y: 580 });
    expect(preview.points[1].x).toBeGreaterThan(preview.points[0].x);
    expect(preview.points[1].y).toBeLessThan(preview.points[0].y);
  });

  it('拖拽速度会覆盖侧视模式的默认自动瞄准，但仍保留物理状态和归零契约', () => {
    const sideview = new BallPhysics({
      canvasWidth: 1280,
      canvasHeight: 720,
      hoopX: 1000,
      gravity: 430,
      chargeRate: 65,
      hoopRangeMin: 0.10,
      hoopRangeMax: 0.34,
      scoreThreshold: 12,
      shotModel: 'sideview',
      ballStartX: 320,
      ballStartY: 580,
    });
    const aim = sideview.getLaunchVelocityFromAim({ dx: 80, dy: -150 });
    sideview.setCharge(aim.power);

    const actual = sideview.throwBall({ velocity: aim });

    expect(actual).toEqual({ vx: aim.vx, vy: aim.vy });
    expect(sideview.isBallFlying()).toBe(true);
    expect(sideview.getCharge()).toBe(0);
  });

  it('支持 Blumgi 风格水平平台反弹，并可切换固定篮筐关卡', () => {
    const levelPhysics = new BallPhysics({
      canvasWidth: 1280,
      canvasHeight: 720,
      hoopX: 1050,
      hoopY: 220,
      gravity: 430,
      chargeRate: 65,
      hoopRangeMin: 0.3,
      hoopRangeMax: 0.3,
      scoreThreshold: 12,
      shotModel: 'sideview',
      hoopMotionEnabled: false,
      platforms: [{ x: 120, y: 400, width: 240, height: 24 }],
    });

    expect(levelPhysics.getHoopPosition()).toEqual({ x: 1050, y: 220 });
    expect(levelPhysics.getPlatforms()).toHaveLength(1);

    levelPhysics._setBallState(200, 350, 0, 220);
    levelPhysics.update(0.2);

    expect(levelPhysics.getLastCollision()).toBe('platform');
    expect(levelPhysics.getBallPosition().y).toBeLessThanOrEqual(400 - levelPhysics.getBallRadius());
    expect(levelPhysics.getBallVelocity().vy).toBeLessThan(0);

    levelPhysics.setLevel({
      ballStartX: 280,
      ballStartY: 540,
      hoopX: 980,
      hoopY: 160,
      platforms: [],
      hoopMotionEnabled: false,
    });
    expect(levelPhysics.getBallPosition()).toEqual({ x: 280, y: 540 });
    expect(levelPhysics.getHoopPosition()).toEqual({ x: 980, y: 160 });
    expect(levelPhysics.getPlatforms()).toEqual([]);
  });

  it('侧视模式穿过有效进球窗口时优先完成进球，不把同一帧的浮台当作撞击', () => {
    const level4 = new BallPhysics({
      canvasWidth: 1280,
      canvasHeight: 720,
      hoopX: 1000,
      hoopY: 226,
      floorY: 620,
      gravity: 430,
      chargeRate: 65,
      hoopRangeMin: 0.3,
      hoopRangeMax: 0.3,
      scoreThreshold: 17,
      scoreWindowHalfWidth: 17,
      shotModel: 'sideview',
      hoopMotionEnabled: false,
      ballStartX: 360,
      ballStartY: 580,
      platforms: [
        { x: 0, y: 620, width: 1280, height: 100 },
        { x: 520, y: 430, width: 190, height: 24 },
        { x: 850, y: 520, width: 190, height: 24 },
        { x: 910, y: 290, width: 180, height: 24 },
      ],
    });

    level4.setLevel({
      ballStartX: 360,
      ballStartY: 580,
      hoopX: 1080,
      hoopY: 260,
      floorY: 620,
      hoopMotionEnabled: false,
      platforms: [
        { x: 0, y: 620, width: 1280, height: 100 },
        { x: 520, y: 430, width: 190, height: 24 },
        { x: 850, y: 520, width: 190, height: 24 },
        { x: 910, y: 290, width: 180, height: 24 },
      ],
    });
    // 该路线在穿筐判定成立的同一子步末端会到达右上浮台顶面。
    level4.throwBall({ velocity: { vx: 820, vy: -530 } });

    let scoreEvent = false;
    for (let frame = 0; frame < 240 && level4.isBallFlying(); frame += 1) {
      level4.update(1 / 120);
      if (level4.consumeScoreEvent()) {
        scoreEvent = true;
        break;
      }
    }

    expect(scoreEvent).toBe(true);
    expect(level4.getScore()).toBe(1);
    expect(level4.getLastCollision()).toBe(null);
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

  it('球心位于物理开口边缘内时，侧视模式仍应判定为进球', () => {
    const sideview = new BallPhysics({
      canvasWidth: 1280,
      canvasHeight: 720,
      hoopX: 1000,
      hoopY: 226,
      floorY: 620,
      gravity: 430,
      chargeRate: 65,
      hoopRangeMin: 0.3,
      hoopRangeMax: 0.3,
      scoreThreshold: 17,
      scoreWindowHalfWidth: 17,
      shotModel: 'sideview',
      hoopMotionEnabled: false,
    });

    // 偏移 16px，仍在 34 - 3 - 14 = 17px 的有效物理开口内。
    sideview._setBallState(1016, 225, 0, 100);
    sideview.update(0.02);

    expect(sideview.getScore()).toBe(1);
    expect(sideview.consumeScoreEvent()).toBe(true);
  });

  it('球从篮圈下缘附近横穿中心线时，不应因 11px 旧容差被判未中', () => {
    const sideview = new BallPhysics({
      canvasWidth: 1280,
      canvasHeight: 720,
      hoopX: 1000,
      hoopY: 226,
      floorY: 620,
      gravity: 430,
      chargeRate: 65,
      hoopRangeMin: 0.3,
      hoopRangeMax: 0.3,
      scoreThreshold: 17,
      scoreWindowHalfWidth: 17,
      shotModel: 'sideview',
      hoopMotionEnabled: false,
    });

    // 球心在篮圈下方 14px 处横穿 X=1000；球体仍覆盖篮圈/篮网的可见入口。
    sideview._setBallState(990, 240, 200, 0);
    sideview.update(0.06);

    expect(sideview.getScore()).toBe(1);
    expect(sideview.consumeScoreEvent()).toBe(true);
  });

  it('侧视模式下有效开口边缘的离散帧不应被篮圈接触漏判', () => {
    const level1 = new BallPhysics({
      canvasWidth: 1280,
      canvasHeight: 720,
      hoopX: 1030,
      hoopY: 226,
      floorY: 620,
      gravity: 430,
      chargeRate: 65,
      hoopRangeMin: 0.3,
      hoopRangeMax: 0.3,
      scoreThreshold: 17,
      scoreWindowHalfWidth: 17,
      shotModel: 'sideview',
      hoopMotionEnabled: false,
      ballStartX: 320,
      ballStartY: 580,
      platforms: [
        { x: 0, y: 620, width: 1280, height: 100 },
        { x: 470, y: 500, width: 220, height: 24 },
        { x: 820, y: 360, width: 220, height: 24 },
      ],
    });
    const speed = 720;
    const angle = -57 * Math.PI / 180;

    level1.throwBall({
      velocity: {
        vx: speed * Math.cos(angle),
        vy: speed * Math.sin(angle),
      },
    });

    let scoreEvent = false;
    for (let frame = 0; frame < 300 && level1.isBallFlying(); frame += 1) {
      level1.update(1 / 60);
      scoreEvent = level1.consumeScoreEvent() || scoreEvent;
    }

    expect(scoreEvent).toBe(true);
    expect(level1.getScore()).toBe(1);
  });

  it('有效开口进入障碍物前应先完成进球判定', () => {
    const sideview = new BallPhysics({
      canvasWidth: 1280,
      canvasHeight: 720,
      hoopX: 1080,
      hoopY: 260,
      floorY: 620,
      gravity: 430,
      chargeRate: 65,
      hoopRangeMin: 0.3,
      hoopRangeMax: 0.3,
      scoreThreshold: 17,
      scoreWindowHalfWidth: 17,
      shotModel: 'sideview',
      hoopMotionEnabled: false,
      platforms: [
        { x: 910, y: 290, width: 180, height: 24 },
      ],
    });

    // 这一子步会让球进入有效开口后落到平台顶面；平台几何不变，
    // 只验证判定顺序不会把已发生的进球吞掉。
    sideview._setBallState(1076, 274, 240, 240);
    sideview.update(1 / 120);

    expect(sideview.getScore()).toBe(1);
    expect(sideview.consumeScoreEvent()).toBe(true);
    expect(sideview.getLastCollision()).toBe(null);
  });

  it('篮板碰撞把球推过篮圈平面时不应误判为进球', () => {
    const hoop = physics.getHoopPosition();
    // 球的右侧已经接近篮板，向下穿过篮圈高度时会先撞上篮板。
    physics._setBallState(hoop.x + 14, hoop.y - 5, 0, 100);

    physics.update(0.08);

    expect(physics.getLastCollision()).toBe('backboard');
    expect(physics.getScore()).toBe(0);
  });

  it('篮板反弹后从右向左回穿篮圈仍能判定为进球', () => {
    const bankShot = new BallPhysics({
      canvasWidth: 1280,
      canvasHeight: 720,
      hoopX: 1030,
      hoopY: 226,
      gravity: 430,
      chargeRate: 65,
      hoopRangeMin: 0.3,
      hoopRangeMax: 0.3,
      scoreThreshold: 12,
      scoreWindowHalfWidth: 12,
      shotModel: 'sideview',
      hoopMotionEnabled: false,
      ballStartX: 320,
      ballStartY: 580,
    });

    // 这条路线先撞到篮板，再在篮圈高度附近从右向左回穿中心线。
    bankShot._setBallState(320, 580, 408, -586);
    let touchedBackboard = false;
    let scored = false;

    for (let frame = 0; frame < 360 && bankShot.isBallFlying(); frame += 1) {
      bankShot.update(1 / 120);
      touchedBackboard ||= bankShot.getLastCollision() === 'backboard';
      if (bankShot.consumeScoreEvent()) {
        scored = true;
        break;
      }
    }

    expect(touchedBackboard).toBe(true);
    expect(scored).toBe(true);
    expect(bankShot.getScore()).toBe(1);
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

  it('保存并恢复投篮中的球、篮筐、得分和计时状态', () => {
    physics.charge(0.6);
    physics.throwBall({ velocity: { vx: 520, vy: -280 } });
    physics.updateHoop(0.4);
    physics.update(0.12);
    physics.tickTimer(3.5);
    physics._addScore(2);

    const snapshot = physics.getSaveState();
    const restored = new BallPhysics({
      canvasWidth: 1280,
      canvasHeight: 720,
      hoopX: 1000,
      gravity: 430,
      chargeRate: 65,
      hoopRangeMin: 0.10,
      hoopRangeMax: 0.34,
      scoreThreshold: 36,
    });

    restored.restoreSaveState(snapshot);

    expect(restored.getSaveState()).toEqual(snapshot);
  });

  // ==================== 2D 侧视投篮模型 ====================

  it('侧视模型预测上下移动的篮筐，并让不同蓄力都瞄准拦截点', () => {
    const sideview = new BallPhysics({
      canvasWidth: 1280,
      canvasHeight: 720,
      hoopX: 1000,
      gravity: 430,
      chargeRate: 65,
      hoopRangeMin: 0.10,
      hoopRangeMax: 0.34,
      scoreThreshold: 12,
      scoreWindowHalfWidth: 12,
      shotModel: 'sideview',
      hoopMotionEnabled: true,
      ballStartX: 320,
      ballStartY: 580,
    });

    const target = sideview.getHoopPosition();
    const lowPower = sideview.getLaunchVelocity(20);
    const highPower = sideview.getLaunchVelocity(90);

    expect(sideview.getShotModel()).toBe('sideview');
    expect(sideview.isHoopMotionEnabled()).toBe(true);
    expect(lowPower.vx).toBeLessThan(highPower.vx);
    expect(lowPower.vy).toBeLessThan(highPower.vy);

    sideview.updateHoop(1);
    expect(sideview.getHoopPosition()).not.toEqual(target);

    [20, 60, 90].forEach((power) => {
      const shot = new BallPhysics({
        canvasWidth: 1280,
        canvasHeight: 720,
        hoopX: 1000,
        gravity: 430,
        chargeRate: 65,
        hoopRangeMin: 0.10,
        hoopRangeMax: 0.34,
        scoreThreshold: 12,
        scoreWindowHalfWidth: 12,
        shotModel: 'sideview',
        hoopMotionEnabled: true,
        ballStartX: 320,
        ballStartY: 580,
      });
      shot.charge(power / 65);
      const preview = shot.getTrajectoryPreview({ power, duration: 2.2, step: 0.05 });
      const velocity = shot.throwBall();

      expect(velocity).toEqual(preview.velocity);
      for (let elapsed = 0; elapsed < 3 && shot.isBallFlying(); elapsed += 1 / 60) {
        shot.updateHoop(1 / 60);
        shot.update(1 / 60);
      }
      expect(shot.getScore()).toBe(1);
    });
  });

  it('侧视篮筐在上下边界连续往返时，穿过有效开口不会被边框碰撞改判', () => {
    const sideview = new BallPhysics({
      canvasWidth: 1280,
      canvasHeight: 720,
      hoopX: 1000,
      gravity: 430,
      chargeRate: 65,
      hoopRangeMin: 0.10,
      hoopRangeMax: 0.34,
      scoreThreshold: 12,
      scoreWindowHalfWidth: 12,
      shotModel: 'sideview',
      hoopMotionEnabled: true,
      ballStartX: 320,
      ballStartY: 580,
    });

    const shootAndConsume = () => {
      sideview.charge(1);
      sideview.throwBall();
      let scored = false;
      for (let frame = 0; frame < 240 && sideview.isBallFlying(); frame += 1) {
        sideview.updateHoop(1 / 60);
        sideview.update(1 / 60);
        if (sideview.consumeScoreEvent()) {
          scored = true;
          break;
        }
      }
      sideview.resetBall();
      return scored;
    };

    // 大步更新先把目标推到上边界，再推到下边界，覆盖两端的拐返状态。
    sideview.updateHoop(10);
    expect(shootAndConsume()).toBe(true);
    sideview.updateHoop(10);
    expect(shootAndConsume()).toBe(true);
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
