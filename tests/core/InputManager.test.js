import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { InputManager } from '../../src/core/InputManager.js';

/**
 * InputManager 测试套件
 * 对应 PRD §6.2 输入抽象层：键盘 + 虚拟摇杆统一汇入方向向量 + 动作事件
 */
describe('InputManager 输入抽象层', () => {
  let input;
  let target;

  beforeEach(() => {
    target = window;
    input = new InputManager();
    input.mount(target);
  });

  afterEach(() => {
    input.unmount();
  });

  /**
   * 辅助：模拟按下/松开按键
   * @param {string} key - KeyboardEvent.key 值
   * @param {string} type - 'keydown' 或 'keyup'
   */
  function pressKey(key, type = 'keydown') {
    target.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true }));
  }

  describe('键盘方向映射（8 方向）', () => {
    it('W 键 → 向上 (y: -1)', () => {
      pressKey('w');
      const v = input.getVector();
      expect(v.x).toBe(0);
      expect(v.y).toBe(-1);
      expect(v.run).toBe(false);
    });

    it('S 键 → 向下 (y: 1)', () => {
      pressKey('s');
      expect(input.getVector()).toEqual({ x: 0, y: 1, run: false });
    });

    it('A 键 → 向左 (x: -1)', () => {
      pressKey('a');
      expect(input.getVector()).toEqual({ x: -1, y: 0, run: false });
    });

    it('D 键 → 向右 (x: 1)', () => {
      pressKey('d');
      expect(input.getVector()).toEqual({ x: 1, y: 0, run: false });
    });

    it('方向键 Up/Down/Left/Right 同样有效', () => {
      pressKey('ArrowUp');
      expect(input.getVector().y).toBe(-1);
      pressKey('ArrowUp', 'keyup');

      pressKey('ArrowDown');
      expect(input.getVector().y).toBe(1);
      pressKey('ArrowDown', 'keyup');

      pressKey('ArrowLeft');
      expect(input.getVector().x).toBe(-1);
      pressKey('ArrowLeft', 'keyup');

      pressKey('ArrowRight');
      expect(input.getVector().x).toBe(1);
    });

    it('W+D 同时按 → 对角线归一化 (x≈0.707, y≈-0.707)', () => {
      pressKey('w');
      pressKey('d');
      const v = input.getVector();
      expect(v.x).toBeCloseTo(Math.SQRT1_2, 5);
      expect(v.y).toBeCloseTo(-Math.SQRT1_2, 5);
      expect(v.run).toBe(false);
    });

    it('W+A 同时按 → 对角线归一化 (x≈-0.707, y≈-0.707)', () => {
      pressKey('w');
      pressKey('a');
      const v = input.getVector();
      expect(v.x).toBeCloseTo(-Math.SQRT1_2, 5);
      expect(v.y).toBeCloseTo(-Math.SQRT1_2, 5);
    });

    it('松开所有键 → 归零 {x:0, y:0, run:false}', () => {
      pressKey('w');
      pressKey('d');
      pressKey('w', 'keyup');
      pressKey('d', 'keyup');
      expect(input.getVector()).toEqual({ x: 0, y: 0, run: false });
    });

    it('松开其中一个键，保留另一个方向', () => {
      pressKey('w');
      pressKey('d');
      pressKey('w', 'keyup');
      const v = input.getVector();
      expect(v.x).toBe(1);
      expect(v.y).toBe(0);
    });
  });

  describe('Shift 奔跑', () => {
    it('Shift+W → run: true', () => {
      pressKey('w');
      pressKey('Shift');
      const v = input.getVector();
      expect(v.x).toBe(0);
      expect(v.y).toBe(-1);
      expect(v.run).toBe(true);
    });

    it('松开 Shift → run: false', () => {
      pressKey('w');
      pressKey('Shift');
      pressKey('Shift', 'keyup');
      expect(input.getVector().run).toBe(false);
    });
  });

  describe('动作事件', () => {
    it('Space → 触发 interact 动作', () => {
      const callback = vi.fn();
      input.onAction(callback);
      pressKey(' ');
      expect(callback).toHaveBeenCalledWith('interact');
    });

    it('Escape → 触发 pause 动作', () => {
      const callback = vi.fn();
      input.onAction(callback);
      pressKey('Escape');
      expect(callback).toHaveBeenCalledWith('pause');
    });

    it('offAction 取消订阅后不再触发', () => {
      const callback = vi.fn();
      input.onAction(callback);
      input.offAction(callback);
      pressKey(' ');
      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('虚拟摇杆注入同一向量通道', () => {
    it('setJoystickVector 注入方向后 getVector 反映摇杆输入', () => {
      input.setJoystickVector(0.5, -0.5);
      const v = input.getVector();
      expect(v.x).toBeCloseTo(0.5, 5);
      expect(v.y).toBeCloseTo(-0.5, 5);
      expect(v.run).toBe(false);
    });

    it('摇杆拉满 (>0.92) → run: true', () => {
      input.setJoystickVector(0, -1.0);
      const v = input.getVector();
      expect(v.run).toBe(true);
    });

    it('摇杆输入优先于键盘（摇杆有输入时使用摇杆值）', () => {
      pressKey('w');
      input.setJoystickVector(1, 0);
      const v = input.getVector();
      expect(v.x).toBe(1);
      expect(v.y).toBe(0);
    });

    it('摇杆归零后回退到键盘输入', () => {
      pressKey('d');
      input.setJoystickVector(0, -1);
      input.setJoystickVector(0, 0);
      const v = input.getVector();
      expect(v.x).toBe(1);
      expect(v.y).toBe(0);
    });

    it('摇杆归零且无键盘输入 → 向量归零', () => {
      input.setJoystickVector(0.5, 0.5);
      input.setJoystickVector(0, 0);
      expect(input.getVector()).toEqual({ x: 0, y: 0, run: false });
    });
  });

  describe('挂载与卸载', () => {
    it('unmount 后不再响应键盘事件', () => {
      input.unmount();
      pressKey('w');
      expect(input.getVector()).toEqual({ x: 0, y: 0, run: false });
    });

    it('mount 到自定义目标元素', () => {
      const div = document.createElement('div');
      document.body.appendChild(div);
      input.unmount();
      input.mount(div);
      div.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', bubbles: true }));
      expect(input.getVector().y).toBe(-1);
      document.body.removeChild(div);
    });
  });
});
