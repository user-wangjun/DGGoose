import { BADGES } from '../data/badges.js';
import { EVENT } from '../config.js';
import { applyButtonStyle } from './ButtonTheme.js';

/** 收集动效持续时间（毫秒），对应 PRD F10 的 0.8s 收集动画 */
const COLLECT_ANIMATION_MS = 800;

/**
 * 印记面板组件（对应 PRD §5 F10）
 *
 * DOM 渲染的印记收集面板，展示 7 枚东莞印记的网格：
 * - 已解锁：彩色图标 + 名称 + 描述
 * - 未解锁：灰色图标 + "???"（防剧透）
 * - 进度条显示 X/7
 * - 全收集时点亮"莞城通"成就标识
 *
 * 监听 BADGE_GET 事件，在解锁瞬间播放 0.8s 收集动效。
 */
export class BadgePanel {
  /**
   * @param {Object} deps - 依赖注入
   * @param {HTMLElement} deps.container - 挂载容器
   * @param {BadgeSystem} deps.badgeSystem - 印记系统实例
   * @param {EventBus} deps.eventBus - 事件总线
   */
  constructor({ container, badgeSystem, eventBus }) {
    this.container = container;
    this.badgeSystem = badgeSystem;
    this.eventBus = eventBus;
    this.element = null;
    this.gridElement = null;
    this.progressTextElement = null;
    this.progressBarFillElement = null;
    this.achievementElement = null;
    /** @type {Map<string, HTMLElement>} 印记 id -> 卡片元素映射，用于动效定位 */
    this.badgeCardElements = new Map();
    this._onBadgeGet = this._onBadgeGet.bind(this);
    this._styleInjected = false;
  }

  /**
   * 创建并挂载面板 DOM，注册事件监听
   * @returns {HTMLElement} 面板根元素
   */
  create() {
    this._injectStyles();

    this.element = document.createElement('div');
    this.element.setAttribute('data-badge-panel', '');
    this.element.style.cssText = `
      display: none; position: fixed; inset: 0; z-index: 8000;
      align-items: center; justify-content: center;
      background: rgba(0,0,0,0.7); pointer-events: auto;
    `;

    const panel = document.createElement('div');
    panel.setAttribute('data-badge-panel-content', '');
    panel.style.cssText = `
      width: 680px; max-width: 92vw; max-height: 90vh; overflow-y: auto;
      background: #1a1a2e; border-radius: 16px; padding: 32px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.5); color: #e0e0e0;
      font-family: -apple-system, "Microsoft YaHei", sans-serif;
    `;

    // 标题栏
    const header = this._createHeader();
    panel.appendChild(header);

    // 进度条
    const progressSection = this._createProgressSection();
    panel.appendChild(progressSection);

    // 成就标识（全收集时点亮）
    this.achievementElement = this._createAchievementElement();
    panel.appendChild(this.achievementElement);

    // 印记网格
    this.gridElement = document.createElement('div');
    this.gridElement.setAttribute('data-badge-grid', '');
    this.gridElement.style.cssText = `
      display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px;
      margin-top: 24px;
    `;
    panel.appendChild(this.gridElement);

    // 关闭按钮
    const closeButton = this._createCloseButton();
    panel.appendChild(closeButton);

    this.element.appendChild(panel);

    // 点击遮罩关闭
    this.element.addEventListener('click', (e) => {
      if (e.target === this.element) {
        this.hide();
      }
    });

    this.container.appendChild(this.element);

    // 监听收集动效事件
    this.eventBus.on(EVENT.BADGE_GET, this._onBadgeGet);

    // 首次渲染
    this.render();

    return this.element;
  }

  /**
   * 显示面板并刷新数据
   */
  show() {
    if (!this.element) return;
    this.render();
    this.element.style.display = 'flex';
  }

  /**
   * 隐藏面板
   */
  hide() {
    if (!this.element) return;
    this.element.style.display = 'none';
  }

  /**
   * 切换显示/隐藏
   */
  toggle() {
    if (!this.element) return;
    if (this.element.style.display === 'flex') {
      this.hide();
    } else {
      this.show();
    }
  }

  /**
   * 重新渲染印记网格与进度
   * 每次调用都从 badgeSystem 读取最新状态，保证数据一致
   */
  render() {
    if (!this.gridElement) return;

    this.gridElement.innerHTML = '';
    this.badgeCardElements.clear();

    for (const badge of BADGES) {
      const card = this._createBadgeCard(badge);
      this.gridElement.appendChild(card);
      this.badgeCardElements.set(badge.id, card);
    }

    this._updateProgress();
    this._updateAchievement();
  }

  /**
   * 销毁面板，移除事件监听与 DOM
   */
  destroy() {
    this.eventBus.off(EVENT.BADGE_GET, this._onBadgeGet);
    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }
    this.element = null;
    this.gridElement = null;
    this.progressTextElement = null;
    this.progressBarFillElement = null;
    this.achievementElement = null;
    this.badgeCardElements.clear();
    this.container = null;
    this.badgeSystem = null;
    this.eventBus = null;
  }

  // ---------- 私有方法 ----------

  /**
   * 创建标题栏
   * @private
   * @returns {HTMLElement}
   */
  _createHeader() {
    const header = document.createElement('div');
    header.style.cssText = `
      display: flex; align-items: center; justify-content: space-between;
      margin-bottom: 20px;
    `;
    const title = document.createElement('h2');
    title.textContent = '东莞印记';
    title.style.cssText = 'margin: 0; font-size: 24px; color: #f0f0f0;';
    header.appendChild(title);
    return header;
  }

  /**
   * 创建进度条区域
   * @private
   * @returns {HTMLElement}
   */
  _createProgressSection() {
    const section = document.createElement('div');
    section.style.cssText = 'margin-bottom: 16px;';

    const progressText = document.createElement('div');
    progressText.setAttribute('data-badge-progress-text', '');
    progressText.style.cssText = 'font-size: 14px; color: #aaa; margin-bottom: 8px;';
    section.appendChild(progressText);
    this.progressTextElement = progressText;

    const progressBar = document.createElement('div');
    progressBar.style.cssText = `
      width: 100%; height: 8px; background: #333; border-radius: 4px;
      overflow: hidden;
    `;
    const fill = document.createElement('div');
    fill.setAttribute('data-badge-progress-fill', '');
    fill.style.cssText = `
      height: 100%; background: linear-gradient(90deg, #bb6b38, #efb45f);
      border-radius: 4px; transition: width 0.4s ease; width: 0%;
    `;
    progressBar.appendChild(fill);
    section.appendChild(progressBar);
    this.progressBarFillElement = fill;

    return section;
  }

  /**
   * 创建全收集成就标识
   * 默认隐藏，全收集后点亮
   * @private
   * @returns {HTMLElement}
   */
  _createAchievementElement() {
    const el = document.createElement('div');
    el.setAttribute('data-badge-achievement', '');
    el.style.cssText = `
      display: none; margin-top: 16px; padding: 12px 20px;
      background: linear-gradient(135deg, #f59e0b, #d97706);
      border-radius: 8px; text-align: center; font-size: 16px;
      color: #fff; font-weight: bold;
    `;
    el.textContent = '成就解锁：莞城通 —— 足迹遍布莞邑大地';
    return el;
  }

  /**
   * 创建单枚印记卡片
   * 根据 BadgeSystem.getBadgeInfo 决定展示完整信息或防剧透占位
   * @private
   * @param {Object} badge - 印记定义
   * @returns {HTMLElement}
   */
  _createBadgeCard(badge) {
    const info = this.badgeSystem.getBadgeInfo(badge.id);
    const unlocked = this.badgeSystem.isUnlocked(badge.id);

    const card = document.createElement('div');
    card.setAttribute('data-badge-card', badge.id);
    card.setAttribute('data-unlocked', String(unlocked));

    if (unlocked) {
      card.style.cssText = `
        background: #2d3938; border: 2px solid #c77b42; border-radius: 12px;
        padding: 16px; text-align: center; cursor: default;
        transition: transform 0.2s ease;
      `;
      const icon = document.createElement('div');
      icon.style.cssText = `
        font-size: 36px; margin-bottom: 8px;
      `;
      icon.textContent = this._getBadgeIcon(badge.id);
      card.appendChild(icon);

      const name = document.createElement('div');
      name.style.cssText = 'font-size: 15px; font-weight: bold; color: #e0e0e0; margin-bottom: 6px;';
      name.textContent = info.name;
      card.appendChild(name);

      const how = document.createElement('div');
      how.style.cssText = 'font-size: 12px; color: #999; margin-bottom: 4px;';
      how.textContent = info.how;
      card.appendChild(how);

      const desc = document.createElement('div');
      desc.style.cssText = 'font-size: 12px; color: #bbb; line-height: 1.4;';
      desc.textContent = info.desc;
      card.appendChild(desc);
    } else {
      card.style.cssText = `
        background: #1e1e2e; border: 2px solid #333; border-radius: 12px;
        padding: 16px; text-align: center; opacity: 0.5;
      `;
      const icon = document.createElement('div');
      icon.style.cssText = 'font-size: 36px; margin-bottom: 8px; filter: grayscale(100%);';
      icon.textContent = '?';
      card.appendChild(icon);

      const name = document.createElement('div');
      name.style.cssText = 'font-size: 15px; font-weight: bold; color: #666;';
      name.textContent = '???';
      card.appendChild(name);

      const hint = document.createElement('div');
      hint.style.cssText = 'font-size: 12px; color: #555; margin-top: 6px;';
      hint.textContent = '未解锁';
      card.appendChild(hint);
    }

    return card;
  }

  /**
   * 创建关闭按钮
   * @private
   * @returns {HTMLElement}
   */
  _createCloseButton() {
    const btn = document.createElement('button');
    btn.setAttribute('data-badge-panel-close', '');
    btn.textContent = '关闭';
    btn.style.cssText = 'display: block; margin: 24px auto 0;';
    applyButtonStyle(btn, { variant: 'secondary', size: 'sm' });
    btn.addEventListener('click', () => this.hide());
    return btn;
  }

  /**
   * 更新进度条文本与填充宽度
   * @private
   */
  _updateProgress() {
    if (!this.progressTextElement || !this.progressBarFillElement) return;

    const progress = this.badgeSystem.getProgress();
    this.progressTextElement.textContent = `已收集 ${progress.collected} / ${progress.total}`;
    this.progressBarFillElement.style.width = `${progress.percent}%`;
  }

  /**
   * 更新全收集成就标识的显示状态
   * @private
   */
  _updateAchievement() {
    if (!this.achievementElement) return;
    this.achievementElement.style.display = this.badgeSystem.isAllCollected() ? 'block' : 'none';
  }

  /**
   * BADGE_GET 事件回调：播放 0.8s 收集动效
   * 刷新面板数据并对新解锁的卡片施加脉冲动画
   * @private
   * @param {Object} data - 事件数据，包含 badge 信息
   */
  _onBadgeGet(data) {
    // 面板未创建或未显示时仅刷新数据，不播放在屏动效
    if (!this.element || this.element.style.display !== 'flex') {
      return;
    }

    this.render();

    const card = this.badgeCardElements.get(data.badge.id);
    if (!card) return;

    // 临时添加动画类，0.8s 后移除
    card.classList.add('badge-collect-pulse');
    setTimeout(() => {
      card.classList.remove('badge-collect-pulse');
    }, COLLECT_ANIMATION_MS);
  }

  /**
   * 根据印记 id 返回对应的 emoji 图标
   * 无匹配时使用通用徽章图标
   * @private
   * @param {string} id - 印记 id
   * @returns {string}
   */
  _getBadgeIcon(id) {
    const iconMap = {
      factory_cert: '📜',
      basketball: '🏀',
      lychee: '🍒',
      roast_goose: '🦆',
      industrial: '⚙️',
      campus: '📚',
      lake: '🏞️',
    };
    return iconMap[id] || '🏅';
  }

  /**
   * 注入收集动效的 CSS 关键帧
   * 仅注入一次，避免重复添加 style 标签
   * @private
   */
  _injectStyles() {
    if (this._styleInjected) return;
    this._styleInjected = true;

    const style = document.createElement('style');
    style.textContent = `
      @keyframes badgeCollectPulse {
        0% { transform: scale(1); box-shadow: 0 0 0 0 rgba(124, 58, 237, 0.7); }
        50% { transform: scale(1.08); box-shadow: 0 0 20px 8px rgba(124, 58, 237, 0.5); }
        100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(124, 58, 237, 0); }
      }
      .badge-collect-pulse {
        animation: badgeCollectPulse ${COLLECT_ANIMATION_MS}ms ease-out;
      }
    `;
    document.head.appendChild(style);
  }
}
