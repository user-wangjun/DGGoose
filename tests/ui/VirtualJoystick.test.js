import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VirtualJoystick, offsetToVector } from '../../src/ui/VirtualJoystick.js';

/**
 * jsdom 不支持 PointerEvent，用 MouseEvent 作为 polyfill
 * PointerEvent 继承 MouseEvent，clientX/clientY 属性一致
 */
if (typeof globalThis.PointerEvent === 'undefined') {
  globalThis.PointerEvent = globalThis.MouseEvent;
}

/**
 * VirtualJoystick 测试套件
 * 对应 PRD §6.2 + Task 1.2：Pointer Events，偏移→向量截断→归一化，拉满判定 run
 */
describe('VirtualJoystick 虚拟摇杆', () => {
  describe('offsetToVector 纯函数（偏移→向量）', () => {
    it('零偏移 → 零向量', () => {
      const v = offsetToVector(0, 0, 34);
      expect(v.x).toBe(0);
      expect(v.y).toBe(0);
      expect(v.run).toBe(false);
    });

    it('水平偏移 < R → 归一化到 -1~1', () => {
      const v = offsetToVector(17, 0, 34);
      expect(v.x).toBeCloseTo(0.5, 5);
      expect(v.y).toBe(0);
      expect(v.run).toBe(false);
    });

    it('偏移 = R → 归一化为 1', () => {
      const v = offsetToVector(34, 0, 34);
      expect(v.x).toBeCloseTo(1, 5);
      expect(v.y).toBe(0);
      expect(v.run).toBe(true);
    });

    it('偏移 > R → 截断到 R（向量幅值不超过 1）', () => {
      const v = offsetToVector(100, 0, 34);
      expect(v.x).toBeCloseTo(1, 5);
      expect(v.y).toBe(0);
      expect(v.run).toBe(true);
    });

    it('对角偏移截断后幅值 ≤ 1', () => {
      const v = offsetToVector(50, 50, 34);
      const mag = Math.hypot(v.x, v.y);
      expect(mag).toBeLessThanOrEqual(1.0001);
    });

    it('拉满 (>0.92R) → run: true', () => {
      const v = offsetToVector(32, 0, 34); // 32/34 ≈ 0.94
      expect(v.run).toBe(true);
    });

    it('未拉满 (<0.92R) → run: false', () => {
      const v = offsetToVector(30, 0, 34); // 30/34 ≈ 0.88
      expect(v.run).toBe(false);
    });

    it('Y 轴方向：向下为正（屏幕坐标系）', () => {
      const v = offsetToVector(0, 17, 34);
      expect(v.y).toBeCloseTo(0.5, 5);
      expect(v.x).toBe(0);
    });
  });

  describe('DOM 挂载冒烟测试', () => {
    let container;
    let joystick;

    beforeEach(() => {
      container = document.createElement('div');
      container.style.width = '200px';
      container.style.height = '200px';
      document.body.appendChild(container);
      joystick = new VirtualJoystick({ container, radius: 34 });
      joystick.mount();
    });

    afterEach(() => {
      joystick.unmount();
      document.body.removeChild(container);
    });

    it('挂载后创建摇杆 DOM 元素', () => {
      const base = container.querySelector('[data-joystick-base]');
      expect(base).not.toBeNull();
    });

    it('pointerdown → 激活摇杆', () => {
      const base = container.querySelector('[data-joystick-base]');
      const event = new PointerEvent('pointerdown', {
        clientX: 100,
        clientY: 100,
        bubbles: true,
      });
      base.dispatchEvent(event);
      expect(joystick.isActive()).toBe(true);
    });

    it('pointerup → 停用摇杆，向量归零', () => {
      const base = container.querySelector('[data-joystick-base]');
      const downEvent = new PointerEvent('pointerdown', {
        clientX: 100,
        clientY: 100,
        bubbles: true,
      });
      base.dispatchEvent(downEvent);

      const upEvent = new PointerEvent('pointerup', {
        clientX: 100,
        clientY: 100,
        bubbles: true,
      });
      window.dispatchEvent(upEvent);

      expect(joystick.isActive()).toBe(false);
      expect(joystick.getVector()).toEqual({ x: 0, y: 0, run: false });
    });

    it('getVector 在未激活时返回零向量', () => {
      expect(joystick.getVector()).toEqual({ x: 0, y: 0, run: false });
    });

    it('pointermove 拖拽 → 向量更新', () => {
      const base = container.querySelector('[data-joystick-base]');

      // 按下（圆心在 jsdom 中为 0,0）
      base.dispatchEvent(new PointerEvent('pointerdown', {
        clientX: 0, clientY: 0, bubbles: true,
      }));

      // 拖拽到右侧
      window.dispatchEvent(new PointerEvent('pointermove', {
        clientX: 20, clientY: 0, bubbles: true,
      }));

      const v = joystick.getVector();
      expect(v.x).toBeGreaterThan(0);
      expect(v.y).toBeCloseTo(0, 5);
      expect(joystick.isActive()).toBe(true);

      // 松开 → 归零
      window.dispatchEvent(new PointerEvent('pointerup', {
        clientX: 20, clientY: 0, bubbles: true,
      }));
      expect(joystick.getVector()).toEqual({ x: 0, y: 0, run: false });
    });
  });
});
