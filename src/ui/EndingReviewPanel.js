import { ENDINGS } from '../data/endings.js';
import { BADGES, BADGE_TYPE } from '../data/badges.js';
import { getBadgeAssetUrl } from '../data/badgeAssets.js';
import { ENDING_CG_URL_MAP } from '../config.js';
import { applyButtonStyle } from './ButtonTheme.js';
import { getEndingCGDisplayConfig } from './EndingCG.js';

/** 展示用解锁密码；只影响回顾面板，不写入真实通关/收集进度。 */
export const ENDING_REVIEW_DEMO_CODE = '0423';

/** 展示解锁状态的存储键，交给 StorageService 自动加 gxe: 前缀。 */
const DEMO_UNLOCK_STORAGE_KEY = 'ending_review_demo_unlocked';

/**
 * 结尾回顾面板。
 *
 * 结局 CG 以对应结局印记是否获得作为真实解锁条件，沿途/结局印记也只显示已获得的详情。
 * 展示密码只记录在回顾专用状态中，方便演示时查看全部内容，同时不污染章节完成判定和实际印记进度。
 */
export class EndingReviewPanel {
  /**
   * @param {Object} deps - 依赖注入
   * @param {HTMLElement} deps.container - 面板挂载容器
   * @param {BadgeSystem} deps.badgeSystem - 真实印记收集系统
   * @param {StorageService} [deps.storage] - 用于持久化展示解锁状态的存储服务
   */
  constructor({ container, badgeSystem, storage = null }) {
    this.container = container;
    this.badgeSystem = badgeSystem;
    this.storage = storage;

    /** @type {HTMLElement|null} 面板根元素 */
    this.element = null;
    /** @type {HTMLElement|null} 结局卡片网格 */
    this.endingGridElement = null;
    /** @type {HTMLElement|null} 结局 CG 进度文本 */
    this.endingProgressElement = null;
    /** @type {HTMLElement|null} 沿途印记卡片网格 */
    this.journeyBadgeGridElement = null;
    /** @type {HTMLElement|null} 结局印记卡片网格 */
    this.endingBadgeGridElement = null;
    /** @type {HTMLElement|null} 印记总进度文本 */
    this.badgeProgressElement = null;
    /** @type {HTMLInputElement|null} 展示密码输入框 */
    this.unlockInput = null;
    /** @type {HTMLElement|null} 展示密码反馈文本 */
    this.unlockFeedbackElement = null;
    /** @type {HTMLFormElement|null} 展示密码表单 */
    this.unlockForm = null;
    /** @type {HTMLElement|null} 当前打开的结局详情 */
    this.detailElement = null;

    /** 主菜单宿主用于回收 activeOverlay 引用的关闭回调 */
    this.onClose = null;
    /** 展示密码解锁状态，不等同于真实印记状态 */
    this.demoUnlocked = this._loadDemoUnlockState();

    this._onUnlockSubmit = this._onUnlockSubmit.bind(this);
    this._onBackdropClick = this._onBackdropClick.bind(this);
  }

  /**
   * 创建并挂载面板 DOM；show() 会按需调用，避免主菜单首屏额外构建大量图片节点。
   * @returns {HTMLElement} 面板根元素
   */
  create() {
    if (this.element) return this.element;

    this.element = document.createElement('div');
    this.element.setAttribute('data-ending-review', '');
    this.element.style.cssText = `
      display: none; position: fixed; inset: 0; z-index: 9000;
      align-items: center; justify-content: center;
      padding: max(12px, env(safe-area-inset-top, 0px))
        max(12px, env(safe-area-inset-right, 0px))
        max(12px, env(safe-area-inset-bottom, 0px))
        max(12px, env(safe-area-inset-left, 0px));
      background: rgba(3, 8, 8, 0.78); pointer-events: auto;
      font-family: -apple-system, "Microsoft YaHei", sans-serif;
    `;
    this.element.addEventListener('click', this._onBackdropClick);

    const panel = document.createElement('div');
    panel.setAttribute('data-ending-review-content', '');
    panel.style.cssText = `
      position: relative; display: flex; flex-direction: column;
      width: min(1180px, 96vw); max-height: 94vh; min-height: 0;
      overflow-y: auto; padding: clamp(20px, 3vw, 36px);
      box-sizing: border-box; color: #e8eee8;
      background:
        radial-gradient(circle at 14% 0%, rgba(217, 166, 91, 0.12), transparent 30%),
        linear-gradient(145deg, #182624 0%, #101918 100%);
      border: 1px solid rgba(242, 202, 134, 0.48); border-radius: 18px;
      box-shadow: 0 24px 80px rgba(0, 0, 0, 0.58), inset 0 1px 0 rgba(255, 244, 214, 0.08);
    `;
    this.element.appendChild(panel);

    panel.appendChild(this._createHeader());
    panel.appendChild(this._createEndingSection());
    panel.appendChild(this._createBadgeSection());

    const closeActions = document.createElement('div');
    closeActions.setAttribute('data-ending-review-actions', '');
    closeActions.style.cssText = `
      display: flex; align-items: center; justify-content: center; flex-wrap: wrap;
      gap: 10px; margin-top: 20px; padding-top: 12px;
      flex: 0 0 auto; background: transparent;
    `;

    const closeButton = document.createElement('button');
    closeButton.setAttribute('data-ending-review-close', '');
    closeButton.textContent = '返回主菜单';
    closeButton.style.cssText = 'display: block; margin: 0; max-width: 100%;';
    applyButtonStyle(closeButton, { variant: 'secondary', size: 'md' });
    closeButton.addEventListener('click', () => this.hide());
    closeActions.appendChild(closeButton);
    panel.appendChild(closeActions);

    this.container.appendChild(this.element);
    this.render();
    return this.element;
  }

  /**
   * 显示面板并刷新解锁状态。
   * 进入回顾时重新读取 BadgeSystem，保证刚通关后无需重启游戏即可看到内容。
   */
  show() {
    if (!this.element) this.create();
    this.render();
    this.element.style.display = 'flex';
  }

  /**
   * 隐藏面板和当前详情，保留组件以便主菜单再次打开时复用。
   */
  hide() {
    if (!this.element) return;

    const wasVisible = this.element.style.display !== 'none';
    this._hideEndingDetail();
    this.element.style.display = 'none';

    if (wasVisible && typeof this.onClose === 'function') {
      this.onClose();
    }
  }

  /** 兼容主菜单通用覆盖层关闭接口。 */
  close() {
    this.hide();
  }

  /**
   * 从真实印记状态重新渲染结局和印记卡片。
   * 密码模式只改变回顾面板的可见性，不改变 BadgeSystem 的实际列表。
   */
  render() {
    if (!this.endingGridElement || !this.journeyBadgeGridElement || !this.endingBadgeGridElement) {
      return;
    }

    this.endingGridElement.innerHTML = '';
    this.journeyBadgeGridElement.innerHTML = '';
    this.endingBadgeGridElement.innerHTML = '';

    for (const ending of ENDINGS) {
      this.endingGridElement.appendChild(this._createEndingCard(ending));
    }

    for (const badge of BADGES) {
      const targetGrid = badge.type === BADGE_TYPE.ENDING
        ? this.endingBadgeGridElement
        : this.journeyBadgeGridElement;
      targetGrid.appendChild(this._createBadgeCard(badge));
    }

    if (this.endingProgressElement) {
      this.endingProgressElement.textContent = `已解锁 ${this._countUnlockedEndings()} / ${ENDINGS.length}`;
    }
    if (this.badgeProgressElement) {
      this.badgeProgressElement.textContent = `已获得 ${this._countUnlockedBadges()} / ${BADGES.length}`;
    }
    this._updateUnlockFeedback();
  }

  /**
   * 销毁组件，移除事件监听与 DOM；可安全重复调用。
   */
  destroy() {
    if (this.unlockForm) {
      this.unlockForm.removeEventListener('submit', this._onUnlockSubmit);
    }
    if (this.element) {
      this.element.removeEventListener('click', this._onBackdropClick);
      if (this.element.parentNode) this.element.parentNode.removeChild(this.element);
    }

    this.element = null;
    this.endingGridElement = null;
    this.endingProgressElement = null;
    this.journeyBadgeGridElement = null;
    this.endingBadgeGridElement = null;
    this.badgeProgressElement = null;
    this.unlockInput = null;
    this.unlockFeedbackElement = null;
    this.unlockForm = null;
    this.detailElement = null;
    this.container = null;
    this.badgeSystem = null;
    this.storage = null;
    this.onClose = null;
  }

  // ==================== 面板结构 ====================

  /**
   * 创建标题栏；密码入口固定在右上区域，适合展示时快速打开全部内容。
   * @returns {HTMLElement}
   * @private
   */
  _createHeader() {
    const header = document.createElement('header');
    header.style.cssText = `
      display: flex; align-items: flex-start; justify-content: space-between;
      gap: 18px; flex-wrap: wrap; margin-bottom: 26px;
    `;

    const titleGroup = document.createElement('div');
    const title = document.createElement('h2');
    title.textContent = '结尾回顾';
    title.style.cssText = 'margin: 0 0 8px; color: #ffe0a6; font-size: clamp(24px, 3vw, 34px);';
    titleGroup.appendChild(title);

    const description = document.createElement('p');
    description.textContent = '通关对应结局或获得对应印记后即可回看；未解锁内容会保持神秘。';
    description.style.cssText = 'margin: 0; color: #aebfba; font-size: 14px; line-height: 1.6;';
    titleGroup.appendChild(description);
    header.appendChild(titleGroup);

    const unlockArea = document.createElement('div');
    unlockArea.style.cssText = `
      display: flex; flex-direction: column; align-items: flex-end; gap: 7px;
      flex: 0 1 310px; min-width: min(100%, 280px); max-width: 100%;
    `;

    this.unlockForm = document.createElement('form');
    this.unlockForm.setAttribute('data-review-unlock-form', '');
    this.unlockForm.style.cssText = `
      display: flex; align-items: center; justify-content: flex-end; flex-wrap: wrap;
      gap: 8px; max-width: 100%;
    `;
    this.unlockForm.addEventListener('submit', this._onUnlockSubmit);

    this.unlockInput = document.createElement('input');
    this.unlockInput.setAttribute('data-review-unlock-input', '');
    this.unlockInput.type = 'password';
    this.unlockInput.inputMode = 'numeric';
    this.unlockInput.maxLength = ENDING_REVIEW_DEMO_CODE.length;
    this.unlockInput.autocomplete = 'off';
    this.unlockInput.placeholder = '输入展示密码';
    this.unlockInput.setAttribute('aria-label', '展示密码');
    this.unlockInput.style.cssText = `
      width: min(142px, 100%); min-height: 42px; padding: 0 12px; box-sizing: border-box;
      color: #fff2cf; background: rgba(8, 15, 15, 0.72);
      border: 1px solid rgba(242, 202, 134, 0.42); border-radius: 7px;
      outline: none; font: inherit; font-size: 14px; text-align: center;
    `;
    this.unlockForm.appendChild(this.unlockInput);

    const unlockButton = document.createElement('button');
    unlockButton.setAttribute('data-review-unlock-submit', '');
    unlockButton.textContent = '解锁展示';
    applyButtonStyle(unlockButton, { variant: 'primary', size: 'sm' });
    // applyButtonStyle 默认把按钮设为普通 button，这里需要恢复 submit 才能触发表单校验。
    unlockButton.type = 'submit';
    this.unlockForm.appendChild(unlockButton);
    unlockArea.appendChild(this.unlockForm);

    this.unlockFeedbackElement = document.createElement('div');
    this.unlockFeedbackElement.setAttribute('data-review-unlock-feedback', '');
    this.unlockFeedbackElement.style.cssText = `
      min-height: 18px; max-width: 100%; color: #99aaa4; font-size: 12px;
      line-height: 1.4; text-align: right; white-space: normal;
    `;
    unlockArea.appendChild(this.unlockFeedbackElement);
    header.appendChild(unlockArea);

    return header;
  }

  /**
   * 创建结局 CG 区块。
   * @returns {HTMLElement}
   * @private
   */
  _createEndingSection() {
    const section = this._createSection('结尾 CG', 'data-ending-review-cg-section');
    const progress = document.createElement('div');
    progress.setAttribute('data-ending-review-cg-progress', '');
    progress.textContent = `已解锁 ${this._countUnlockedEndings()} / ${ENDINGS.length}`;
    progress.style.cssText = 'margin-bottom: 14px; color: #aebfba; font-size: 13px;';
    this.endingProgressElement = progress;
    section.appendChild(progress);

    this.endingGridElement = document.createElement('div');
    this.endingGridElement.setAttribute('data-ending-review-cg-grid', '');
    this.endingGridElement.style.cssText = `
      display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
      gap: clamp(10px, 1.3vw, 14px); min-width: 0;
    `;
    section.appendChild(this.endingGridElement);
    return section;
  }

  /**
   * 创建印记区块，沿途与结局印记分组呈现以便快速核验收藏进度。
   * @returns {HTMLElement}
   * @private
   */
  _createBadgeSection() {
    const section = this._createSection('东莞印记', 'data-ending-review-badge-section');
    const progress = document.createElement('div');
    progress.setAttribute('data-ending-review-badge-progress', '');
    progress.textContent = `已获得 ${this._countUnlockedBadges()} / ${BADGES.length}`;
    progress.style.cssText = 'margin-bottom: 16px; color: #aebfba; font-size: 13px;';
    this.badgeProgressElement = progress;
    section.appendChild(progress);

    const journeyTitle = document.createElement('h3');
    journeyTitle.textContent = '沿途印记';
    journeyTitle.style.cssText = 'margin: 0 0 10px; color: #f4c77a; font-size: 17px;';
    section.appendChild(journeyTitle);

    this.journeyBadgeGridElement = this._createBadgeGrid('journey');
    section.appendChild(this.journeyBadgeGridElement);

    const endingTitle = document.createElement('h3');
    endingTitle.textContent = '结局印记';
    endingTitle.style.cssText = 'margin: 24px 0 10px; color: #f4c77a; font-size: 17px;';
    section.appendChild(endingTitle);

    this.endingBadgeGridElement = this._createBadgeGrid('ending');
    section.appendChild(this.endingBadgeGridElement);
    return section;
  }

  /**
   * 创建统一区块容器。
   * @param {string} titleText
   * @param {string} dataAttribute
   * @returns {HTMLElement}
   * @private
   */
  _createSection(titleText, dataAttribute) {
    const section = document.createElement('section');
    section.setAttribute(dataAttribute, '');
    section.style.cssText = `
      margin-top: 20px; padding: 18px; box-sizing: border-box;
      background: rgba(7, 14, 14, 0.34); border: 1px solid rgba(193, 171, 126, 0.18);
      border-radius: 12px;
    `;

    const title = document.createElement('h3');
    title.textContent = titleText;
    title.style.cssText = 'margin: 0 0 8px; color: #fff0c9; font-size: 21px;';
    section.appendChild(title);
    return section;
  }

  /**
   * @param {string} type
   * @returns {HTMLElement}
   * @private
   */
  _createBadgeGrid(type) {
    const grid = document.createElement('div');
    grid.setAttribute('data-review-badge-grid', type);
    grid.style.cssText = `
      display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 12px; min-width: 0;
    `;
    return grid;
  }

  // ==================== 卡片渲染 ====================

  /**
   * 创建结局卡片；锁定状态不插入 CG 图片节点，避免通过缩略图提前泄露内容。
   * @param {Object} ending
   * @returns {HTMLElement}
   * @private
   */
  _createEndingCard(ending) {
    const unlocked = this._isEndingUnlocked(ending);
    const card = document.createElement('article');
    card.setAttribute('data-ending-card', ending.id);
    card.dataset.unlocked = String(unlocked);
    card.style.cssText = `
      min-width: 0; overflow: hidden; border: 1px solid ${unlocked ? 'rgba(242, 202, 134, 0.58)' : 'rgba(126, 143, 137, 0.25)'};
      border-radius: 10px; background: ${unlocked ? 'rgba(43, 58, 54, 0.78)' : 'rgba(27, 37, 36, 0.7)'};
      box-shadow: ${unlocked ? '0 8px 22px rgba(0, 0, 0, 0.22)' : 'none'};
    `;

    const action = document.createElement('button');
    action.setAttribute('data-ending-card-action', ending.id);
    action.type = 'button';
    action.disabled = !unlocked;
    action.style.cssText = `
      display: flex; flex-direction: column; align-items: stretch; width: 100%;
      min-height: 0; padding: 0; overflow: hidden; border: 0; border-radius: 9px;
      color: inherit; background: transparent; box-shadow: none; text-align: left;
      cursor: ${unlocked ? 'pointer' : 'not-allowed'};
    `;
    applyButtonStyle(action, { variant: unlocked ? 'ghost' : 'secondary', size: 'md', width: 'full' });
    action.style.minHeight = '0';
    action.style.padding = '0';

    if (unlocked) {
      const image = document.createElement('img');
      image.setAttribute('data-ending-card-image', ending.id);
      image.src = ENDING_CG_URL_MAP[ending.id];
      image.alt = ending.title;
      image.decoding = 'async';
      image.style.cssText = `
        display: block; width: 100%; aspect-ratio: 16 / 9; object-fit: contain;
        background: linear-gradient(145deg, rgba(18, 30, 30, 0.92), rgba(8, 16, 16, 0.92));
      `;
      action.appendChild(image);
    } else {
      const lock = document.createElement('div');
      lock.setAttribute('data-ending-card-lock', ending.id);
      lock.textContent = '🔒';
      lock.style.cssText = `
        display: flex; align-items: center; justify-content: center; gap: 8px;
        width: 100%; aspect-ratio: 16 / 9; box-sizing: border-box;
        color: #77847f; background: linear-gradient(135deg, #222d2c, #121b1b);
        font-size: 30px;
      `;
      action.appendChild(lock);
    }

    const title = document.createElement('div');
    title.setAttribute('data-ending-card-title', ending.id);
    title.textContent = unlocked ? ending.title : '???';
    title.style.cssText = `
      padding: 11px 12px 3px; color: ${unlocked ? '#ffe0a6' : '#77847f'};
      font-size: 16px; font-weight: 700;
    `;
    action.appendChild(title);

    const status = document.createElement('div');
    status.textContent = unlocked ? '已解锁 · 点击查看' : '完成对应结局后解锁';
    status.style.cssText = `
      padding: 0 12px 12px; color: ${unlocked ? '#b5c8bd' : '#68736f'};
      font-size: 12px; line-height: 1.4;
    `;
    action.appendChild(status);

    if (unlocked) {
      action.addEventListener('click', () => this._showEndingDetail(ending));
    }
    card.appendChild(action);
    return card;
  }

  /**
   * 创建印记卡片；密码模式只在此面板内视为已解锁。
   * @param {Object} badge
   * @returns {HTMLElement}
   * @private
   */
  _createBadgeCard(badge) {
    const unlocked = this._isBadgeUnlocked(badge.id);
    const card = document.createElement('article');
    card.setAttribute('data-review-badge-card', badge.id);
    card.dataset.unlocked = String(unlocked);
    card.style.cssText = `
      min-width: 0; padding: 12px 10px; box-sizing: border-box; text-align: center;
      border: 1px solid ${unlocked ? 'rgba(199, 123, 66, 0.72)' : 'rgba(126, 143, 137, 0.2)'};
      border-radius: 10px; background: ${unlocked ? 'rgba(45, 57, 56, 0.86)' : 'rgba(30, 38, 38, 0.68)'};
      opacity: ${unlocked ? '1' : '0.62'};
    `;

    const imageSource = getBadgeAssetUrl(badge.id, unlocked);
    if (imageSource) {
      const image = document.createElement('img');
      image.setAttribute('data-review-badge-image', badge.id);
      image.src = imageSource;
      image.alt = unlocked ? badge.name : '未获得印记';
      image.decoding = 'async';
      image.style.cssText = `
        display: block; width: 76px; height: 76px; object-fit: contain;
        margin: 0 auto 7px;
        filter: drop-shadow(0 0 8px ${unlocked ? 'rgba(255, 205, 108, 0.35)' : 'rgba(255,255,255,0.05)'});
      `;
      card.appendChild(image);
    }

    const name = document.createElement('div');
    name.textContent = unlocked ? badge.name : '???';
    name.style.cssText = `
      min-height: 21px; color: ${unlocked ? '#e9eee9' : '#707b76'};
      font-size: 14px; font-weight: 700;
    `;
    card.appendChild(name);

    const detail = document.createElement('div');
    detail.textContent = unlocked ? badge.desc : '未获得';
    detail.style.cssText = `
      margin-top: 6px; color: ${unlocked ? '#aebfba' : '#68736f'};
      font-size: 11px; line-height: 1.4;
    `;
    card.appendChild(detail);
    return card;
  }

  /**
   * 展示已解锁结局的详情 CG，不触发结局结算事件，也不会重复发放印记。
   * @param {Object} ending
   * @private
   */
  _showEndingDetail(ending) {
    if (!this.element || !this._isEndingUnlocked(ending)) return;
    this._hideEndingDetail();

    const display = getEndingCGDisplayConfig(ending.id);
    const imageUrl = ENDING_CG_URL_MAP[ending.id] || ENDING_CG_URL_MAP.intro_dongguan;

    const detail = document.createElement('div');
    detail.setAttribute('data-ending-detail', ending.id);
    detail.style.cssText = `
      position: absolute; inset: 0; z-index: 3; display: flex; align-items: center;
      justify-content: center;
      padding: max(14px, env(safe-area-inset-top, 0px))
        max(14px, env(safe-area-inset-right, 0px))
        max(14px, env(safe-area-inset-bottom, 0px))
        max(14px, env(safe-area-inset-left, 0px));
      box-sizing: border-box; overflow: hidden;
      background: rgba(5, 11, 11, 0.96); border-radius: 18px;
    `;

    const content = document.createElement('div');
    content.style.cssText = `
      width: min(980px, 100%); height: 100%; max-height: 100%; min-height: 0;
      display: flex; flex-direction: column; align-items: center; gap: 10px;
      overflow: hidden; text-align: center;
    `;

    const media = document.createElement('figure');
    media.setAttribute('data-ending-detail-media', '');
    media.style.cssText = `
      position: relative; flex: 0 1 auto; width: min(860px, 92vw, 103.11vh);
      aspect-ratio: 16 / 9; min-height: 0; margin: 0; overflow: hidden;
      border: 1px solid rgba(242, 202, 134, 0.45); border-radius: 10px;
      background: rgba(14, 25, 25, 0.9); box-shadow: 0 12px 38px rgba(0, 0, 0, 0.42);
    `;

    const backdrop = document.createElement('img');
    backdrop.setAttribute('data-ending-detail-background', ending.id);
    backdrop.src = imageUrl;
    backdrop.alt = '';
    backdrop.setAttribute('aria-hidden', 'true');
    backdrop.decoding = 'async';
    backdrop.style.cssText = `
      position: absolute; inset: -8%; width: 116%; height: 116%; object-fit: cover;
      object-position: ${display.objectPosition}; filter: blur(18px) brightness(0.42);
      transform: scale(1.08);
    `;
    media.appendChild(backdrop);

    const image = document.createElement('img');
    image.setAttribute('data-ending-detail-image', ending.id);
    image.src = imageUrl;
    image.alt = ending.title;
    image.decoding = 'async';
    image.style.cssText = `
      position: relative; z-index: 1; display: block; width: 100%; height: 100%;
      object-fit: contain; object-position: ${display.objectPosition};
    `;
    media.appendChild(image);
    content.appendChild(media);

    const copy = document.createElement('div');
    copy.setAttribute('data-ending-detail-copy', '');
    copy.style.cssText = `
      width: min(780px, 100%); flex: 1 1 auto; min-height: 0; overflow-y: auto;
      padding: 2px 6px 4px; box-sizing: border-box;
    `;

    const title = document.createElement('h3');
    title.textContent = ending.title;
    title.style.cssText = 'margin: 4px 0 8px; color: #ffe0a6; font-size: clamp(22px, 3vw, 30px); line-height: 1.2;';
    copy.appendChild(title);

    const narration = document.createElement('p');
    narration.textContent = ending.narration;
    narration.style.cssText = 'margin: 0; color: #d4dfd9; font-size: 14px; line-height: 1.75; overflow-wrap: anywhere;';
    copy.appendChild(narration);

    const epilogue = document.createElement('div');
    epilogue.textContent = ending.epilogue;
    epilogue.style.cssText = 'margin-top: 10px; color: #f4c77a; font-size: 15px; line-height: 1.35; font-weight: 700;';
    copy.appendChild(epilogue);
    content.appendChild(copy);

    const actions = document.createElement('div');
    actions.setAttribute('data-ending-detail-actions', '');
    actions.style.cssText = `
      display: flex; flex: 0 0 auto; align-items: center; justify-content: center;
      flex-wrap: wrap; gap: 10px; min-height: 38px; padding-top: 4px;
    `;
    const closeButton = document.createElement('button');
    closeButton.setAttribute('data-ending-detail-close', '');
    closeButton.textContent = '返回结尾回顾';
    closeButton.style.cssText = 'max-width: 100%; margin: 0;';
    applyButtonStyle(closeButton, { variant: 'secondary', size: 'sm' });
    closeButton.addEventListener('click', () => this._hideEndingDetail());
    actions.appendChild(closeButton);
    content.appendChild(actions);

    detail.appendChild(content);
    this.element.appendChild(detail);
    this.detailElement = detail;
  }

  /** @private */
  _hideEndingDetail() {
    if (this.detailElement && this.detailElement.parentNode) {
      this.detailElement.parentNode.removeChild(this.detailElement);
    }
    this.detailElement = null;
  }

  // ==================== 解锁状态 ====================

  /** @private */
  _isEndingUnlocked(ending) {
    return this.demoUnlocked || Boolean(this.badgeSystem?.isUnlocked?.(ending.badge));
  }

  /** @private */
  _isBadgeUnlocked(badgeId) {
    return this.demoUnlocked || Boolean(this.badgeSystem?.isUnlocked?.(badgeId));
  }

  /** @private */
  _countUnlockedEndings() {
    return ENDINGS.filter((ending) => this._isEndingUnlocked(ending)).length;
  }

  /** @private */
  _countUnlockedBadges() {
    return BADGES.filter((badge) => this._isBadgeUnlocked(badge.id)).length;
  }

  /** @private */
  _loadDemoUnlockState() {
    if (!this.storage || typeof this.storage.get !== 'function') return false;
    return this.storage.get(DEMO_UNLOCK_STORAGE_KEY, false) === true;
  }

  /** @private */
  _onUnlockSubmit(event) {
    event.preventDefault();
    const code = this.unlockInput?.value.trim() || '';
    if (code !== ENDING_REVIEW_DEMO_CODE) {
      if (this.unlockFeedbackElement) {
        this.unlockFeedbackElement.textContent = '密码不正确，请重新输入。';
        this.unlockFeedbackElement.style.color = '#f0a18d';
      }
      return;
    }

    this.demoUnlocked = true;
    if (this.storage && typeof this.storage.set === 'function') {
      try {
        this.storage.set(DEMO_UNLOCK_STORAGE_KEY, true);
      } catch (error) {
        // 演示解锁本身仍然可用；存储失败只影响下次打开时是否保留状态。
        console.warn('[鹅厂出逃记] 结尾回顾展示状态保存失败:', error);
      }
    }

    if (this.unlockInput) this.unlockInput.value = '';
    this.render();
    if (this.unlockFeedbackElement) {
      this.unlockFeedbackElement.textContent = '展示模式已开启：全部结尾 CG 与印记已解锁。';
      this.unlockFeedbackElement.style.color = '#a6d9a8';
    }
  }

  /** @private */
  _updateUnlockFeedback() {
    if (!this.unlockFeedbackElement) return;
    if (this.demoUnlocked) {
      this.unlockFeedbackElement.textContent = '展示模式已开启：全部内容可回看。';
      this.unlockFeedbackElement.style.color = '#a6d9a8';
      return;
    }
    this.unlockFeedbackElement.textContent = '';
    this.unlockFeedbackElement.style.color = '#99aaa4';
  }

  /** @private */
  _onBackdropClick(event) {
    if (event.target === this.element) this.hide();
  }
}
