import { describe, expect, it, vi } from 'vitest';
import {
  TopdownController,
  circleOverlapsRect,
  findNearbyInteractable,
  resolveTopdownMovement,
} from '../../src/core/TopdownController.js';

describe('俯视场景共享控制器', () => {
  it('只从可用目标中选择范围内最近的互动对象', () => {
    const target = findNearbyInteractable(
      { x: 100, y: 100 },
      [
        { id: 'far', x: 180, y: 100, radius: 100, label: '远处' },
        { id: 'near', x: 125, y: 100, radius: 50, label: '近处' },
        { id: 'disabled', x: 105, y: 100, radius: 50, available: false, label: '不可用' },
      ],
    );

    expect(target?.id).toBe('near');
  });

  it('可用条件为函数时按当前状态重新判断', () => {
    const state = { ready: false };
    const targets = [{ id: 'exit', x: 100, y: 100, radius: 50, available: () => state.ready }];

    expect(findNearbyInteractable({ x: 100, y: 100 }, targets)).toBeNull();
    state.ready = true;
    expect(findNearbyInteractable({ x: 100, y: 100 }, targets)?.id).toBe('exit');
  });

  it('局部更新碰撞层时保留互动目标和角色碰撞半径', () => {
    const target = { id: 'exit', x: 100, y: 100, radius: 50, label: '出口' };
    const controller = new TopdownController({
      player: { x: 100, y: 100, position: { x: 100, y: 100 } },
      input: { getVector: () => ({ x: 0, y: 0, run: false }) },
    });

    controller.setMap({
      obstacles: [{ id: 'closed-gate', x: 80, y: 80, width: 20, height: 20 }],
      interactables: [target],
      playerRadius: 16,
    });
    controller.setMap({ obstacles: [] });

    expect(controller.interactables).toEqual([target]);
    expect(controller.playerRadius).toBe(16);
  });

  it('移动经过障碍物时保留可行轴，不穿过矩形碰撞层', () => {
    const next = resolveTopdownMovement(
      { x: 100, y: 150 },
      { x: 220, y: 230 },
      {
        bounds: { left: 24, top: 80, right: 1256, bottom: 680 },
        obstacles: [{ x: 160, y: 120, width: 80, height: 80 }],
        radius: 18,
      },
    );

    expect(circleOverlapsRect(next, { x: 160, y: 120, width: 80, height: 80 }, 18)).toBe(false);
    expect(next.y).toBeGreaterThan(200);
  });

  it('锁定移动时不推进角色位置，并且互动按钮不触发目标', () => {
    const player = {
      x: 100,
      y: 100,
      position: { x: 100, y: 100 },
      update: vi.fn(),
      setPosition: vi.fn(),
    };
    const input = { getVector: () => ({ x: 1, y: 0, run: false }) };
    const onInteract = vi.fn();
    const controller = new TopdownController({
      player,
      input,
      container: document.createElement('div'),
      onInteract,
    });
    controller.setMap({
      interactables: [{ id: 'npc', x: 100, y: 100, radius: 60, label: '交谈' }],
    });
    controller.setMovementLocked(true);
    controller.update(0.1);

    expect(player.update).toHaveBeenCalled();
    expect(player.setPosition).not.toHaveBeenCalled();
    expect(controller.handleInteract()).toBe(false);
    expect(onInteract).not.toHaveBeenCalled();
  });

  it('隐藏标记的物件只在当前互动目标附近显示文字', () => {
    const player = { x: 100, y: 100, position: { x: 100, y: 100 } };
    const controller = new TopdownController({
      player,
      input: { getVector: () => ({ x: 0, y: 0, run: false }) },
    });
    const farTarget = {
      id: 'far-tree',
      x: 300,
      y: 100,
      radius: 50,
      hideMarker: true,
      markerLabel: '远处树',
    };
    const activeTarget = {
      id: 'near-tree',
      x: 100,
      y: 100,
      radius: 50,
      hideMarker: true,
      markerLabel: '当前树',
    };
    controller.setMap({ interactables: [farTarget, activeTarget] });
    controller.setInteractionEnabled(true);

    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      fillText: vi.fn(),
    };
    controller.drawInteractables(ctx);

    expect(ctx.fillText).toHaveBeenCalledTimes(1);
    expect(ctx.fillText).toHaveBeenCalledWith('当前树', 100, expect.any(Number));
  });

  it('正式互动标记只显示文字，不绘制范围圆圈', () => {
    const controller = new TopdownController({
      player: { x: 100, y: 100, position: { x: 100, y: 100 } },
      input: { getVector: () => ({ x: 0, y: 0, run: false }) },
    });
    controller.setMap({
      interactables: [{ id: 'sign', x: 100, y: 100, radius: 68, markerLabel: '顺序提示' }],
    });
    controller.setInteractionEnabled(true);

    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      fillText: vi.fn(),
      beginPath: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
    };
    controller.drawInteractables(ctx);

    expect(ctx.fillText).toHaveBeenCalledWith('顺序提示', 100, expect.any(Number));
    expect(ctx.arc).not.toHaveBeenCalled();
    expect(ctx.fill).not.toHaveBeenCalled();
    expect(ctx.stroke).not.toHaveBeenCalled();
  });

  it('俯视 HUD 与 16:9 游戏画框对齐，不占用画框外黑边', () => {
    const container = document.createElement('div');
    const canvas = document.createElement('canvas');
    const controller = new TopdownController({
      player: { x: 100, y: 100, position: { x: 100, y: 100 } },
      input: { getVector: () => ({ x: 0, y: 0, run: false }) },
      container,
      canvas,
    });

    controller.mount();

    expect(controller.domRoot.style.position).toBe('fixed');
    expect(controller.domRoot.style.top).toBe('50%');
    expect(controller.domRoot.style.left).toBe('50%');
    expect(controller.domRoot.style.width).toBe('var(--gxe-game-frame-width)');
    expect(controller.domRoot.style.height).toBe('var(--gxe-game-frame-height)');
    expect(controller.domRoot.style.transform).toBe('translate(-50%, -50%)');

    controller.destroy();
  });
});
