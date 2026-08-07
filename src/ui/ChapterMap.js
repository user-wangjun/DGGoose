import { CHAPTERS } from '../data/chapters.js';
import { BADGES, BADGE_TYPE } from '../data/badges.js';
import { Button } from './Button.js';

/** 章节节点三态枚举 */
const NodeState = {
  LOCKED: 'locked',
  CURRENT: 'current',
  COMPLETED: 'completed',
};

/** 各状态对应的视觉表现（图标/边框色/背景色/文字色） */
const STATE_VISUALS = {
  [NodeState.LOCKED]: { icon: '🔒', borderColor: '#4b5563', bgColor: '#1f2937', textColor: '#6b7280' },
  [NodeState.CURRENT]: { icon: '⭐', borderColor: '#fbbf24', bgColor: '#1f2937', textColor: '#fbbf24' },
  [NodeState.COMPLETED]: { icon: '✓', borderColor: '#34d399', bgColor: '#065f46', textColor: '#34d399' },
};

/**
 * 章节地图 UI 组件（对应 PRD §5 F4）
 *
 * 以横向时间轴形式展示 7 个章节节点，根据解锁/完成状态渲染三态
 * （锁定/当前/已完成）。点击已解锁节点弹出信息卡展示章节详情，
 * 点击锁定节点通过 Toast 提示"完成上一章后解锁"，不泄露后续剧情。
 *
 * 设计要点：
 * - 节点间连线表示章节顺序，已完成路径高亮为绿色
 * - 信息卡展示章节名/场景/玩法/印记状态/文化标签/抉择状态/结局印记
 * - 印记状态通过 BadgeSystem 查询，未解锁仅显示"未获得"防剧透
 * - 通关后全解锁时，已完成章节仍可点击重玩
 * - 底部展示结局印记收集进度（M5 §5.7），支持多周目收集追踪
 */
export class ChapterMap {
  /**
   * 创建章节地图实例
   * @param {Object} deps - 依赖注入
   * @param {HTMLElement} deps.container - DOM 挂载容器（通常为 #ui-root 子层）
   * @param {BadgeSystem} deps.badgeSystem - 印记系统，用于查询印记解锁状态
   * @param {Toast} deps.toast - 轻提示实例，用于锁定节点点击提示
   * @param {Function} deps.onEnterChapter - 进入章节回调，参数为章节 id
   * @param {string[]} [deps.unlockedChapters] - 初始已解锁章节 id 列表
   * @param {string[]} [deps.completedChapters] - 初始已完成章节 id 列表
   * @param {string[]} [deps.choices] - 已选择"留下"的场景 id 列表（M5 §5.7）
   */
  constructor({ container, badgeSystem, toast, onEnterChapter, unlockedChapters = [], completedChapters = [], choices = [] }) {
    this.container = container;
    this.badgeSystem = badgeSystem;
    this.toast = toast;
    this.onEnterChapter = onEnterChapter || null;

    /** 已解锁章节 id 列表 */
    this.unlockedChapters = unlockedChapters;
    /** 已完成章节 id 列表 */
    this.completedChapters = completedChapters;
    /** 已选择"留下"的场景 id 列表（对应 ch1~ch5 的 choice 抉择） */
    this.choices = choices;
    /** 当前选中章节 id，null 表示未选中 */
    this.selectedChapterId = null;

    this.element = null;
    this.timelineElement = null;
    this.infoCardElement = null;
    /** 结局印记收集进度元素，create 时构建 */
    this.endingProgressElement = null;
    /** @type {Map<string, HTMLElement>} 章节 id → 节点元素映射 */
    this.nodeElements = new Map();
    /** 进入章节按钮实例，销毁时需清理 */
    this.enterButton = null;
    /** 样式是否已注入，避免重复添加 style 标签 */
    this._stylesInjected = false;

    // 绑定事件处理器，确保回调中 this 指向正确
    this._onEnterClick = this._onEnterClick.bind(this);
  }

  /**
   * 构建章节地图 DOM 并挂载到容器
   * @returns {HTMLElement} 地图根元素
   */
  create() {
    this._injectStyles();

    this.element = document.createElement('div');
    this.element.setAttribute('data-chapter-map', '');
    this.element.style.cssText = `
      pointer-events: auto;
      display: flex; flex-direction: column; align-items: center;
      width: 100%; padding: 20px;
      font-family: -apple-system, "Microsoft YaHei", sans-serif;
    `;

    // 时间轴区域：横向排列 7 个节点与连线
    this.timelineElement = this._createTimeline();
    this.element.appendChild(this.timelineElement);

    // 信息卡区域：默认隐藏，选中节点后显示
    this.infoCardElement = this._createInfoCardContainer();
    this.element.appendChild(this.infoCardElement);

    // 结局印记收集进度区域（M5 §5.7）
    this.endingProgressElement = this._createEndingProgress();
    this.element.appendChild(this.endingProgressElement);

    this.container.appendChild(this.element);

    // 首次渲染节点
    this.render();

    return this.element;
  }

  /**
   * 更新解锁/完成状态并重新渲染
   * 由 ChapterSelectScene 在 onEnter 时调用，传入从存档推断的状态
   * @param {string[]} unlockedChapters - 已解锁章节 id 列表
   * @param {string[]} completedChapters - 已完成章节 id 列表
   * @param {string[]} [choices] - 已选择"留下"的场景 id 列表（M5 §5.7）
   */
  setState(unlockedChapters, completedChapters, choices) {
    this.unlockedChapters = unlockedChapters || [];
    this.completedChapters = completedChapters || [];
    this.choices = choices || [];
    this.selectedChapterId = null;
    this.render();
    this._updateEndingProgress();
    this.hideInfoCard();
  }

  /**
   * 重新渲染所有节点与连线
   * 每次状态变更后调用，保证 UI 与数据同步
   */
  render() {
    if (!this.timelineElement) return;

    this.timelineElement.innerHTML = '';
    this.nodeElements.clear();

    for (let i = 0; i < CHAPTERS.length; i++) {
      const chapter = CHAPTERS[i];

      // 创建节点
      const node = this._createNode(chapter);
      this.timelineElement.appendChild(node);
      this.nodeElements.set(chapter.id, node);

      // 非最后一个节点后添加连线
      if (i < CHAPTERS.length - 1) {
        const connector = this._createConnector(chapter.id);
        this.timelineElement.appendChild(connector);
      }
    }
  }

  /**
   * 选中指定章节节点并展示信息卡
   * 更新节点高亮状态，填充信息卡内容
   * @param {string} chapterId - 章节 id
   */
  selectNode(chapterId) {
    this.selectedChapterId = chapterId;

    // 通过 data-selected 属性控制高亮，CSS 负责视觉表现
    for (const [id, node] of this.nodeElements) {
      if (id === chapterId) {
        node.setAttribute('data-selected', 'true');
      } else {
        node.removeAttribute('data-selected');
      }
    }

    // 查找章节数据并展示信息卡
    const chapter = CHAPTERS.find((ch) => ch.id === chapterId);
    if (chapter) {
      this.showInfoCard(chapter);
    }
  }

  /**
   * 展示章节信息卡
   * 信息卡包含：章节名、场景、玩法、印记状态、文化标签、抉择状态、结局印记、进入按钮
   * 印记状态通过 BadgeSystem 查询，未解锁仅显示"未获得"防剧透
   * 抉择状态仅对有 choice 字段的章节展示（ch1~ch5），序章和终章不展示
   * @param {Object} chapter - 章节数据
   */
  showInfoCard(chapter) {
    if (!this.infoCardElement) return;

    // 清空并重建信息卡内容
    this.infoCardElement.innerHTML = '';

    // 章节名
    const nameEl = document.createElement('h3');
    nameEl.textContent = chapter.name;
    nameEl.style.cssText = 'margin: 0 0 16px 0; font-size: 20px; color: #f0f0f0;';
    this.infoCardElement.appendChild(nameEl);

    // 信息行容器
    const infoList = document.createElement('div');
    infoList.style.cssText = 'display: flex; flex-direction: column; gap: 10px; margin-bottom: 20px;';

    infoList.appendChild(this._createInfoRow('场景', chapter.scene));
    infoList.appendChild(this._createInfoRow('玩法', chapter.gameplay));
    infoList.appendChild(this._createInfoRow('文化标签', chapter.tag));
    infoList.appendChild(this._createInfoRow('预计时长', `${chapter.time} 分钟`));

    // 沿途印记状态行（防剧透：未解锁仅显示"未获得"，不暴露印记名称）
    const badgeInfo = this.badgeSystem.getBadgeInfo(chapter.badge);
    const badgeUnlocked = this.badgeSystem.isUnlocked(chapter.badge);
    const badgeText = badgeUnlocked && badgeInfo
      ? `${badgeInfo.name}（已获得）`
      : '未获得';
    infoList.appendChild(this._createInfoRow('印记', badgeText));

    // 抉择状态行（M5 §5.7）：仅对有 choice 字段的章节展示
    if (chapter.choice) {
      const hasChosenStay = this.choices.includes(chapter.id);
      const choiceText = hasChosenStay ? '已选择留下' : '未选择留下';
      infoList.appendChild(this._createInfoRow('抉择', choiceText));

      // 结局印记状态行（M5 §5.7）：展示对应结局印记的收集状态
      const endingBadgeId = chapter.choice.badge;
      const endingBadgeInfo = this.badgeSystem.getBadgeInfo(endingBadgeId);
      const endingBadgeUnlocked = this.badgeSystem.isUnlocked(endingBadgeId);
      const endingBadgeText = endingBadgeUnlocked && endingBadgeInfo
        ? `${endingBadgeInfo.name}（已获得）`
        : '未获得';
      infoList.appendChild(this._createInfoRow('结局印记', endingBadgeText));
    }

    this.infoCardElement.appendChild(infoList);

    // "进入章节"按钮
    if (this.enterButton) {
      this.enterButton.destroy();
    }
    this.enterButton = new Button({
      label: '进入章节',
      onClick: this._onEnterClick,
      variant: 'primary',
    });
    const buttonEl = this.enterButton.create();
    buttonEl.style.display = 'block';
    buttonEl.style.margin = '0 auto';
    this.infoCardElement.appendChild(buttonEl);

    this.infoCardElement.style.display = 'block';
  }

  /**
   * 隐藏信息卡并清除节点选中状态
   */
  hideInfoCard() {
    if (!this.infoCardElement) return;
    this.infoCardElement.style.display = 'none';
    this.infoCardElement.innerHTML = '';

    if (this.enterButton) {
      this.enterButton.destroy();
      this.enterButton = null;
    }

    // 清除所有节点的选中高亮
    for (const node of this.nodeElements.values()) {
      node.removeAttribute('data-selected');
    }

    this.selectedChapterId = null;
  }

  /**
   * 销毁组件，清理 DOM 与引用
   */
  destroy() {
    if (this.enterButton) {
      this.enterButton.destroy();
      this.enterButton = null;
    }
    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }
    this.element = null;
    this.timelineElement = null;
    this.infoCardElement = null;
    this.endingProgressElement = null;
    this.nodeElements.clear();
    this.container = null;
    this.badgeSystem = null;
    this.toast = null;
    this.onEnterChapter = null;
  }

  // ==================== 私有方法 ====================

  /**
   * 创建结局印记收集进度区域（M5 §5.7）
   * 展示已收集的结局印记数量与总数（6 枚），激励多周目收集
   * @returns {HTMLElement}
   * @private
   */
  _createEndingProgress() {
    const wrapper = document.createElement('div');
    wrapper.setAttribute('data-ending-progress', '');
    wrapper.style.cssText = `
      margin-top: 20px; padding: 12px 24px;
      width: 480px; max-width: 90vw;
      background: #1a1a2e; border-radius: 8px;
      border: 1px solid #2d2d4f;
      display: flex; align-items: center; gap: 12px;
      font-family: -apple-system, "Microsoft YaHei", sans-serif;
    `;

    // 标签
    const label = document.createElement('span');
    label.textContent = '结局印记';
    label.style.cssText = 'flex-shrink: 0; color: #9ca3af; font-size: 14px;';
    wrapper.appendChild(label);

    // 进度文本（由 _updateEndingProgress 填充）
    const text = document.createElement('span');
    text.setAttribute('data-ending-progress-text', '');
    text.style.cssText = 'flex-shrink: 0; color: #e5e7eb; font-size: 14px; min-width: 48px;';
    wrapper.appendChild(text);

    // 进度条容器
    const barContainer = document.createElement('div');
    barContainer.style.cssText = `
      flex: 1; height: 8px; background: #374151;
      border-radius: 4px; overflow: hidden;
    `;

    // 进度条填充
    const barFill = document.createElement('div');
    barFill.setAttribute('data-ending-progress-bar', '');
    barFill.style.cssText = `
      height: 100%; width: 0%;
      background: linear-gradient(90deg, #bb6b38, #efb45f);
      border-radius: 4px; transition: width 0.4s ease;
    `;
    barContainer.appendChild(barFill);
    wrapper.appendChild(barContainer);

    // 初始填充进度
    this._fillEndingProgress(wrapper);

    return wrapper;
  }

  /**
   * 填充结局印记进度区域的内容
   * 从 BadgeSystem 获取已收集的结局印记数量，更新文本与进度条宽度
   * @param {HTMLElement} wrapper - 进度区域根元素
   * @private
   */
  _fillEndingProgress(wrapper) {
    // 筛选结局类型印记
    const endingBadges = BADGES.filter((b) => b.type === BADGE_TYPE.ENDING);
    const total = endingBadges.length;
    const collected = endingBadges.filter((b) => this.badgeSystem.isUnlocked(b.id)).length;
    const percent = total === 0 ? 0 : (collected / total) * 100;

    const textEl = wrapper.querySelector('[data-ending-progress-text]');
    if (textEl) {
      textEl.textContent = `${collected} / ${total}`;
    }

    const barEl = wrapper.querySelector('[data-ending-progress-bar]');
    if (barEl) {
      barEl.style.width = `${percent}%`;
    }
  }

  /**
   * 更新结局印记收集进度区域
   * setState 后调用，重新从 BadgeSystem 获取最新收集状态
   * @private
   */
  _updateEndingProgress() {
    if (this.endingProgressElement) {
      this._fillEndingProgress(this.endingProgressElement);
    }
  }

  /**
   * 注入 hover 与选中态的 CSS 规则
   * 仅注入一次，通过 data 属性选择器实现交互态，避免内联样式冲突
   * @private
   */
  _injectStyles() {
    if (this._stylesInjected) return;
    this._stylesInjected = true;

    const style = document.createElement('style');
    style.textContent = `
      [data-chapter-map] [data-chapter-node][data-state="current"]:hover [data-chapter-icon],
      [data-chapter-map] [data-chapter-node][data-state="completed"]:hover [data-chapter-icon] {
        transform: scale(1.1);
      }
      [data-chapter-map] [data-chapter-node][data-selected="true"] [data-chapter-icon] {
        transform: scale(1.1);
        box-shadow: 0 0 0 4px rgba(99, 102, 241, 0.4);
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * 创建时间轴容器
   * 使用 flex 布局横向排列节点与连线
   * @returns {HTMLElement}
   * @private
   */
  _createTimeline() {
    const timeline = document.createElement('div');
    timeline.setAttribute('data-chapter-timeline', '');
    timeline.style.cssText = `
      display: flex; align-items: flex-start; justify-content: center;
      flex-wrap: nowrap; gap: 0; width: 100%; max-width: 1100px;
    `;
    return timeline;
  }

  /**
   * 创建单个章节节点
   * 根据解锁状态应用不同样式与图标
   * @param {Object} chapter - 章节数据
   * @returns {HTMLElement}
   * @private
   */
  _createNode(chapter) {
    const state = this._getNodeState(chapter.id);
    const visual = STATE_VISUALS[state];
    const isUnlocked = state !== NodeState.LOCKED;

    const node = document.createElement('div');
    node.setAttribute('data-chapter-node', chapter.id);
    node.setAttribute('data-state', state);
    node.style.cssText = `
      display: flex; flex-direction: column; align-items: center;
      cursor: ${isUnlocked ? 'pointer' : 'default'};
      flex-shrink: 0; width: 110px;
    `;

    // 圆形图标
    const icon = document.createElement('div');
    icon.setAttribute('data-chapter-icon', '');
    icon.style.cssText = `
      width: 56px; height: 56px; border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      font-size: 24px; border: 3px solid ${visual.borderColor};
      background: ${visual.bgColor}; color: ${visual.textColor};
      transition: transform 0.2s ease, box-shadow 0.2s ease;
    `;
    icon.textContent = visual.icon;
    node.appendChild(icon);

    // 章节名
    const label = document.createElement('div');
    label.setAttribute('data-chapter-label', '');
    label.style.cssText = `
      margin-top: 10px; font-size: 12px; text-align: center;
      color: ${isUnlocked ? '#d1d5db' : '#6b7280'};
      max-width: 106px; line-height: 1.4;
    `;
    label.textContent = chapter.name;
    node.appendChild(label);

    // 已解锁节点注册点击事件
    if (isUnlocked) {
      node.addEventListener('click', () => this._handleNodeClick(chapter.id));
    }

    return node;
  }

  /**
   * 创建节点间的连线
   * 前一章节已完成时连线高亮为绿色（表示路径已打通）
   * @param {string} prevChapterId - 前一章节 id
   * @returns {HTMLElement}
   * @private
   */
  _createConnector(prevChapterId) {
    const isActive = this.completedChapters.includes(prevChapterId);
    const connector = document.createElement('div');
    connector.setAttribute('data-chapter-connector', '');
    connector.setAttribute('data-active', String(isActive));
    connector.style.cssText = `
      flex: 1; min-width: 20px; height: 3px; margin-top: 26px;
      background: ${isActive ? '#34d399' : '#374151'};
      border-radius: 2px; transition: background 0.3s ease;
    `;
    return connector;
  }

  /**
   * 创建信息卡容器（默认隐藏）
   * 选中节点后填充内容并显示
   * @returns {HTMLElement}
   * @private
   */
  _createInfoCardContainer() {
    const card = document.createElement('div');
    card.setAttribute('data-chapter-info-card', '');
    card.style.cssText = `
      display: none; margin-top: 28px; padding: 24px 32px;
      width: 480px; max-width: 90vw;
      background: #1e1b2e; border-radius: 12px;
      border: 1px solid #3d3859;
      box-shadow: 0 4px 24px rgba(0,0,0,0.3);
      color: #e5e7eb; font-size: 15px;
    `;
    return card;
  }

  /**
   * 创建信息卡中的单行信息
   * @param {string} label - 标签
   * @param {string} value - 值
   * @returns {HTMLElement}
   * @private
   */
  _createInfoRow(label, value) {
    const row = document.createElement('div');
    row.style.cssText = 'display: flex; gap: 12px;';

    const labelEl = document.createElement('span');
    labelEl.textContent = label;
    labelEl.style.cssText = 'flex-shrink: 0; width: 72px; color: #9ca3af;';

    const valueEl = document.createElement('span');
    valueEl.textContent = value;
    valueEl.style.cssText = 'color: #e5e7eb;';

    row.appendChild(labelEl);
    row.appendChild(valueEl);
    return row;
  }

  /**
   * 判断章节节点的当前状态
   * 已完成 > 已解锁（当前）> 锁定，按优先级返回
   * @param {string} chapterId - 章节 id
   * @returns {string} NodeState 枚举值
   * @private
   */
  _getNodeState(chapterId) {
    if (this.completedChapters.includes(chapterId)) {
      return NodeState.COMPLETED;
    }
    if (this.unlockedChapters.includes(chapterId)) {
      return NodeState.CURRENT;
    }
    return NodeState.LOCKED;
  }

  /**
   * 节点点击处理
   * 已解锁节点 → 选中并展示信息卡；锁定节点 → Toast 提示
   * @param {string} chapterId - 被点击的章节 id
   * @private
   */
  _handleNodeClick(chapterId) {
    const isLocked = !this.unlockedChapters.includes(chapterId);

    // 锁定节点仅提示，不剧透后续内容
    if (isLocked) {
      this.toast.show('完成上一章后解锁');
      return;
    }

    this.selectNode(chapterId);
  }

  /**
   * "进入章节"按钮点击处理
   * 触发外部回调，由场景层负责切换到对应章节场景
   * @private
   */
  _onEnterClick() {
    if (!this.selectedChapterId || !this.onEnterChapter) return;
    this.onEnterChapter(this.selectedChapterId);
  }
}
