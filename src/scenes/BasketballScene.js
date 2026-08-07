import { GAME, EVENT } from '../config.js';
import { BallPhysics } from '../core/BallPhysics.js';
import { ChargeMeter } from '../ui/ChargeMeter.js';
import { ParticleSystem } from '../core/ParticleSystem.js';
import { ChoiceOverlay } from '../ui/ChoiceOverlay.js';
import { applyButtonStyle } from '../ui/ButtonTheme.js';
import { DIALOGUES } from '../data/dialogues.js';

/**
 * 投篮物理参数（来自 PRD §5 F5，与 BallPhysics 测试配置一致）
 */
const HOOP_X = 1000;
const GRAVITY = 430;
const CHARGE_RATE = 65;
const HOOP_RANGE_MIN = 0.10;
const HOOP_RANGE_MAX = 0.34;
const SCORE_THRESHOLD = 36;

/** 进球/未中反馈文本显示时长（秒） */
const FEEDBACK_DURATION = 1.5;

/** 开场对话取 ch1 前 4 行（最后一行带 minigame:start 事件） */
const OPENING_LINES = DIALOGUES.ch1.slice(0, 4);
/** 过关对话取 ch1 第 7~9 行（minigame:win → 感言 → chapter:next） */
const WIN_LINES = DIALOGUES.ch1.slice(6, 9);
/** 进球反馈文本（来自 ch1 第 5 行 minigame:score） */
const SCORE_FEEDBACK_TEXT = (DIALOGUES.ch1[4] && DIALOGUES.ch1[4].txt) || '好球！再来！';
/** 未中反馈文本（来自 ch1 第 6 行 minigame:miss） */
const MISS_FEEDBACK_TEXT = (DIALOGUES.ch1[5] && DIALOGUES.ch1[5].txt) || '差一点！调整力度再试试。';

/**
 * 抉择点配置（对应剧情分支设计 v4 §3 伞形多结局）
 * 发放沿途印记后弹出，玩家可选"留下训练"进入篮球人生结局分支，或继续探寻。
 */
const CHOICE_CONFIG = {
  sceneId: 'ch1',
  nextChapter: 'ch2',
  title: '教练拍了拍莞小鹅的肩膀',
  stayLabel: '留下训练',
  continueLabel: '继续探寻',
};

/**
 * 投篮小游戏场景（对应 PRD §5 F5 + Task 3.3）
 *
 * 玩法流程：
 * 1. 进入场景 → 播放开场对话（ch1 前 4 行）
 * 2. 对话结束 → 触发 minigame:start → 玩家蓄力投篮
 * 3. 60 秒内投进 5 球 → 播放过关对话 → 发放印记 "basketball" → 进入剧情抉择
 * 4. 时间到未进 5 球 → 可领取篮球纪念继续剧情，也可选择重试
 *
 * 分层渲染：
 * - Canvas 层：背景、篮筐、球、蓄力条（画布内）、计分、倒计时、反馈文本
 * - DOM 层：ChargeMeter（蓄力按钮 + 进度条）、失败结算按钮
 *
 * 输入方式：
 * - 触控主路径：ChargeMeter 蓄力按钮按住蓄力、松开出手
 * - 开发回退：空格键 keydown 蓄力、keyup 出手
 */
export class BasketballScene {
  /**
   * @param {Object} deps - 依赖注入
   * @param {SceneManager} deps.sceneManager - 场景管理器
   * @param {EventBus} deps.eventBus - 事件总线
   * @param {BadgeSystem} deps.badgeSystem - 印记系统
   * @param {DialogueRunner} deps.dialogueRunner - 对话运行器（由 DialogueBox 内部使用）
   * @param {DialogueBox} deps.dialogueBox - 对话框 UI（共享单例）
   * @param {InputManager} deps.input - 输入管理器
   * @param {HTMLElement} deps.container - UI 挂载容器
   */
  constructor({ sceneManager, eventBus, badgeSystem, dialogueRunner, dialogueBox, input, container, getFps, getChoice }) {
    this.sceneManager = sceneManager;
    this.eventBus = eventBus;
    this.badgeSystem = badgeSystem;
    this.dialogueRunner = dialogueRunner;
    this.dialogueBox = dialogueBox;
    this.input = input;
    this.container = container;
    /** FPS 提供函数（供粒子系统降级判断） */
    this.getFps = getFps || (() => 60);
    /** 读取已记录抉择的回调（用于判断"留下"按钮是否置灰，伞形多结局仅允许一次留下） */
    this.getChoice = getChoice || (() => null);

    /** 场景阶段：'idle' | 'dialogue' | 'playing' | 'winDialogue' | 'failed' | 'choice' */
    this.phase = 'idle';
    /** 物理引擎实例 */
    this.physics = null;
    /** 蓄力条 DOM 组件实例 */
    this.chargeMeter = null;
    /** 是否正在蓄力 */
    this.isCharging = false;
    /** 标记上一帧球是否在飞行（用于检测球落地的时刻） */
    this.ballWasFlying = false;
    /** 反馈文本（"好球！"或"差一点！"） */
    this.feedbackText = '';
    /** 反馈文本剩余显示时间（秒） */
    this.feedbackTimer = 0;
    /** 防重复切换场景 */
    this.transitioning = false;
    /** 再来一局覆盖层 DOM */
    this.retryOverlay = null;
    /** 再来一局按钮 DOM */
    this.retryButton = null;
    /** 失败后领取篮球纪念并继续剧情的按钮 DOM */
    this.souvenirButton = null;
    /** 粒子系统（进球光效） */
    this.particles = null;
    /** 抉择覆盖层实例（发放印记后弹出） */
    this.choiceOverlay = null;

    // 绑定事件处理器 this 指向
    this._onDialogueNext = this._onDialogueNext.bind(this);
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._onChargeStart = this._onChargeStart.bind(this);
    this._onChargeRelease = this._onChargeRelease.bind(this);
    this._onRetryClick = this._onRetryClick.bind(this);
    this._onFailureContinue = this._onFailureContinue.bind(this);
    this._onChoiceStay = this._onChoiceStay.bind(this);
    this._onChoiceContinue = this._onChoiceContinue.bind(this);
  }

  // ==================== 场景生命周期 ====================

  /**
   * 场景进入：创建物理引擎、注册事件、播放开场对话
   * @param {*} [params] - 切换场景时传入的参数（本场景忽略）
   */
  onEnter(_params) {
    this._createPhysics();
    this.particles = new ParticleSystem({ getFps: this.getFps });

    // 监听对话结束事件，用于阶段切换
    this.eventBus.on(EVENT.DIALOGUE_NEXT, this._onDialogueNext);

    // 监听抉择事件，玩家点击"留下"/"继续"后推进流程
    this.eventBus.on(EVENT.CHOICE_STAY, this._onChoiceStay);
    this.eventBus.on(EVENT.CHOICE_CONTINUE, this._onChoiceContinue);

    // 进入开场对话阶段
    this.phase = 'dialogue';
    this.dialogueBox.show(OPENING_LINES);
  }

  /**
   * 每帧更新：按当前阶段分发到对应更新逻辑
   * @param {number} deltaTime - 帧间隔（秒）
   */
  update(deltaTime) {
    // 粒子系统始终更新（进球光效淡出动画）
    if (this.particles) this.particles.update(deltaTime);

    switch (this.phase) {
      case 'dialogue':
        this.dialogueBox.update(deltaTime);
        break;
      case 'playing':
        this._updatePlaying(deltaTime);
        break;
      case 'winDialogue':
        this.dialogueBox.update(deltaTime);
        break;
      case 'failed':
        // 失败阶段无逐帧逻辑，等待玩家点击重试
        break;
      default:
        break;
    }
  }

  /**
   * 绘制：在 Canvas 上渲染背景、篮筐、球、蓄力条、计分、倒计时、反馈
   * @param {CanvasRenderingContext2D} ctx
   */
  draw(ctx) {
    if (!ctx) return;
    this._drawBackground(ctx);
    this._drawTrajectoryGuide(ctx);
    this._drawHoop(ctx);
    this._drawBall(ctx);
    if (this.phase === 'playing') {
      this._drawChargeBar(ctx);
    }
    this._drawHud(ctx);
    // 粒子特效渲染在 HUD 之上
    if (this.particles) this.particles.draw(ctx);
    if (this.feedbackTimer > 0) {
      this._drawFeedback(ctx);
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

    // 移除键盘监听
    this._removeKeyboardListeners();

    // 停止蓄力
    this.isCharging = false;

    // 销毁蓄力条
    this._destroyChargeMeter();

    // 移除再来一局覆盖层
    this._removeRetryOverlay();

    // 移除抉择覆盖层
    this._hideChoiceOverlay();

    // 隐藏对话框（共享单例，仅隐藏不销毁）
    if (this.dialogueBox) {
      this.dialogueBox.hide();
    }

    // 重置状态
    this.physics = null;
    this.phase = 'idle';
    this.transitioning = false;
    this.feedbackText = '';
    this.feedbackTimer = 0;
    this.ballWasFlying = false;
    // 清理粒子系统
    if (this.particles) {
      this.particles.clear();
      this.particles = null;
    }
  }

  // ==================== 物理引擎创建 ====================

  /**
   * 创建物理引擎实例（参数与 PRD §5 F5 及 BallPhysics 测试一致）
   * @private
   */
  _createPhysics() {
    this.physics = new BallPhysics({
      canvasWidth: GAME.WIDTH,
      canvasHeight: GAME.HEIGHT,
      hoopX: HOOP_X,
      gravity: GRAVITY,
      chargeRate: CHARGE_RATE,
      hoopRangeMin: HOOP_RANGE_MIN,
      hoopRangeMax: HOOP_RANGE_MAX,
      scoreThreshold: SCORE_THRESHOLD,
    });
  }

  // ==================== 游戏阶段更新 ====================

  /**
   * 游戏中阶段的逐帧更新
   * 顺序：篮筐浮动 → 蓄力 → 球物理 → 计时器 → 反馈 → 胜负判定
   * @param {number} deltaTime - 帧间隔（秒）
   * @private
   */
  _updatePlaying(deltaTime) {
    // 篮筐持续浮动，无论球是否在飞
    this.physics.updateHoop(deltaTime);

    // 蓄力：按住时持续增长
    if (this.isCharging && !this.physics.isBallFlying()) {
      this.physics.charge(deltaTime);
      this.chargeMeter.update(this.physics.getCharge());
    }

    // 球飞行物理更新
    if (this.physics.isBallFlying()) {
      this.physics.update(deltaTime);
      if (this.physics.consumeScoreEvent()) {
        // 得分在穿过篮圈的当帧处理，不等待篮球落地或停止飞行。
        this.ballWasFlying = false;
        this._onBallScored();
      } else {
        this.ballWasFlying = true;
      }
    } else if (this.ballWasFlying) {
      // 球刚停止飞行（出界），按投失处理；进球已在穿筐当帧处理。
      this.ballWasFlying = false;
      this._onBallLanded();
    }

    // 倒计时持续递减（失败判定会检查球未飞行，确保最后一球飞行中不被截断）
    this.physics.tickTimer(deltaTime);

    // 反馈文本倒计时
    if (this.feedbackTimer > 0) {
      this.feedbackTimer -= deltaTime;
    }

    // 胜利判定（优先于失败判定，确保最后一球进球算赢）
    if (this.physics.hasWon() && !this.transitioning) {
      this._startWinDialogue();
      return;
    }

    // 失败判定：时间到且球不在飞行中
    if (this.physics.isTimeUp() && !this.physics.isBallFlying() && !this.transitioning) {
      this._onGameFailed();
      return;
    }
  }

  // ==================== 阶段切换 ====================

  /**
   * 对话结束事件处理：根据当前阶段决定下一步
   * - dialogue 阶段结束 → 启动小游戏
   * - winDialogue 阶段结束 → 发放印记 + 弹出剧情抉择
   * @param {Object} data - 事件数据，data.finished 为 true 表示整段对话结束
   * @private
   */
  _onDialogueNext(data) {
    if (!data || !data.finished) return;

    if (this.phase === 'dialogue') {
      this._startMinigame();
    } else if (this.phase === 'winDialogue') {
      this._onWinDialogueFinished();
    }
  }

  /**
   * 启动小游戏：创建蓄力条、注册键盘监听、进入 playing 阶段
   * @private
   */
  _startMinigame() {
    this.phase = 'playing';
    this.transitioning = false;

    // 创建并挂载蓄力条
    this.chargeMeter = new ChargeMeter({
      onChargeStart: this._onChargeStart,
      onChargeRelease: this._onChargeRelease,
    });
    this.chargeMeter.mount(this.container);
    this.chargeMeter.update(0);

    // 注册空格键蓄力监听
    this._addKeyboardListeners();
  }

  /**
   * 开始过关对话：销毁游戏 UI、播放过关对话
   * @private
   */
  _startWinDialogue() {
    this.transitioning = true;
    this.phase = 'winDialogue';

    // 停止蓄力并清理游戏 UI
    this.isCharging = false;
    this._removeKeyboardListeners();
    this._destroyChargeMeter();

    // 播放过关对话
    this.dialogueBox.show(WIN_LINES);
  }

  /**
   * 过关对话结束：发放印记，广播章节完成，然后弹出抉择点
   * 抉择在发放沿途印记后、推进下一场景之前插入（对应剧情分支设计 v4）
   * @private
   */
  _onWinDialogueFinished() {
    this._completeChapter();
  }

  /**
   * 完成篮球馆章节：成功与失败后领取纪念共用同一条正式剧情出口。
   * 这样小游戏结果只影响挑战反馈，不会阻断章节完成、抉择或后续场景。
   * @private
   */
  _completeChapter() {
    this.transitioning = false;
    this.phase = 'choice';
    this.badgeSystem.unlock('basketball');
    // 广播章节完成，触发自动存档
    this.eventBus.emit(EVENT.CHAPTER_COMPLETE, { chapter: 'ch1' });
    // 发放沿途印记后弹出抉择，玩家选择"留下"或"继续探寻"
    this._showChoice();
  }

  // ==================== 抉择点 ====================

  /**
   * 弹出抉择覆盖层：让玩家选择"留下训练"或"继续探寻"
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

  /**
   * 游戏失败：时间到未进 5 球。
   * 销毁游戏 UI，显示失败结算；玩家可以领取篮球纪念并继续正式剧情，
   * 也可以选择再来一局挑战 5 球目标。
   * @private
   */
  _onGameFailed() {
    this.transitioning = true;
    this.phase = 'failed';

    this.isCharging = false;
    this._removeKeyboardListeners();
    this._destroyChargeMeter();
    this._showRetryOverlay();
  }

  // ==================== 球落地处理 ====================

  /**
   * 球穿过篮圈后的即时反馈处理。
   * 物理引擎已在穿筐当帧递增得分，这里只负责反馈和复位篮球。
   * @private
   */
  _onBallScored() {
    this.feedbackText = SCORE_FEEDBACK_TEXT;
    // 进球音效 + 光效粒子（对应 PRD §7.7 进球光效）
    this.eventBus.emit(EVENT.SFX_PLAY, { name: 'goal' });
    if (this.particles) {
      const hoop = this.physics.getHoopPosition();
      this.particles.emit(hoop.x, hoop.y, 'sparkle');
    }
    this.feedbackTimer = FEEDBACK_DURATION;
    this._resetBallAfterShot();
  }

  /**
   * 球落地（出界）后的投失反馈处理。
   * @private
   */
  _onBallLanded() {
    this.feedbackText = MISS_FEEDBACK_TEXT;
    // 投失音效
    this.eventBus.emit(EVENT.SFX_PLAY, { name: 'miss' });
    this.feedbackTimer = FEEDBACK_DURATION;
    this._resetBallAfterShot();
  }

  /**
   * 结束一轮投篮并把篮球放回起点，保证进球和投失走同一套复位流程。
   * @private
   */
  _resetBallAfterShot() {
    // 重置球到投掷起始点，准备下一次投篮
    this.physics.resetBall();
    if (this.chargeMeter) {
      this.chargeMeter.update(0);
    }
  }

  // ==================== 蓄力与出手 ====================

  /**
   * 蓄力开始（空格 keydown 或按钮 pointerdown 触发）
   * 球飞行中不允许蓄力
   * @private
   */
  _onChargeStart() {
    if (this.phase !== 'playing') return;
    if (this.physics.isBallFlying()) return;
    this.isCharging = true;
  }

  /**
   * 蓄力释放出手（空格 keyup 或按钮 pointerup 触发）
   * 记录飞行前得分用于落地判定，调用物理引擎投球
   * @private
   */
  _onChargeRelease() {
    if (!this.isCharging) return;
    this.isCharging = false;

    // 球飞行中不重复投球
    if (this.physics.isBallFlying()) return;

    // 调用物理引擎出手
    this.physics.throwBall();

    // 重置蓄力条显示
    if (this.chargeMeter) {
      this.chargeMeter.update(0);
    }
  }

  // ==================== 键盘监听 ====================

  /**
   * 注册空格键 keydown/keyup 监听
   * InputManager 仅在 keydown 时触发 interact，不提供 keyup，
   * 因此场景自行监听空格键的按下与释放以实现蓄力机制
   * @private
   */
  _addKeyboardListeners() {
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
  }

  /**
   * 移除空格键监听
   * @private
   */
  _removeKeyboardListeners() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
  }

  /**
   * keydown：空格键开始蓄力
   * e.repeat 防止按住时重复触发
   * @param {KeyboardEvent} e
   * @private
   */
  _onKeyDown(e) {
    if (e.key !== ' ') return;
    // 阻止空格键滚动页面
    e.preventDefault();
    if (e.repeat) return;
    this._onChargeStart();
  }

  /**
   * keyup：空格键释放出手
   * @param {KeyboardEvent} e
   * @private
   */
  _onKeyUp(e) {
    if (e.key !== ' ') return;
    e.preventDefault();
    this._onChargeRelease();
  }

  // ==================== 蓄力条管理 ====================

  /**
   * 销毁蓄力条组件
   * @private
   */
  _destroyChargeMeter() {
    if (this.chargeMeter) {
      this.chargeMeter.destroy();
      this.chargeMeter = null;
    }
  }

  // ==================== 再来一局覆盖层 ====================

  /**
   * 显示失败结算覆盖层（DOM）
   * 包含篮球纪念领取按钮与可选的"再来一局"按钮
   * @private
   */
  _showRetryOverlay() {
    this.retryOverlay = document.createElement('div');
    this.retryOverlay.setAttribute('data-retry-overlay', '');
    this.retryOverlay.style.cssText = `
      position: fixed; inset: 0; z-index: 300;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: 24px; background: rgba(0,0,0,0.75); pointer-events: auto;
    `;

    const title = document.createElement('div');
    title.textContent = '时间到！';
    title.style.cssText = `
      font-size: 36px; color: #f87171; font-family: inherit; font-weight: bold;
    `;

    const subtitle = document.createElement('div');
    const score = this.physics ? this.physics.getScore() : 0;
    subtitle.textContent = `本轮进球 ${score} / 5`;
    subtitle.style.cssText = `
      font-size: 18px; color: #cbd5e1; font-family: inherit;
    `;

    const note = document.createElement('div');
    note.textContent = '没关系，教练把篮球场的纪念也送给你。';
    note.style.cssText = `
      font-size: 16px; color: #fcd34d; font-family: inherit;
    `;

    const actionRow = document.createElement('div');
    actionRow.style.cssText = `
      display: flex; flex-wrap: wrap; justify-content: center; gap: 12px;
    `;

    this.souvenirButton = document.createElement('button');
    this.souvenirButton.setAttribute('data-souvenir-continue', '');
    this.souvenirButton.textContent = '收下纪念，继续剧情';
    applyButtonStyle(this.souvenirButton, { variant: 'primary', size: 'lg' });
    this.souvenirButton.addEventListener('click', this._onFailureContinue);

    this.retryButton = document.createElement('button');
    this.retryButton.setAttribute('data-retry-button', '');
    this.retryButton.textContent = '再来一局';
    applyButtonStyle(this.retryButton, { variant: 'secondary', size: 'lg' });
    this.retryButton.addEventListener('click', this._onRetryClick);

    this.retryOverlay.appendChild(title);
    this.retryOverlay.appendChild(subtitle);
    this.retryOverlay.appendChild(note);
    actionRow.appendChild(this.souvenirButton);
    actionRow.appendChild(this.retryButton);
    this.retryOverlay.appendChild(actionRow);

    this.container.appendChild(this.retryOverlay);
  }

  /**
   * 移除再来一局覆盖层
   * @private
   */
  _removeRetryOverlay() {
    if (this.souvenirButton) {
      this.souvenirButton.removeEventListener('click', this._onFailureContinue);
      this.souvenirButton = null;
    }
    if (this.retryButton) {
      this.retryButton.removeEventListener('click', this._onRetryClick);
      this.retryButton = null;
    }
    if (this.retryOverlay && this.retryOverlay.parentNode) {
      this.retryOverlay.parentNode.removeChild(this.retryOverlay);
    }
    this.retryOverlay = null;
  }

  /**
   * 再来一局按钮点击：移除覆盖层、重置游戏、重新进入 playing 阶段
   * @private
   */
  _onRetryClick() {
    // 防连点
    if (!this.transitioning) return;

    this._removeRetryOverlay();
    this.transitioning = false;

    // 重置物理引擎与游戏状态
    this._createPhysics();
    this.isCharging = false;
    this.ballWasFlying = false;
    this.feedbackText = '';
    this.feedbackTimer = 0;

    // 直接进入小游戏（不重播开场对话）
    this._startMinigame();
  }

  /**
   * 失败后领取篮球纪念并进入正式剧情。
   * @private
   */
  _onFailureContinue() {
    if (this.phase !== 'failed' || !this.transitioning) return;

    this._removeRetryOverlay();
    this._completeChapter();
  }

  // ==================== Canvas 绘制 ====================

  /**
   * 绘制背景：深色渐变 + 木地板色调
   * @param {CanvasRenderingContext2D} ctx
   * @private
   */
  _drawBackground(ctx) {
    const gradient = ctx.createLinearGradient(0, 0, 0, GAME.HEIGHT);
    gradient.addColorStop(0, '#1a1a2e');
    gradient.addColorStop(0.7, '#16213e');
    gradient.addColorStop(1, '#0f172a');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, GAME.WIDTH, GAME.HEIGHT);

    // 地板线（暗示球场地面）
    ctx.strokeStyle = 'rgba(251, 191, 36, 0.15)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 620);
    ctx.lineTo(GAME.WIDTH, 620);
    ctx.stroke();
  }

  /**
   * 绘制投篮抛物线辅助：静止球/蓄力时显示蓝色虚线采样点，
   * 并在篮圈附近标出当前力度预计经过的位置。
   * 轨迹数据由 BallPhysics 计算，和真实出手共用重力与初速度公式。
   * @param {CanvasRenderingContext2D} ctx
   * @private
   */
  _drawTrajectoryGuide(ctx) {
    if (!this.physics || this.phase !== 'playing' || this.physics.isBallFlying()) return;

    const charge = this.physics.getCharge();
    const preview = this.physics.getTrajectoryPreview({
      power: charge,
      duration: 3.5,
      step: 0.06,
      maxPoints: 64,
    });
    if (preview.points.length < 2) return;

    const hoop = preview.hoop;
    const scoreWindow = this.physics.getScoreWindow();
    const ball = this.physics.getBallPosition();
    const nearestToHoop = preview.points.reduce((nearest, point) => {
      if (Math.abs(point.x - hoop.x) < Math.abs(nearest.x - hoop.x)) return point;
      return nearest;
    }, preview.points[0]);
    const verticalError = Math.abs(nearestToHoop.y - hoop.y);
    const targetColor = verticalError < 24 ? '#4ade80' : '#fbbf24';

    ctx.save();
    ctx.setLineDash([5, 8]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = `rgba(96, 165, 250, ${0.35 + charge / 250})`;
    ctx.beginPath();
    preview.points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.stroke();

    // 采样点强化轨迹的方向感，避免在缩放画布上只看到一条模糊细线。
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(147, 197, 253, 0.7)';
    for (let i = 1; i < preview.points.length; i += 2) {
      const point = preview.points[i];
      ctx.beginPath();
      ctx.arc(point.x, point.y, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // 目标窗口与物理判定共用有效开口，避免辅助线比真实可进区域更宽。
    ctx.strokeStyle = targetColor;
    ctx.globalAlpha = 0.55;
    ctx.setLineDash([3, 5]);
    ctx.beginPath();
    ctx.ellipse(scoreWindow.left + scoreWindow.halfWidth, scoreWindow.y, scoreWindow.halfWidth, 9, 0, 0, Math.PI * 2);
    ctx.stroke();

    // 轨迹从投掷点开始，给玩家一个明确的辅助提示。
    ctx.globalAlpha = 0.75;
    ctx.fillStyle = '#bfdbfe';
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText('抛物线辅助', ball.x + 22, ball.y - 18);
    ctx.restore();
  }

  /**
   * 绘制篮筐：背板 + 篮圈 + 篮网
   * 篮筐位置由物理引擎的浮动逻辑决定
   * @param {CanvasRenderingContext2D} ctx
   * @private
   */
  _drawHoop(ctx) {
    if (!this.physics) return;
    const hoop = this.physics.getHoopPosition();

    ctx.save();

    // 背板（白色矩形）
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.fillRect(hoop.x + 18, hoop.y - 50, 8, 80);

    // 篮圈（橙色椭圆，侧视）
    ctx.strokeStyle = '#f97316';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.ellipse(hoop.x, hoop.y, 28, 6, 0, 0, Math.PI * 2);
    ctx.stroke();

    // 篮网（简化的下垂线条）
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.lineWidth = 1.5;
    for (let i = -2; i <= 2; i++) {
      const netTopX = hoop.x + i * 7;
      const netBottomX = hoop.x + i * 4;
      ctx.beginPath();
      ctx.moveTo(netTopX, hoop.y);
      ctx.lineTo(netBottomX, hoop.y + 22);
      ctx.stroke();
    }
    // 篮网底部横线
    ctx.beginPath();
    ctx.moveTo(hoop.x - 8, hoop.y + 22);
    ctx.lineTo(hoop.x + 8, hoop.y + 22);
    ctx.stroke();

    ctx.restore();
  }

  /**
   * 绘制篮球：橙色圆 + 黑色纹路
   * 球位置由物理引擎决定（飞行中为抛物线位置，静止时为投掷点）
   * @param {CanvasRenderingContext2D} ctx
   * @private
   */
  _drawBall(ctx) {
    if (!this.physics) return;
    const ball = this.physics.getBallPosition();
    const radius = this.physics.getBallRadius();

    ctx.save();

    // 球体（橙色渐变）
    const gradient = ctx.createRadialGradient(
      ball.x - 4, ball.y - 4, 2,
      ball.x, ball.y, radius
    );
    gradient.addColorStop(0, '#fbbf24');
    gradient.addColorStop(1, '#ea580c');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, radius, 0, Math.PI * 2);
    ctx.fill();

    // 篮球纹路（十字线）
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, radius, 0, Math.PI * 2);
    ctx.stroke();
    // 横线
    ctx.beginPath();
    ctx.moveTo(ball.x - radius, ball.y);
    ctx.lineTo(ball.x + radius, ball.y);
    ctx.stroke();
    // 竖线
    ctx.beginPath();
    ctx.moveTo(ball.x, ball.y - radius);
    ctx.lineTo(ball.x, ball.y + radius);
    ctx.stroke();

    ctx.restore();
  }

  /**
   * 绘制画布内蓄力条（球身旁边的迷你力度条）
   * 与 DOM ChargeMeter 同步显示蓄力值，提供游戏世界内的视觉反馈
   * @param {CanvasRenderingContext2D} ctx
   * @private
   */
  _drawChargeBar(ctx) {
    if (!this.physics) return;
    const charge = this.physics.getCharge();
    if (charge <= 0 && !this.isCharging) return;

    const ball = this.physics.getBallPosition();
    const barX = ball.x - 30;
    const barY = ball.y + 24;
    const barWidth = 60;
    const barHeight = 6;

    ctx.save();

    // 轨道
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(barX, barY, barWidth, barHeight);

    // 填充（绿→红渐变，与 DOM 组件一致）
    const fillWidth = (charge / 100) * barWidth;
    const gradient = ctx.createLinearGradient(barX, 0, barX + barWidth, 0);
    gradient.addColorStop(0, '#22c55e');
    gradient.addColorStop(0.5, '#eab308');
    gradient.addColorStop(1, '#ef4444');
    ctx.fillStyle = gradient;
    ctx.fillRect(barX, barY, fillWidth, barHeight);

    // 边框
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 1;
    ctx.strokeRect(barX, barY, barWidth, barHeight);

    ctx.restore();
  }

  /**
   * 绘制 HUD：计分（左上）与倒计时（右上）
   * @param {CanvasRenderingContext2D} ctx
   * @private
   */
  _drawHud(ctx) {
    if (!this.physics) return;

    ctx.save();
    ctx.font = 'bold 24px sans-serif';
    ctx.textBaseline = 'top';

    // 计分（左上）
    const score = this.physics.getScore();
    ctx.fillStyle = '#f1f5f9';
    ctx.textAlign = 'left';
    ctx.fillText(`进球 ${score} / 5`, 24, 20);

    // 倒计时（右上）
    const timer = Math.ceil(this.physics.getTimer());
    ctx.textAlign = 'right';
    // 时间不足 10 秒时变红警示
    ctx.fillStyle = timer <= 10 ? '#f87171' : '#f1f5f9';
    ctx.fillText(`${timer}s`, GAME.WIDTH - 24, 20);

    // 操作提示（底部中央，仅在游戏中显示）
    if (this.phase === 'playing') {
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#64748b';
      ctx.fillText('空格 / 按钮按住蓄力，松开出手 · 蓝色虚线为抛物线辅助', GAME.WIDTH / 2, GAME.HEIGHT - 24);
    }

    ctx.restore();
  }

  /**
   * 绘制反馈文本（进球/未中提示）
   * 文本随剩余时间淡出
   * @param {CanvasRenderingContext2D} ctx
   * @private
   */
  _drawFeedback(ctx) {
    if (!this.feedbackText) return;

    // 透明度随剩余时间递减，实现淡出效果
    const alpha = Math.min(1, this.feedbackTimer / 0.5);
    const isScore = this.feedbackText === SCORE_FEEDBACK_TEXT;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = 'bold 32px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // 进球绿色，未中橙色
    ctx.fillStyle = isScore ? '#4ade80' : '#fbbf24';
    ctx.fillText(this.feedbackText, GAME.WIDTH / 2, GAME.HEIGHT * 0.35);
    ctx.restore();
  }
}
