import { getEndingById } from '../data/endings.js';
import { BADGES } from '../data/badges.js';
import { ENDING_CG_URL_MAP, EVENT } from '../config.js';
import { applyButtonStyle } from './ButtonTheme.js';

/**
 * 各结局的主题色调（对应剧情分支设计 v4 §4 结局体系）
 * 真结局使用金色主题，其余结局使用对应场景色调，渲染时区分氛围
 */
const ENDING_THEME = {
  intro_dongguan: { primary: '#fbbf24', glow: 'rgba(251, 191, 36, 0.55)' },
  basketball_life: { primary: '#f97316', glow: 'rgba(249, 115, 22, 0.5)' },
  lychee_heir: { primary: '#22c55e', glow: 'rgba(34, 197, 94, 0.5)' },
  goose_heir: { primary: '#ef4444', glow: 'rgba(239, 68, 68, 0.5)' },
  tech_star: { primary: '#60a5fa', glow: 'rgba(96, 165, 250, 0.5)' },
  college_freshman: { primary: '#a78bfa', glow: 'rgba(167, 139, 250, 0.5)' },
};

/**
 * 六张正式 CG 的显示配置。
 * 图片统一为 16:9，正文放在独立的安全面板内，避免压住人物和主体。
 */
export const ENDING_CG_DISPLAY_CONFIG = Object.freeze({
  basketball_life: Object.freeze({ panelSide: 'right', objectPosition: 'center center' }),
  lychee_heir: Object.freeze({ panelSide: 'left', objectPosition: 'center center' }),
  goose_heir: Object.freeze({ panelSide: 'right', objectPosition: 'center center' }),
  tech_star: Object.freeze({ panelSide: 'left', objectPosition: 'center center' }),
  college_freshman: Object.freeze({ panelSide: 'right', objectPosition: 'center center' }),
  intro_dongguan: Object.freeze({ panelSide: 'left', objectPosition: 'center center' }),
});

/** @param {string} endingId @returns {{panelSide: string, objectPosition: string}} */
export function getEndingCGDisplayConfig(endingId) {
  return ENDING_CG_DISPLAY_CONFIG[endingId] || ENDING_CG_DISPLAY_CONFIG.intro_dongguan;
}

/** @param {string} endingId @returns {string} */
function getEndingCGUrl(endingId) {
  return ENDING_CG_URL_MAP[endingId] || ENDING_CG_URL_MAP.intro_dongguan;
}

/**
 * 结局 CG 组件（对应剧情分支设计 v4 §4 结局体系 + Task 5.6）
 *
 * 6 个结局 CG 首版以"场景定格 + 标题 + 文案 + 印记发放"实现。
 * 显示对应结局的标题、叙述文案、成就和印记信息，并提供返回主菜单入口。
 *
 * 职责：
 * - show(endingId)：查找结局数据 → 解锁结局印记 → 渲染全屏覆盖层 → 播放音效 → 广播 CHAPTER_COMPLETE
 * - hide()：移除覆盖层
 * - onExit："返回主菜单"回调，由宿主场景设置路由；未注入宿主路由时刷新页面回到主菜单
 */
export class EndingCG {
  /**
   * @param {Object} deps - 依赖注入
   * @param {EventBus} deps.eventBus - 事件总线（广播结局/章节完成/音效）
   * @param {HTMLElement} deps.container - 覆盖层挂载容器
   * @param {BadgeSystem} deps.badgeSystem - 印记系统（解锁结局印记）
   */
  constructor({ eventBus, container, badgeSystem }) {
    this.eventBus = eventBus;
    this.container = container;
    this.badgeSystem = badgeSystem;

    /** 覆盖层 DOM 根 */
    this.element = null;
    /** "返回主菜单"按钮 DOM 元素 */
    this.menuButton = null;

    /** 宿主注入的"返回主菜单"回调 */
    this.onExit = null;
    /** 当前展示的结局 id，供终章精确续接使用 */
    this.currentEndingId = null;

    this._onMenuClick = this._onMenuClick.bind(this);
  }

  /**
   * 显示指定结局的 CG
   * 顺序：查找结局数据 → 解锁印记 → 渲染覆盖层 → 播放音效 → 广播章节完成
   * @param {string} endingId - 结局 id
   * @param {{persist?:boolean}} [options] - 是否广播章节完成并触发自动存档
   */
  show(endingId, { persist = true } = {}) {
    const ending = getEndingById(endingId);
    // 未知结局 id 静默忽略，避免脏数据导致渲染异常
    if (!ending) return;

    // 首次结算写入印记，重玩结局时重新展示但不重复计数。
    if (this.badgeSystem && ending.badge) {
      this.badgeSystem.unlockOrReveal(ending.badge);
    }

    // 防止重复调用 show() 时旧覆盖层留在 DOM 中，造成按钮和遮罩叠层。
    if (this.element) this.hide();
    this.currentEndingId = ending.id;

    // 渲染全屏覆盖层（标题 + 叙述 + 成就 + 印记 + 返回主菜单）
    this._render(ending);

    // 播放结局音效（对应 PRD §7.8 SFX 结局）
    this.eventBus.emit(EVENT.SFX_PLAY, { name: 'ending' });

    if (persist) {
      // 广播章节完成 + 结局信息，供自动存档与主菜单"重新出发"
      this.eventBus.emit(EVENT.CHAPTER_COMPLETE, {
        chapter: 'finale',
        ending: ending.id,
        achievement: ending.achievement,
      });
    }
  }

  /**
   * 隐藏并销毁覆盖层
   */
  hide() {
    if (this.menuButton) {
      this.menuButton.removeEventListener('click', this._onMenuClick);
      this.menuButton = null;
    }
    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }
    this.element = null;
    this.currentEndingId = null;
  }

  /**
   * 渲染结局 CG 全屏覆盖层
   * 真结局金色主题、其余结局对应场景色调，居中展示标题/叙述/成就/印记
   * @param {Object} ending - 结局数据
   * @private
   */
  _render(ending) {
    const theme = ENDING_THEME[ending.id] || ENDING_THEME.intro_dongguan;
    const display = getEndingCGDisplayConfig(ending.id);
    const badgeName = this._getBadgeName(ending.badge);
    const imageUrl = getEndingCGUrl(ending.id);

    this.element = document.createElement('div');
    this.element.setAttribute('data-ending-cg', ending.id);
    this.element.style.cssText = `
      position: fixed; inset: 0; z-index: 400;
      display: flex; align-items: center; justify-content: center;
      padding: max(12px, env(safe-area-inset-top, 0px))
        max(12px, env(safe-area-inset-right, 0px))
        max(12px, env(safe-area-inset-bottom, 0px))
        max(12px, env(safe-area-inset-left, 0px));
      box-sizing: border-box; background: #0b1515;
      font-family: inherit; overflow: hidden; pointer-events: auto;
      isolation: isolate;
    `;

    // 模糊同源背景负责填满安全区，避免 contain 模式在超宽横屏留下黑边。
    const background = document.createElement('img');
    background.src = imageUrl;
    background.alt = '';
    background.setAttribute('aria-hidden', 'true');
    background.setAttribute('data-ending-background', '');
    background.decoding = 'async';
    background.style.cssText = `
      position: absolute; inset: -8%; z-index: -2;
      width: 116%; height: 116%; object-fit: cover;
      object-position: ${display.objectPosition};
      filter: blur(26px) brightness(0.42) saturate(0.82);
      transform: scale(1.08); opacity: 0.92;
    `;
    this.element.appendChild(background);

    const shade = document.createElement('div');
    shade.setAttribute('aria-hidden', 'true');
    shade.style.cssText = `
      position: absolute; inset: 0; z-index: -1; pointer-events: none;
      background: linear-gradient(90deg, rgba(5, 12, 12, 0.34), rgba(5, 12, 12, 0.08) 48%, rgba(5, 12, 12, 0.38));
    `;
    this.element.appendChild(shade);

    const stage = document.createElement('div');
    stage.setAttribute('data-ending-stage', '');
    stage.style.cssText = `
      position: relative; z-index: 1; display: flex; align-items: stretch;
      flex: 1 1 auto; min-width: 0; min-height: 0;
      width: min(2200px, 100%); height: min(1000px, 100%); max-height: 100%;
      gap: clamp(10px, 1.3vw, 24px); box-sizing: border-box;
    `;

    const media = document.createElement('figure');
    media.setAttribute('data-ending-media', '');
    media.style.cssText = `
      position: relative; display: flex; flex: 1 1 auto; align-items: center;
      justify-content: center; min-width: 0; min-height: 0; margin: 0;
      overflow: hidden; border: 1px solid rgba(242, 202, 134, 0.35);
      border-radius: 16px; background: rgba(12, 23, 23, 0.08);
      box-shadow: 0 18px 50px rgba(0, 0, 0, 0.3);
    `;

    const mediaBackdrop = document.createElement('img');
    mediaBackdrop.setAttribute('data-ending-media-background', ending.id);
    mediaBackdrop.src = imageUrl;
    mediaBackdrop.alt = '';
    mediaBackdrop.setAttribute('aria-hidden', 'true');
    mediaBackdrop.decoding = 'async';
    mediaBackdrop.style.cssText = `
      position: absolute; inset: -8%; width: 116%; height: 116%; object-fit: cover;
      object-position: ${display.objectPosition}; filter: blur(18px) brightness(0.68) saturate(0.9);
      transform: scale(1.08); opacity: 0.88;
    `;
    media.appendChild(mediaBackdrop);

    const image = document.createElement('img');
    image.setAttribute('data-ending-cg-image', ending.id);
    image.src = imageUrl;
    image.alt = ending.title;
    image.decoding = 'async';
    image.style.cssText = `
      position: relative; z-index: 1; display: block; width: 100%; height: 100%;
      object-fit: contain; object-position: ${display.objectPosition};
    `;
    media.appendChild(image);

    const contentPanel = document.createElement('section');
    contentPanel.setAttribute('data-ending-content', '');
    contentPanel.style.cssText = `
      display: flex; flex: 0 0 clamp(276px, 31vw, 460px); flex-direction: column;
      min-width: 0; min-height: 0; height: 100%; overflow: hidden;
      padding: clamp(12px, 1.8vw, 32px) clamp(12px, 2vw, 34px);
      box-sizing: border-box; border: 1px solid rgba(242, 202, 134, 0.46);
      border-radius: 16px;
      background: linear-gradient(150deg, rgba(17, 31, 30, 0.94), rgba(8, 17, 17, 0.88));
      box-shadow: 0 18px 50px rgba(0, 0, 0, 0.34), inset 0 1px 0 rgba(255, 244, 214, 0.08);
      backdrop-filter: blur(12px);
    `;

    const content = document.createElement('div');
    content.setAttribute('data-ending-copy', '');
    content.style.cssText = `
      flex: 1 1 auto; min-height: 0; overflow-y: auto; overflow-x: hidden;
      display: flex; flex-direction: column; align-items: center; gap: clamp(6px, 1.2vh, 16px);
      padding: 2px 4px 4px; box-sizing: border-box; text-align: center;
      overscroll-behavior: contain;
    `;
    contentPanel.appendChild(content);

    // 结局标题（大字 + 主题色辉光）
    const title = document.createElement('h1');
    title.textContent = ending.title;
    title.style.cssText = `
      margin: 0; max-width: 100%; font-size: clamp(24px, 4.5vh, 42px);
      line-height: 1.15; font-weight: bold; color: ${theme.primary};
      text-shadow: 0 2px 16px ${theme.glow}; text-align: center;
    `;
    content.appendChild(title);

    // 成就名
    const achievement = document.createElement('div');
    achievement.textContent = `成就解锁：${ending.achievement}`;
    achievement.style.cssText = `
      max-width: 100%; font-size: clamp(14px, 1.5vw, 20px);
      line-height: 1.35; color: #fde68a; text-align: center;
    `;
    content.appendChild(achievement);

    // 印记名（对应结局印记）
    const badgeText = document.createElement('div');
    badgeText.textContent = `获得印记：${badgeName}`;
    badgeText.style.cssText = `
      max-width: 100%; box-sizing: border-box; font-size: clamp(12px, 1.2vw, 16px);
      line-height: 1.3; color: ${theme.primary}; text-align: center;
      padding: 5px 14px; border: 1px solid ${theme.primary}; border-radius: 999px;
    `;
    content.appendChild(badgeText);

    // 叙述文案（只在正文区域滚动，不会把按钮推出安全区）
    const narration = document.createElement('div');
    narration.textContent = ending.narration;
    narration.style.cssText = `
      width: 100%; max-width: 640px; font-size: clamp(12px, 1.25vw, 16px);
      line-height: 1.5; color: #e2e8f0; text-align: center; margin-top: 2px;
      overflow-wrap: anywhere;
    `;
    content.appendChild(narration);

    // 结语（epilogue）
    const epilogue = document.createElement('div');
    epilogue.textContent = ending.epilogue;
    epilogue.style.cssText = `
      max-width: 100%; font-size: clamp(14px, 1.4vw, 18px);
      line-height: 1.35; color: ${theme.primary}; font-weight: bold;
      text-align: center; margin-top: 2px;
    `;
    content.appendChild(epilogue);

    const actions = document.createElement('div');
    actions.setAttribute('data-ending-actions', '');
    actions.style.cssText = `
      display: flex; flex: 0 0 auto; flex-wrap: wrap; align-items: center;
      justify-content: center; gap: 10px;
      min-height: 38px; padding-top: clamp(8px, 1.5vh, 18px);
    `;

    // 所有结局统一只提供返回主菜单，避免普通结局继续回到已结束的分支流程。
    this.menuButton = document.createElement('button');
    this.menuButton.setAttribute('data-ending-menu', ending.id);
    this.menuButton.setAttribute('data-ending-action', 'menu');
    this.menuButton.textContent = '返回主菜单';
    this.menuButton.setAttribute('aria-label', `${ending.title}：返回主菜单`);
    this.menuButton.style.cssText = 'max-width: 100%; margin: 0;';
    applyButtonStyle(this.menuButton, { variant: 'secondary', size: 'md' });
    this.menuButton.addEventListener('click', this._onMenuClick);
    actions.appendChild(this.menuButton);
    contentPanel.appendChild(actions);

    if (display.panelSide === 'left') {
      stage.appendChild(contentPanel);
      stage.appendChild(media);
    } else {
      stage.appendChild(media);
      stage.appendChild(contentPanel);
    }

    this.element.appendChild(stage);
    this.container.appendChild(this.element);
  }

  /** 结局 CG 的"返回主菜单"按钮点击回调。 */
  _onMenuClick() {
    this.hide();
    this._exitToMenu();
  }

  /** 统一处理宿主路由和无宿主时的兼容性回退。 */
  _exitToMenu() {
    if (typeof this.onExit === 'function') {
      this.onExit();
      return;
    }

    if (typeof window !== 'undefined' && typeof window.location?.reload === 'function') {
      window.location.reload();
    }
  }

  /**
   * 根据印记 id 查找印记名称
   * @param {string} badgeId - 印记 id
   * @returns {string} 印记名称，未知 id 返回 id 本身
   * @private
   */
  _getBadgeName(badgeId) {
    if (!badgeId) return '';
    const badge = BADGES.find((item) => item.id === badgeId);
    return badge ? badge.name : badgeId;
  }
}
