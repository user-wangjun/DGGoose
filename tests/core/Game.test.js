import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Game } from '../../src/core/Game.js';

/** 创建桩场景，带 update/draw 间谍 */
function createStubScene() {
  return {
    update: vi.fn(),
    draw: vi.fn(),
    onEnter: vi.fn(),
    onExit: vi.fn(),
  };
}

describe('Game 主循环', () => {
  let rafSpy;
  let cancelRafSpy;
  let perfSpy;
  let rafCallbacks;

  beforeEach(() => {
    rafCallbacks = [];
    rafSpy = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((fn) => {
      rafCallbacks.push(fn);
      return rafCallbacks.length;
    });
    cancelRafSpy = vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => {});
    perfSpy = vi.spyOn(globalThis.performance, 'now');
  });

  afterEach(() => {
    rafSpy.mockRestore();
    cancelRafSpy.mockRestore();
    perfSpy.mockRestore();
  });

  it('start() 后启动主循环并调用场景 update 与 draw', () => {
    perfSpy.mockReturnValue(1000);
    const game = new Game({});
    const scene = createStubScene();
    game.setScene(scene);

    game.start();
    expect(rafCallbacks.length).toBe(1);

    // 模拟一帧（16ms 后）
    rafCallbacks[0](1016);

    expect(scene.update).toHaveBeenCalledTimes(1);
    expect(scene.update).toHaveBeenCalledWith(0.016);
    expect(scene.draw).toHaveBeenCalledTimes(1);
  });

  it('deltaTime 钳制到 0.05s，防止切后台后大跳跃', () => {
    perfSpy.mockReturnValue(1000);
    const game = new Game({});
    const scene = createStubScene();
    game.setScene(scene);

    game.start();
    // 模拟长时间间隔（切后台 5 秒后恢复）
    rafCallbacks[0](6000);

    expect(scene.update).toHaveBeenCalledWith(0.05);
  });

  it('stop() 后停止主循环，不再调用 update', () => {
    perfSpy.mockReturnValue(1000);
    const game = new Game({});
    const scene = createStubScene();
    game.setScene(scene);

    game.start();
    rafCallbacks[0](1016);

    game.stop();
    expect(cancelRafSpy).toHaveBeenCalled();

    const updateCount = scene.update.mock.calls.length;
    // 再触发一帧，running 已为 false，不应调用 update
    if (rafCallbacks.length > 1) {
      rafCallbacks[1](1032);
    }
    expect(scene.update.mock.calls.length).toBe(updateCount);
  });

  it('无场景时不报错', () => {
    perfSpy.mockReturnValue(1000);
    const game = new Game({});

    game.start();
    expect(() => rafCallbacks[0](1016)).not.toThrow();
    game.stop();
  });

  it('setScene 设置当前场景', () => {
    const game = new Game({});
    const scene = createStubScene();

    game.setScene(scene);
    // 通过 update 间接验证场景已设置
    game.update(0.016);
    expect(scene.update).toHaveBeenCalledWith(0.016);
  });
});
