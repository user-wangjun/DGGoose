import { getEndingById } from '../data/endings.js';
import { BADGES } from '../data/badges.js';
import { EVENT } from '../config.js';
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
 * 结局 CG 组件（对应剧情分支设计 v4 §4 结局体系 + Task 5.6）
 *
 * 6 个结局 CG 首版以"场景定格 + 标题 + 文案 + 印记发放"实现。
 * 显示对应结局的标题、叙述文案、成就和印记信息，并提供"再选一次"入口。
 *
 * 职责：
 * - show(endingId)：查找结局数据 → 解锁结局印记 → 渲染全屏覆盖层 → 播放音效 → 广播 CHAPTER_COMPLETE
 * - hide()：移除覆盖层
 * - onRetry：回调属性，"再选一次"点击后触发，由宿主场景设置回退逻辑
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
    /** "再选一次"按钮 DOM 元素 */
    this.retryButton = null;

    /** "再选一次"回调，宿主场景可设置以回退到走马灯前 */
    this.onRetry = null;

    this._onRetryClick = this._onRetryClick.bind(this);
  }

  /**
   * 显示指定结局的 CG
   * 顺序：查找结局数据 → 解锁印记 → 渲染覆盖层 → 播放音效 → 广播章节完成
   * @param {string} endingId - 结局 id
   */
  show(endingId) {
    const ending = getEndingById(endingId);
    // 未知结局 id 静默忽略，避免脏数据导致渲染异常
    if (!ending) return;

    // 解锁对应结局印记（idempotent，重复调用不会重复触发动效）
    if (this.badgeSystem && ending.badge) {
      this.badgeSystem.unlock(ending.badge);
    }

    // 渲染全屏覆盖层（标题 + 叙述 + 成就 + 印记 + 再选一次）
    this._render(ending);

    // 播放结局音效（对应 PRD §7.8 SFX 结局）
    this.eventBus.emit(EVENT.SFX_PLAY, { name: 'ending' });

    // 广播章节完成 + 结局信息，供自动存档与主菜单"重新出发"
    this.eventBus.emit(EVENT.CHAPTER_COMPLETE, {
      chapter: 'finale',
      ending: ending.id,
      achievement: ending.achievement,
    });
  }

  /**
   * 隐藏并销毁覆盖层
   */
  hide() {
    if (this.retryButton) {
      this.retryButton.removeEventListener('click', this._onRetryClick);
      this.retryButton = null;
    }
    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }
    this.element = null;
  }

  /**
   * 渲染结局 CG 全屏覆盖层
   * 真结局金色主题、其余结局对应场景色调，居中展示标题/叙述/成就/印记
   * @param {Object} ending - 结局数据
   * @private
   */
  _render(ending) {
    const theme = ENDING_THEME[ending.id] || ENDING_THEME.intro_dongguan;
    const badgeName = this._getBadgeName(ending.badge);

    this.element = document.createElement('div');
    this.element.setAttribute('data-ending-cg', ending.id);
    this.element.style.cssText = `
      position: fixed; inset: 0; z-index: 400;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: 18px; padding: 40px 24px; box-sizing: border-box;
      background: rgba(0, 0, 0, 0.8);
      font-family: inherit; overflow: auto; pointer-events: auto;
    `;

    // 结局标题（大字 + 主题色辉光）
    const title = document.createElement('div');
    title.textContent = ending.title;
    title.style.cssText = `
      font-size: 40px; font-weight: bold; color: ${theme.primary};
      text-shadow: 0 2px 16px ${theme.glow};
      text-align: center;
    `;
    this.element.appendChild(title);

    // 成就名
    const achievement = document.createElement('div');
    achievement.textContent = `成就解锁：${ending.achievement}`;
    achievement.style.cssText = `
      font-size: 20px; color: #fde68a; text-align: center;
    `;
    this.element.appendChild(achievement);

    // 印记名（对应结局印记）
    const badgeText = document.createElement('div');
    badgeText.textContent = `获得印记：${badgeName}`;
    badgeText.style.cssText = `
      font-size: 16px; color: ${theme.primary}; text-align: center;
      padding: 4px 16px; border: 1px solid ${theme.primary}; border-radius: 999px;
    `;
    this.element.appendChild(badgeText);

    // 叙述文案（长文本换行）
    const narration = document.createElement('div');
    narration.textContent = ending.narration;
    narration.style.cssText = `
      font-size: 16px; line-height: 1.8; color: #e2e8f0;
      max-width: 640px; text-align: center; margin-top: 8px;
    `;
    this.element.appendChild(narration);

    // 结语（epilogue）
    const epilogue = document.createElement('div');
    epilogue.textContent = ending.epilogue;
    epilogue.style.cssText = `
      font-size: 18px; color: ${theme.primary}; font-weight: bold;
      text-align: center; margin-top: 4px;
    `;
    this.element.appendChild(epilogue);

    // "再选一次"按钮
    this.retryButton = document.createElement('button');
    this.retryButton.textContent = '再选一次';
    this.retryButton.style.cssText = 'margin-top: 18px;';
    applyButtonStyle(this.retryButton, { variant: 'secondary', size: 'md' });
    this.retryButton.addEventListener('click', this._onRetryClick);
    this.element.appendChild(this.retryButton);

    this.container.appendChild(this.element);
  }

  /**
   * "再选一次"按钮点击：隐藏覆盖层并触发回调
   * @private
   */
  _onRetryClick() {
    this.hide();
    if (typeof this.onRetry === 'function') {
      this.onRetry();
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
