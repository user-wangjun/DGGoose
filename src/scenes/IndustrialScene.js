import { GAME, EVENT } from '../config.js';
import { DIALOGUES } from '../data/dialogues.js';
import { getHotspotsByScene } from '../data/hotspots.js';
import { Toast } from '../ui/Toast.js';
import { ChoiceOverlay } from '../ui/ChoiceOverlay.js';

/** 开场对话取 ch4 前 3 行（最后一行带 observe:start 事件） */
const OPENING_LINES = DIALOGUES.ch4.slice(0, 3);

/** 结束对话取 ch4 后 6 行（含 puzzle:start、puzzle:solved、badge:unlock、chapter:next） */
const ENDING_LINES = DIALOGUES.ch4.slice(3);

/** 组装动画时长（秒），齿轮汇聚并合成访客徽章 */
const ASSEMBLY_DURATION = 2.0;

/** 过渡提示延迟（毫秒），等待玩家读完最后一条台词后再切换阶段 */
const TRANSITION_DELAY = 2700;

/** 热区尺寸（像素），满足 ≥44px 拇指触控要求 */
const HOT_ZONE_SIZE = 80;

/** 齿轮零件位置（画布逻辑坐标），分散在双区域下方避免与互动点重叠 */
const GEAR_POSITIONS = [
  { x: 260, y: 500 },
  { x: 640, y: 540 },
  { x: 1020, y: 500 },
];

/** 安检门中心位置（画布右侧出口处） */
const DOOR_X = 1050;
const DOOR_Y = 380;

/** 组装中心点（画布中央，齿轮汇聚位置） */
const ASSEMBLY_CENTER_X = 640;
const ASSEMBLY_CENTER_Y = 400;

/** 齿轮绘制半径（像素） */
const GEAR_RADIUS = 22;

/** 互动点发光半径（像素） */
const HOTSPOT_RADIUS = 18;

/**
 * 抉择点配置（对应剧情分支设计 v4 §3 伞形多结局）
 * 组装访客徽章通过安检后弹出，玩家可选"留下研发"进入科技新星结局分支，或继续前行。
 */
const CHOICE_CONFIG = {
  sceneId: 'ch4',
  nextChapter: 'ch5',
  title: '工程师递来一张工牌',
  stayLabel: '留下研发',
  continueLabel: '继续前行',
};

/**
 * 第四章场景 · 工业园区收集解谜 + 观赏互动（对应 PRD §5 F8 + §4.2 第四章 + 计划 Task 3.6）
 *
 * 职责分工：
 * - Canvas 层：绘制双区域背景（高新园区科技蓝 + 制造工厂钢灰暖橙）、
 *   互动点发光圆点、齿轮零件（金色齿轮）、安检门、组装动画
 * - DOM 层：互动点热区、齿轮零件热区（≥44px 适配拇指）
 *
 * 玩法流程：
 * 1. 进入 → 播放对话 ch4 前 3 行（含 observe:start）
 * 2. 对话结束 → 显示 3 个互动点 → 玩家点击查看台词气泡（Toast）
 * 3. 全部查看 → 触发 puzzle:start → 显示 3 个齿轮零件 → 玩家点击收集
 * 4. 3 个全收集 → 组装动画（齿轮汇聚合成访客徽章）→ 安检门开启
 * 5. 播放对话 ch4 后 6 行 → 发放印记 "industrial" → 切换到 ch5
 */
export class IndustrialScene {
  /**
   * @param {Object} deps - 依赖注入
   * @param {SceneManager} deps.sceneManager - 场景管理器
   * @param {EventBus} deps.eventBus - 事件总线
   * @param {BadgeSystem} deps.badgeSystem - 印记系统
   * @param {DialogueRunner} deps.dialogueRunner - 对话运行器
   * @param {DialogueBox} deps.dialogueBox - 对话框 UI（共享单例）
   * @param {InputManager} deps.input - 输入管理器
   * @param {HTMLElement} deps.container - UI 挂载容器
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

    /** 场景阶段：idle / intro / observe / puzzle / assembling / outro / done */
    this.phase = 'idle';
    /** 互动点数据列表（从 hotspots.js 获取） */
    this.hotspots = [];
    /** 互动点查看状态数组（与 hotspots 一一对应） */
    this.hotspotViewed = [];
    /** 齿轮零件收集状态数组 */
    this.gearCollected = [];
    /** 组装动画进度（0~1） */
    this.assemblyProgress = 0;
    /** 环境动画累计时间（秒），用于发光脉动与齿轮旋转 */
    this.animTime = 0;
    /** 防重复切换场景 */
    this.transitioning = false;
    /** 阶段过渡定时器 ID，onExit 时需清理 */
    this.transitionTimer = null;

    /** DOM 根容器（热区层） */
    this.domRoot = null;
    /** 互动点热区 DOM 元素列表 */
    this.hotspotHotZones = [];
    /** 齿轮零件热区 DOM 元素列表 */
    this.gearHotZones = [];
    /** Toast 实例（台词与收集提示用） */
    this.toast = null;
    /** 抉择覆盖层实例（发放印记后弹出） */
    this.choiceOverlay = null;

    // 绑定事件处理器 this 指向
    this._onDialogueNext = this._onDialogueNext.bind(this);
    this._resizeHandler = this._resizeHandler.bind(this);
    this._onChoiceStay = this._onChoiceStay.bind(this);
    this._onChoiceContinue = this._onChoiceContinue.bind(this);
  }

  // ==================== 场景生命周期 ====================

  /**
   * 场景进入：初始化状态、获取互动点数据、构建 DOM 热区、注册事件、播放开场对话
   */
  onEnter() {
    this.phase = 'intro';
    this.assemblyProgress = 0;
    this.animTime = 0;
    this.transitioning = false;

    // 从数据层获取 ch4 互动点
    this.hotspots = getHotspotsByScene('ch4');
    this.hotspotViewed = this.hotspots.map(() => false);
    this.gearCollected = GEAR_POSITIONS.map(() => false);

    // 创建 Toast 实例（台词与收集提示用）
    this.toast = new Toast({ container: this.container, duration: 2500 });

    // 构建 DOM 热区层
    this._buildDom();

    // 注册事件
    this.eventBus.on(EVENT.DIALOGUE_NEXT, this._onDialogueNext);
    // 监听抉择事件，玩家点击"留下"/"继续"后推进流程
    this.eventBus.on(EVENT.CHOICE_STAY, this._onChoiceStay);
    this.eventBus.on(EVENT.CHOICE_CONTINUE, this._onChoiceContinue);
    window.addEventListener('resize', this._resizeHandler);

    // 播放开场对话（ch4 前 3 行）
    this.dialogueBox.show(OPENING_LINES);
  }

  /**
   * 每帧更新：推进对话逐字显示、环境动画、组装动画
   * @param {number} deltaTime - 帧间隔（秒）
   */
  update(deltaTime) {
    // 始终推进对话框逐字显示
    this.dialogueBox.update(deltaTime);
    this.animTime += deltaTime;

    // 组装动画推进
    if (this.phase === 'assembling') {
      this.assemblyProgress += deltaTime / ASSEMBLY_DURATION;
      if (this.assemblyProgress >= 1) {
        this.assemblyProgress = 1;
        this._onAssemblyComplete();
      }
    }
  }

  /**
   * Canvas 渲染：双区域背景、互动点、齿轮零件、安检门、组装动画、HUD
   * @param {CanvasRenderingContext2D} ctx
   */
  draw(ctx) {
    if (!ctx) return;
    this._drawBackground(ctx);
    this._drawSecurityDoor(ctx);

    // 观赏与解谜阶段绘制互动点（已查看的显示暗淡标记）
    if (this.phase === 'observe' || this.phase === 'puzzle') {
      this._drawHotspots(ctx);
    }

    // 解谜阶段绘制未收集的齿轮零件
    if (this.phase === 'puzzle') {
      this._drawGears(ctx);
    }

    // 组装阶段绘制汇聚动画
    if (this.phase === 'assembling') {
      this._drawAssembly(ctx);
    }

    // 结束阶段绘制访客徽章
    if (this.phase === 'outro' || this.phase === 'done') {
      this._drawVisitorBadge(ctx);
    }

    this._drawHud(ctx);
  }

  /**
   * 场景退出：移除事件监听、清理定时器、销毁 DOM 与 Toast
   */
  onExit() {
    // 移除事件总线监听
    this.eventBus.off(EVENT.DIALOGUE_NEXT, this._onDialogueNext);
    this.eventBus.off(EVENT.CHOICE_STAY, this._onChoiceStay);
    this.eventBus.off(EVENT.CHOICE_CONTINUE, this._onChoiceContinue);
    // 移除窗口尺寸监听
    window.removeEventListener('resize', this._resizeHandler);

    // 清理阶段过渡定时器
    if (this.transitionTimer) {
      clearTimeout(this.transitionTimer);
      this.transitionTimer = null;
    }

    // 销毁 Toast
    if (this.toast) {
      this.toast.destroy();
      this.toast = null;
    }

    // 销毁 DOM 热区层
    this._destroyDom();

    // 移除抉择覆盖层
    this._hideChoiceOverlay();

    // 隐藏对话框（共享单例，仅隐藏不销毁）
    if (this.dialogueBox) {
      this.dialogueBox.hide();
    }

    // 重置状态
    this.phase = 'idle';
    this.transitioning = false;
    this.assemblyProgress = 0;
    this.hotspots = [];
    this.hotspotViewed = [];
    this.gearCollected = [];
  }

  // ==================== 对话阶段处理 ====================

  /**
   * 对话推进事件处理：仅在整段对话结束时推进阶段
   * - intro 阶段结束 → 进入观赏互动阶段
   * - outro 阶段结束 → 发放印记并切换到第五章
   * @param {Object} data - 事件数据，data.finished 为 true 表示整段对话结束
   * @private
   */
  _onDialogueNext(data) {
    if (!data || !data.finished) return;

    if (this.phase === 'intro') {
      this._startObserve();
    } else if (this.phase === 'outro') {
      this._onOutroComplete();
    }
  }

  // ==================== 观赏互动阶段 ====================

  /**
   * 启动观赏互动阶段：显示互动点热区
   * @private
   */
  _startObserve() {
    this.phase = 'observe';
    this._updateDomPosition();
  }

  /**
   * 互动点点击处理：显示台词 Toast 并标记为已查看
   * @param {number} index - 互动点的 0 基索引
   * @private
   */
  _onHotspotClick(index) {
    if (this.phase !== 'observe') return;
    if (this.hotspotViewed[index]) return;

    // 标记为已查看
    this.hotspotViewed[index] = true;

    // 通过 Toast 显示互动点台词
    const spot = this.hotspots[index];
    this.toast.show(`【${spot.name}】${spot.text}`);

    // 更新热区显示（已查看的隐藏热区）
    this._updateDomPosition();

    // 检查是否全部查看完毕
    this._checkAllHotspotsViewed();
  }

  /**
   * 检查所有互动点是否已查看完毕，是则延迟切换到解谜阶段
   * @private
   */
  _checkAllHotspotsViewed() {
    const allViewed = this.hotspotViewed.every((viewed) => viewed);
    if (!allViewed) return;

    // 延迟显示过渡提示并切换阶段，让玩家先读完最后一条互动点台词
    this.transitionTimer = setTimeout(() => {
      this.transitionTimer = null;
      if (this.phase !== 'observe') return;
      this.toast.show('互动点已全部查看，齿轮零件已出现！');
      this._startPuzzle();
    }, TRANSITION_DELAY);
  }

  // ==================== 收集解谜阶段 ====================

  /**
   * 启动收集解谜阶段：隐藏互动点热区，显示齿轮零件热区
   * @private
   */
  _startPuzzle() {
    this.phase = 'puzzle';
    this._updateDomPosition();
  }

  /**
   * 齿轮零件点击处理：标记为已收集并显示进度提示
   * @param {number} index - 齿轮零件的 0 基索引
   * @private
   */
  _onGearClick(index) {
    if (this.phase !== 'puzzle') return;
    if (this.gearCollected[index]) return;

    // 标记为已收集
    this.gearCollected[index] = true;

    // 显示收集进度提示
    const collectedCount = this.gearCollected.filter((collected) => collected).length;
    this.toast.show(`收集到齿轮零件 ${collectedCount} / ${GEAR_POSITIONS.length}`);

    // 更新热区显示（已收集的隐藏热区）
    this._updateDomPosition();

    // 检查是否全部收集完毕
    this._checkAllGearsCollected();
  }

  /**
   * 检查所有齿轮零件是否已收集完毕，是则延迟启动组装动画
   * @private
   */
  _checkAllGearsCollected() {
    const allCollected = this.gearCollected.every((collected) => collected);
    if (!allCollected) return;

    // 延迟显示过渡提示并启动组装，让玩家先读完最后一条收集提示
    this.transitionTimer = setTimeout(() => {
      this.transitionTimer = null;
      if (this.phase !== 'puzzle') return;
      this.toast.show('齿轮零件收集完毕，开始组装访客徽章！');
      this._startAssembly();
    }, TRANSITION_DELAY);
  }

  // ==================== 组装动画阶段 ====================

  /**
   * 启动组装动画：齿轮汇聚并合成访客徽章
   * @private
   */
  _startAssembly() {
    this.phase = 'assembling';
    this.assemblyProgress = 0;
  }

  /**
   * 组装动画完成：播放结束对话（ch4 后 6 行）
   * @private
   */
  _onAssemblyComplete() {
    this.phase = 'outro';
    this.dialogueBox.show(ENDING_LINES);
  }

  // ==================== 结束阶段 ====================

  /**
   * 结束对话完成：发放工业齿轮印记，广播章节完成，然后弹出抉择点
   * 抉择在发放沿途印记后、推进下一场景之前插入（对应剧情分支设计 v4）
   * @private
   */
  _onOutroComplete() {
    if (this.transitioning) return;
    // 发放工业齿轮印记
    this.badgeSystem.unlock('industrial');
    // 广播章节完成，触发自动存档
    this.eventBus.emit(EVENT.CHAPTER_COMPLETE, { chapter: 'ch4' });
    // 发放沿途印记后弹出抉择，玩家选择"留下"或"继续前行"
    this._showChoice();
  }

  // ==================== 抉择点 ====================

  /**
   * 弹出抉择覆盖层：让玩家选择"留下研发"或"继续前行"
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

  // ==================== DOM 热区构建 ====================

  /**
   * 构建 DOM 热区层：互动点热区 + 齿轮零件热区
   * 使用 canvas 的 boundingRect 精确定位，保证热区与 Canvas 绘制对齐
   * @private
   */
  _buildDom() {
    this.domRoot = document.createElement('div');
    this.domRoot.setAttribute('data-industrial-scene', '');
    this.domRoot.style.cssText = `
      position: fixed; z-index: 50; pointer-events: none;
    `;

    // 构建互动点热区
    this.hotspotHotZones = [];
    for (let i = 0; i < this.hotspots.length; i++) {
      const zone = document.createElement('div');
      zone.style.cssText = `
        position: absolute; pointer-events: auto; cursor: pointer;
        border-radius: 50%; display: none;
      `;
      // 闭包捕获索引，避免回调中 i 被覆盖
      const index = i;
      zone.addEventListener('click', () => this._onHotspotClick(index));
      this.domRoot.appendChild(zone);
      this.hotspotHotZones.push(zone);
    }

    // 构建齿轮零件热区
    this.gearHotZones = [];
    for (let i = 0; i < GEAR_POSITIONS.length; i++) {
      const zone = document.createElement('div');
      zone.style.cssText = `
        position: absolute; pointer-events: auto; cursor: pointer;
        border-radius: 50%; display: none;
      `;
      const index = i;
      zone.addEventListener('click', () => this._onGearClick(index));
      this.domRoot.appendChild(zone);
      this.gearHotZones.push(zone);
    }

    this.container.appendChild(this.domRoot);
    this._updateDomPosition();
  }

  /**
   * 根据 Canvas 显示区域更新热区位置和尺寸
   * 保证热区与 Canvas 绘制的互动点/齿轮精确对齐
   * @private
   */
  _updateDomPosition() {
    const canvas = document.getElementById('game');
    if (!canvas || !this.domRoot) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = rect.width / GAME.WIDTH;
    const scaleY = rect.height / GAME.HEIGHT;

    // DOM 容器匹配 Canvas 显示区域
    this.domRoot.style.left = rect.left + 'px';
    this.domRoot.style.top = rect.top + 'px';
    this.domRoot.style.width = rect.width + 'px';
    this.domRoot.style.height = rect.height + 'px';

    // 定位互动点热区
    for (let i = 0; i < this.hotspots.length; i++) {
      const spot = this.hotspots[i];
      const zone = this.hotspotHotZones[i];
      if (!zone) continue;

      const zoneSize = Math.max(HOT_ZONE_SIZE * Math.min(scaleX, scaleY), 44);
      const centerX = spot.x * scaleX;
      const centerY = spot.y * scaleY;

      zone.style.width = zoneSize + 'px';
      zone.style.height = zoneSize + 'px';
      zone.style.left = centerX - zoneSize / 2 + 'px';
      zone.style.top = centerY - zoneSize / 2 + 'px';

      // 仅在观赏阶段且未查看时显示热区
      const shouldShow = this.phase === 'observe' && !this.hotspotViewed[i];
      zone.style.display = shouldShow ? 'block' : 'none';
    }

    // 定位齿轮零件热区
    for (let i = 0; i < GEAR_POSITIONS.length; i++) {
      const gear = GEAR_POSITIONS[i];
      const zone = this.gearHotZones[i];
      if (!zone) continue;

      const zoneSize = Math.max(HOT_ZONE_SIZE * Math.min(scaleX, scaleY), 44);
      const centerX = gear.x * scaleX;
      const centerY = gear.y * scaleY;

      zone.style.width = zoneSize + 'px';
      zone.style.height = zoneSize + 'px';
      zone.style.left = centerX - zoneSize / 2 + 'px';
      zone.style.top = centerY - zoneSize / 2 + 'px';

      // 仅在解谜阶段且未收集时显示热区
      const shouldShow = this.phase === 'puzzle' && !this.gearCollected[i];
      zone.style.display = shouldShow ? 'block' : 'none';
    }
  }

  /**
   * 窗口尺寸变化时重新定位热区
   * @private
   */
  _resizeHandler() {
    this._updateDomPosition();
  }

  /**
   * 销毁 DOM 热区层
   * @private
   */
  _destroyDom() {
    if (this.domRoot && this.domRoot.parentNode) {
      this.domRoot.parentNode.removeChild(this.domRoot);
    }
    this.domRoot = null;
    this.hotspotHotZones = [];
    this.gearHotZones = [];
  }

  // ==================== Canvas 绘制 ====================

  /**
   * 绘制双区域背景：左半区高新园区（科技蓝）+ 右半区制造工厂（钢灰暖橙）
   * @param {CanvasRenderingContext2D} ctx
   * @private
   */
  _drawBackground(ctx) {
    // 左半区：高新园区（科技蓝渐变）
    const techGradient = ctx.createLinearGradient(0, 0, 0, GAME.HEIGHT);
    techGradient.addColorStop(0, '#0c1e3e');
    techGradient.addColorStop(0.5, '#162a4a');
    techGradient.addColorStop(1, '#0a1830');
    ctx.fillStyle = techGradient;
    ctx.fillRect(0, 0, GAME.WIDTH / 2, GAME.HEIGHT);

    // 右半区：制造工厂（钢灰 + 暖橙渐变）
    const factoryGradient = ctx.createLinearGradient(0, 0, 0, GAME.HEIGHT);
    factoryGradient.addColorStop(0, '#2a2a2a');
    factoryGradient.addColorStop(0.5, '#3a3028');
    factoryGradient.addColorStop(1, '#1e1e1e');
    ctx.fillStyle = factoryGradient;
    ctx.fillRect(GAME.WIDTH / 2, 0, GAME.WIDTH / 2, GAME.HEIGHT);

    // 中央分界线
    ctx.strokeStyle = 'rgba(251, 191, 36, 0.15)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(GAME.WIDTH / 2, 0);
    ctx.lineTo(GAME.WIDTH / 2, GAME.HEIGHT);
    ctx.stroke();

    // 左半区装饰：玻璃幕墙网格线
    ctx.strokeStyle = 'rgba(100, 180, 255, 0.08)';
    ctx.lineWidth = 1;
    for (let x = 40; x < GAME.WIDTH / 2; x += 80) {
      ctx.beginPath();
      ctx.moveTo(x, 60);
      ctx.lineTo(x, GAME.HEIGHT - 100);
      ctx.stroke();
    }
    for (let y = 80; y < GAME.HEIGHT - 100; y += 80) {
      ctx.beginPath();
      ctx.moveTo(20, y);
      ctx.lineTo(GAME.WIDTH / 2 - 20, y);
      ctx.stroke();
    }

    // 右半区装饰：厂房锯齿屋顶剪影
    ctx.fillStyle = 'rgba(255, 140, 50, 0.08)';
    for (let x = GAME.WIDTH / 2 + 40; x < GAME.WIDTH - 40; x += 120) {
      ctx.beginPath();
      ctx.moveTo(x, 120);
      ctx.lineTo(x + 60, 80);
      ctx.lineTo(x + 120, 120);
      ctx.closePath();
      ctx.fill();
    }

    // 地面
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.fillRect(0, GAME.HEIGHT - 100, GAME.WIDTH, 100);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, GAME.HEIGHT - 100);
    ctx.lineTo(GAME.WIDTH, GAME.HEIGHT - 100);
    ctx.stroke();

    // 区域标签
    ctx.save();
    ctx.font = 'bold 14px sans-serif';
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(100, 180, 255, 0.5)';
    ctx.fillText('高新园区', 24, 24);
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(255, 140, 50, 0.5)';
    ctx.fillText('制造工厂', GAME.WIDTH - 24, 24);
    ctx.restore();
  }

  /**
   * 绘制互动点：发光圆点（未查看）或暗淡标记（已查看）
   * @param {CanvasRenderingContext2D} ctx
   * @private
   */
  _drawHotspots(ctx) {
    for (let i = 0; i < this.hotspots.length; i++) {
      const spot = this.hotspots[i];
      const viewed = this.hotspotViewed[i];

      ctx.save();

      // 脉动动画因子
      const pulse = Math.sin(this.animTime * 3 + i * 1.5) * 0.3 + 0.7;
      const radius = HOTSPOT_RADIUS;

      if (viewed) {
        // 已查看：暗淡标记
        ctx.globalAlpha = 0.3;
        ctx.fillStyle = '#64748b';
        ctx.beginPath();
        ctx.arc(spot.x, spot.y, radius * 0.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#475569';
        ctx.lineWidth = 1;
        ctx.stroke();
      } else {
        // 未查看：发光圆点 + 外层光晕
        const glowGradient = ctx.createRadialGradient(
          spot.x, spot.y, 0,
          spot.x, spot.y, radius * 2.5
        );
        glowGradient.addColorStop(0, `rgba(100, 200, 255, ${pulse * 0.4})`);
        glowGradient.addColorStop(1, 'rgba(100, 200, 255, 0)');
        ctx.fillStyle = glowGradient;
        ctx.beginPath();
        ctx.arc(spot.x, spot.y, radius * 2.5, 0, Math.PI * 2);
        ctx.fill();

        // 核心圆点
        ctx.fillStyle = '#60a5fa';
        ctx.beginPath();
        ctx.arc(spot.x, spot.y, radius, 0, Math.PI * 2);
        ctx.fill();

        // 高亮内圈
        ctx.fillStyle = `rgba(255, 255, 255, ${pulse * 0.6})`;
        ctx.beginPath();
        ctx.arc(spot.x, spot.y, radius * 0.5, 0, Math.PI * 2);
        ctx.fill();

        // 边框
        ctx.strokeStyle = '#93c5fd';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(spot.x, spot.y, radius, 0, Math.PI * 2);
        ctx.stroke();
      }

      // 互动点名称
      ctx.globalAlpha = viewed ? 0.4 : 0.9;
      ctx.font = '13px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = '#e2e8f0';
      ctx.fillText(spot.name, spot.x, spot.y + radius + 8);

      ctx.restore();
    }
  }

  /**
   * 绘制未收集的齿轮零件：金色齿轮 + 旋转动画 + 光晕
   * @param {CanvasRenderingContext2D} ctx
   * @private
   */
  _drawGears(ctx) {
    for (let i = 0; i < GEAR_POSITIONS.length; i++) {
      const gear = GEAR_POSITIONS[i];
      if (this.gearCollected[i]) continue;

      ctx.save();

      // 旋转角度与脉动光效
      const rotation = this.animTime * 1.5 + i * 0.8;
      const pulse = Math.sin(this.animTime * 4 + i * 2) * 0.2 + 0.8;

      // 光晕
      const glowGradient = ctx.createRadialGradient(
        gear.x, gear.y, 0,
        gear.x, gear.y, GEAR_RADIUS * 2.5
      );
      glowGradient.addColorStop(0, `rgba(251, 191, 36, ${pulse * 0.35})`);
      glowGradient.addColorStop(1, 'rgba(251, 191, 36, 0)');
      ctx.fillStyle = glowGradient;
      ctx.beginPath();
      ctx.arc(gear.x, gear.y, GEAR_RADIUS * 2.5, 0, Math.PI * 2);
      ctx.fill();

      // 绘制齿轮本体
      ctx.translate(gear.x, gear.y);
      ctx.rotate(rotation);
      this._drawGearShape(ctx, GEAR_RADIUS, '#fbbf24', '#f59e0b');

      ctx.restore();
    }
  }

  /**
   * 绘制齿轮形状：齿轮齿 + 中心孔
   * 调用前需已 translate 到齿轮中心并 rotate 到目标角度
   * @param {CanvasRenderingContext2D} ctx - 已变换的上下文
   * @param {number} radius - 齿轮基准半径
   * @param {string} fillColor - 填充颜色
   * @param {string} strokeColor - 描边颜色
   * @private
   */
  _drawGearShape(ctx, radius, fillColor, strokeColor) {
    const teeth = 8;
    const innerRadius = radius * 0.75;
    const outerRadius = radius * 1.25;
    const totalPoints = teeth * 4;

    // 绘制齿轮齿轮廓
    ctx.beginPath();
    for (let i = 0; i < totalPoints; i++) {
      const angle = (i / totalPoints) * Math.PI * 2;
      const phase = i % 4;
      // phase 0/3 为齿根（内圆），phase 1/2 为齿尖（外圆）
      const r = (phase === 0 || phase === 3) ? innerRadius : outerRadius;
      const x = Math.cos(angle) * r;
      const y = Math.sin(angle) * r;
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.closePath();
    ctx.fillStyle = fillColor;
    ctx.fill();
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 2;
    ctx.stroke();

    // 中心孔
    ctx.fillStyle = '#1e293b';
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.3, 0, Math.PI * 2);
    ctx.fill();
  }

  /**
   * 绘制组装动画：3 个齿轮从各自位置汇聚到组装中心
   * 进度过半后渐显访客徽章雏形
   * @param {CanvasRenderingContext2D} ctx
   * @private
   */
  _drawAssembly(ctx) {
    ctx.save();

    // 绘制汇聚中的齿轮
    for (let i = 0; i < GEAR_POSITIONS.length; i++) {
      const gear = GEAR_POSITIONS[i];
      const progress = this.assemblyProgress;

      // 插值位置：从原始位置向组装中心移动
      const currentX = gear.x + (ASSEMBLY_CENTER_X - gear.x) * progress;
      const currentY = gear.y + (ASSEMBLY_CENTER_Y - gear.y) * progress;

      // 旋转加速
      const rotation = this.animTime * 3 + i * 1.2;

      ctx.save();
      ctx.translate(currentX, currentY);
      ctx.rotate(rotation);

      // 逐渐缩小
      const scale = 1 - progress * 0.3;
      ctx.scale(scale, scale);

      this._drawGearShape(ctx, GEAR_RADIUS, '#fbbf24', '#f59e0b');
      ctx.restore();
    }

    // 组装进度过半时渐显访客徽章雏形
    if (this.assemblyProgress > 0.5) {
      const badgeAlpha = (this.assemblyProgress - 0.5) * 2;
      ctx.globalAlpha = badgeAlpha;

      // 徽章光晕
      const badgeGlow = ctx.createRadialGradient(
        ASSEMBLY_CENTER_X, ASSEMBLY_CENTER_Y, 0,
        ASSEMBLY_CENTER_X, ASSEMBLY_CENTER_Y, 50
      );
      badgeGlow.addColorStop(0, 'rgba(251, 191, 36, 0.6)');
      badgeGlow.addColorStop(1, 'rgba(251, 191, 36, 0)');
      ctx.fillStyle = badgeGlow;
      ctx.beginPath();
      ctx.arc(ASSEMBLY_CENTER_X, ASSEMBLY_CENTER_Y, 50, 0, Math.PI * 2);
      ctx.fill();

      // 徽章主体
      ctx.fillStyle = '#fbbf24';
      ctx.beginPath();
      ctx.arc(ASSEMBLY_CENTER_X, ASSEMBLY_CENTER_Y, 28, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#d97706';
      ctx.lineWidth = 3;
      ctx.stroke();

      // 徽章内部齿轮图标
      ctx.save();
      ctx.translate(ASSEMBLY_CENTER_X, ASSEMBLY_CENTER_Y);
      ctx.rotate(this.animTime * 2);
      this._drawGearShape(ctx, 16, '#d97706', '#92400e');
      ctx.restore();
    }

    ctx.restore();
  }

  /**
   * 绘制组装完成后的访客徽章（结束阶段显示）
   * @param {CanvasRenderingContext2D} ctx
   * @private
   */
  _drawVisitorBadge(ctx) {
    ctx.save();

    // 徽章光晕
    const glowGradient = ctx.createRadialGradient(
      ASSEMBLY_CENTER_X, ASSEMBLY_CENTER_Y, 0,
      ASSEMBLY_CENTER_X, ASSEMBLY_CENTER_Y, 60
    );
    glowGradient.addColorStop(0, 'rgba(251, 191, 36, 0.3)');
    glowGradient.addColorStop(1, 'rgba(251, 191, 36, 0)');
    ctx.fillStyle = glowGradient;
    ctx.beginPath();
    ctx.arc(ASSEMBLY_CENTER_X, ASSEMBLY_CENTER_Y, 60, 0, Math.PI * 2);
    ctx.fill();

    // 徽章主体
    ctx.fillStyle = '#fbbf24';
    ctx.beginPath();
    ctx.arc(ASSEMBLY_CENTER_X, ASSEMBLY_CENTER_Y, 28, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#d97706';
    ctx.lineWidth = 3;
    ctx.stroke();

    // 徽章内部齿轮图标（持续旋转）
    ctx.save();
    ctx.translate(ASSEMBLY_CENTER_X, ASSEMBLY_CENTER_Y);
    ctx.rotate(this.animTime * 1.5);
    this._drawGearShape(ctx, 16, '#d97706', '#92400e');
    ctx.restore();

    // 徽章标签
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#fbbf24';
    ctx.fillText('访客徽章', ASSEMBLY_CENTER_X, ASSEMBLY_CENTER_Y + 40);

    ctx.restore();
  }

  /**
   * 绘制安检门：门框 + 双开滑动门板 + 警示灯
   * 门板开合进度随组装动画或完成状态变化
   * @param {CanvasRenderingContext2D} ctx
   * @private
   */
  _drawSecurityDoor(ctx) {
    // 门开启进度：组装中跟随 assemblyProgress，结束后全开
    const openAmount = this.phase === 'assembling' ? this.assemblyProgress
      : (this.phase === 'outro' || this.phase === 'done') ? 1
        : 0;

    ctx.save();

    const doorWidth = 50;
    const doorHeight = 180;
    const slideMax = doorWidth * 0.9;

    // 门框
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 4;
    ctx.strokeRect(
      DOOR_X - doorWidth - 5,
      DOOR_Y - doorHeight / 2 - 5,
      doorWidth * 2 + 10,
      doorHeight + 10
    );

    // 门框顶部标识牌
    ctx.fillStyle = '#475569';
    ctx.fillRect(DOOR_X - 60, DOOR_Y - doorHeight / 2 - 28, 120, 22);
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#cbd5e1';
    ctx.fillText('安检通道', DOOR_X, DOOR_Y - doorHeight / 2 - 17);

    // 左门板（向左滑动）
    const leftSlide = -openAmount * slideMax;
    ctx.fillStyle = '#475569';
    ctx.fillRect(DOOR_X - doorWidth + leftSlide, DOOR_Y - doorHeight / 2, doorWidth, doorHeight);
    ctx.fillStyle = '#334155';
    for (let y = 0; y < doorHeight; y += 20) {
      ctx.fillRect(DOOR_X - doorWidth + leftSlide, DOOR_Y - doorHeight / 2 + y, doorWidth, 3);
    }

    // 右门板（向右滑动）
    const rightSlide = openAmount * slideMax;
    ctx.fillStyle = '#475569';
    ctx.fillRect(DOOR_X + rightSlide, DOOR_Y - doorHeight / 2, doorWidth, doorHeight);
    ctx.fillStyle = '#334155';
    for (let y = 0; y < doorHeight; y += 20) {
      ctx.fillRect(DOOR_X + rightSlide, DOOR_Y - doorHeight / 2 + y, doorWidth, 3);
    }

    // 警示灯：组装中闪烁绿色，完成后常亮绿色
    const isGreen = this.phase === 'assembling'
      ? Math.sin(this.animTime * 8) > 0
      : openAmount >= 1;
    const lampColor = isGreen ? '#22c55e' : '#475569';
    ctx.fillStyle = lampColor;
    ctx.beginPath();
    ctx.arc(DOOR_X - 70, DOOR_Y - doorHeight / 2 - 17, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(DOOR_X + 70, DOOR_Y - doorHeight / 2 - 17, 5, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  /**
   * 绘制 HUD：阶段进度提示与操作引导
   * @param {CanvasRenderingContext2D} ctx
   * @private
   */
  _drawHud(ctx) {
    ctx.save();
    ctx.font = 'bold 18px sans-serif';
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';

    // 观赏阶段：互动点查看进度
    if (this.phase === 'observe') {
      const viewed = this.hotspotViewed.filter((v) => v).length;
      ctx.fillStyle = '#60a5fa';
      ctx.fillText(`互动点 ${viewed} / ${this.hotspots.length}`, 24, 20);
    }

    // 解谜阶段：齿轮收集进度
    if (this.phase === 'puzzle') {
      const collected = this.gearCollected.filter((c) => c).length;
      ctx.fillStyle = '#fbbf24';
      ctx.fillText(`齿轮零件 ${collected} / ${GEAR_POSITIONS.length}`, 24, 20);
    }

    // 底部操作提示
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    if (this.phase === 'observe') {
      ctx.fillStyle = '#64748b';
      ctx.fillText('点击发光圆点查看互动故事', GAME.WIDTH / 2, GAME.HEIGHT - 28);
    } else if (this.phase === 'puzzle') {
      ctx.fillStyle = '#64748b';
      ctx.fillText('点击金色齿轮收集零件', GAME.WIDTH / 2, GAME.HEIGHT - 28);
    } else if (this.phase === 'assembling') {
      ctx.fillStyle = '#fbbf24';
      ctx.fillText('正在组装访客徽章...', GAME.WIDTH / 2, GAME.HEIGHT - 28);
    }

    ctx.restore();
  }
}
