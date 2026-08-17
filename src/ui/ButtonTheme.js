/**
 * 全局按钮视觉主题。
 *
 * 按钮是游戏里最频繁出现的交互表面，统一在这里维护材质、层级和状态，
 * 避免主菜单、弹窗和玩法按钮各自回到通用网页控件的视觉语言。
 */
export const BUTTON_THEME_STYLE_ID = 'goose-escape-button-theme';

const BUTTON_THEME_CSS = `
  [data-ui-button] {
    appearance: none;
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 112px;
    min-height: 46px;
    padding: 0 20px;
    border: 1px solid var(--ui-button-border);
    border-radius: 7px;
    color: var(--ui-button-text);
    background: var(--ui-button-background);
    box-shadow:
      0 3px 0 var(--ui-button-shadow),
      inset 0 1px 0 rgba(255, 245, 218, 0.16),
      0 9px 22px rgba(10, 14, 15, 0.16);
    font-family: inherit;
    font-size: clamp(15px, 2.5vh, 18px);
    font-weight: 700;
    letter-spacing: 0.04em;
    line-height: 1;
    text-align: center;
    white-space: nowrap;
    cursor: pointer;
    touch-action: manipulation;
    user-select: none;
    -webkit-tap-highlight-color: transparent;
    transition:
      transform 140ms ease,
      background 140ms ease,
      border-color 140ms ease,
      box-shadow 140ms ease,
      color 140ms ease,
      filter 140ms ease;
  }

  [data-ui-button][data-size="sm"] {
    min-width: 96px;
    min-height: 38px;
    padding: 0 14px;
    border-radius: 6px;
    font-size: 14px;
    letter-spacing: 0.03em;
  }

  [data-ui-button][data-size="lg"] {
    min-height: 54px;
    padding: 0 24px;
    font-size: 20px;
  }

  [data-ui-button][data-size="touch"] {
    min-height: 56px;
    padding: 0 30px;
    font-size: 18px;
  }

  [data-ui-button][data-width="full"] {
    width: 100%;
  }

  [data-ui-button][data-variant="primary"] {
    --ui-button-background: linear-gradient(180deg, #e9a65a 0%, #c87339 100%);
    --ui-button-background-hover: linear-gradient(180deg, #f3b96c 0%, #d78343 100%);
    --ui-button-border: #ffd18a;
    --ui-button-border-hover: #ffe2ae;
    --ui-button-text: #fff8e9;
    --ui-button-shadow: #704020;
    --ui-button-shadow-hover: #8b5127;
  }

  [data-ui-button][data-variant="secondary"] {
    --ui-button-background: linear-gradient(180deg, rgba(50, 62, 62, 0.95) 0%, rgba(27, 36, 37, 0.95) 100%);
    --ui-button-background-hover: linear-gradient(180deg, rgba(65, 78, 76, 0.98) 0%, rgba(35, 45, 45, 0.98) 100%);
    --ui-button-border: rgba(243, 194, 120, 0.5);
    --ui-button-border-hover: #e7b66f;
    --ui-button-text: #f7e4c1;
    --ui-button-shadow: #131a1b;
    --ui-button-shadow-hover: #1e2929;
  }

  [data-ui-button][data-variant="danger"] {
    --ui-button-background: linear-gradient(180deg, #bd674f 0%, #914338 100%);
    --ui-button-background-hover: linear-gradient(180deg, #d17a5d 0%, #a34c3e 100%);
    --ui-button-border: #e8a180;
    --ui-button-border-hover: #f4b99b;
    --ui-button-text: #fff3e9;
    --ui-button-shadow: #54251e;
    --ui-button-shadow-hover: #6c2f25;
  }

  [data-ui-button][data-variant="ghost"] {
    --ui-button-background: rgba(19, 28, 29, 0.34);
    --ui-button-background-hover: rgba(49, 61, 60, 0.66);
    --ui-button-border: rgba(247, 221, 177, 0.3);
    --ui-button-border-hover: rgba(247, 221, 177, 0.75);
    --ui-button-text: #eed9ae;
    --ui-button-shadow: rgba(0, 0, 0, 0.22);
    --ui-button-shadow-hover: rgba(0, 0, 0, 0.32);
  }

  [data-ui-button]:hover:not(:disabled),
  [data-ui-button][data-state="hover"] {
    color: #fff9eb;
    background: var(--ui-button-background-hover);
    border-color: var(--ui-button-border-hover);
    box-shadow:
      0 4px 0 var(--ui-button-shadow-hover),
      inset 0 1px 0 rgba(255, 249, 228, 0.24),
      0 12px 25px rgba(10, 14, 15, 0.22);
    transform: translateY(-1px);
  }

  [data-ui-button]:active:not(:disabled),
  [data-ui-button][data-state="pressed"] {
    filter: brightness(0.94);
    box-shadow:
      0 1px 0 var(--ui-button-shadow),
      inset 0 2px 4px rgba(23, 18, 12, 0.24);
    transform: translateY(2px);
  }

  [data-ui-button]:focus-visible {
    outline: 2px solid #ffe0a6;
    outline-offset: 3px;
  }

  [data-ui-button]:disabled,
  [data-ui-button][data-state="disabled"] {
    color: #b5ac9b;
    background: linear-gradient(180deg, rgba(61, 65, 61, 0.7) 0%, rgba(35, 39, 37, 0.72) 100%);
    border-color: rgba(210, 194, 165, 0.2);
    box-shadow: 0 2px 0 rgba(13, 17, 17, 0.35);
    cursor: not-allowed;
    filter: saturate(0.35);
  }

  @media (hover: none) {
    [data-ui-button]:hover:not(:disabled),
    [data-ui-button][data-state="hover"] {
      transform: none;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    [data-ui-button] {
      transition: none;
    }
  }
`;

/**
 * 确保按钮主题只注入一次。
 * 组件测试和运行时都会调用它，因此不依赖入口文件的加载顺序。
 */
export function ensureButtonTheme() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(BUTTON_THEME_STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = BUTTON_THEME_STYLE_ID;
  style.textContent = BUTTON_THEME_CSS;
  document.head.appendChild(style);
}

/**
 * 给任意原生按钮套用统一主题。
 * 位置、宽度和 margin 等布局仍由调用方控制，主题只接管按钮本身的视觉与状态。
 * @param {HTMLButtonElement} button - 原生按钮元素
 * @param {Object} options - 视觉选项
 * @param {string} [options.variant='secondary'] - primary / secondary / danger / ghost
 * @param {string} [options.size='md'] - sm / md / lg / touch
 * @param {string} [options.width='auto'] - auto / full
 * @returns {HTMLButtonElement}
 */
export function applyButtonStyle(button, { variant = 'secondary', size = 'md', width = 'auto' } = {}) {
  if (!button) return button;

  ensureButtonTheme();
  button.type = 'button';

  button.setAttribute('data-ui-button', '');
  button.dataset.variant = variant;
  button.dataset.size = size;
  if (width === 'full') button.dataset.width = 'full';
  else delete button.dataset.width;
  button.dataset.state = button.disabled ? 'disabled' : 'idle';

  return button;
}
