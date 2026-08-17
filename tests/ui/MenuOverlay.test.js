import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MenuOverlay } from '../../src/ui/MenuOverlay.js';

describe('MenuOverlay 横屏触控说明', () => {
  let container;
  let menuOverlay;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (menuOverlay) {
      menuOverlay.destroy();
      menuOverlay = null;
    }
    if (container.parentNode) {
      container.parentNode.removeChild(container);
    }
  });

  it('只展示手机/平板横屏操作，不再展示 PC 操作区', () => {
    menuOverlay = new MenuOverlay({ container });
    menuOverlay.show();

    const panel = container.querySelector('[data-menu-overlay]');
    expect(panel).not.toBeNull();
    expect(panel.querySelector('[data-menu-overlay-close]').dataset.uiButton).toBe('');
    expect(panel.textContent).toContain('手机/平板横屏操作');
    expect(panel.textContent).toContain('请使用手机或平板横屏体验');
    expect(panel.textContent).not.toContain('PC 操作');
    expect(panel.textContent).not.toContain('WSAD');
  });

  it('点击关闭后移除覆盖层并通知调用方', () => {
    const onClose = vi.fn();
    menuOverlay = new MenuOverlay({ container, onClose });
    menuOverlay.show();

    container.querySelector('[data-menu-overlay-close]').click();

    expect(container.querySelector('[data-overlay]')).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
