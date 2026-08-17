import { EVENT } from '../config.js';
import { Overlay } from './Overlay.js';
import { applyButtonStyle } from './ButtonTheme.js';

/** 语言选项标签映射，首版简中完整可用，其余保留为已有选项。 */
const LANG_LABELS = {
  'zh-CN': '简体中文',
  'zh-TW': '繁體中文',
  en: 'English',
};

/** 滑杆范围沿用 SettingsService 的既有字段和边界。 */
const SLIDER_CONFIG = {
  bgm: { label: 'BGM 音量', min: 0, max: 100 },
  sfx: { label: '音效音量', min: 0, max: 100 },
  textSpeed: { label: '文字速度', min: 1, max: 60 },
};

/** 重置确认超时（毫秒）：超时后自动回到普通按钮状态。 */
const RESET_CONFIRM_TIMEOUT = 3000;

/** 设置面板样式只注入一次，避免共享 UI 样式重复累积。 */
const SETTINGS_PANEL_STYLE_ID = 'goose-escape-settings-panel-style';

/** 允许同一页面中存在多个测试/预览实例时仍保持 aria id 唯一。 */
let settingsPanelInstanceId = 0;

const SETTINGS_PANEL_CSS = `
  [data-settings-overlay] {
    position: fixed;
    inset: 0;
    z-index: 9000;
    display: flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    padding: max(12px, env(safe-area-inset-top, 0px))
      max(12px, env(safe-area-inset-right, 0px))
      max(12px, env(safe-area-inset-bottom, 0px))
      max(12px, env(safe-area-inset-left, 0px));
    background: rgba(44, 25, 19, 0.68);
    backdrop-filter: blur(3px);
    pointer-events: auto;
  }

  [data-settings-overlay] [data-overlay-content] {
    display: flex;
    align-items: center;
    justify-content: center;
    width: auto;
    max-width: 100%;
    max-height: 100%;
    padding: 0;
    overflow: visible;
    pointer-events: auto;
  }

  [data-settings-panel] {
    position: relative;
    isolation: isolate;
    box-sizing: border-box;
    color: #4a2a1b;
    font-family: "Microsoft YaHei", "PingFang SC", sans-serif;
    line-height: 1.45;
    border: 3px solid #6d4127;
    border-radius: 24px;
    background:
      radial-gradient(circle at 12% 0%, rgba(255, 255, 255, 0.84), transparent 29%),
      repeating-linear-gradient(7deg, rgba(128, 77, 38, 0.045) 0 1px, transparent 1px 7px),
      linear-gradient(145deg, #fff4d8 0%, #f9e2ba 54%, #efc98f 100%);
    overflow-x: hidden;
    overflow-y: auto;
    box-shadow:
      0 0 0 2px rgba(255, 232, 170, 0.78),
      0 12px 0 rgba(89, 48, 27, 0.22),
      0 24px 54px rgba(35, 18, 11, 0.42),
      inset 0 1px 0 rgba(255, 255, 255, 0.9);
    scrollbar-color: rgba(139, 81, 42, 0.68) transparent;
    scrollbar-width: thin;
  }

  [data-settings-panel]::before,
  [data-settings-panel]::after {
    position: absolute;
    z-index: -1;
    content: "";
    pointer-events: none;
  }

  [data-settings-panel]::before {
    top: 14px;
    right: 16px;
    width: 42px;
    height: 42px;
    border-top: 2px solid rgba(174, 98, 53, 0.45);
    border-right: 2px solid rgba(174, 98, 53, 0.45);
    border-radius: 0 18px 0 0;
    transform: rotate(8deg);
  }

  [data-settings-panel]::after {
    bottom: 14px;
    left: 16px;
    width: 30px;
    height: 18px;
    border-bottom: 2px solid rgba(174, 98, 53, 0.38);
    border-left: 2px solid rgba(174, 98, 53, 0.38);
    border-radius: 0 0 0 15px;
    transform: rotate(-10deg);
  }

  [data-settings-header] {
    position: relative;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 14px;
    margin-bottom: 20px;
    padding-bottom: 16px;
    border-bottom: 1px solid rgba(122, 70, 37, 0.27);
  }

  [data-settings-header]::after {
    position: absolute;
    right: 0;
    bottom: -2px;
    left: 0;
    height: 3px;
    content: "";
    background: linear-gradient(90deg, transparent, rgba(183, 76, 59, 0.72), transparent);
    opacity: 0.7;
  }

  [data-settings-eyebrow] {
    margin-bottom: 5px;
    color: #a86c28;
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.2em;
    text-transform: uppercase;
  }

  [data-settings-title] {
    display: inline-flex;
    align-items: center;
    min-height: 43px;
    margin: 0;
    padding: 7px 20px 8px;
    border: 2px solid #6d4127;
    border-radius: 12px 15px 15px 4px;
    background: linear-gradient(135deg, #9d3f35 0%, #bd5540 63%, #d87b4b 100%);
    color: #fff4d5;
    font-size: clamp(23px, 3vw, 30px);
    font-weight: 900;
    letter-spacing: 0.12em;
    line-height: 1;
    text-shadow: 0 1px 1px rgba(81, 35, 20, 0.66);
    box-shadow: 3px 4px 0 rgba(98, 48, 27, 0.18), inset 0 1px 0 rgba(255, 244, 214, 0.52);
  }

  [data-settings-flourish] {
    flex: 0 0 auto;
    margin-top: 5px;
    color: #b87430;
    font-family: Georgia, serif;
    font-size: 27px;
    line-height: 1;
    opacity: 0.78;
    transform: rotate(16deg);
  }

  [data-settings-description] {
    max-width: 32ch;
    margin: 9px 0 0;
    color: #79543c;
    font-size: 13px;
    line-height: 1.55;
  }

  [data-settings-section] {
    margin: 0 0 16px;
    padding: 14px 15px 5px;
    border: 1px solid rgba(123, 73, 40, 0.24);
    border-radius: 15px;
    background: rgba(255, 249, 226, 0.46);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.58);
  }

  [data-settings-section-title] {
    margin: 0 0 9px;
    color: #8f493a;
    font-size: 12px;
    font-weight: 900;
    letter-spacing: 0.12em;
  }

  [data-settings-slider-row],
  [data-settings-choice-row],
  [data-settings-shake-row] {
    min-width: 0;
    border-top: 1px dashed rgba(125, 75, 41, 0.2);
  }

  [data-settings-slider-row] {
    display: grid;
    grid-template-columns: minmax(74px, 0.9fr) minmax(0, 1.7fr) 42px;
    align-items: center;
    gap: 12px;
    min-height: 56px;
  }

  [data-settings-slider-row]:first-of-type,
  [data-settings-choice-row]:first-of-type,
  [data-settings-shake-row]:first-of-type {
    border-top: 0;
  }

  [data-settings-label] {
    color: #583624;
    font-size: 14px;
    font-weight: 800;
    white-space: nowrap;
  }

  [data-settings-slider] {
    display: block;
    width: 100%;
    height: 26px;
    margin: 0;
    appearance: none;
    background: transparent;
    cursor: pointer;
    touch-action: manipulation;
  }

  [data-settings-slider]::-webkit-slider-runnable-track {
    height: 8px;
    border: 1px solid rgba(123, 73, 40, 0.46);
    border-radius: 999px;
    background: linear-gradient(
      90deg,
      #b74d40 0%,
      #e18c4f var(--settings-percent, 0%),
      #d8bd8a var(--settings-percent, 0%),
      #ead9b4 100%
    );
    box-shadow: inset 0 1px 2px rgba(86, 44, 23, 0.22), 0 1px 0 rgba(255, 255, 255, 0.55);
  }

  [data-settings-slider]::-moz-range-track {
    height: 8px;
    border: 1px solid rgba(123, 73, 40, 0.46);
    border-radius: 999px;
    background: #ead9b4;
    box-shadow: inset 0 1px 2px rgba(86, 44, 23, 0.22), 0 1px 0 rgba(255, 255, 255, 0.55);
  }

  [data-settings-slider]::-moz-range-progress {
    height: 8px;
    border-radius: 999px;
    background: linear-gradient(90deg, #b74d40, #e18c4f);
  }

  [data-settings-slider]::-webkit-slider-thumb {
    width: 22px;
    height: 22px;
    margin-top: -8px;
    appearance: none;
    border: 2px solid #fff3d0;
    border-radius: 50%;
    background: #b64b40;
    box-shadow: 0 2px 0 #7c392e, 0 3px 7px rgba(73, 35, 20, 0.3);
    transition: transform 120ms ease, box-shadow 120ms ease, background 120ms ease;
  }

  [data-settings-slider]::-moz-range-thumb {
    width: 18px;
    height: 18px;
    border: 2px solid #fff3d0;
    border-radius: 50%;
    background: #b64b40;
    box-shadow: 0 2px 0 #7c392e, 0 3px 7px rgba(73, 35, 20, 0.3);
  }

  [data-settings-slider]:hover::-webkit-slider-thumb,
  [data-settings-slider]:active::-webkit-slider-thumb {
    background: #d46b45;
    box-shadow: 0 2px 0 #7c392e, 0 4px 10px rgba(73, 35, 20, 0.34);
    transform: scale(1.1);
  }

  [data-settings-slider]:focus-visible {
    outline: 2px solid #a84b3e;
    outline-offset: 3px;
    border-radius: 999px;
  }

  [data-settings-value] {
    min-width: 42px;
    padding: 4px 5px;
    border: 1px solid rgba(137, 84, 43, 0.35);
    border-radius: 8px;
    background: rgba(255, 250, 232, 0.65);
    color: #914538;
    font-size: 13px;
    font-variant-numeric: tabular-nums;
    font-weight: 900;
    text-align: center;
  }

  [data-settings-choice-row],
  [data-settings-shake-row] {
    display: grid;
    grid-template-columns: minmax(74px, 0.9fr) minmax(0, 2.1fr);
    align-items: center;
    gap: 12px;
    min-height: 67px;
  }

  [data-settings-language-group] {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    min-width: 0;
  }

  [data-lang-option] {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    min-height: 35px;
    padding: 5px 10px;
    border: 1px solid rgba(124, 76, 43, 0.36);
    border-radius: 999px;
    background: rgba(255, 250, 235, 0.67);
    color: #6d4a35;
    font-size: 12px;
    font-weight: 800;
    cursor: pointer;
    transition: border-color 140ms ease, background 140ms ease, color 140ms ease, transform 140ms ease;
    user-select: none;
  }

  [data-lang-option]:hover,
  [data-lang-option][data-selected="true"] {
    border-color: #a9463d;
    background: linear-gradient(135deg, rgba(179, 73, 62, 0.95), rgba(214, 119, 70, 0.95));
    color: #fff5df;
    box-shadow: 0 2px 0 rgba(100, 45, 30, 0.22);
    transform: translateY(-1px);
  }

  [data-lang-option]:focus-within {
    outline: 2px solid #a84b3e;
    outline-offset: 2px;
  }

  [data-lang-radio] {
    width: 16px;
    height: 16px;
    flex: 0 0 auto;
    margin: 0;
    appearance: none;
    border: 2px solid #9c7453;
    border-radius: 50%;
    background: rgba(255, 248, 224, 0.9);
    cursor: pointer;
  }

  [data-lang-radio]:checked {
    border-color: #fff1d0;
    background: radial-gradient(circle, #fff1d0 0 30%, #ad493e 34% 70%, #7a382f 72% 100%);
  }

  [data-lang-radio]:focus-visible {
    outline: 2px solid #a84b3e;
    outline-offset: 2px;
  }

  [data-shake-toggle] {
    position: relative;
    display: block;
    width: 58px;
    height: 32px;
    margin: 0;
    appearance: none;
    border: 2px solid #7e6a5a;
    border-radius: 999px;
    background: #9c8c7b;
    cursor: pointer;
    transition: background 140ms ease, border-color 140ms ease, box-shadow 140ms ease;
  }

  [data-shake-toggle]::before {
    position: absolute;
    top: 3px;
    left: 3px;
    width: 22px;
    height: 22px;
    content: "";
    border: 1px solid rgba(103, 55, 34, 0.3);
    border-radius: 50%;
    background: #fff5db;
    box-shadow: 0 2px 3px rgba(68, 37, 23, 0.28);
    transition: transform 160ms ease;
  }

  [data-shake-toggle]:checked {
    border-color: #8b392f;
    background: linear-gradient(90deg, #ad493f, #db7a47);
  }

  [data-shake-toggle]:checked::before {
    transform: translateX(26px);
  }

  [data-shake-toggle]:focus-visible {
    outline: 2px solid #a84b3e;
    outline-offset: 3px;
  }

  [data-shake-status] {
    margin-left: 8px;
    color: #8f493a;
    font-size: 12px;
    font-weight: 800;
  }

  [data-vibration-hint] {
    display: block;
    margin-top: 4px;
    color: #8b7868;
    font-size: 11px;
    line-height: 1.4;
  }

  [data-settings-shake-controls] {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 2px;
  }

  [data-settings-actions] {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.14fr);
    gap: 10px;
    align-items: center;
    margin-top: 18px;
    padding-top: 15px;
    border-top: 1px solid rgba(122, 70, 37, 0.27);
  }

  [data-settings-actions] [data-ui-button] {
    width: 100%;
    min-width: 0;
    min-height: 43px;
  }

  [data-settings-actions] [data-reset-btn] {
    border-color: rgba(137, 71, 54, 0.52);
    color: #7c4037;
    background: rgba(255, 240, 216, 0.72);
    box-shadow: 0 2px 0 rgba(110, 57, 38, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.62);
  }

  [data-settings-actions] [data-reset-btn]:hover:not(:disabled),
  [data-settings-actions] [data-reset-btn][data-state="hover"] {
    color: #fff5e4;
    background: linear-gradient(180deg, #c26a53 0%, #a24b3e 100%);
  }

  [data-settings-actions] [data-reset-btn][data-confirming="true"] {
    border-color: #8b392f;
    color: #fff5e4;
    background: linear-gradient(180deg, #bd5547 0%, #92382f 100%);
    box-shadow: 0 3px 0 #6e2925, 0 0 0 3px rgba(190, 82, 65, 0.18);
  }

  [data-reset-status] {
    grid-column: 1 / -1;
    min-height: 15px;
    margin: -2px 2px 0;
    color: #89644a;
    font-size: 11px;
    line-height: 1.35;
    text-align: center;
  }

  [data-settings-panel] :focus-visible {
    outline-color: #a84b3e;
  }

  @media (max-width: 620px) {
    [data-settings-panel] {
      border-radius: 20px;
    }

    [data-settings-header] {
      margin-bottom: 14px;
      padding-bottom: 12px;
    }

    [data-settings-section] {
      margin-bottom: 11px;
      padding: 10px 11px 2px;
      border-radius: 13px;
    }

    [data-settings-slider-row] {
      grid-template-columns: minmax(68px, 0.85fr) minmax(0, 1.8fr) 39px;
      min-height: 48px;
      gap: 8px;
    }

    [data-settings-choice-row],
    [data-settings-shake-row] {
      grid-template-columns: minmax(68px, 0.85fr) minmax(0, 2fr);
      min-height: 58px;
      gap: 8px;
    }

    [data-lang-option] {
      min-height: 32px;
      padding: 4px 8px;
      font-size: 11px;
    }

    [data-settings-description] {
      font-size: 12px;
    }
  }

  @media (orientation: landscape) and (max-height: 500px) {
    [data-settings-panel] {
      max-height: calc(100dvh - max(20px, env(safe-area-inset-top, 0px) + env(safe-area-inset-bottom, 0px) + 20px));
      padding: 15px 18px max(16px, env(safe-area-inset-bottom, 0px));
      border-radius: 18px;
    }

    [data-settings-header] {
      margin-bottom: 10px;
      padding-bottom: 9px;
    }

    [data-settings-eyebrow] {
      margin-bottom: 2px;
      font-size: 9px;
    }

    [data-settings-title] {
      min-height: 34px;
      padding: 5px 14px 6px;
      font-size: 21px;
    }

    [data-settings-description] {
      margin-top: 5px;
      font-size: 11px;
    }

    [data-settings-flourish] {
      font-size: 20px;
    }

    [data-settings-section] {
      margin-bottom: 8px;
      padding: 7px 10px 1px;
    }

    [data-settings-section-title] {
      margin-bottom: 4px;
      font-size: 10px;
    }

    [data-settings-slider-row] {
      min-height: 40px;
    }

    [data-settings-choice-row],
    [data-settings-shake-row] {
      min-height: 45px;
    }

    [data-settings-actions] {
      margin-top: 10px;
      padding-top: 9px;
    }
  }

  /* 低高度手机横屏优先保证设置面板的完整首屏，避免按钮只存在于不可见滚动区。 */
  @media (orientation: landscape) and (max-height: 420px) {
    [data-settings-overlay] {
      padding: max(6px, env(safe-area-inset-top, 0px))
        max(6px, env(safe-area-inset-right, 0px))
        max(6px, env(safe-area-inset-bottom, 0px))
        max(6px, env(safe-area-inset-left, 0px));
    }

    [data-settings-panel] {
      max-height: calc(100dvh - max(12px, env(safe-area-inset-top, 0px) + env(safe-area-inset-bottom, 0px) + 12px));
      padding: 8px 12px max(8px, env(safe-area-inset-bottom, 0px));
      border-width: 2px;
      border-radius: 14px;
    }

    [data-settings-header] {
      gap: 8px;
      margin-bottom: 6px;
      padding-bottom: 6px;
    }

    [data-settings-eyebrow] {
      display: none;
    }

    [data-settings-title] {
      min-height: 28px;
      padding: 4px 11px 5px;
      font-size: 18px;
    }

    [data-settings-description] {
      display: none;
    }

    [data-settings-flourish] {
      margin-top: 0;
      font-size: 16px;
    }

    [data-settings-section] {
      margin-bottom: 4px;
      padding: 4px 7px 0;
      border-radius: 10px;
    }

    [data-settings-section-title] {
      margin-bottom: 2px;
      font-size: 9px;
    }

    [data-settings-slider-row] {
      grid-template-columns: minmax(62px, 0.8fr) minmax(0, 1.8fr) 36px;
      min-height: 30px;
      gap: 6px;
    }

    [data-settings-choice-row],
    [data-settings-shake-row] {
      grid-template-columns: minmax(62px, 0.8fr) minmax(0, 2fr);
      min-height: 35px;
      gap: 6px;
    }

    [data-settings-label] {
      font-size: 11px;
    }

    [data-settings-slider] {
      height: 22px;
    }

    [data-settings-value] {
      min-width: 36px;
      padding: 2px 3px;
      font-size: 11px;
    }

    [data-lang-option] {
      min-height: 26px;
      padding: 2px 6px;
      gap: 4px;
      font-size: 9px;
    }

    [data-lang-radio] {
      width: 12px;
      height: 12px;
    }

    [data-shake-toggle] {
      width: 48px;
      height: 26px;
    }

    [data-shake-toggle]::before {
      top: 2px;
      left: 2px;
      width: 18px;
      height: 18px;
    }

    [data-shake-toggle]:checked::before {
      transform: translateX(20px);
    }

    [data-shake-status] {
      margin-left: 5px;
      font-size: 10px;
    }

    [data-settings-actions] {
      gap: 6px;
      margin-top: 5px;
      padding-top: 5px;
    }

    [data-settings-actions] [data-ui-button] {
      min-height: 32px;
      padding-block: 5px;
      font-size: 11px;
    }

    [data-reset-status] {
      min-height: 12px;
      margin-top: -1px;
      font-size: 9px;
    }
  }

  /* 720p 横向桌面仍应在初始位置看到完整操作区，避免把主要按钮藏在滚动折叠线下。 */
  @media (min-height: 501px) and (max-height: 760px) {
    [data-settings-panel] {
      padding-top: 24px;
      padding-bottom: 18px;
    }

    [data-settings-header] {
      margin-bottom: 14px;
      padding-bottom: 11px;
    }

    [data-settings-section] {
      margin-bottom: 10px;
      padding-top: 10px;
      padding-bottom: 2px;
    }

    [data-settings-section-title] {
      margin-bottom: 5px;
    }

    [data-settings-slider-row] {
      min-height: 48px;
    }

    [data-settings-choice-row],
    [data-settings-shake-row] {
      min-height: 58px;
    }

    [data-settings-actions] {
      margin-top: 11px;
      padding-top: 10px;
    }
  }

  @media (max-width: 420px) {
    [data-settings-actions] {
      grid-template-columns: 1fr;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    [data-settings-panel] *,
    [data-settings-panel] *::before,
    [data-settings-panel] *::after {
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
      scroll-behavior: auto !important;
      transition-duration: 0.01ms !important;
    }
  }
`;

/**
 * 设置面板（对应 PRD §5 F12）。
 *
 * 组件只负责 UI 和交互编排，字段校验、事件广播、存储和默认值继续由
 * SettingsService 负责；BGM/SFX 即时联动继续走 EVENT.SETTING_CHANGE。
 */
export class SettingsPanel {
  /**
   * @param {Object} deps - 依赖注入
   * @param {SettingsService} deps.settingsService - 设置服务
   * @param {AudioManager} [deps.audioManager] - 音频管理器（可选）
   * @param {EventBus} deps.eventBus - 事件总线
   * @param {HTMLElement} deps.container - 挂载容器
   */
  constructor({ settingsService, audioManager, eventBus, container }) {
    this.settingsService = settingsService;
    this.audioManager = audioManager || null;
    this.eventBus = eventBus;
    this.container = container;

    // 兼容当前入口中未把 EventBus 传给 SettingsService 的旧装配方式。
    // 不替换已有总线，只补齐服务 set() 广播所需的依赖，保持既有字段和接口不变。
    if (this.settingsService && !this.settingsService.eventBus && this.eventBus) {
      this.settingsService.eventBus = this.eventBus;
    }

    this.element = null;
    this.overlay = null;
    this._subscribed = false;
    this._confirmingReset = false;
    this._resetConfirmTimer = null;

    const instanceId = ++settingsPanelInstanceId;
    this._titleId = `settings-panel-title-${instanceId}`;
    this._descriptionId = `settings-panel-description-${instanceId}`;
    this._resetStatusId = `settings-panel-reset-status-${instanceId}`;

    this._onSettingChange = this._onSettingChange.bind(this);
    this._onBgmInput = this._onBgmInput.bind(this);
    this._onSfxInput = this._onSfxInput.bind(this);
    this._onTextSpeedInput = this._onTextSpeedInput.bind(this);
    this._onLangChange = this._onLangChange.bind(this);
    this._onShakeChange = this._onShakeChange.bind(this);
    this._onResetClick = this._onResetClick.bind(this);
    this._onCloseClick = this._onCloseClick.bind(this);
  }

  /** 构建面板并挂载 overlay；重复 create 会复用同一 DOM 和事件订阅。 */
  create() {
    if (this.element) return this.element;

    this._injectStyles();
    this.element = this._buildPanel();
    this.overlay = new Overlay({
      container: this.container,
      dismissible: true,
      onClose: () => this.hide(),
    });
    this._mountOverlay();

    this.eventBus.on(EVENT.SETTING_CHANGE, this._onSettingChange);
    this._subscribed = true;
    return this.element;
  }

  /** 显示面板并从设置服务同步全部控件。 */
  show() {
    if (!this.element) this.create();

    // Overlay 的 backdrop 关闭会把它自身移出 DOM；下次打开时重新挂载同一个面板。
    this._mountOverlay();
    this.element.style.display = 'block';
    if (this.overlay?.element) this.overlay.element.style.display = 'flex';
    this._syncControls();
  }

  /** 隐藏面板并强制 flush，保留既有关闭和持久化语义。 */
  hide() {
    if (this.element) this.element.style.display = 'none';
    if (this.overlay?.element) this.overlay.element.style.display = 'none';

    this.settingsService.flush();
    this._cancelResetConfirm();
  }

  /** 移除设置事件订阅、取消计时器并清理 overlay/DOM。 */
  destroy() {
    if (this._subscribed) {
      this.eventBus.off(EVENT.SETTING_CHANGE, this._onSettingChange);
      this._subscribed = false;
    }
    this._cancelResetConfirm();

    if (this.overlay) {
      this.overlay.destroy();
      this.overlay = null;
    }
    this.element = null;
    this.audioManager = null;
  }

  // ==================== DOM 构建 ====================

  _injectStyles() {
    if (typeof document === 'undefined' || document.getElementById(SETTINGS_PANEL_STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = SETTINGS_PANEL_STYLE_ID;
    style.textContent = SETTINGS_PANEL_CSS;
    document.head.appendChild(style);
  }

  /** Overlay 可能已经被 backdrop close 清空，按需重新挂载并套用正式层级。 */
  _mountOverlay() {
    if (!this.overlay || !this.element) return;
    if (!this.overlay.element) this.overlay.mount(this.element);

    this.overlay.element.setAttribute('data-settings-overlay', '');
    this.overlay.element.style.cssText = `
      position: fixed; inset: 0; z-index: 9000; display: flex;
      align-items: center; justify-content: center; box-sizing: border-box;
      padding: max(12px, env(safe-area-inset-top, 0px))
        max(12px, env(safe-area-inset-right, 0px))
        max(12px, env(safe-area-inset-bottom, 0px))
        max(12px, env(safe-area-inset-left, 0px));
      background: rgba(44, 25, 19, 0.68); backdrop-filter: blur(3px);
      pointer-events: auto;
    `;
    if (this.overlay.contentElement) {
      this.overlay.contentElement.style.cssText = `
        position: relative; display: flex; align-items: center; justify-content: center;
        width: auto; max-width: 100%; max-height: 100%; padding: 0;
        overflow: visible; pointer-events: auto;
      `;
    }
  }

  _buildPanel() {
    const panel = document.createElement('div');
    panel.setAttribute('data-settings-panel', '');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', this._titleId);
    panel.setAttribute('aria-describedby', this._descriptionId);
    panel.tabIndex = -1;
    panel.style.cssText = `
      display: block; width: min(520px, calc(100vw - max(24px, env(safe-area-inset-left, 0px) + env(safe-area-inset-right, 0px))));
      max-width: 100%; max-height: calc(100dvh - max(24px, env(safe-area-inset-top, 0px) + env(safe-area-inset-bottom, 0px)));
      min-height: 0; overflow-x: hidden; overflow-y: auto; scrollbar-gutter: stable;
      padding: clamp(24px, 3.5vw, 36px) clamp(22px, 3.8vw, 40px) max(24px, env(safe-area-inset-bottom, 0px));
    `;

    panel.appendChild(this._buildHeader());
    panel.appendChild(this._buildSliderSection());
    panel.appendChild(this._buildChoiceSection());
    panel.appendChild(this._buildActions());
    return panel;
  }

  _buildHeader() {
    const header = document.createElement('header');
    header.setAttribute('data-settings-header', '');

    const copy = document.createElement('div');
    const eyebrow = document.createElement('div');
    eyebrow.setAttribute('data-settings-eyebrow', '');
    eyebrow.textContent = 'GOOSE ESCAPE';

    const title = document.createElement('h2');
    title.id = this._titleId;
    title.setAttribute('data-settings-title', '');
    title.textContent = '设置';

    const description = document.createElement('p');
    description.id = this._descriptionId;
    description.setAttribute('data-settings-description', '');
    description.textContent = '调一调出发节奏，保存后继续莞小鹅的城市冒险。';

    copy.append(eyebrow, title, description);
    header.appendChild(copy);

    const flourish = document.createElement('span');
    flourish.setAttribute('data-settings-flourish', '');
    flourish.setAttribute('aria-hidden', 'true');
    flourish.textContent = '✦';
    header.appendChild(flourish);
    return header;
  }

  _buildSliderSection() {
    const section = document.createElement('section');
    section.setAttribute('data-settings-section', 'sliders');
    section.setAttribute('aria-labelledby', `${this._titleId}-sliders`);

    const sectionTitle = document.createElement('h3');
    sectionTitle.id = `${this._titleId}-sliders`;
    sectionTitle.setAttribute('data-settings-section-title', '');
    sectionTitle.textContent = '声音与阅读';
    section.appendChild(sectionTitle);

    for (const [key, config] of Object.entries(SLIDER_CONFIG)) {
      section.appendChild(this._buildSliderRow(key, config));
    }
    return section;
  }

  _buildSliderRow(key, config) {
    const row = document.createElement('div');
    row.setAttribute('data-settings-slider-row', key);

    const sliderId = `settings-${key}-slider-${this._titleId.split('-').pop()}`;
    const label = document.createElement('label');
    label.setAttribute('data-settings-label', '');
    label.htmlFor = sliderId;
    label.textContent = config.label;

    const slider = document.createElement('input');
    slider.id = sliderId;
    slider.type = 'range';
    slider.min = String(config.min);
    slider.max = String(config.max);
    slider.step = '1';
    slider.value = String(this.settingsService.get(key));
    slider.setAttribute(`data-${key}-slider`, '');
    slider.setAttribute('data-settings-slider', '');
    slider.setAttribute('aria-label', config.label);
    slider.addEventListener('input', this._getSliderHandler(key));

    const valueDisplay = document.createElement('output');
    valueDisplay.setAttribute(`data-${key}-value`, '');
    valueDisplay.setAttribute('data-settings-value', '');
    valueDisplay.htmlFor = sliderId;
    valueDisplay.setAttribute('aria-live', 'polite');
    valueDisplay.textContent = slider.value;

    row.append(label, slider, valueDisplay);
    this._setSliderVisual(slider, valueDisplay, Number(slider.value));
    return row;
  }

  _buildChoiceSection() {
    const section = document.createElement('section');
    section.setAttribute('data-settings-section', 'choices');
    section.setAttribute('aria-labelledby', `${this._titleId}-choices`);

    const sectionTitle = document.createElement('h3');
    sectionTitle.id = `${this._titleId}-choices`;
    sectionTitle.setAttribute('data-settings-section-title', '');
    sectionTitle.textContent = '冒险偏好';
    section.appendChild(sectionTitle);

    section.appendChild(this._buildLangRow());
    section.appendChild(this._buildShakeRow());
    return section;
  }

  _buildLangRow() {
    const row = document.createElement('div');
    row.setAttribute('data-settings-choice-row', 'language');

    const labelId = `${this._titleId}-language-label`;
    const label = document.createElement('span');
    label.id = labelId;
    label.setAttribute('data-settings-label', '');
    label.textContent = '语言';

    const group = document.createElement('div');
    group.setAttribute('data-settings-language-group', '');
    group.setAttribute('role', 'radiogroup');
    group.setAttribute('aria-labelledby', labelId);

    const currentLang = this.settingsService.get('lang');
    for (const [langCode, langLabel] of Object.entries(LANG_LABELS)) {
      const option = document.createElement('label');
      option.setAttribute('data-lang-option', langCode);
      option.dataset.selected = String(langCode === currentLang);
      option.htmlFor = `settings-lang-${langCode}-${this._titleId.split('-').pop()}`;

      const radio = document.createElement('input');
      radio.id = option.htmlFor;
      radio.type = 'radio';
      radio.name = 'lang';
      radio.value = langCode;
      radio.checked = langCode === currentLang;
      radio.setAttribute('data-lang-radio', '');
      radio.setAttribute('aria-label', langLabel);
      radio.addEventListener('change', this._onLangChange);

      const text = document.createElement('span');
      text.textContent = langLabel;

      option.append(radio, text);
      group.appendChild(option);
    }

    row.append(label, group);
    return row;
  }

  _buildShakeRow() {
    const row = document.createElement('div');
    row.setAttribute('data-settings-shake-row', '');

    const labelId = `${this._titleId}-shake-label`;
    const label = document.createElement('label');
    label.id = labelId;
    label.setAttribute('data-settings-label', '');
    label.htmlFor = `settings-shake-toggle-${this._titleId.split('-').pop()}`;
    label.textContent = '屏幕震动';

    const controls = document.createElement('div');
    controls.setAttribute('data-settings-shake-controls', '');

    const toggle = document.createElement('input');
    toggle.id = label.htmlFor;
    toggle.type = 'checkbox';
    toggle.checked = Boolean(this.settingsService.get('shake'));
    toggle.setAttribute('data-shake-toggle', '');
    toggle.setAttribute('aria-labelledby', labelId);
    toggle.addEventListener('change', this._onShakeChange);

    const status = document.createElement('span');
    status.setAttribute('data-shake-status', '');
    status.setAttribute('aria-live', 'polite');

    controls.append(toggle, status);
    row.append(label, controls);

    if (!this._supportsVibration()) {
      const hint = document.createElement('span');
      hint.setAttribute('data-vibration-hint', '');
      hint.textContent = '当前设备不支持震动反馈';
      hint.setAttribute('aria-live', 'polite');
      controls.appendChild(hint);
    }

    this._styleToggle(toggle);
    status.textContent = toggle.checked ? '开启' : '关闭';
    return row;
  }

  _buildActions() {
    const actions = document.createElement('footer');
    actions.setAttribute('data-settings-actions', '');

    const resetBtn = document.createElement('button');
    resetBtn.textContent = '重置设置';
    resetBtn.setAttribute('data-reset-btn', '');
    resetBtn.setAttribute('aria-describedby', this._resetStatusId);
    applyButtonStyle(resetBtn, { variant: 'danger', size: 'sm' });
    resetBtn.addEventListener('click', this._onResetClick);

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '关闭';
    closeBtn.setAttribute('data-close-btn', '');
    applyButtonStyle(closeBtn, { variant: 'primary', size: 'sm' });
    closeBtn.addEventListener('click', this._onCloseClick);

    const resetStatus = document.createElement('span');
    resetStatus.id = this._resetStatusId;
    resetStatus.setAttribute('data-reset-status', '');
    resetStatus.setAttribute('aria-live', 'polite');
    resetStatus.textContent = '重置会恢复全部设置的默认值';

    actions.append(resetBtn, closeBtn, resetStatus);
    return actions;
  }

  // ==================== 事件处理 ====================

  _getSliderHandler(key) {
    if (key === 'bgm') return this._onBgmInput;
    if (key === 'sfx') return this._onSfxInput;
    if (key === 'textSpeed') return this._onTextSpeedInput;
    return () => {};
  }

  _onBgmInput(event) {
    const value = Number(event.target.value);
    this._updateSliderVisual('bgm', value);
    this.settingsService.set('bgm', value);
  }

  _onSfxInput(event) {
    const value = Number(event.target.value);
    this._updateSliderVisual('sfx', value);
    this.settingsService.set('sfx', value);
  }

  _onTextSpeedInput(event) {
    const value = Number(event.target.value);
    this._updateSliderVisual('textSpeed', value);
    this.settingsService.set('textSpeed', value);
  }

  _onLangChange(event) {
    if (!event.target.checked) return;
    this._syncLanguageVisuals(event.target.value);
    this.settingsService.set('lang', event.target.value);
  }

  _onShakeChange(event) {
    const enabled = Boolean(event.target.checked);
    this._styleToggle(event.target);
    this.settingsService.set('shake', enabled);

    if (enabled && this._supportsVibration()) {
      try {
        navigator.vibrate(50);
      } catch (_error) {
        // 某些浏览器暴露了 vibrate 但会拒绝调用，不能影响其他设置。
      }
    }
  }

  _onResetClick() {
    if (!this._confirmingReset) {
      this._confirmingReset = true;
      const button = this.element?.querySelector('[data-reset-btn]');
      const status = this.element?.querySelector('[data-reset-status]');
      if (button) {
        button.textContent = '确认重置？';
        button.dataset.confirming = 'true';
        button.setAttribute('aria-label', '确认重置设置');
      }
      if (status) status.textContent = '再次点击确认恢复默认值（3 秒后自动取消）';

      this._resetConfirmTimer = setTimeout(() => {
        this._cancelResetConfirm();
      }, RESET_CONFIRM_TIMEOUT);
      return;
    }

    this._cancelResetConfirm();
    this.settingsService.reset();
    this._syncControls();
  }

  _onCloseClick() {
    this.hide();
  }

  /** SETTING_CHANGE 仍是音量即时联动的唯一组件内路径。 */
  _onSettingChange(data) {
    if (!data || !this.audioManager) return;
    if (data.key === 'bgm') this.audioManager.setBgmVolume(data.value);
    if (data.key === 'sfx') this.audioManager.setSfxVolume(data.value);
  }

  // ==================== 同步与视觉状态 ====================

  _syncControls() {
    if (!this.element) return;
    const all = this.settingsService.getAll();

    for (const key of Object.keys(SLIDER_CONFIG)) {
      const slider = this.element.querySelector(`[data-${key}-slider]`);
      if (!slider) continue;
      slider.value = String(all[key]);
      this._updateSliderVisual(key, Number(all[key]));
    }

    this._syncLanguageVisuals(all.lang);

    const toggle = this.element.querySelector('[data-shake-toggle]');
    if (toggle) {
      toggle.checked = Boolean(all.shake);
      this._styleToggle(toggle);
    }
  }

  _updateSliderVisual(key, value) {
    if (!this.element) return;
    const slider = this.element.querySelector(`[data-${key}-slider]`);
    const display = this.element.querySelector(`[data-${key}-value]`);
    if (!slider) return;

    this._setSliderVisual(slider, display, value);
  }

  _setSliderVisual(slider, display, value) {
    if (!slider) return;

    const min = Number(slider.min);
    const max = Number(slider.max);
    const numericValue = Number.isFinite(value) ? value : min;
    const clampedValue = Math.max(min, Math.min(max, numericValue));
    const percentage = max === min ? 0 : ((clampedValue - min) / (max - min)) * 100;
    slider.style.setProperty('--settings-percent', `${percentage}%`);
    slider.setAttribute('aria-valuenow', String(clampedValue));
    if (display) display.textContent = String(clampedValue);
  }

  _syncLanguageVisuals(currentLang) {
    if (!this.element) return;
    this.element.querySelectorAll('[data-lang-option]').forEach((option) => {
      const radio = option.querySelector('[data-lang-radio]');
      const selected = radio?.value === currentLang;
      if (radio) {
        radio.checked = selected;
        radio.setAttribute('aria-checked', String(selected));
      }
      option.dataset.selected = String(selected);
    });
  }

  _styleToggle(toggle) {
    const enabled = Boolean(toggle.checked);
    toggle.dataset.checked = String(enabled);
    toggle.setAttribute('aria-checked', String(enabled));
    toggle.style.background = enabled
      ? 'linear-gradient(90deg, #ad493f, #db7a47)'
      : '#9c8c7b';

    const status = this.element?.querySelector('[data-shake-status]');
    if (status) status.textContent = enabled ? '开启' : '关闭';
  }

  _supportsVibration() {
    return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
  }

  _cancelResetConfirm() {
    if (this._resetConfirmTimer !== null) {
      clearTimeout(this._resetConfirmTimer);
      this._resetConfirmTimer = null;
    }
    this._confirmingReset = false;

    const button = this.element?.querySelector('[data-reset-btn]');
    const status = this.element?.querySelector('[data-reset-status]');
    if (button) {
      button.textContent = '重置设置';
      delete button.dataset.confirming;
      button.removeAttribute('aria-label');
    }
    if (status) status.textContent = '重置会恢复全部设置的默认值';
  }
}
