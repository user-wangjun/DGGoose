import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PlayerController } from '../../src/core/PlayerController.js';
import { GAME } from '../../src/config.js';
import { TopdownController } from '../../src/core/TopdownController.js';

/**
 * PlayerController 测试套件
 * 对应 PRD §6.2 + Task 1.5：输入向量→位移，边界钳制，朝向翻转，动画状态联动
 */

/** 创建桩 InputManager，可预设向量 */
function createStubInput(vector) {
  return {
    getVector: vi.fn(() => ({ ...vector })),
  };
}

describe('PlayerController 角色控制', () => {
  let controller;

  beforeEach(() => {
    controller = new PlayerController({
      x: GAME.WIDTH / 2,
      y: GAME.HEIGHT / 2,
      bounds: { width: GAME.WIDTH, height: GAME.HEIGHT },
    });
  });

  describe('位移与速度', () => {
    it('输入零向量 → 位置不变', () => {
      const input = createStubInput({ x: 0, y: 0, run: false });
      controller.update(0.016, input);
      expect(controller.x).toBe(GAME.WIDTH / 2);
      expect(controller.y).toBe(GAME.HEIGHT / 2);
    });

    it('向右输入 → X 增加（walk 速度 150px/s）', () => {
      const input = createStubInput({ x: 1, y: 0, run: false });
      controller.update(1.0, input);
      expect(controller.x).toBe(GAME.WIDTH / 2 + 150);
    });

    it('向上输入 → Y 减少（屏幕坐标系 Y 向下为正）', () => {
      const input = createStubInput({ x: 0, y: -1, run: false });
      controller.update(1.0, input);
      expect(controller.y).toBe(GAME.HEIGHT / 2 - 150);
    });

    it('run=true → 使用奔跑速度 260px/s', () => {
      const input = createStubInput({ x: 1, y: 0, run: true });
      controller.update(1.0, input);
      expect(controller.x).toBe(GAME.WIDTH / 2 + 260);
    });

    it('对角线输入 → 位移分量正确', () => {
      const input = createStubInput({ x: Math.SQRT1_2, y: Math.SQRT1_2, run: false });
      controller.update(1.0, input);
      expect(controller.x).toBeCloseTo(GAME.WIDTH / 2 + 150 * Math.SQRT1_2, 2);
      expect(controller.y).toBeCloseTo(GAME.HEIGHT / 2 + 150 * Math.SQRT1_2, 2);
    });
  });

  describe('边界钳制', () => {
    it('移动超出右边界 → 钳制到画布宽度', () => {
      controller.setPosition(GAME.WIDTH - 10, GAME.HEIGHT / 2);
      const input = createStubInput({ x: 1, y: 0, run: false });
      controller.update(1.0, input);
      expect(controller.x).toBeLessThanOrEqual(GAME.WIDTH);
      expect(controller.x).toBe(GAME.WIDTH);
    });

    it('移动超出左边界 → 钳制到 0', () => {
      controller.setPosition(10, GAME.HEIGHT / 2);
      const input = createStubInput({ x: -1, y: 0, run: false });
      controller.update(1.0, input);
      expect(controller.x).toBe(0);
    });

    it('移动超出下边界 → 钳制到画布高度', () => {
      controller.setPosition(GAME.WIDTH / 2, GAME.HEIGHT - 10);
      const input = createStubInput({ x: 0, y: 1, run: false });
      controller.update(1.0, input);
      expect(controller.y).toBe(GAME.HEIGHT);
    });

    it('移动超出上边界 → 钳制到 0', () => {
      controller.setPosition(GAME.WIDTH / 2, 10);
      const input = createStubInput({ x: 0, y: -1, run: false });
      controller.update(1.0, input);
      expect(controller.y).toBe(0);
    });
  });

  describe('朝向', () => {
    it('向右移动 → facing = 1', () => {
      const input = createStubInput({ x: 1, y: 0, run: false });
      controller.update(0.016, input);
      expect(controller.facing).toBe(1);
    });

    it('向左移动 → facing = -1', () => {
      const input = createStubInput({ x: -1, y: 0, run: false });
      controller.update(0.016, input);
      expect(controller.facing).toBe(-1);
    });

    it('静止时朝向保持上次状态', () => {
      const input = createStubInput({ x: -1, y: 0, run: false });
      controller.update(0.016, input);
      expect(controller.facing).toBe(-1);

      const idleInput = createStubInput({ x: 0, y: 0, run: false });
      controller.update(0.016, idleInput);
      expect(controller.facing).toBe(-1);
    });
  });

  describe('动画状态联动', () => {
    it('静止 → 状态 idle', () => {
      const input = createStubInput({ x: 0, y: 0, run: false });
      controller.update(0.016, input);
      expect(controller.animState).toBe('idle');
    });

    it('行走 → 状态 walk', () => {
      const input = createStubInput({ x: 1, y: 0, run: false });
      controller.update(0.016, input);
      expect(controller.animState).toBe('walk');
    });

    it('奔跑 → 状态 run', () => {
      const input = createStubInput({ x: 1, y: 0, run: true });
      controller.update(0.016, input);
      expect(controller.animState).toBe('run');
    });

    it('停止移动 → 状态切回 idle', () => {
      const moveInput = createStubInput({ x: 1, y: 0, run: false });
      controller.update(0.016, moveInput);
      expect(controller.animState).toBe('walk');

      const idleInput = createStubInput({ x: 0, y: 0, run: false });
      controller.update(0.016, idleInput);
      expect(controller.animState).toBe('idle');
    });
  });

  describe('碰撞后运动状态同步', () => {
    it('连续顶住障碍物时，实际停住后速度和动画回到 idle', () => {
      const input = createStubInput({ x: 1, y: 0, run: false });
      const topdown = new TopdownController({
        player: controller,
        input,
      });
      topdown.setMap({
        bounds: { left: 24, top: 80, right: 1256, bottom: 680 },
        obstacles: [{ x: 110, y: 100, width: 20, height: 100 }],
        playerRadius: 20,
      });
      controller.setPosition(80, 150);

      topdown.update(0.1);
      expect(controller.x).toBeCloseTo(87.5, 5);
      expect(controller.animState).toBe('walk');

      topdown.update(0.1);
      expect(controller.x).toBeCloseTo(87.5, 5);
      expect(controller.velocity).toEqual({ x: 0, y: 0 });
      expect(controller.animState).toBe('idle');
    });
  });

  describe('只读暴露', () => {
    it('保存并恢复位置、速度、朝向和动画状态', () => {
      const input = createStubInput({ x: -1, y: 0, run: true });
      controller.update(0.25, input);

      const snapshot = controller.getSaveState();
      const restored = new PlayerController({
        x: 0,
        y: 0,
        bounds: { width: GAME.WIDTH, height: GAME.HEIGHT },
      });

      restored.restoreSaveState(snapshot);

      expect(restored.getSaveState()).toEqual(snapshot);
    });

    it('position 返回 {x, y} 副本（不可外部修改）', () => {
      const pos = controller.position;
      pos.x = 999;
      expect(controller.x).not.toBe(999);
    });

    it('velocity 返回当前速度向量', () => {
      const input = createStubInput({ x: 1, y: 0, run: false });
      controller.update(0.016, input);
      expect(controller.velocity.x).toBe(150);
      expect(controller.velocity.y).toBe(0);
    });
  });
});
