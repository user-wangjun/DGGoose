import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BadgeReveal } from '../../src/ui/BadgeReveal.js';

describe('场景完成印记核验展示', () => {
  let container;
  let reveal;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement('div');
    document.body.appendChild(container);
    reveal = new BadgeReveal({ container, durationMs: 1500 });
  });

  afterEach(() => {
    reveal.destroy();
    container.remove();
    vi.useRealTimers();
  });

  it('展示正式彩色徽章并带有发光背景层', () => {
    reveal.show({ id: 'factory_cert', name: '出厂合格证' });

    const root = container.querySelector('[data-badge-reveal]');
    const image = root.querySelector('[data-badge-reveal-image]');

    expect(root).not.toBeNull();
    expect(root.querySelector('[data-badge-reveal-glow]')).not.toBeNull();
    expect(image.src).toContain('badge_factory_color.png');
    expect(root.textContent).toContain('出厂合格证');
  });

  it('图片尚未返回或加载失败时仍保留可见徽章画框', () => {
    reveal.show({ id: 'basketball', name: '篮球徽章' });

    const root = container.querySelector('[data-badge-reveal]');
    const frame = root.querySelector('[data-badge-reveal-art]');
    const image = root.querySelector('[data-badge-reveal-image]');
    const fallback = root.querySelector('[data-badge-reveal-fallback]');

    expect(frame).not.toBeNull();
    expect(frame.style.width).toContain('184px');
    expect(frame.style.height).toContain('184px');
    expect(fallback.style.opacity).not.toBe('0');

    image.dispatchEvent(new Event('load'));
    expect(image.style.opacity).toBe('1');
    expect(fallback.style.opacity).toBe('0');

    image.dispatchEvent(new Event('error'));
    expect(image.style.display).toBe('none');
    expect(fallback.style.opacity).toBe('1');
  });

  it('获得印记后保持展示，按空格确认才移除并继续', () => {
    const onConfirm = vi.fn();
    reveal.show({ id: 'basketball', name: '篮球徽章' }, { onConfirm });
    expect(container.querySelector('[data-badge-reveal]')).not.toBeNull();

    vi.advanceTimersByTime(1500);
    expect(container.querySelector('[data-badge-reveal]')).not.toBeNull();

    window.dispatchEvent(new KeyboardEvent('keydown', {
      key: ' ',
      code: 'Space',
      bubbles: true,
    }));

    expect(container.querySelector('[data-badge-reveal]')).toBeNull();
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('手机没有空格键时可点击模态层内的继续按钮', () => {
    const onConfirm = vi.fn();
    reveal.show({ id: 'factory_cert', name: '出厂合格证' }, { onConfirm });

    const confirmButton = container.querySelector('[data-badge-reveal-confirm]');
    expect(confirmButton).not.toBeNull();
    expect(confirmButton.textContent).toBe('继续');
    expect(container.querySelector('[data-badge-reveal-hint]').textContent).toContain('点击');

    confirmButton.click();

    expect(container.querySelector('[data-badge-reveal]')).toBeNull();
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('收集印记的同一个空格事件结束对白时，不应立即确认新展示', () => {
    const onConfirm = vi.fn();
    const collectOnSpace = () => {
      reveal.show({ id: 'factory_cert', name: '出厂合格证' }, { onConfirm });
    };
    window.addEventListener('keydown', collectOnSpace);

    window.dispatchEvent(new KeyboardEvent('keydown', {
      key: ' ',
      code: 'Space',
      bubbles: true,
    }));

    window.removeEventListener('keydown', collectOnSpace);
    expect(container.querySelector('[data-badge-reveal]')).not.toBeNull();
    expect(onConfirm).not.toHaveBeenCalled();

    // 确认监听要等当前 keydown 事件返回后再挂载，下一次空格才可以确认。
    expect(reveal.inputTarget).toBeNull();
    vi.runOnlyPendingTimers();
    expect(reveal.inputTarget).toBe(window);
  });

  it('未知印记不创建错误的占位展示', () => {
    reveal.show({ id: 'unknown_badge', name: '未知' });

    expect(container.querySelector('[data-badge-reveal]')).toBeNull();
  });
});
