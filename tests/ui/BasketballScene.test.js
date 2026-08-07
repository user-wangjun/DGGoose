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

  beforeEach(() => {
    eventBus = new EventBus();
    container = document.createElement('div');
    document.body.appendChild(container);
    badgeSystem = { unlock: vi.fn() };
    sceneManager = { change: vi.fn() };

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

    expect(badgeSystem.unlock).toHaveBeenCalledWith('basketball');
    expect(chapterComplete).toHaveBeenCalledWith({ chapter: 'ch1' });
    expect(scene.phase).toBe('choice');
    expect(container.querySelector('[data-retry-overlay]')).toBeNull();
    expect(container.querySelector('[data-choice-overlay]')).not.toBeNull();
  });

  it('仍可选择再来一局，且不会提前发放纪念', () => {
    container.querySelector('[data-retry-button]').click();

    expect(badgeSystem.unlock).not.toHaveBeenCalled();
    expect(scene.phase).toBe('playing');
    expect(container.querySelector('[data-retry-overlay]')).toBeNull();
    expect(container.querySelector('[data-charge-meter]')).not.toBeNull();
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
    expect(scene.physics.getBallPosition()).toEqual({ x: 120, y: 580 });
    expect(scene.ballWasFlying).toBe(false);
  });
});
