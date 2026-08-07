import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ViewportAdapter } from '../../src/core/ViewportAdapter.js';

/**
 * ViewportAdapter 测试套件
 * 对应 PRD §6.1 双端适配 + Task 1.6：横屏检测，竖屏遮罩，DPI缩放，安全区
 */
describe('ViewportAdapter 双端适配', () => {
  let adapter;

  afterEach(() => {
    if (adapter) {
      adapter.destroy();
      adapter = null;
    }
  });

  describe('横竖屏判定（纯函数）', () => {
    it('landscape → true（宽 > 高）', () => {
      expect(ViewportAdapter.isLandscape(1280, 720)).toBe(true);
    });

    it('portrait → false（宽 < 高）', () => {
      expect(ViewportAdapter.isLandscape(720, 1280)).toBe(false);
    });

    it('正方形 → 视为横屏（兼容）', () => {
      expect(ViewportAdapter.isLandscape(1080, 1080)).toBe(true);
    });
  });

  describe('orientation 值判定', () => {
    it('orientation = 0 → 竖屏', () => {
      expect(ViewportAdapter.isLandscapeByOrientation(0)).toBe(false);
    });

    it('orientation = 90 → 横屏', () => {
      expect(ViewportAdapter.isLandscapeByOrientation(90)).toBe(true);
    });

    it('orientation = -90 → 横屏', () => {
      expect(ViewportAdapter.isLandscapeByOrientation(-90)).toBe(true);
    });

    it('orientation = 180 → 竖屏', () => {
      expect(ViewportAdapter.isLandscapeByOrientation(180)).toBe(false);
    });
  });

  describe('DPI 适配', () => {
    it('getDpr 返回 devicePixelRatio（最小 1，最大 3）', () => {
      const dpr = ViewportAdapter.getDpr();
      expect(dpr).toBeGreaterThanOrEqual(1);
      expect(dpr).toBeLessThanOrEqual(3);
    });
  });

  describe('画布缩放计算', () => {
    it('计算等比缩放（容器更宽时按高度适配）', () => {
      const scale = ViewportAdapter.calcScale({
        logicalW: 1280,
        logicalH: 720,
        viewportW: 1920,
        viewportH: 1080,
      });
      // 1920/1280 = 1.5, 1080/720 = 1.5 → 取较小值 1.5
      expect(scale).toBe(1.5);
    });

    it('容器更高时按宽度适配', () => {
      const scale = ViewportAdapter.calcScale({
        logicalW: 1280,
        logicalH: 720,
        viewportW: 1280,
        viewportH: 900,
      });
      // 1280/1280 = 1, 900/720 = 1.25 → 取较小值 1
      expect(scale).toBe(1);
    });
  });

  describe('DOM 遮罩冒烟', () => {
    it('按当前视口宽高判断竖屏，即使 screen.orientation 仍报告横屏', () => {
      const originalWidth = window.innerWidth;
      const originalHeight = window.innerHeight;
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: 844 });

      adapter = new ViewportAdapter();
      adapter.mount();
      const overlay = document.querySelector('[data-rotate-overlay]');

      expect(overlay.style.display).toBe('flex');

      Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth });
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: originalHeight });
    });

    it('创建遮罩元素并添加到 body', () => {
      adapter = new ViewportAdapter();
      adapter.mount();
      const overlay = document.querySelector('[data-rotate-overlay]');
      expect(overlay).not.toBeNull();
    });

    it('showRotateOverlay → 遮罩可见', () => {
      adapter = new ViewportAdapter();
      adapter.mount();
      adapter.showRotateOverlay();
      const overlay = document.querySelector('[data-rotate-overlay]');
      expect(overlay.style.display).not.toBe('none');
    });

    it('hideRotateOverlay → 遮罩隐藏', () => {
      adapter = new ViewportAdapter();
      adapter.mount();
      adapter.showRotateOverlay();
      adapter.hideRotateOverlay();
      const overlay = document.querySelector('[data-rotate-overlay]');
      expect(overlay.style.display).toBe('none');
    });

    it('destroy → 移除遮罩和事件监听', () => {
      adapter = new ViewportAdapter();
      adapter.mount();
      adapter.destroy();
      adapter = null;
      const overlay = document.querySelector('[data-rotate-overlay]');
      expect(overlay).toBeNull();
    });
  });

  describe('安全区', () => {
    it('getSafeAreaInsets 返回对象（含 top/right/bottom/left）', () => {
      const insets = ViewportAdapter.getSafeAreaInsets();
      expect(insets).toHaveProperty('top');
      expect(insets).toHaveProperty('right');
      expect(insets).toHaveProperty('bottom');
      expect(insets).toHaveProperty('left');
    });

    it('applySafeArea 将安全区内边距应用到元素 padding', () => {
      const el = document.createElement('div');
      ViewportAdapter.applySafeArea(el);
      // jsdom 中 env() 值为 0，padding 应为 "0px"
      expect(el.style.paddingTop).toBe('0px');
      expect(el.style.paddingRight).toBe('0px');
      expect(el.style.paddingBottom).toBe('0px');
      expect(el.style.paddingLeft).toBe('0px');
    });
  });

  describe('画布缩放适配', () => {
    it('fitCanvas 按视口等比缩放画布 CSS 尺寸', () => {
      adapter = new ViewportAdapter();
      adapter.mount();
      const canvas = document.createElement('canvas');
      // 模拟 1280×720 逻辑尺寸 × DPR=1
      canvas.width = 1280;
      canvas.height = 720;
      // jsdom 默认 innerWidth=1024, innerHeight=768
      adapter.fitCanvas(canvas);
      // scale = min(1024/1280, 768/720) = min(0.8, 1.066) = 0.8
      // CSS 宽 = 1280 * 0.8 = 1024, CSS 高 = 720 * 0.8 = 576
      expect(canvas.style.width).toBe('1024px');
      expect(canvas.style.height).toBe('576px');
    });

    it('fitCanvas 存储画布引用供 resize 时重新适配', () => {
      adapter = new ViewportAdapter();
      adapter.mount();
      const canvas = document.createElement('canvas');
      canvas.width = 1280;
      canvas.height = 720;
      adapter.fitCanvas(canvas);
      expect(adapter._canvas).toBe(canvas);
    });
  });
});
