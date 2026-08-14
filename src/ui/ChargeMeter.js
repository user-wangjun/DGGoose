/**
 * 蓄力条 UI 组件（对应 PRD §5 F5）
 *
 * 纯 DOM 组件，不使用 Canvas。
 * 提供水平力度条（绿→黄→红渐变）与键盘/按钮备用入口。
 * 主路径由篮球画布上的拖拽瞄准处理；按钮保留给键盘不可用或辅助操作场景。
 *
 * 交互方式：
 * - 触控主路径：拖拽篮球瞄准 → 松手出手
 * - 备用路径：按钮或空格键按住蓄力 → 松开出手
 */

import { applyButtonStyle } from './ButtonTheme.js';

/** 蓄力条样式注入标识，避免重复注入 */
const CHARGE_METER_STYLE_ID = 'charge-meter-style';

export class ChargeMeter {
  /**
   * @param {Object} deps - 依赖配置
   * @param {Function} deps.onChargeStart - 蓄力开始回调（按下时触发）
   * @param {Function} deps.onChargeRelease - 蓄力释放回调（松开时触发，执行出手）
   */
  constructor({ onChargeStart, onChargeRelease }) {
    this.onChargeStart = onChargeStart || null;
    this.onChargeRelease = onChargeRelease || null;

    /** DOM 根容器 */
    this.element = null;
    /** 进度条填充元素 */
    this.fillElement = null;
    /** 蓄力按钮元素 */
    this.buttonElement = null;
    /** 蓄力数值文本元素 */
    this.labelElement = null;
    /** 主交互提示文本元素 */
    this.hintElement = null;

    /** 是否正在蓄力中（防重复触发） */
    this._charging = false;

    // 绑定事件处理器 this 指向，便于 add/removeEventListener
    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
    this._onPointerCancel = this._onPointerCancel.bind(this);
    this._onWindowPointerUp = this._onWindowPointerUp.bind(this);
  }

  /**
   * 挂载蓄力条到指定容器
   * 构建 DOM 结构：标签 + 进度条 + 蓄力按钮
   * @param {HTMLElement} container - 挂载容器（通常为 #ui-root）
   */
  mount(container) {
    this._injectStyle();

    this.element = document.createElement('div');
    this.element.setAttribute('data-charge-meter', '');
    this.element.style.cssText = `
      position: fixed;
      bottom: calc(var(--gxe-game-frame-bottom, 0px) + 68px);
      left: 50%; transform: translateX(-50%);
      z-index: 200; display: flex; flex-direction: column; align-items: center; gap: 10px;
      pointer-events: auto; user-select: none;
    `;

    this.hintElement = document.createElement('div');
    this.hintElement.setAttribute('data-aim-hint', '');
    this.hintElement.textContent = '拖拽篮球瞄准，松手发射';
    this.hintElement.style.cssText = `
      color: #f8fafc; font-size: 14px; font-weight: 700;
      padding: 6px 12px; border-radius: 999px;
      background: rgba(15, 23, 42, 0.78);
      border: 1px solid rgba(148, 163, 184, 0.32);
      box-shadow: 0 8px 20px rgba(2, 6, 23, 0.18);
    `;

    // 进度条行：标签 + 轨道
    const trackRow = document.createElement('div');
    trackRow.style.cssText = 'display: flex; align-items: center; gap: 10px;';

    this.labelElement = document.createElement('span');
    this.labelElement.textContent = '力度';
    this.labelElement.style.cssText = `
      font-size: 14px; color: #cbd5e1; font-family: inherit; min-width: 32px;
    `;

    // 进度条轨道（暗色底）
    const track = document.createElement('div');
    track.style.cssText = `
      width: 260px; height: 18px; border-radius: 9px;
      background: rgba(0,0,0,0.45); border: 1px solid rgba(255,255,255,0.18);
      overflow: hidden;
    `;

    // 填充层：绿→黄→红渐变，宽度随蓄力值变化
    // 低蓄力绿色表示安全，高蓄力红色表示力度大但难控制
    this.fillElement = document.createElement('div');
    this.fillElement.style.cssText = `
      height: 100%; width: 0%; border-radius: 9px;
      background: linear-gradient(90deg, #22c55e, #eab308, #ef4444);
      transition: width 0.03s linear;
    `;

    track.appendChild(this.fillElement);
    trackRow.appendChild(this.labelElement);
    trackRow.appendChild(track);

    // 键盘/按钮备用入口：主路径是篮球本体上的拖拽瞄准。
    this.buttonElement = document.createElement('button');
    this.buttonElement.textContent = '备用蓄力';
    this.buttonElement.setAttribute('aria-label', '备用蓄力，按住后松开出手');
    this.buttonElement.setAttribute('data-aim-fallback', '');
    applyButtonStyle(this.buttonElement, { variant: 'primary', size: 'touch' });
    this.buttonElement.style.cssText = 'touch-action: none; user-select: none;';

    // pointerdown 启动蓄力，pointerup/cancel 结束蓄力
    this.buttonElement.addEventListener('pointerdown', this._onPointerDown);
    this.buttonElement.addEventListener('pointerup', this._onPointerUp);
    this.buttonElement.addEventListener('pointercancel', this._onPointerCancel);

    this.element.appendChild(this.hintElement);
    this.element.appendChild(trackRow);
    this.element.appendChild(this.buttonElement);

    container.appendChild(this.element);
  }

  /**
   * 更新蓄力条显示宽度
   * @param {number} charge - 当前蓄力值（0~100）
   */
  update(charge) {
    if (!this.fillElement) return;
    const clamped = Math.max(0, Math.min(100, charge));
    this.fillElement.style.width = `${clamped}%`;
  }

  /**
   * 销毁组件，移除所有事件监听与 DOM 元素
   */
  destroy() {
    // 移除 window 级兜底监听（若存在）
    window.removeEventListener('pointerup', this._onWindowPointerUp);

    if (this.buttonElement) {
      this.buttonElement.removeEventListener('pointerdown', this._onPointerDown);
      this.buttonElement.removeEventListener('pointerup', this._onPointerUp);
      this.buttonElement.removeEventListener('pointercancel', this._onPointerCancel);
    }
    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }
    this.element = null;
    this.fillElement = null;
    this.buttonElement = null;
    this.labelElement = null;
    this.hintElement = null;
    this.onChargeStart = null;
    this.onChargeRelease = null;
    this._charging = false;
  }

  // ==================== 指针事件处理 ====================

  /**
   * 按下蓄力按钮：启动蓄力并捕获指针
   * 使用 setPointerCapture 确保指针移出按钮后仍能收到 pointerup；
   * 同时在 window 上注册兜底 pointerup，防止捕获失败时蓄力卡住
   * @param {PointerEvent} e
   * @private
   */
  _onPointerDown(e) {
    e.preventDefault();
    if (this._charging) return;

    // 尝试捕获指针，保证 pointerup 能被按钮接收
    try {
      this.buttonElement.setPointerCapture(e.pointerId);
    } catch (_err) {
      // 部分环境不支持 setPointerCapture，降级依赖 window 兜底
    }

    // window 级兜底：无论指针在哪释放都能触发出手
    window.addEventListener('pointerup', this._onWindowPointerUp);

    this._charging = true;
    this.buttonElement.dataset.state = 'pressed';
    if (this.onChargeStart) this.onChargeStart();
  }

  /**
   * 按钮上释放指针：触发出手
   * @private
   */
  _onPointerUp() {
    this._release();
  }

  /**
   * 指针被系统中断（如来电、切换应用）：释放蓄力
   * @private
   */
  _onPointerCancel() {
    this._release();
  }

  /**
   * window 级 pointerup 兜底处理
   * 当 setPointerCapture 不可用或指针在按钮外释放时由此回调兜底
   * @private
   */
  _onWindowPointerUp() {
    this._release();
  }

  /**
   * 释放蓄力的统一内部入口
   * 重置按钮视觉、移除 window 监听、触发出手回调
   * 通过 _charging 标志防重复调用
   * @private
   */
  _release() {
    if (!this._charging) return;
    this._charging = false;

    window.removeEventListener('pointerup', this._onWindowPointerUp);

    if (this.buttonElement) {
      this.buttonElement.dataset.state = 'idle';
    }
    if (this.onChargeRelease) this.onChargeRelease();
  }

  // ==================== 样式注入 ====================

  /**
   * 注入蓄力按钮按下时的脉冲动画样式（全局注入一次）
   * @private
   */
  _injectStyle() {
    if (document.getElementById(CHARGE_METER_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = CHARGE_METER_STYLE_ID;
    style.textContent = `
      [data-charge-meter] button:active,
      [data-charge-meter] button[data-state="pressed"] {
        animation: charge-pulse 0.6s ease-in-out infinite;
      }
      @keyframes charge-pulse {
        0%, 100% { box-shadow: 0 0 0 0 rgba(233, 166, 90, 0.42); }
        50% { box-shadow: 0 0 0 8px rgba(233, 166, 90, 0); }
      }
    `;
    document.head.appendChild(style);
  }
}
