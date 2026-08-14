import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BasketballScene } from '../../src/scenes/BasketballScene.js';
import { EventBus } from '../../src/core/EventBus.js';
import { EVENT } from '../../src/config.js';

describe('BasketballScene 失败后的正式剧情出口', () => {
  let scene;
  let container;
  let eventBus;
  let badgeSystem;
  let sceneManager;
  let goalBurstEffect;

  beforeEach(() => {
    eventBus = new EventBus();
    container = document.createElement('div');
    document.body.appendChild(container);
    badgeSystem = { unlockOrReveal: vi.fn() };
    sceneManager = { change: vi.fn() };
    goalBurstEffect = {
      play: vi.fn(),
      update: vi.fn(),
      draw: vi.fn(),
      clear: vi.fn(),
    };

    scene = new BasketballScene({
      sceneManager,
      eventBus,
      badgeSystem,
      dialogueRunner: {},
      dialogueBox: {
        show: vi.fn(),
        hide: vi.fn(),
        update: vi.fn(),
      },
      input: {},
      container,
      goalBurstEffect,
    });

    scene._createPhysics();
    scene.phase = 'playing';
    scene.physics.tickTimer(60);
    scene._onGameFailed();
  });

  afterEach(() => {
    scene.onExit();
    if (container.parentNode) {
      container.parentNode.removeChild(container);
    }
  });

  it('未进 5 球时仍可领取篮球纪念并进入章节抉择', () => {
    const chapterComplete = vi.fn();
    eventBus.on(EVENT.CHAPTER_COMPLETE, chapterComplete);

    const souvenirButton = container.querySelector('[data-souvenir-continue]');
    expect(souvenirButton).not.toBeNull();
    expect(souvenirButton.textContent).toBe('收下纪念，继续剧情');
    expect(container.querySelector('[data-retry-button]')).not.toBeNull();

    souvenirButton.click();

    expect(badgeSystem.unlockOrReveal).toHaveBeenCalledWith('basketball');
    expect(chapterComplete).toHaveBeenCalledWith({ chapter: 'ch1' });
    expect(scene.phase).toBe('choice');
    expect(container.querySelector('[data-retry-overlay]')).toBeNull();
    expect(container.querySelector('[data-choice-overlay]')).not.toBeNull();
  });

  it('仍可选择再来一局，且不会提前发放纪念', () => {
    container.querySelector('[data-retry-button]').click();

    expect(badgeSystem.unlockOrReveal).not.toHaveBeenCalled();
    expect(scene.phase).toBe('playing');
    expect(container.querySelector('[data-retry-overlay]')).toBeNull();
    expect(container.querySelector('[data-charge-meter]')).not.toBeNull();
  });

  it('在抉择阶段再次保存时仍保留投篮物理进度', () => {
    scene._removeRetryOverlay();
    const checkpoint = scene.getSaveState();
    checkpoint.phase = 'choice';
    checkpoint.physics.score = 3;
    checkpoint.physics.ball = { x: 456, y: 321, vx: 12, vy: -4 };

    scene._restoreSaveState(checkpoint);

    expect(scene.phase).toBe('choice');
    expect(scene.physics.getScore()).toBe(3);
    expect(scene.physics.getBallPosition()).toEqual({ x: 456, y: 321 });
  });

  it('篮球穿过篮圈时立即反馈并复位，不等待落地', () => {
    scene._removeRetryOverlay();
    scene._createPhysics();
    scene.phase = 'playing';
    scene.transitioning = false;
    scene.chargeMeter = { update: vi.fn(), destroy: vi.fn() };

    const hoop = scene.physics.getHoopPosition();
    scene.physics._setBallState(hoop.x, hoop.y - 5, 0, 100);
    scene.ballWasFlying = true;

    scene._updatePlaying(0.08);

    expect(scene.physics.getScore()).toBe(1);
    expect(scene.feedbackTimer).toBeGreaterThan(0);
    // 第一章使用正式背景右侧篮架，投掷点由场景坐标配置为 320×580。
    expect(scene.physics.getBallPosition()).toEqual({ x: 320, y: 580 });
    expect(scene.ballWasFlying).toBe(false);
  });

  it('进球事件只走一次计数，并同步刷新俯视目标进度', () => {
    scene._removeRetryOverlay();
    scene._createPhysics();
    scene.phase = 'playing';
    scene.transitioning = false;
    scene.topdown = { setProgress: vi.fn(), destroy: vi.fn() };
    scene.chargeMeter = { update: vi.fn(), destroy: vi.fn() };

    const hoop = scene.physics.getHoopPosition();
    scene.physics._setBallState(hoop.x, hoop.y - 5, 0, 100);
    scene._updatePlaying(0.08);

    expect(scene.physics.getScore()).toBe(1);
    expect(scene.topdown.setProgress).toHaveBeenLastCalledWith('挑战目标：进球 1 / 5');

    // 进球后的复位球已经不在飞行中，再更新一帧不能重复增加计数。
    scene._updatePlaying(0.08);
    expect(scene.physics.getScore()).toBe(1);
  });

  it('有效进球只启动一次正式光效，并使用切关前的旧篮筐坐标', () => {
    scene._removeRetryOverlay();
    scene._createPhysics();
    scene.phase = 'playing';
    scene.blumgiMode = true;
    scene.transitioning = false;
    scene._configureBlumgiLevel(0);
    scene.chargeMeter = { update: vi.fn(), destroy: vi.fn() };

    const scoredHoop = { ...scene.physics.getHoopPosition() };
    scene.physics._setBallState(scoredHoop.x, scoredHoop.y - 5, 0, 100);
    scene.ballWasFlying = true;

    scene._updatePlaying(0.08);
    scene._onBallScored();

    expect(goalBurstEffect.play).toHaveBeenCalledTimes(1);
    expect(goalBurstEffect.play).toHaveBeenCalledWith({
      x: scoredHoop.x,
      y: scoredHoop.y,
      enhanced: false,
    });
    expect(scene.physics.getHoopPosition()).not.toEqual(scoredHoop);
    expect(scene.physics.getScore()).toBe(1);
  });

  it('投失不启动正式进球光效', () => {
    scene._removeRetryOverlay();
    scene._createPhysics();
    scene.phase = 'playing';
    scene.transitioning = false;
    scene.chargeMeter = { update: vi.fn(), destroy: vi.fn() };

    scene._onBallLanded();

    expect(goalBurstEffect.play).not.toHaveBeenCalled();
    expect(scene.physics.getScore()).toBe(0);
  });

  it('第 5 球只增加一次得分并启动 1.2 倍增强光效', () => {
    scene._removeRetryOverlay();
    scene._createPhysics();
    scene.phase = 'playing';
    scene.blumgiMode = true;
    scene.transitioning = false;
    scene._configureBlumgiLevel(0);
    scene.chargeMeter = { update: vi.fn(), destroy: vi.fn() };

    for (let score = 0; score < 4; score += 1) {
      const hoop = scene.physics.getHoopPosition();
      scene.physics._setBallState(hoop.x, hoop.y - 5, 0, 100);
      scene.ballWasFlying = true;
      scene._updatePlaying(0.08);
    }

    const finalHoop = { ...scene.physics.getHoopPosition() };
    scene.physics._setBallState(finalHoop.x, finalHoop.y - 5, 0, 100);
    scene.ballWasFlying = true;
    scene._updatePlaying(0.08);

    expect(scene.physics.getScore()).toBe(5);
    expect(goalBurstEffect.play).toHaveBeenCalledTimes(5);
    expect(goalBurstEffect.play).toHaveBeenLastCalledWith({
      x: finalHoop.x,
      y: finalHoop.y,
      enhanced: true,
    });

    scene._onBallScored();
    expect(scene.physics.getScore()).toBe(5);
    expect(goalBurstEffect.play).toHaveBeenCalledTimes(5);
  });

  it('onExit 清理正在播放的正式光效状态', () => {
    goalBurstEffect.play({ x: 1030, y: 226 });

    scene.onExit();

    expect(goalBurstEffect.clear).toHaveBeenCalledTimes(1);
    expect(scene.goalBurstEffect).toBeNull();
  });

  it('出手时启动莞小鹅投球序列帧', () => {
    const gooseSprite = { playAction: vi.fn() };
    const actionScene = new BasketballScene({
      sceneManager,
      eventBus,
      badgeSystem,
      dialogueRunner: {},
      dialogueBox: { show: vi.fn(), hide: vi.fn(), update: vi.fn() },
      input: {},
      container,
      gooseSprite,
    });
    actionScene._createPhysics();
    actionScene.phase = 'playing';
    actionScene.isCharging = true;

    actionScene._onChargeRelease();

    expect(gooseSprite.playAction).toHaveBeenCalledWith('throw', {
      facing: 1,
      restart: true,
      resetCoreFrame: true,
    });
    actionScene.onExit();
  });

  it('从篮球拖拽瞄准并松手时，使用拖拽向量发射而不是旧版固定初速', () => {
    const canvas = document.createElement('canvas');
    Object.defineProperty(canvas, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 1280, height: 720 }),
    });
    scene.canvas = canvas;
    scene._createPhysics();
    scene.phase = 'playing';
    scene.chargeMeter = { update: vi.fn(), destroy: vi.fn() };

    const preventDefault = vi.fn();
    scene._onCanvasPointerDown({
      pointerId: 9,
      clientX: 320,
      clientY: 580,
      preventDefault,
    });
    scene._onCanvasPointerMove({
      pointerId: 9,
      clientX: 420,
      clientY: 430,
      preventDefault,
    });
    const expected = { ...scene.aimVelocity };

    expect(scene.isAiming).toBe(true);
    expect(expected.vx).toBeGreaterThan(0);
    expect(expected.vy).toBeLessThan(0);

    scene._onCanvasPointerUp({
      pointerId: 9,
      clientX: 420,
      clientY: 430,
      preventDefault,
    });

    expect(scene.isAiming).toBe(false);
    expect(scene.physics.isBallFlying()).toBe(true);
    expect(scene.physics.getBallVelocity().vx).toBeCloseTo(expected.vx, 5);
    expect(scene.physics.getBallVelocity().vy).toBeCloseTo(expected.vy, 5);
    expect(preventDefault).toHaveBeenCalled();
  });

  it('投篮阶段收起通用动作键，避免一键走预设路线', () => {
    const action = document.createElement('button');
    action.setAttribute('data-joystick-interact', '');
    action.textContent = '互动';
    container.appendChild(action);
    const actionScene = new BasketballScene({
      sceneManager,
      eventBus,
      badgeSystem,
      dialogueRunner: {},
      dialogueBox: { show: vi.fn(), hide: vi.fn(), update: vi.fn() },
      input: { onAction: vi.fn(), offAction: vi.fn() },
      container,
    });

    actionScene._setMobileActionVisible(false);
    expect(action.hidden).toBe(true);
    expect(action.disabled).toBe(true);
    expect(action.hasAttribute('data-joystick-action-suppressed')).toBe(true);

    actionScene._setMobileActionVisible(true);
    expect(action.hidden).toBe(false);
    expect(action.disabled).toBe(false);
    expect(action.hasAttribute('data-joystick-action-suppressed')).toBe(false);
  });

  it('触屏从篮球附近而非精确中心按下也能进入瞄准', () => {
    const canvas = document.createElement('canvas');
    Object.defineProperty(canvas, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 1280, height: 720 }),
    });
    scene.canvas = canvas;
    scene._createPhysics();
    scene.phase = 'playing';

    scene._onCanvasPointerDown({
      pointerId: 12,
      clientX: 370,
      clientY: 580,
      preventDefault: vi.fn(),
    });

    expect(scene.isAiming).toBe(true);
    scene.onExit();
  });

  it('Blumgi 风格投失落地后自动回到当前小关卡起点', () => {
    scene._removeRetryOverlay();
    scene._createPhysics();
    scene.phase = 'playing';
    scene.blumgiMode = true;
    scene.transitioning = false;
    scene._configureBlumgiLevel(0);
    scene.chargeMeter = { update: vi.fn(), destroy: vi.fn() };

    expect(scene.physics.isHoopMotionEnabled()).toBe(false);
    expect(scene.physics.getPlatforms().length).toBeGreaterThan(1);
    expect(scene.physics.getHoopPosition()).toEqual({ x: 1030, y: 226 });
    expect(scene.physics.getScoreWindow().halfWidth).toBe(17);

    // 从场内另一处的地面接触开始，验证“停止飞行”分支也会触发复位。
    scene.physics._setBallState(720, 606, 0, 0);
    scene.ballWasFlying = true;
    scene._updatePlaying(0.01);
    scene._updatePlaying(0.01);

    expect(scene.physics.getBallPosition()).toEqual({ x: 320, y: 580 });
    expect(scene.physics.isBallFlying()).toBe(false);
    expect(scene.feedbackTimer).toBeGreaterThan(0);
  });

  it('Blumgi 风格进球后切换下一关布局而不是把篮球强制送回第一关', () => {
    scene.phase = 'playing';
    scene.blumgiMode = true;
    scene._createPhysics();
    scene._configureBlumgiLevel(0);
    scene.chargeMeter = { update: vi.fn(), destroy: vi.fn() };

    const hoop = scene.physics.getHoopPosition();
    scene.physics._setBallState(hoop.x, hoop.y - 5, 0, 100);
    scene.ballWasFlying = true;
    scene._updatePlaying(0.08);

    expect(scene.physics.getScore()).toBe(1);
    expect(scene.blumgiLevelIndex).toBe(1);
    expect(scene.physics.getBallPosition()).toEqual({ x: 260, y: 560 });
    expect(scene.physics.getHoopPosition()).toEqual({ x: 1080, y: 350 });
  });

  it('使用上下移动的侧视篮架位置绘制篮筐，绘制与判定保持同步', () => {
    scene._createPhysics();
    scene.phase = 'playing';
    const initialHoop = scene.physics.getHoopPosition();
    scene.physics.updateHoop(1);
    const hoop = scene.physics.getHoopPosition();
    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      scale: vi.fn(),
      drawImage: vi.fn(),
      fillRect: vi.fn(),
      beginPath: vi.fn(),
      ellipse: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
    };
    const hoopImage = { width: 384, height: 384 };
    scene.objectImages = new Map([['hoop', hoopImage]]);

    scene._drawHoop(ctx);

    expect(scene.physics.getShotModel()).toBe('sideview');
    expect(scene.physics.isHoopMotionEnabled()).toBe(true);
    expect(Math.abs(hoop.y - initialHoop.y)).toBeGreaterThan(20);
    expect(ctx.translate).toHaveBeenCalledWith(hoop.x, hoop.y + 190);
    expect(ctx.drawImage).toHaveBeenCalledWith(hoopImage, -77, -282, 154, 282);
    expect(ctx.fillRect).not.toHaveBeenCalled();
    expect(ctx.ellipse).not.toHaveBeenCalled();
    expect(ctx.lineTo).not.toHaveBeenCalled();
  });
});
