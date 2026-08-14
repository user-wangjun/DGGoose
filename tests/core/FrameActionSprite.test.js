import { describe, expect, it } from 'vitest';
import { FrameActionSprite } from '../../src/core/FrameActionSprite.js';

function createSpecs() {
  return {
    idle: {
      src: 'idle.png',
      config: {
        atlas: { frameW: 32, frameH: 32, columns: 4, rows: 1 },
        animations: { idle: { row: 0, frames: 4, fps: 6, loop: true } },
      },
    },
    action: {
      src: 'action.png',
      config: {
        atlas: { frameW: 32, frameH: 32, columns: 3, rows: 1 },
        animations: { action: { row: 0, frames: 3, fps: 10, loop: false } },
      },
    },
    run: {
      src: 'run.png',
      config: {
        atlas: { frameW: 32, frameH: 32, columns: 4, rows: 1 },
        animations: {
          run: {
            row: 0,
            frames: 4,
            fps: 4,
            loop: true,
            motion: { bob: 4, sway: 2, tilt: 0.04, squash: 0.025 },
          },
        },
      },
    },
  };
}

describe('FrameActionSprite', () => {
  it('plays an independent action and returns to the core state', () => {
    const sprite = new FrameActionSprite({ specs: createSpecs(), defaultState: 'idle' });

    expect(sprite.playAction('action')).toBe(true);
    sprite.update(0.12, 'idle', 1);
    expect(sprite.currentAction).toBe('action');
    expect(sprite.animations.get('action').frameIndex).toBe(1);

    sprite.update(0.2, 'idle', 1);
    expect(sprite.currentAction).toBeNull();
    expect(sprite.currentState).toBe('idle');
  });

  it('can hold the final action frame until the scene clears it', () => {
    const sprite = new FrameActionSprite({ specs: createSpecs(), defaultState: 'idle' });

    sprite.playAction('action', { hold: true });
    sprite.update(0.4, 'idle', 1);
    expect(sprite.isActionActive('action')).toBe(true);
    expect(sprite.actionFinished).toBe(true);

    sprite.clearAction();
    expect(sprite.isActionActive()).toBe(false);
  });

  it('can return to the core state initial frame after a temporary action', () => {
    const sprite = new FrameActionSprite({ specs: createSpecs(), defaultState: 'idle' });

    // 先把待机动画推进到非初始帧，确保后面的回到初始帧不是默认状态残留。
    sprite.update(0.2, 'idle', 1);
    expect(sprite.animations.get('idle').frameIndex).not.toBe(0);

    sprite.playAction('action', { resetCoreFrame: true, restart: true });
    sprite.update(0.31, 'idle', 1);

    expect(sprite.currentAction).toBeNull();
    expect(sprite.currentState).toBe('idle');
    expect(sprite.animations.get('idle').frameIndex).toBe(0);

    // 下一次出手仍从投球动作第 0 帧开始。
    sprite.playAction('action', { resetCoreFrame: true, restart: true });
    expect(sprite.animations.get('action').frameIndex).toBe(0);
  });

  it('applies visible run motion while the run atlas advances frames', () => {
    const sprite = new FrameActionSprite({ specs: createSpecs(), defaultState: 'idle' });
    sprite.images.set('run', {});
    const translations = [];
    const sourceFrames = [];
    const ctx = {
      globalAlpha: 1,
      save() {},
      restore() {},
      translate: (...args) => translations.push(args),
      rotate() {},
      scale() {},
      drawImage: (...args) => sourceFrames.push(args.slice(1, 5)),
    };

    sprite.update(0, 'run', 1);
    sprite.draw(ctx, 100, 200);
    sprite.update(0.25, 'run', 1);
    sprite.draw(ctx, 100, 200);

    expect(sprite.animations.get('run').frameIndex).toBe(1);
    expect(sourceFrames[0][0]).not.toBe(sourceFrames[1][0]);
    expect(translations[0]).not.toEqual(translations[1]);
  });
});
