import { describe, expect, it, vi } from 'vitest';
import { SongshanScene } from '../../src/scenes/SongshanScene.js';

function createScene() {
  return new SongshanScene({
    sceneManager: { change: vi.fn() },
    eventBus: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
    badgeSystem: { unlockOrReveal: vi.fn() },
    dialogueRunner: null,
    dialogueBox: { show: vi.fn(), hide: vi.fn(), update: vi.fn() },
    input: null,
    container: null,
    getChoice: () => null,
  });
}

function createObjectContext() {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    scale: vi.fn(),
    drawImage: vi.fn(),
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    arc: vi.fn(),
  };
}

describe('终章·松山湖正式物件层', () => {
  it('把长椅放入鹅之后的前景裁切层，保持坐姿而不遮住整只角色', () => {
    const scene = createScene();
    const images = {
      bench: { id: 'bench' },
      lakesideDecor: { id: 'lakeside-decor' },
    };
    scene.objectImages = new Map(Object.entries(images));
    const ctx = createObjectContext();

    scene._drawSongshanObjects(ctx);
    const objectCalls = ctx.drawImage.mock.calls;
    expect(objectCalls.map(([image]) => image)).toEqual([
      images.bench,
      images.lakesideDecor,
      images.lakesideDecor,
    ]);

    scene._drawSongshanForeground(ctx);
    const foregroundCall = ctx.drawImage.mock.calls.at(-1);
    expect(foregroundCall.slice(0, 5)).toEqual([images.bench, 0, 188, 384, 168]);
    expect(foregroundCall[7]).toBeGreaterThan(0);
  });

  it('余烬使用短火花线，不再绘制圆形粒子', () => {
    const scene = createScene();
    scene.particles = [{ x: 40, y: 60, size: 2, life: 1, maxLife: 2 }];
    const ctx = createObjectContext();

    scene._drawParticles(ctx);

    expect(ctx.stroke).toHaveBeenCalled();
    expect(ctx.arc).not.toHaveBeenCalled();
  });
});
