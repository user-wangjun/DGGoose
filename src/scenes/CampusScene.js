import { GAME, EVENT } from '../config.js';
import { DIALOGUES } from '../data/dialogues.js';
import { getHotspotsByScene } from '../data/hotspots.js';
import { ChoiceOverlay } from '../ui/ChoiceOverlay.js';
import { applyButtonStyle } from '../ui/ButtonTheme.js';

/** 开场对话取 ch5 前 2 行（旁白引入 + 莞小鹅好奇） */
const INTRO_LINES = DIALOGUES.ch5.slice(0, 2);

/** 收尾对话取 ch5 后 7 行（含 observe:start、三处台词、学长学姐对话、badge:unlock、chapter:next） */
const OUTRO_LINES = DIALOGUES.ch5.slice(2, 9);

/**
 * 抉择点配置（对应剧情分支设计 v4 §3 伞形多结局）
 * 与学姐对话完成后弹出，玩家可选"留下入学"进入大学新生结局分支，或继续前行至松山湖。
 */
const CHOICE_CONFIG = {
  sceneId: 'ch5',
  nextChapter: 'finale',
  title: '学姐真诚地看着你',
  stayLabel: '留下入学',
  continueLabel: '继续前行',
};

/** 落叶粒子数量 */
const LEAF_COUNT = 18;

/** 落叶颜色池（暖秋色系，呼应校园落叶纷飞的氛围） */
const LEAF_COLORS = ['#d97706', '#b45309', '#92400e', '#a16207', '#ca8a04'];

/** 互动点发光脉冲速度（弧度/秒） */
const PULSE_SPEED = 3.0;

/** 台词气泡自动消失时长（毫秒） */
const BUBBLE_DURATION = 4000;

/**
 * DGUT 校园观赏互动场景（对应 PRD §5 F8 + §4.2 第五章 + 计划 Task 3.7）
 *
 * 职责分工：
 * - Canvas 层：绘制校园背景（米白+木色）、互动点发光圆点、落叶动画
 * - DOM 层：互动点热区（点击触发台词气泡）、进度提示、"继续前行"按钮
 *
 * 交互流程：
 * 1. 进入 → 播放开场对话（ch5 前 2 行）
 * 2. 对话结束 → 触发 observe:start → 显示 3 个发光互动点与进度提示
 * 3. 点击互动点 → 弹出台词气泡 → 标记"已查看" → 更新进度"已触发 X/3"
 * 4. 全部查看后 → 显示"继续前行"按钮
 * 5. 点击继续 → 播放收尾对话（ch5 后 7 行，含学长学姐对话和 badge:unlock）
 * 6. 收尾对话结束 → 发放印记 "campus" → 切换到 finale
 */
export class CampusScene {
  /**
   * @param {Object} deps - 依赖注入
   * @param {SceneManager} deps.sceneManager - 场景管理器，用于切换场景
   * @param {EventBus} deps.eventBus - 事件总线，用于监听对话结束与广播 observe:start
   * @param {BadgeSystem} deps.badgeSystem - 印记系统，用于解锁 campus 印记
   * @param {DialogueRunner} deps.dialogueRunner - 对话运行器（由 DialogueBox 内部使用）
   * @param {DialogueBox} deps.dialogueBox - 对话框 UI（共享单例）
   * @param {InputManager} deps.input - 输入管理器
   * @param {HTMLElement} deps.container - UI 挂载容器（通常为 #ui-root）
   */
  constructor({ sceneManager, eventBus, badgeSystem, dialogueRunner, dialogueBox, input, container, getChoice }) {
    this.sceneManager = sceneManager;
    this.eventBus = eventBus;
    this.badgeSystem = badgeSystem;
    this.dialogueRunner = dialogueRunner;
    this.dialogueBox = dialogueBox;
    this.input = input;
    this.container = container;
    /** 读取已记录抉择的回调（用于判断"留下"按钮是否置灰，伞形多结局仅允许一次留下） */
    this.getChoice = getChoice || (() => null);

    /** 场景阶段：'idle' | 'intro' | 'observing' | 'outro' | 'done' */
    this.phase = 'idle';
    /** 互动点列表（从 hotspots 数据获取，onEnter 时初始化） */
    this.hotspots = [];
    /** 已查看的互动点 id 集合（Set 自动去重） */
    this.viewedHotspotIds = new Set();
    /** 落叶粒子数组 */
    this.leaves = [];
    /** 发光脉冲动画累计时间（秒），用于驱动互动点呼吸效果 */
    this.pulseTime = 0;

    /** 观赏阶段 DOM 根容器（含进度提示与互动点热区） */
    this.domRoot = null;
    /** 互动点热区 DOM 元素映射（id → element），便于更新已查看样式 */
    this.hotspotElements = new Map();
    /** 进度提示 DOM 元素引用 */
    this.progressElement = null;
    /** "继续前行"按钮 DOM 元素引用 */
    this.continueButton = null;
    /** 当前台词气泡 DOM 元素引用 */
    this.bubbleElement = null;
    /** 气泡自动消失定时器 ID，onExit 时需清理 */
    this.bubbleTimer = null;
    /** 防重复切换场景标记 */
    this.transitioning = false;
    /** 抉择覆盖层实例（发放印记后弹出） */
    this.choiceOverlay = null;

    // 绑定事件处理器 this 指向，便于 onExit 时精确移除
    this._onDialogueNext = this._onDialogueNext.bind(this);
    this._onContinueClick = this._onContinueClick.bind(this);
    this._onChoiceStay = this._onChoiceStay.bind(this);
    this._onChoiceContinue = this._onChoiceContinue.bind(this);
  }

  // ==================== 场景生命周期 ====================

  /**
   * 场景进入：初始化落叶、加载互动点、注册事件、播放开场对话
   * @param {*} [params] - 切换场景时传入的参数（本场景忽略）
   */
  onEnter(_params) {
    // 初始化落叶粒子（全屏随机分布，营造落叶纷飞氛围）
    this._initLeaves();

    // 加载 ch5 场景的 3 个互动点（图书馆、自习室窗、校道）
    this.hotspots = getHotspotsByScene('ch5');
    this.viewedHotspotIds.clear();

    // 监听对话结束事件，用于阶段切换
    this.eventBus.on(EVENT.DIALOGUE_NEXT, this._onDialogueNext);
    // 监听抉择事件，玩家点击"留下"/"继续"后推进流程
    this.eventBus.on(EVENT.CHOICE_STAY, this._onChoiceStay);
    this.eventBus.on(EVENT.CHOICE_CONTINUE, this._onChoiceContinue);

    // 进入开场对话阶段，播放 ch5 前 2 行
    this.phase = 'intro';
    this.dialogueBox.show(INTRO_LINES);
  }

  /**
   * 每帧更新：推进落叶动画、脉冲计时，按阶段分发对话更新
   * @param {number} deltaTime - 帧间隔（秒）
   */
  update(deltaTime) {
    // 落叶动画与脉冲始终推进，不受阶段影响
    this._updateLeaves(deltaTime);
    this.pulseTime += deltaTime;

    switch (this.phase) {
      case 'intro':
        this.dialogueBox.update(deltaTime);
        break;
      case 'observing':
        // 观赏阶段无逐帧逻辑，等待玩家点击互动点
        break;
      case 'outro':
        this.dialogueBox.update(deltaTime);
        break;
      default:
        break;
    }
  }

  /**
   * 绘制：在 Canvas 上渲染校园背景、落叶、互动点发光圆点
   * @param {CanvasRenderingContext2D} ctx
   */
  draw(ctx) {
    if (!ctx) return;
    this._drawBackground(ctx);
    this._drawLeaves(ctx);
    // 仅在观赏阶段绘制互动点发光圆点
    if (this.phase === 'observing') {
      this._drawHotspots(ctx);
    }
  }

  /**
   * 场景退出：清理所有 DOM、事件监听、定时器
   */
  onExit() {
    // 移除事件总线监听
    this.eventBus.off(EVENT.DIALOGUE_NEXT, this._onDialogueNext);
    this.eventBus.off(EVENT.CHOICE_STAY, this._onChoiceStay);
    this.eventBus.off(EVENT.CHOICE_CONTINUE, this._onChoiceContinue);

    // 移除抉择覆盖层
    this._hideChoiceOverlay();

    // 清理台词气泡定时器与 DOM
    this._clearBubble();

    // 移除"继续前行"按钮事件监听与 DOM
    if (this.continueButton) {
      this.continueButton.removeEventListener('click', this._onContinueClick);
      if (this.continueButton.parentNode) {
        this.continueButton.parentNode.removeChild(this.continueButton);
      }
      this.continueButton = null;
    }

    // 清空互动点热区引用（domRoot 移除时一并清除子元素与事件监听）
    this.hotspotElements.clear();

    // 移除观赏阶段 DOM 根（包含进度提示与互动点热区）
    if (this.domRoot && this.domRoot.parentNode) {
      this.domRoot.parentNode.removeChild(this.domRoot);
    }
    this.domRoot = null;
    this.progressElement = null;

    // 隐藏对话框（共享单例，仅隐藏不销毁）
    if (this.dialogueBox) {
      this.dialogueBox.hide();
    }

    // 重置状态
    this.phase = 'idle';
    this.transitioning = false;
    this.pulseTime = 0;
    this.leaves = [];
    this.hotspots = [];
    this.viewedHotspotIds.clear();
  }

  // ==================== 对话阶段处理 ====================

  /**
   * 对话结束事件处理：根据当前阶段决定下一步
   * - intro 阶段结束 → 触发 observe:start，进入观赏阶段
   * - outro 阶段结束 → 发放印记 + 切换到 finale
   * @param {Object} data - 事件数据，data.finished 为 true 表示整段对话结束
   * @private
   */
  _onDialogueNext(data) {
    if (!data || !data.finished) return;

    if (this.phase === 'intro') {
      this._startObserving();
    } else if (this.phase === 'outro') {
      this._onOutroComplete();
    }
  }

  /**
   * 开始观赏阶段：广播 observe:start 事件，构建互动点 DOM
   * @private
   */
  _startObserving() {
    this.phase = 'observing';
    // 广播观赏开始事件，供外部模块（如音频、成就系统）响应
    this.eventBus.emit('observe:start');
    // 构建互动点热区与进度提示 UI
    this._buildObserveDom();
  }

  /**
   * 收尾对话结束：发放校园书签印记，广播章节完成，然后弹出抉择点
   * 抉择在发放沿途印记后、推进下一场景之前插入（对应剧情分支设计 v4）
   * @private
   */
  _onOutroComplete() {
    if (this.transitioning) return;
    // 发放校园书签印记
    this.badgeSystem.unlock('campus');
    // 广播章节完成，触发自动存档
    this.eventBus.emit(EVENT.CHAPTER_COMPLETE, { chapter: 'ch5' });
    // 发放沿途印记后弹出抉择，玩家选择"留下入学"或"继续前行"
    this._showChoice();
  }

  // ==================== 抉择点 ====================

  /**
   * 弹出抉择覆盖层：让玩家选择"留下入学"或"继续前行"
   * 若已在前序场景选过"留下"，则本场景"留下"按钮置灰（伞形多结局仅允许一次留下）
   * @private
   */
  _showChoice() {
    // 隐藏对话框，避免与抉择覆盖层重叠
    if (this.dialogueBox) {
      this.dialogueBox.hide();
    }
    // 已选过其他场景"留下"则置灰本场景"留下"按钮
    const existingChoice = this.getChoice();
    const stayDisabled = existingChoice !== null && existingChoice !== undefined;

    this.choiceOverlay = new ChoiceOverlay({ eventBus: this.eventBus, container: this.container });
    this.choiceOverlay.show({
      title: CHOICE_CONFIG.title,
      stayLabel: CHOICE_CONFIG.stayLabel,
      continueLabel: CHOICE_CONFIG.continueLabel,
      stayDisabled,
      sceneId: CHOICE_CONFIG.sceneId,
    });
  }

  /**
   * 玩家选"留下"：广播锁定事件（主循环负责记录 choice），然后推进到下一场景
   * 留下不影响流程推进，仅记录选择供终章松山湖结算
   * @param {Object} data - 事件数据，data.sceneId 为当前场景 id
   * @private
   */
  _onChoiceStay(data) {
    // 抉择覆盖层未显示或场景 id 不匹配则忽略，避免跨场景误触
    if (!this.choiceOverlay) return;
    if (!data || data.sceneId !== CHOICE_CONFIG.sceneId) return;
    // 留下选择由 main.js 的 CHOICE_STAY 监听写入存档，此处仅推进场景
    this._advanceToNextScene();
  }

  /**
   * 玩家选"继续"：直接推进到下一场景
   * @param {Object} data - 事件数据
   * @private
   */
  _onChoiceContinue(data) {
    if (!this.choiceOverlay) return;
    if (!data || data.sceneId !== CHOICE_CONFIG.sceneId) return;
    this._advanceToNextScene();
  }

  /**
   * 推进到下一场景：隐藏抉择覆盖层并切换场景
   * @private
   */
  _advanceToNextScene() {
    if (this.transitioning) return;
    this.transitioning = true;
    this._hideChoiceOverlay();
    this.sceneManager.change(CHOICE_CONFIG.nextChapter);
  }

  /**
   * 隐藏并销毁抉择覆盖层
   * @private
   */
  _hideChoiceOverlay() {
    if (this.choiceOverlay) {
      this.choiceOverlay.hide();
      this.choiceOverlay = null;
    }
  }

  // ==================== 互动点交互 ====================

  /**
   * 互动点点击处理：弹出台词气泡、标记已查看、更新进度
   * 全部查看后自动显示"继续前行"按钮
   * @param {Object} hotspot - 被点击的互动点数据
   * @private
   */
  _onHotspotClick(hotspot) {
    // 弹出台词气泡
    this._showBubble(hotspot);

    // 标记为已查看（Set 自动去重，重复点击不重复计数）
    const wasNew = !this.viewedHotspotIds.has(hotspot.id);
    this.viewedHotspotIds.add(hotspot.id);

    // 仅在新触发时更新视觉与进度，避免重复刷新
    if (wasNew) {
      this._markHotspotViewed(hotspot.id);
      this._updateProgress();
    }

    // 全部查看后显示"继续前行"按钮（仅创建一次）
    if (this.viewedHotspotIds.size === this.hotspots.length && !this.continueButton) {
      this._showContinueButton();
    }
  }

  /**
   * 将互动点热区标记为已查看样式（降低透明度、变色）
   * @param {string} hotspotId - 互动点 id
   * @private
   */
  _markHotspotViewed(hotspotId) {
    const el = this.hotspotElements.get(hotspotId);
    if (el) {
      el.setAttribute('data-viewed', 'true');
      el.style.background = 'rgba(34, 197, 94, 0.12)';
      el.style.borderColor = 'rgba(34, 197, 94, 0.5)';
    }
  }

  /**
   * 更新进度提示文本"已触发 X/3"
   * @private
   */
  _updateProgress() {
    if (this.progressElement) {
      this.progressElement.textContent = `已触发 ${this.viewedHotspotIds.size} / ${this.hotspots.length}`;
    }
  }

  // ==================== 台词气泡 ====================

  /**
   * 显示台词气泡（DOM 层），定位在互动点上方
   * 气泡显示互动点台词文本，自动换行，BUBBLE_DURATION 后自动消失
   * @param {Object} hotspot - 互动点数据
   * @private
   */
  _showBubble(hotspot) {
    // 清除已有气泡，避免堆叠
    this._clearBubble();

    const bubble = document.createElement('div');
    bubble.setAttribute('data-speech-bubble', hotspot.id);
    bubble.style.cssText = `
      position: absolute;
      left: ${(hotspot.x / GAME.WIDTH) * 100}%;
      top: ${(hotspot.y / GAME.HEIGHT) * 100}%;
      transform: translate(-50%, calc(-100% - 28px));
      max-width: 280px; padding: 12px 16px;
      background: rgba(255, 255, 255, 0.95);
      color: #1e293b; font-size: 15px; line-height: 1.6;
      border-radius: 12px; box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
      pointer-events: none; z-index: 250;
      font-family: inherit;
    `;
    bubble.textContent = hotspot.text;

    // 气泡底部小尾巴（三角形），指向互动点
    const tail = document.createElement('div');
    tail.style.cssText = `
      position: absolute; bottom: -8px; left: 50%;
      transform: translateX(-50%);
      width: 0; height: 0;
      border-left: 8px solid transparent;
      border-right: 8px solid transparent;
      border-top: 8px solid rgba(255, 255, 255, 0.95);
    `;
    bubble.appendChild(tail);

    this.domRoot.appendChild(bubble);
    this.bubbleElement = bubble;

    // 定时自动消失
    this.bubbleTimer = setTimeout(() => {
      this._clearBubble();
    }, BUBBLE_DURATION);
  }

  /**
   * 清除当前台词气泡与自动消失定时器
   * @private
   */
  _clearBubble() {
    if (this.bubbleTimer) {
      clearTimeout(this.bubbleTimer);
      this.bubbleTimer = null;
    }
    if (this.bubbleElement && this.bubbleElement.parentNode) {
      this.bubbleElement.parentNode.removeChild(this.bubbleElement);
    }
    this.bubbleElement = null;
  }

  // ==================== 继续前行 ====================

  /**
   * 显示"继续前行"按钮（底部居中），点击后进入收尾对话
   * @private
   */
  _showContinueButton() {
    const button = document.createElement('button');
    button.setAttribute('data-continue-button', '');
    button.textContent = '继续前行';
    button.style.cssText = `
      position: fixed; bottom: 80px; left: 50%;
      z-index: 260; pointer-events: auto;
    `;
    // 使用 translate 属性保留按钮主题的 hover / pressed transform 状态。
    button.style.translate = '-50% 0';
    applyButtonStyle(button, { variant: 'primary', size: 'lg' });
    button.addEventListener('click', this._onContinueClick);
    this.container.appendChild(button);
    this.continueButton = button;
  }

  /**
   * "继续前行"按钮点击：移除观赏 UI，播放收尾对话
   * @private
   */
  _onContinueClick() {
    if (this.transitioning) return;

    // 移除"继续前行"按钮
    if (this.continueButton) {
      this.continueButton.removeEventListener('click', this._onContinueClick);
      if (this.continueButton.parentNode) {
        this.continueButton.parentNode.removeChild(this.continueButton);
      }
      this.continueButton = null;
    }

    // 清除台词气泡
    this._clearBubble();

    // 隐藏互动点热区，防止收尾对话期间误触
    this.hotspotElements.forEach((el) => {
      el.style.display = 'none';
    });

    // 隐藏进度提示
    if (this.progressElement) {
      this.progressElement.style.display = 'none';
    }

    // 进入收尾对话阶段，播放 ch5 后 7 行
    this.phase = 'outro';
    this.dialogueBox.show(OUTRO_LINES);
  }

  // ==================== DOM 构建 ====================

  /**
   * 构建观赏阶段 DOM：互动点热区 + 进度提示
   * domRoot 设为 pointer-events: none，仅热区元素可交互
   * @private
   */
  _buildObserveDom() {
    this.domRoot = document.createElement('div');
    this.domRoot.setAttribute('data-campus-observe', '');
    this.domRoot.style.cssText = `
      position: fixed; inset: 0; z-index: 200;
      pointer-events: none;
    `;

    // 构建进度提示（顶部居中）
    this.progressElement = document.createElement('div');
    this.progressElement.style.cssText = `
      position: fixed; top: 24px; left: 50%;
      transform: translateX(-50%);
      padding: 8px 24px; border-radius: 8px;
      background: rgba(0, 0, 0, 0.6); color: #f1f5f9;
      font-size: 16px; font-family: inherit;
      pointer-events: none; z-index: 210;
    `;
    this.progressElement.textContent = `已触发 0 / ${this.hotspots.length}`;
    this.domRoot.appendChild(this.progressElement);

    // 构建互动点热区
    for (const spot of this.hotspots) {
      const el = this._buildHotspotElement(spot);
      this.domRoot.appendChild(el);
      this.hotspotElements.set(spot.id, el);
    }

    this.container.appendChild(this.domRoot);
  }

  /**
   * 构建单个互动点热区 DOM 元素
   * 使用百分比定位将逻辑坐标映射到视口位置
   * @param {Object} hotspot - 互动点数据
   * @returns {HTMLElement}
   * @private
   */
  _buildHotspotElement(hotspot) {
    const el = document.createElement('div');
    el.setAttribute('data-hotspot', hotspot.id);
    el.style.cssText = `
      position: absolute;
      left: ${(hotspot.x / GAME.WIDTH) * 100}%;
      top: ${(hotspot.y / GAME.HEIGHT) * 100}%;
      width: 56px; height: 56px;
      transform: translate(-50%, -50%);
      border-radius: 50%;
      cursor: pointer;
      pointer-events: auto;
      z-index: 210;
      background: rgba(251, 191, 36, 0.15);
      border: 2px solid rgba(251, 191, 36, 0.5);
      transition: background 0.3s ease, border-color 0.3s ease;
    `;
    el.addEventListener('click', () => this._onHotspotClick(hotspot));
    return el;
  }

  // ==================== 落叶动画 ====================

  /**
   * 初始化落叶粒子，随机分布在画布上方区域
   * @private
   */
  _initLeaves() {
    this.leaves = [];
    for (let i = 0; i < LEAF_COUNT; i++) {
      this.leaves.push(this._createLeaf(true));
    }
  }

  /**
   * 创建一片落叶粒子
   * @param {boolean} randomY - true 用于初始化（全屏随机 Y），false 用于从顶部重生
   * @returns {Object} 落叶粒子对象
   * @private
   */
  _createLeaf(randomY) {
    return {
      x: Math.random() * GAME.WIDTH,
      y: randomY ? Math.random() * GAME.HEIGHT : -20 - Math.random() * 60,
      size: 5 + Math.random() * 7,
      rotation: Math.random() * Math.PI * 2,
      rotationSpeed: (Math.random() - 0.5) * 2.5,
      fallSpeed: 20 + Math.random() * 40,
      swayAmplitude: 12 + Math.random() * 25,
      swayPhase: Math.random() * Math.PI * 2,
      swaySpeed: 0.8 + Math.random() * 1.5,
      color: LEAF_COLORS[Math.floor(Math.random() * LEAF_COLORS.length)],
    };
  }

  /**
   * 更新落叶粒子位置，飘出画布底部后从顶部重生
   * @param {number} deltaTime - 帧间隔（秒）
   * @private
   */
  _updateLeaves(deltaTime) {
    for (const leaf of this.leaves) {
      leaf.y += leaf.fallSpeed * deltaTime;
      leaf.swayPhase += leaf.swaySpeed * deltaTime;
      leaf.rotation += leaf.rotationSpeed * deltaTime;
      // 飘出底部后从顶部重生，保持落叶持续
      if (leaf.y > GAME.HEIGHT + 20) {
        Object.assign(leaf, this._createLeaf(false));
      }
    }
  }

  // ==================== Canvas 绘制 ====================

  /**
   * 绘制校园背景：米白渐变 + 木色地面 + 建筑剪影（图书馆窗户暖光）
   * @param {CanvasRenderingContext2D} ctx
   * @private
   */
  _drawBackground(ctx) {
    // 米白渐变背景（上浅下深，营造温暖校园氛围）
    const gradient = ctx.createLinearGradient(0, 0, 0, GAME.HEIGHT);
    gradient.addColorStop(0, '#faf6f0');
    gradient.addColorStop(0.6, '#f5ede0');
    gradient.addColorStop(1, '#e8dcc8');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, GAME.WIDTH, GAME.HEIGHT);

    // 远景建筑剪影（图书馆轮廓）
    ctx.fillStyle = 'rgba(180, 160, 130, 0.35)';
    ctx.fillRect(200, 180, 240, 260);

    // 图书馆窗户暖色光点（暗示灯火通明）
    ctx.fillStyle = 'rgba(251, 191, 36, 0.3)';
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 5; col++) {
        ctx.fillRect(220 + col * 42, 210 + row * 55, 24, 32);
      }
    }

    // 中景树木剪影
    ctx.fillStyle = 'rgba(120, 100, 70, 0.3)';
    ctx.beginPath();
    ctx.arc(560, 240, 60, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(880, 230, 50, 0, Math.PI * 2);
    ctx.fill();

    // 木色地面
    ctx.fillStyle = '#c9b896';
    ctx.fillRect(0, GAME.HEIGHT - 120, GAME.WIDTH, 120);

    // 地面砖纹纹理
    ctx.strokeStyle = 'rgba(120, 90, 50, 0.15)';
    ctx.lineWidth = 1;
    for (let x = 0; x < GAME.WIDTH; x += 60) {
      ctx.beginPath();
      ctx.moveTo(x, GAME.HEIGHT - 120);
      ctx.lineTo(x, GAME.HEIGHT);
      ctx.stroke();
    }
    for (let y = GAME.HEIGHT - 90; y < GAME.HEIGHT; y += 30) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(GAME.WIDTH, y);
      ctx.stroke();
    }

    // 校道路径（浅色带，暗示行走方向）
    ctx.fillStyle = 'rgba(245, 237, 224, 0.6)';
    ctx.fillRect(0, GAME.HEIGHT - 80, GAME.WIDTH, 12);
  }

  /**
   * 绘制落叶粒子（椭圆 + 叶脉，带摇摆与旋转）
   * @param {CanvasRenderingContext2D} ctx
   * @private
   */
  _drawLeaves(ctx) {
    for (const leaf of this.leaves) {
      const swayX = leaf.x + Math.sin(leaf.swayPhase) * leaf.swayAmplitude;
      ctx.save();
      ctx.translate(swayX, leaf.y);
      ctx.rotate(leaf.rotation);
      ctx.fillStyle = leaf.color;
      // 叶子形状（椭圆）
      ctx.beginPath();
      ctx.ellipse(0, 0, leaf.size, leaf.size * 0.45, 0, 0, Math.PI * 2);
      ctx.fill();
      // 叶脉线条
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.2)';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(-leaf.size, 0);
      ctx.lineTo(leaf.size, 0);
      ctx.stroke();
      ctx.restore();
    }
  }

  /**
   * 绘制互动点发光圆点（仅观赏阶段）
   * 未查看的互动点呈金色脉冲发光，已查看的呈绿色暗光
   * @param {CanvasRenderingContext2D} ctx
   * @private
   */
  _drawHotspots(ctx) {
    // 脉冲值 0~1，正弦驱动呼吸效果
    const pulse = 0.5 + 0.5 * Math.sin(this.pulseTime * PULSE_SPEED);

    for (const spot of this.hotspots) {
      const viewed = this.viewedHotspotIds.has(spot.id);
      ctx.save();

      if (viewed) {
        // 已查看：绿色暗光，表示已完成
        ctx.fillStyle = `rgba(34, 197, 94, ${0.2 + pulse * 0.15})`;
        ctx.beginPath();
        ctx.arc(spot.x, spot.y, 16 + pulse * 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#22c55e';
        ctx.beginPath();
        ctx.arc(spot.x, spot.y, 6, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // 未查看：金色脉冲发光，吸引玩家点击
        ctx.fillStyle = `rgba(251, 191, 36, ${0.3 + pulse * 0.35})`;
        ctx.beginPath();
        ctx.arc(spot.x, spot.y, 18 + pulse * 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fbbf24';
        ctx.beginPath();
        ctx.arc(spot.x, spot.y, 8, 0, Math.PI * 2);
        ctx.fill();
      }

      // 互动点名称标签
      ctx.fillStyle = 'rgba(60, 50, 30, 0.85)';
      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(spot.name, spot.x, spot.y - 24);

      ctx.restore();
    }
  }
}
