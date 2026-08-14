import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VirtualJoystick, offsetToVector } from '../../src/ui/VirtualJoystick.js';

/**
 * jsdom 不支持 PointerEvent，用 MouseEvent 作为 polyfill。
 * 需要 pointerId 的场景手动补齐该只读属性。
 */
if (typeof globalThis.PointerEvent === 'undefined') {
  globalThis.PointerEvent = globalThis.MouseEvent;
}

function createPointerEvent(type, init = {}) {
  const event = new PointerEvent(type, {
    clientX: init.clientX ?? 0,
    clientY: init.clientY ?? 0,
    bubbles: init.bubbles ?? true,
    cancelable: init.cancelable ?? true,
  });
  if (init.pointerId !== undefined) {
    Object.defineProperty(event, 'pointerId', { configurable: true, value: init.pointerId });
  }
  return event;
}

function setElementRect(element, { left = 0, top = 0, width = 119, height = 119 } = {}) {
  element.getBoundingClientRect = vi.fn(() => ({
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  }));
}

/**
 * VirtualJoystick 测试套件
 * 对应 PRD §6.2 + Task 1.2：Pointer Events，偏移→向量截断→归一化，拉满判定 run。
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

  describe('DOM 挂载与正式视觉契约', () => {
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
      joystick?.unmount();
      if (container?.parentNode) container.parentNode.removeChild(container);
    });

    it('挂载后正式底座和摇杆头保留既有 data 属性', () => {
      const base = container.querySelector('[data-joystick-base]');
      const stick = container.querySelector('[data-joystick-stick]');
      const action = container.querySelector('[data-joystick-interact]');

      expect(base).not.toBeNull();
      expect(stick).not.toBeNull();
      expect(action).not.toBeNull();
      expect(action.parentElement).toBe(container);
      expect(action.parentElement).not.toBe(base);
      expect(base.dataset.joystickState).toBe('idle');
      expect(stick.dataset.joystickState).toBe('idle');
      expect(base.classList.contains('gxe-virtual-joystick')).toBe(true);
      expect(stick.classList.contains('gxe-virtual-joystick__stick')).toBe(true);
      expect(Number.parseFloat(base.style.width)).toBeGreaterThanOrEqual(96);
      expect(Number.parseFloat(base.style.width)).toBeLessThanOrEqual(120);
      expect(Number.parseFloat(stick.style.width)).toBeGreaterThanOrEqual(44);
      expect(Number.parseFloat(stick.style.width)).toBeLessThanOrEqual(60);
      expect(action.tagName).toBe('BUTTON');
      expect(action.textContent).toBe('互动');
      expect(action.getAttribute('aria-label')).toBe('互动');
      expect(action.dataset.joystickActionState).toBe('idle');
    });

    it('小屏横屏、安全区、层级和 reduced-motion CSS 契约存在', () => {
      const base = container.querySelector('[data-joystick-base]');
      const styleText = joystick.styleElement.textContent;

      expect(base.style.position).toBe('fixed');
      expect(base.style.left).toBe('var(--joystick-left)');
      expect(base.style.bottom).toBe('var(--joystick-bottom)');
      expect(base.style.zIndex).toBe('40');
      expect(styleText).toContain('env(safe-area-inset-left');
      expect(styleText).toContain('env(safe-area-inset-bottom');
      expect(styleText).toContain('env(safe-area-inset-right');
      expect(styleText).toContain('--gxe-game-frame-left');
      expect(styleText).toContain('--gxe-game-frame-right');
      expect(styleText).toContain('--gxe-game-frame-bottom');
      expect(styleText).toContain('min(100vw, 177.7778vh)');
      expect(styleText).toContain('min(100vh, 56.25vw)');
      expect(styleText).toContain('@media (max-width: 960px) and (max-height: 460px) and (orientation: landscape)');
      expect(styleText).toContain('@media (prefers-reduced-motion: reduce)');
      expect(styleText).toContain('z-index: 40');
      expect(styleText).toContain('pointer-events: none');
      expect(styleText).toContain('#ee8653');
      expect(styleText).toContain('data-joystick-interact');
      expect(styleText).toContain('--joystick-action-right');
      expect(styleText).toContain('--joystick-action-bottom');
      expect(styleText).toContain('display: none !important');
      expect(base.style.overflow).toBe('hidden');
    });

    it('移动端交互键复用现有 Space/interact 通道，且不会激活摇杆', () => {
      const base = container.querySelector('[data-joystick-base]');
      const action = container.querySelector('[data-joystick-interact]');
      const onKeyDown = vi.fn();
      window.addEventListener('keydown', onKeyDown);

      action.dispatchEvent(createPointerEvent('pointerdown', { pointerId: 20 }));
      expect(action.dataset.joystickActionState).toBe('pressed');
      expect(joystick.isActive()).toBe(false);

      action.dispatchEvent(createPointerEvent('pointerup', { pointerId: 20 }));
      expect(action.dataset.joystickActionState).toBe('idle');

      action.click();
      const syntheticAction = onKeyDown.mock.calls.at(-1)?.[0];
      expect(syntheticAction).toBeInstanceOf(KeyboardEvent);
      expect(syntheticAction.key).toBe(' ');
      expect(syntheticAction.code).toBe('Space');
      expect(base.dataset.joystickState).toBe('idle');

      window.removeEventListener('keydown', onKeyDown);
    });

    it('俯视 HUD 常驻但提示未出现时仍保留通用交互键', () => {
      const action = container.querySelector('[data-joystick-interact]');
      const hud = document.createElement('div');
      hud.setAttribute('data-topdown-hud', '');
      document.body.appendChild(hud);

      joystick.getVector();
      expect(action.hidden).toBe(false);
      expect(action.disabled).toBe(false);

      const prompt = document.createElement('div');
      prompt.setAttribute('data-topdown-interaction', '');
      prompt.style.display = 'flex';
      prompt.getBoundingClientRect = () => ({ width: 120, height: 40 });
      document.body.appendChild(prompt);
      joystick.getVector();
      expect(action.hidden).toBe(true);
      expect(action.disabled).toBe(true);

      prompt.remove();
      hud.remove();
      joystick.getVector();
      expect(action.hidden).toBe(false);
      expect(action.disabled).toBe(false);
    });

    it('阶段标记可暂时收起通用键，避免替玩法自动出手', () => {
      const action = container.querySelector('[data-joystick-interact]');

      action.setAttribute('data-joystick-action-suppressed', '');
      joystick.getVector();
      expect(action.hidden).toBe(true);
      expect(action.disabled).toBe(true);

      action.removeAttribute('data-joystick-action-suppressed');
      joystick.getVector();
      expect(action.hidden).toBe(false);
      expect(action.disabled).toBe(false);
    });

    it('pointerdown → pressed，移动后进入 dragging', () => {
      const base = container.querySelector('[data-joystick-base]');
      setElementRect(base);

      base.dispatchEvent(createPointerEvent('pointerdown', {
        clientX: 59.5,
        clientY: 59.5,
        pointerId: 7,
      }));
      expect(joystick.isActive()).toBe(true);
      expect(joystick.getState()).toBe('pressed');
      expect(base.dataset.joystickState).toBe('pressed');

      window.dispatchEvent(createPointerEvent('pointermove', {
        clientX: 79.5,
        clientY: 59.5,
        pointerId: 7,
      }));
      expect(joystick.getState()).toBe('dragging');
      expect(base.dataset.joystickState).toBe('dragging');
    });

    it('拖动向量不会超过单位圆，摇杆头不会超过最大半径', () => {
      const base = container.querySelector('[data-joystick-base]');
      setElementRect(base);
      base.dispatchEvent(createPointerEvent('pointerdown', {
        clientX: 59.5,
        clientY: 59.5,
        pointerId: 8,
      }));
      window.dispatchEvent(createPointerEvent('pointermove', {
        clientX: 600,
        clientY: 500,
        pointerId: 8,
      }));

      const vector = joystick.getVector();
      const vectorMagnitude = Math.hypot(vector.x, vector.y);
      const stickOffsetMagnitude = Math.hypot(joystick.stickOffset.x, joystick.stickOffset.y);

      expect(vectorMagnitude).toBeLessThanOrEqual(1.0001);
      expect(stickOffsetMagnitude).toBeLessThanOrEqual(joystick.radius + 0.0001);
      expect(stickOffsetMagnitude).toBeCloseTo(joystick.radius, 5);
      expect(joystick.stickElement.style.transform).toContain('calc(-50% +');
    });

    it('pointerdown 支持指针捕获，pointerup 后立即归中并向量归零', () => {
      const base = container.querySelector('[data-joystick-base]');
      setElementRect(base);
      base.setPointerCapture = vi.fn();
      base.releasePointerCapture = vi.fn();
      base.hasPointerCapture = vi.fn(() => true);

      base.dispatchEvent(createPointerEvent('pointerdown', {
        clientX: 59.5,
        clientY: 59.5,
        pointerId: 9,
      }));
      window.dispatchEvent(createPointerEvent('pointermove', {
        clientX: 82,
        clientY: 59.5,
        pointerId: 9,
      }));
      expect(base.setPointerCapture).toHaveBeenCalledWith(9);

      window.dispatchEvent(createPointerEvent('pointerup', {
        clientX: 82,
        clientY: 59.5,
        pointerId: 9,
      }));

      expect(base.releasePointerCapture).toHaveBeenCalledWith(9);
      expect(joystick.isActive()).toBe(false);
      expect(joystick.getVector()).toEqual({ x: 0, y: 0, run: false });
      expect(joystick.getState()).toBe('released');
      expect(joystick.stickOffset).toEqual({ x: 0, y: 0 });
      expect(joystick.stickElement.style.transform).toBe('translate(-50%, -50%)');
    });

    it('pointercancel、lostpointercapture 和窗口失焦都会归零', () => {
      const base = container.querySelector('[data-joystick-base]');
      setElementRect(base);

      base.dispatchEvent(createPointerEvent('pointerdown', {
        clientX: 59.5,
        clientY: 59.5,
        pointerId: 10,
      }));
      window.dispatchEvent(createPointerEvent('pointermove', {
        clientX: 75,
        clientY: 50,
        pointerId: 10,
      }));
      base.dispatchEvent(createPointerEvent('pointercancel', { pointerId: 10 }));
      expect(joystick.getVector()).toEqual({ x: 0, y: 0, run: false });
      expect(joystick.getState()).toBe('released');

      base.dispatchEvent(createPointerEvent('pointerdown', {
        clientX: 59.5,
        clientY: 59.5,
        pointerId: 11,
      }));
      window.dispatchEvent(createPointerEvent('pointermove', {
        clientX: 76,
        clientY: 59.5,
        pointerId: 11,
      }));
      base.dispatchEvent(new Event('lostpointercapture', { bubbles: true }));
      expect(joystick.getVector()).toEqual({ x: 0, y: 0, run: false });

      base.dispatchEvent(createPointerEvent('pointerdown', {
        clientX: 59.5,
        clientY: 59.5,
        pointerId: 12,
      }));
      window.dispatchEvent(new Event('blur'));
      expect(joystick.isActive()).toBe(false);
      expect(joystick.getVector()).toEqual({ x: 0, y: 0, run: false });
    });

    it('隐藏/禁用时不可操作，恢复显示后仍兼容菜单场景策略', () => {
      const base = container.querySelector('[data-joystick-base]');

      joystick.setVisible(false);
      expect(base.style.display).toBe('none');
      expect(joystick.getState()).toBe('hidden');
      base.dispatchEvent(createPointerEvent('pointerdown', { clientX: 20, clientY: 20 }));
      expect(joystick.isActive()).toBe(false);
      expect(joystick.getVector()).toEqual({ x: 0, y: 0, run: false });

      joystick.setVisible(true);
      expect(base.style.display).toBe('');
      expect(joystick.getState()).toBe('idle');

      joystick.setEnabled(false);
      expect(joystick.getState()).toBe('disabled');
      base.dispatchEvent(createPointerEvent('pointerdown', { clientX: 20, clientY: 20 }));
      expect(joystick.isActive()).toBe(false);
      expect(joystick.getVector()).toEqual({ x: 0, y: 0, run: false });
      joystick.setEnabled(true);
      expect(joystick.getState()).toBe('idle');
    });

    it('不注册键盘输入监听，键盘事件不会改变摇杆向量', () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      expect(joystick.getVector()).toEqual({ x: 0, y: 0, run: false });
      expect(joystick.getState()).toBe('idle');
    });

    it('prefers-reduced-motion 下复位不依赖动画', () => {
      const previousMatchMedia = window.matchMedia;
      const reducedContainer = document.createElement('div');
      document.body.appendChild(reducedContainer);
      window.matchMedia = vi.fn().mockReturnValue({ matches: true, media: '(prefers-reduced-motion: reduce)' });

      const reducedJoystick = new VirtualJoystick({ container: reducedContainer, radius: 34 });
      reducedJoystick.mount();
      const reducedBase = reducedContainer.querySelector('[data-joystick-base]');
      setElementRect(reducedBase);
      reducedBase.dispatchEvent(createPointerEvent('pointerdown', { clientX: 59.5, clientY: 59.5 }));
      window.dispatchEvent(createPointerEvent('pointermove', { clientX: 90, clientY: 59.5 }));
      window.dispatchEvent(createPointerEvent('pointerup', { clientX: 90, clientY: 59.5 }));

      expect(reducedJoystick.reducedMotion).toBe(true);
      expect(reducedJoystick.stickElement.style.transition).toBe('none');
      expect(reducedJoystick.stickElement.style.transform).toBe('translate(-50%, -50%)');
      expect(reducedJoystick.getVector()).toEqual({ x: 0, y: 0, run: false });

      reducedJoystick.destroy();
      reducedContainer.remove();
      window.matchMedia = previousMatchMedia;
    });

    it('destroy 后清理 DOM、样式和窗口监听器', () => {
      const base = container.querySelector('[data-joystick-base]');
      setElementRect(base);
      const removeWindowListener = vi.spyOn(window, 'removeEventListener');

      base.dispatchEvent(createPointerEvent('pointerdown', {
        clientX: 59.5,
        clientY: 59.5,
        pointerId: 13,
      }));
      joystick.destroy();

      expect(container.querySelector('[data-joystick-base]')).toBeNull();
      expect(container.querySelector('[data-joystick-stick]')).toBeNull();
      expect(container.querySelector('[data-joystick-interact]')).toBeNull();
      expect(document.head.querySelector('[data-joystick-styles]')).toBeNull();
      expect(removeWindowListener).toHaveBeenCalledWith('pointermove', joystick._onPointerMove);
      expect(removeWindowListener).toHaveBeenCalledWith('pointerup', joystick._onPointerUp);
      expect(removeWindowListener).toHaveBeenCalledWith('pointercancel', joystick._onPointerCancel);
      expect(removeWindowListener).toHaveBeenCalledWith('blur', joystick._onWindowBlur);

      window.dispatchEvent(createPointerEvent('pointermove', { clientX: 100, clientY: 100 }));
      expect(joystick.getVector()).toEqual({ x: 0, y: 0, run: false });
      removeWindowListener.mockRestore();
    });
  });
});
