import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ShootingJoystick } from '../../src/ui/ShootingJoystick.js';

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

describe('ShootingJoystick 移动端投篮轮盘', () => {
  let container;
  let joystick;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    joystick = new ShootingJoystick({ container, radius: 34 });
    joystick.mount();
  });

  afterEach(() => {
    joystick?.destroy();
    container?.remove();
  });

  it('挂载在右下专用区域，默认隐藏且不影响通用交互键', () => {
    const base = container.querySelector('[data-joystick-shoot]');
    const stick = container.querySelector('[data-joystick-shoot-stick]');
    const label = container.querySelector('[data-joystick-shoot-label]');

    expect(base).not.toBeNull();
    expect(stick).not.toBeNull();
    expect(label?.textContent).toBe('投篮');
    expect(base.parentElement).toBe(container);
    expect(base.dataset.joystickShootState).toBe('hidden');
    expect(base.style.display).toBe('none');
    expect(base.style.right).toBe('var(--joystick-shoot-right)');
    expect(base.style.bottom).toBe('var(--joystick-shoot-bottom)');
    expect(Number.parseFloat(base.style.width)).toBeGreaterThanOrEqual(96);
    expect(Number.parseFloat(base.style.width)).toBeLessThanOrEqual(120);
    expect(joystick.styleElement.textContent).toContain('env(safe-area-inset-right');
    expect(joystick.styleElement.textContent).toContain('--gxe-game-frame-right');
    expect(joystick.styleElement.textContent).toContain('@media (prefers-reduced-motion: reduce)');
  });

  it('独立指针拖动产生方向/力度，松手回调最后的向量', () => {
    const onMove = vi.fn();
    const onRelease = vi.fn();
    const onCancel = vi.fn();
    joystick.setHandlers({ onMove, onRelease, onCancel }).setVisible(true);
    const base = container.querySelector('[data-joystick-shoot]');
    setElementRect(base, { left: 700, top: 240 });

    base.dispatchEvent(createPointerEvent('pointerdown', {
      clientX: 759.5,
      clientY: 299.5,
      pointerId: 31,
    }));
    window.dispatchEvent(createPointerEvent('pointermove', {
      clientX: 793.5,
      clientY: 282.5,
      pointerId: 31,
    }));

    expect(joystick.isActive()).toBe(true);
    expect(joystick.getVector().x).toBeCloseTo(0.894427, 5);
    expect(joystick.getVector().y).toBeCloseTo(-0.447214, 5);
    expect(onMove.mock.calls.at(-1)[0].x).toBeCloseTo(0.894427, 5);
    expect(onMove.mock.calls.at(-1)[0].y).toBeCloseTo(-0.447214, 5);
    expect(onMove.mock.calls.at(-1)[0].run).toBe(true);

    window.dispatchEvent(createPointerEvent('pointerup', {
      clientX: 793.5,
      clientY: 282.5,
      pointerId: 31,
    }));

    expect(onRelease).toHaveBeenCalledTimes(1);
    expect(onRelease.mock.calls[0][0].x).toBeCloseTo(0.894427, 5);
    expect(onRelease.mock.calls[0][0].y).toBeCloseTo(-0.447214, 5);
    expect(onRelease.mock.calls[0][0].run).toBe(true);
    expect(onCancel).not.toHaveBeenCalled();
    expect(joystick.isActive()).toBe(false);
    expect(joystick.getVector()).toEqual({ x: 0, y: 0, run: false });
    expect(base.dataset.joystickShootState).toBe('released');
  });

  it('忽略第二根指针，取消/隐藏时不会误发射', () => {
    const onRelease = vi.fn();
    const onCancel = vi.fn();
    joystick.setHandlers({ onRelease, onCancel }).setVisible(true);
    const base = container.querySelector('[data-joystick-shoot]');
    setElementRect(base);

    base.dispatchEvent(createPointerEvent('pointerdown', { clientX: 59.5, clientY: 59.5, pointerId: 41 }));
    window.dispatchEvent(createPointerEvent('pointermove', { clientX: 90, clientY: 59.5, pointerId: 42 }));
    expect(joystick.getVector().x).toBe(0);

    window.dispatchEvent(createPointerEvent('pointercancel', { pointerId: 42 }));
    expect(joystick.isActive()).toBe(true);
    joystick.setVisible(false);

    expect(onRelease).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(joystick.getVector()).toEqual({ x: 0, y: 0, run: false });
    expect(joystick.getState()).toBe('hidden');
  });
});
