/**
 * 移动端横屏适配器（对应 PRD §6.1 移动端横屏适配 + Task 1.6）
 * 横屏检测（screen.orientation + window.orientation 兜底）；
 * 竖屏时显示"请横屏游玩"遮罩（DOM）；
 * 画布按视口等比缩放（DPI 适配）；安全区 env(safe-area-inset-*) 应用于 UI 层。
 */

/**
 * 视口适配器：管理横竖屏检测与旋转遮罩
 */
export class ViewportAdapter {
  constructor() {
    /** @type {HTMLElement|null} 旋转提示遮罩 */
    this.overlay = null;
    /** @type {Function|null} orientationchange 监听器 */
    this._orientationHandler = null;
    /** @type {Function|null} resize 监听器 */
    this._resizeHandler = null;
    /** @type {HTMLCanvasElement|null} 需要在 resize 时重新适配的画布 */
    this._canvas = null;
  }

  /**
   * 挂载：创建遮罩 DOM 并监听屏幕旋转
   */
  mount() {
    this.overlay = document.createElement('div');
    this.overlay.setAttribute('data-rotate-overlay', '');
    this.overlay.style.cssText = `
      position: fixed;
      inset: 0;
      z-index: 9999;
      display: none;
      align-items: center;
      justify-content: center;
      background: rgba(0, 0, 0, 0.9);
      color: #fff;
      font-size: 24px;
      text-align: center;
    `;
    this.overlay.innerHTML = '<p>请将手机或平板横屏游玩 🔄</p>';
    document.body.appendChild(this.overlay);

    // 监听屏幕旋转
    this._orientationHandler = () => this.checkOrientation();
    this._resizeHandler = () => this.checkOrientation();

    if (typeof screen !== 'undefined' && screen.orientation) {
      screen.orientation.addEventListener('change', this._orientationHandler);
    }
    window.addEventListener('resize', this._resizeHandler);
    // Android 浏览器展开/收起地址栏时，window.resize 不一定触发，
    // 但 visualViewport 会报告实际可见区域的变化。画布和 DOM 组件都必须
    // 跟随这两个事件，否则顶部 HUD 会被浏览器 UI 盖住，底部按钮会落出屏幕。
    if (window.visualViewport?.addEventListener) {
      window.visualViewport.addEventListener('resize', this._resizeHandler);
      window.visualViewport.addEventListener('scroll', this._resizeHandler);
    }

    // 初始检测
    this.checkOrientation();
  }

  /**
   * 检测当前横竖屏状态，切换遮罩显示。
   * 视口宽高优先，因为它直接对应当前页面可用空间；方向 API 仅作无有效视口数据时的兜底。
   */
  checkOrientation() {
    let landscape;

    const { width: viewportW, height: viewportH } = ViewportAdapter.getViewportSize();
    ViewportAdapter.syncViewportCssVariables(viewportW, viewportH);

    if (viewportW > 0 && viewportH > 0) {
      // 当前页面真正可见的区域是布局和画布适配的最终依据。
      landscape = ViewportAdapter.isLandscape(viewportW, viewportH);
    } else if (typeof screen !== 'undefined' && screen.orientation) {
      // 无有效视口数据时使用现代浏览器方向 API。
      landscape = screen.orientation.type.startsWith('landscape');
    } else if (typeof window.orientation !== 'undefined') {
      // 再兜底到旧版浏览器的旋转角度。
      landscape = ViewportAdapter.isLandscapeByOrientation(window.orientation);
    }

    if (landscape) {
      this.hideRotateOverlay();
    } else {
      this.showRotateOverlay();
    }

    // resize 时同时重新适配画布
    if (this._canvas) {
      this.fitCanvas(this._canvas);
    }
  }

  /**
   * 将画布等比缩放到当前视口大小（CSS 尺寸适配）
   * 物理像素由调用方按 DPR 设置，此方法仅管理 CSS 显示尺寸
   * @param {HTMLCanvasElement} canvas - 需要适配的画布元素
   */
  fitCanvas(canvas) {
    this._canvas = canvas;
    const { width: viewportW, height: viewportH } = ViewportAdapter.getViewportSize();
    ViewportAdapter.syncViewportCssVariables(viewportW, viewportH);
    const scale = ViewportAdapter.calcScale({
      logicalW: canvas.width / ViewportAdapter.getDpr(),
      logicalH: canvas.height / ViewportAdapter.getDpr(),
      viewportW,
      viewportH,
    });
    // 等比缩放：CSS 尺寸 = 逻辑尺寸 × 缩放比
    canvas.style.width = (canvas.width / ViewportAdapter.getDpr()) * scale + 'px';
    canvas.style.height = (canvas.height / ViewportAdapter.getDpr()) * scale + 'px';
  }

  /**
   * 显示旋转提示遮罩
   */
  showRotateOverlay() {
    if (this.overlay) {
      this.overlay.style.display = 'flex';
    }
  }

  /**
   * 隐藏旋转提示遮罩
   */
  hideRotateOverlay() {
    if (this.overlay) {
      this.overlay.style.display = 'none';
    }
  }

  /**
   * 销毁：移除遮罩和事件监听
   */
  destroy() {
    if (this._orientationHandler && typeof screen !== 'undefined' && screen.orientation) {
      screen.orientation.removeEventListener('change', this._orientationHandler);
    }
    if (this._resizeHandler) {
      window.removeEventListener('resize', this._resizeHandler);
      if (window.visualViewport?.removeEventListener) {
        window.visualViewport.removeEventListener('resize', this._resizeHandler);
        window.visualViewport.removeEventListener('scroll', this._resizeHandler);
      }
    }
    if (this.overlay && this.overlay.parentNode) {
      this.overlay.parentNode.removeChild(this.overlay);
    }
    this.overlay = null;
    this._orientationHandler = null;
    this._resizeHandler = null;
    this._canvas = null;
  }

  /**
   * 纯函数：根据宽高判断是否横屏
   * @param {number} width
   * @param {number} height
   * @returns {boolean}
   */
  static isLandscape(width, height) {
    return width >= height;
  }

  /**
   * 纯函数：根据 orientation 角度判断是否横屏
   * @param {number} orientation - 旋转角度（0/90/-90/180）
   * @returns {boolean}
   */
  static isLandscapeByOrientation(orientation) {
    return Math.abs(orientation) === 90;
  }

  /**
   * 获取设备像素比（钳制 1~3，避免高 DPI 设备过度渲染）
   * @returns {number}
   */
  static getDpr() {
    const dpr = window.devicePixelRatio || 1;
    return Math.min(Math.max(dpr, 1), 3);
  }

  /**
   * 读取实际可见视口尺寸。
   * 移动端浏览器的 innerHeight 可能仍包含展开的地址栏，visualViewport 才是
   * 用户此刻真正能看到、也能操作到的区域；桌面端或旧浏览器则回退到 window。
   * @returns {{width:number,height:number}}
   */
  static getViewportSize() {
    if (typeof window === 'undefined') return { width: 0, height: 0 };

    const visualWidth = Number(window.visualViewport?.width);
    const visualHeight = Number(window.visualViewport?.height);
    return {
      width: visualWidth > 0 ? visualWidth : Number(window.innerWidth) || 0,
      height: visualHeight > 0 ? visualHeight : Number(window.innerHeight) || 0,
    };
  }

  /**
   * 把 JS 读取到的可视视口同步给所有 DOM 组件共享的 CSS 变量。
   * 这样即使浏览器不支持 dvh，组件仍会和 fitCanvas 使用同一套尺寸。
   * @param {number} width
   * @param {number} height
   */
  static syncViewportCssVariables(width, height) {
    if (typeof document === 'undefined' || !document.documentElement) return;

    if (Number(width) > 0) {
      document.documentElement.style.setProperty('--gxe-viewport-width', `${Number(width)}px`);
    }
    if (Number(height) > 0) {
      document.documentElement.style.setProperty('--gxe-viewport-height', `${Number(height)}px`);
    }
  }

  /**
   * 纯函数：计算画布等比缩放比例
   * 取宽高比中较小的缩放值，保证画面完整显示且不变形
   * @param {Object} dims
   * @param {number} dims.logicalW - 逻辑宽度
   * @param {number} dims.logicalH - 逻辑高度
   * @param {number} dims.viewportW - 视口宽度
   * @param {number} dims.viewportH - 视口高度
   * @returns {number} 缩放比例
   */
  static calcScale({ logicalW, logicalH, viewportW, viewportH }) {
    const scaleX = viewportW / logicalW;
    const scaleY = viewportH / logicalH;
    return Math.min(scaleX, scaleY);
  }

  /**
   * 获取安全区内边距（刘海/挖孔适配）
   * 通过 CSS 自定义属性中转读取 env() 值，需在 CSS 中预设：
   *   :root { --safe-area-top: env(safe-area-inset-top, 0px); ... }
   * jsdom 环境下返回 0 作为默认值
   * @returns {{top: number, right: number, bottom: number, left: number}}
   */
  static getSafeAreaInsets() {
    const style = getComputedStyle(document.documentElement);
    const parse = (val) => parseInt(val, 10) || 0;
    return {
      top: parse(style.getPropertyValue('--safe-area-top')),
      right: parse(style.getPropertyValue('--safe-area-right')),
      bottom: parse(style.getPropertyValue('--safe-area-bottom')),
      left: parse(style.getPropertyValue('--safe-area-left')),
    };
  }

  /**
   * 将安全区内边距应用到指定 DOM 元素的 padding
   * 用于 UI 层避免被刘海/挖孔/圆角遮挡
   * @param {HTMLElement} element - 需要应用安全区的元素
   */
  static applySafeArea(element) {
    const insets = ViewportAdapter.getSafeAreaInsets();
    element.style.paddingTop = insets.top + 'px';
    element.style.paddingRight = insets.right + 'px';
    element.style.paddingBottom = insets.bottom + 'px';
    element.style.paddingLeft = insets.left + 'px';
  }
}
