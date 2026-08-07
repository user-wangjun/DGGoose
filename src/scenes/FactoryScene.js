import { GAME, EVENT } from '../config.js';
import { DIALOGUES } from '../data/dialogues.js';
import { ParticleSystem } from '../core/ParticleSystem.js';
import { FactoryPhysics } from '../core/FactoryPhysics.js';

/** 围墙 X 坐标（画布右侧），玩家靠近此位置可触发翻墙 */
const WALL_X = 1080;

/** 玩家靠近围墙的判定阈值（像素），小于此距离视为"在墙边" */
const WALL_PROXIMITY = 130;

/** 玩家初始位置 */
const PLAYER_START_X = 180;
/** 传送带顶面就是这一章的可行走地面，角色脚底锚点与绘制保持一致。 */
const PLAYER_START_Y = GAME.HEIGHT - 160;

/** 翻墙剧情 CG 时长（秒）；只保留一段短而明确的出逃记忆点。 */
const CLIMB_DURATION = 2.6;

/** 翻墙关键姿态出现的区间，前后用常规奔跑帧衔接起跳与落地。 */
const CLIMB_POSE_START = 0.16;
const CLIMB_POSE_END = 0.86;
const CLIMB_POSE_WIDTH = 260;
const CLIMB_POSE_HEIGHT = 260;

/** 资源尚未完成加载时的兼容性占位尺寸；正常绘制使用 GooseSprite */
const PLAYER_SIZE = 48;

/** 角色中心距离墙边的安全半径，防止精灵视觉上穿进墙体。 */
const PLAYER_COLLISION_RADIUS = 30;

/** 角色中心的左侧活动边界，给画面留出可读的安全边距。 */
const PLAYER_LEFT_BOUND = 60;

/** 传送带动画速度（px/s），用于条纹滚动 */
const CONVEYOR_SPEED = 60;

/**
 * 序章场景 · 生产线觉醒（对应 PRD §4.2 序章 + 计划 Task 3.2）
 *
 * 职责分工：
 * - Canvas 层：绘制工厂背景（灰色工业风）、传送带动画、围墙、莞小鹅核心序列帧
 * - DOM 层：依赖 DialogueBox 播放对话并锁定移动
 *
 * 教学引导流程：
 * 1. 进入 → 播放对话前 3 行（引导移动）
 * 2. 对话结束 → 玩家自由移动，向右走向围墙
 * 3. 靠近围墙 → 播放对话第 4-5 行（引导互动）
 * 4. 对话结束 → 玩家按空格翻墙（需在墙边）
 * 5. 翻墙剧情 CG → 播放对话第 6-9 行
 * 6. 对话结束 → 发放印记 factory_cert → 切换到第一章
 */
export class FactoryScene {
  /**
   * @param {Object} deps - 依赖注入
   * @param {SceneManager} deps.sceneManager - 场景管理器
   * @param {EventBus} deps.eventBus - 事件总线
   * @param {BadgeSystem} deps.badgeSystem - 印记系统
   * @param {DialogueRunner} deps.dialogueRunner - 对话运行器
   * @param {DialogueBox} deps.dialogueBox - 对话框 UI
   * @param {InputManager} deps.input - 输入管理器
   * @param {PlayerController} deps.player - 角色控制器
   * @param {HTMLElement} deps.container - UI 挂载容器
   * @param {Function} [deps.getFps] - FPS 获取函数（供粒子系统降级）
   * @param {import('../core/GooseSprite.js').GooseSprite} [deps.gooseSprite] - 莞小鹅序列帧绘制器
   */
  constructor({ sceneManager, eventBus, badgeSystem, dialogueRunner, dialogueBox, input, player, container, getFps, gooseSprite }) {
    this.sceneManager = sceneManager;
    this.eventBus = eventBus;
    this.badgeSystem = badgeSystem;
    this.dialogueRunner = dialogueRunner;
    this.dialogueBox = dialogueBox;
    this.input = input;
    this.player = player;
    this.container = container;
    this.gooseSprite = gooseSprite || null;
    /** FPS 提供函数（供粒子系统降级判断） */
    this.getFps = getFps || (() => 60);

    /** 当前阶段：idle / intro / move / interact_dialogue / interact / climbing / outro / done */
    this.phase = 'idle';
    /** 翻墙动画进度（0~1） */
    this.climbProgress = 0;
    /** 传送带动画累计时间（秒） */
    this.conveyorTime = 0;
    /** 标记是否已触发场景切换，防止重复调用 */
    this.transitioning = false;
    /** 奔跑尘土粒子系统 */
    this.particles = null;
    /** 尘土发射累计计时（秒），控制发射频率 */
    this._dustTimer = 0;
    /** 鹅厂专用侧视物理；其它俯视场景继续使用共享 PlayerController。 */
    this.factoryPhysics = null;

    // 绑定回调，便于 onExit 时精确移除
    this._onDialogueNext = this._onDialogueNext.bind(this);
    this._onAction = this._onAction.bind(this);
  }

  // ==================== 场景生命周期 ====================

  /**
   * 场景进入：初始化状态、设置玩家位置、注册事件、开始序章对话
   */
  onEnter() {
    this.phase = 'intro';
    this.climbProgress = 0;
    this.conveyorTime = 0;
    this.transitioning = false;
    this._dustTimer = 0;

    // 初始化奔跑尘土粒子系统
    this.particles = new ParticleSystem({ getFps: this.getFps });

    // 这一章的 Y 轴是高度：传送带顶面为地面，不能沿 Y 轴自由漂移。
    this.factoryPhysics = new FactoryPhysics({
      groundY: PLAYER_START_Y,
      leftBound: PLAYER_LEFT_BOUND,
      wallX: WALL_X,
      playerRadius: PLAYER_COLLISION_RADIUS,
    });
    this.factoryPhysics.setPosition(PLAYER_START_X, PLAYER_START_Y);

    // 同步共享角色控制器的位置，保持场景切换和现有渲染接口不变。
    this.player.setPosition(PLAYER_START_X, PLAYER_START_Y);

    // 注册对话结束事件，用于阶段推进
    this.eventBus.on(EVENT.DIALOGUE_NEXT, this._onDialogueNext);
    // 注册动作事件，用于检测空格翻墙
    this.input.onAction(this._onAction);

    // 播放序章前 3 行对话（引导移动）
    this.dialogueBox.show(DIALOGUES.prologue.slice(0, 3));
  }

  /**
   * 每帧更新：推进对话逐字、处理阶段逻辑（移动/翻墙动画）
   * @param {number} deltaTime - 帧间隔（秒）
   */
  update(deltaTime) {
    // 始终推进对话框逐字显示（对话不可见时为空操作）
    this.dialogueBox.update(deltaTime);

    // 累计传送带动画时间
    this.conveyorTime += deltaTime;

    // 翻墙动画阶段：推进进度，到达 1 时触发翻墙完成
    if (this.phase === 'climbing') {
      this.climbProgress += deltaTime / CLIMB_DURATION;
      if (this.climbProgress >= 1) {
        this.climbProgress = 1;
        this._onClimbComplete();
      }
      this._updateGooseSprite(deltaTime);
      return;
    }

    // 移动阶段：更新角色位置，检测围墙靠近
    if (this.phase === 'move') {
      this._updateFactoryPhysics(deltaTime);
      // 奔跑时发射尘土粒子（对应 PRD §7.7 奔跑尘土）
      if (this.particles && this.factoryPhysics?.animState === 'run' && this.factoryPhysics.isGrounded) {
        this._dustTimer += deltaTime;
        if (this._dustTimer >= 0.08) {
          this._dustTimer = 0;
          this.particles.emit(this.player.x, this.player.y + 4, 'dust');
        }
      }
      // 靠近围墙时触发互动引导对话
      if (this.factoryPhysics?.isGrounded && this.player.x >= WALL_X - WALL_PROXIMITY) {
        this._startInteractDialogue();
      }
    }

    // 互动阶段：允许玩家微调位置
    if (this.phase === 'interact') {
      this._updateFactoryPhysics(deltaTime);
    }

    this._updateGooseSprite(deltaTime);

    // 更新粒子系统
    if (this.particles) this.particles.update(deltaTime);
  }

  /**
   * Canvas 渲染：工厂背景 + 传送带 + 围墙 + 角色
   * @param {CanvasRenderingContext2D} ctx
   */
  draw(ctx) {
    if (!ctx) return;
    this._drawBackground(ctx);
    this._drawConveyorBelt(ctx);
    this._drawWall(ctx);
    this._drawClimbCinematic(ctx);
    this._drawPlayer(ctx);
    // 尘土粒子渲染在角色之上
    if (this.particles) this.particles.draw(ctx);
  }

  /**
   * 场景退出：移除事件监听、隐藏对话框、重置状态
   */
  onExit() {
    this.eventBus.off(EVENT.DIALOGUE_NEXT, this._onDialogueNext);
    this.input.offAction(this._onAction);
    if (this.dialogueBox) {
      this.dialogueBox.hide();
    }
    // 清理粒子系统
    if (this.particles) {
      this.particles.clear();
      this.particles = null;
    }
    this.factoryPhysics = null;
    this.phase = 'idle';
    this.transitioning = false;
  }

  // ==================== 对话阶段处理 ====================

  /**
   * 对话推进事件处理：仅在整段对话结束时推进阶段
   * @param {Object} data - 事件数据，finished 为 true 表示对话全部结束
   * @private
   */
  _onDialogueNext(data) {
    if (!data || !data.finished) return;

    if (this.phase === 'intro') {
      // 前 3 行对话结束 → 解锁移动
      this.phase = 'move';
      return;
    }

    if (this.phase === 'interact_dialogue') {
      // 第 4-5 行对话结束 → 解锁互动
      this.phase = 'interact';
      return;
    }

    if (this.phase === 'outro') {
      // 第 6-9 行对话结束 → 发放印记 → 切场景
      this._onOutroComplete();
      return;
    }
  }

  /**
   * 开始互动引导对话（第 4-5 行）
   * @private
   */
  _startInteractDialogue() {
    this.phase = 'interact_dialogue';
    this.dialogueBox.show(DIALOGUES.prologue.slice(3, 5));
  }

  // ==================== 翻墙交互 ====================

  /**
   * 动作事件处理：互动阶段按空格且靠近围墙时触发翻墙
   * @param {string} action - 动作名（interact / pause）
   * @private
   */
  _onAction(action) {
    if (action !== 'interact') return;

    // 翻墙 CG 播放到中段后允许空格/点击跳过，避免剧情过场阻断移动节奏。
    if (this.phase === 'climbing') {
      if (this.climbProgress > 0.28) {
        this.climbProgress = 1;
        this._onClimbComplete();
      }
      return;
    }

    if (this.phase !== 'interact') return;
    // 仅在围墙附近允许翻墙
    if (this.factoryPhysics?.isGrounded && this.player.x >= WALL_X - WALL_PROXIMITY) {
      this._startClimb();
    }
  }

  /**
   * 开始翻墙动画
   * @private
   */
  _startClimb() {
    this.phase = 'climbing';
    this.climbProgress = 0;
    this.eventBus.emit(EVENT.SFX_PLAY, { name: 'jump' });
  }

  /**
   * 翻墙动画完成：播放翻墙后对话（第 6-9 行）
   * @private
   */
  _onClimbComplete() {
    this.phase = 'outro';
    this.dialogueBox.show(DIALOGUES.prologue.slice(5, 9));
  }

  /**
   * 尾声对话完成：发放印记并切换到第一章
   * @private
   */
  _onOutroComplete() {
    if (this.transitioning) return;
    this.transitioning = true;
    this.badgeSystem.unlock('factory_cert');
    // 广播章节完成，触发自动存档
    this.eventBus.emit(EVENT.CHAPTER_COMPLETE, { chapter: 'prologue' });
    this.sceneManager.change('ch1');
  }

  /**
   * 用鹅厂物理推进角色，再把结果同步给共享 PlayerController。
   * 共享控制器保留给其它场景使用，这里只借它的朝向和动画状态接口。
   * @param {number} deltaTime - 帧间隔（秒）
   * @private
   */
  _updateFactoryPhysics(deltaTime) {
    if (!this.factoryPhysics) return;

    const state = this.factoryPhysics.update(deltaTime, this.input);
    this.player.setPosition(state.x, state.y);
    this.player.update(0, {
      getVector: () => ({
        x: Math.sign(state.velocity.x),
        y: 0,
        run: state.animState === 'run',
      }),
    });
  }

  /** 让序列帧绘制器读取物理层的动画和朝向，避免出现位置与动作不同步。 */
  _updateGooseSprite(deltaTime) {
    if (!this.gooseSprite) return;

    const spriteState = this.phase === 'climbing'
      ? 'run'
      : this.factoryPhysics?.animState || this.player.animState;
    const facing = this.factoryPhysics?.facing || this.player.facing;
    this.gooseSprite.update(deltaTime, spriteState, facing);
  }

  // ==================== Canvas 绘制 ====================

  /**
   * 绘制工厂背景：灰色工业风渐变 + 地面 + 管道装饰
   * @param {CanvasRenderingContext2D} ctx
   * @private
   */
  _drawBackground(ctx) {
    // 渐变背景（上深下浅，营造工厂纵深）
    const gradient = ctx.createLinearGradient(0, 0, 0, GAME.HEIGHT);
    gradient.addColorStop(0, '#2a2a2a');
    gradient.addColorStop(0.6, '#333333');
    gradient.addColorStop(1, '#1a1a1a');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, GAME.WIDTH, GAME.HEIGHT);

    // 远景管道装饰
    ctx.fillStyle = '#3a3a3a';
    ctx.fillRect(0, 80, GAME.WIDTH, 20);
    ctx.fillRect(0, 140, GAME.WIDTH, 12);

    // 地面
    ctx.fillStyle = '#3c3c3c';
    ctx.fillRect(0, GAME.HEIGHT - 100, GAME.WIDTH, 100);

    // 地面纹理线
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    for (let x = 0; x < GAME.WIDTH; x += 80) {
      ctx.beginPath();
      ctx.moveTo(x, GAME.HEIGHT - 100);
      ctx.lineTo(x, GAME.HEIGHT);
      ctx.stroke();
    }
  }

  /**
   * 绘制传送带：滚动的条纹动画占位
   * @param {CanvasRenderingContext2D} ctx
   * @private
   */
  _drawConveyorBelt(ctx) {
    const beltY = GAME.HEIGHT - 160;
    const beltHeight = 36;

    // 传送带主体
    ctx.fillStyle = '#4a4a4a';
    ctx.fillRect(0, beltY, GAME.WIDTH, beltHeight);

    // 滚动条纹（随时间向右移动）
    const offset = (this.conveyorTime * CONVEYOR_SPEED) % 40;
    ctx.fillStyle = '#5a5a5a';
    for (let x = -40; x < GAME.WIDTH; x += 40) {
      ctx.fillRect(x + offset, beltY + 4, 20, beltHeight - 8);
    }

    // 传送带支架
    ctx.fillStyle = '#2a2a2a';
    for (let x = 80; x < GAME.WIDTH; x += 200) {
      ctx.fillRect(x, beltY + beltHeight, 8, 60);
    }

    // 传送带滚轮
    ctx.fillStyle = '#555';
    ctx.beginPath();
    ctx.arc(20, beltY + beltHeight / 2, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(GAME.WIDTH - 20, beltY + beltHeight / 2, 14, 0, Math.PI * 2);
    ctx.fill();
  }

  /**
   * 绘制围墙：右侧灰色墙体 + "出厂合格"标识
   * @param {CanvasRenderingContext2D} ctx
   * @private
   */
  _drawWall(ctx) {
    const wallX = WALL_X;
    const wallY = GAME.HEIGHT - 260;
    const wallW = 36;
    const wallH = 180;

    // 墙体
    ctx.fillStyle = '#666';
    ctx.fillRect(wallX, wallY, wallW, wallH);

    // 墙顶凸缘
    ctx.fillStyle = '#777';
    ctx.fillRect(wallX - 4, wallY, wallW + 8, 8);

    // 墙体砖纹
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 1;
    for (let y = wallY + 20; y < wallY + wallH; y += 25) {
      ctx.beginPath();
      ctx.moveTo(wallX, y);
      ctx.lineTo(wallX + wallW, y);
      ctx.stroke();
    }

    // "出厂合格"标识牌（互动阶段显示提示）
    if (this.phase === 'interact' || this.phase === 'interact_dialogue') {
      ctx.save();
      ctx.fillStyle = '#fbbf24';
      ctx.font = 'bold 13px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('出厂合格', wallX + wallW / 2, wallY - 12);
      ctx.restore();
    }
  }

  /**
   * 绘制翻墙剧情 CG 的镜头遮罩。
   * 背景保持工厂场景，动的只有莞小鹅；黑边和暖光负责把普通玩法切成剧情瞬间。
   * @param {CanvasRenderingContext2D} ctx
   * @private
   */
  _drawClimbCinematic(ctx) {
    if (this.phase !== 'climbing') return;

    const t = this.climbProgress;
    const edgeFade = Math.min(1, t / 0.12, (1 - t) / 0.14);
    const vignette = ctx.createRadialGradient(WALL_X - 20, GAME.HEIGHT - 320, 50, WALL_X - 20, GAME.HEIGHT - 320, 460);
    vignette.addColorStop(0, `rgba(251, 191, 36, ${0.12 * edgeFade})`);
    vignette.addColorStop(1, `rgba(15, 23, 42, ${0.28 * edgeFade})`);

    ctx.save();
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, GAME.WIDTH, GAME.HEIGHT);
    ctx.fillStyle = `rgba(8, 12, 24, ${0.82 * edgeFade})`;
    ctx.fillRect(0, 0, GAME.WIDTH, 42);
    ctx.fillRect(0, GAME.HEIGHT - 42, GAME.WIDTH, 42);
    ctx.restore();
  }

  /**
   * 绘制莞小鹅角色：常规帧负责助跑/落地，专用关键姿态负责越墙。
   * @param {CanvasRenderingContext2D} ctx
   * @private
   */
  _drawPlayer(ctx) {
    // 对话期间用独立立绘承担角色表现，隐藏场景内的小角色，避免两套形象重叠。
    if (this.dialogueBox?.visible) return;

    let drawX = this.player.x;
    let drawY = this.player.y;

    // 翻墙剧情 CG：沿抛物线越过围墙。
    if (this.phase === 'climbing') {
      const t = this.climbProgress;
      const startX = this.player.x;
      const endX = WALL_X + 70;
      drawX = startX + (endX - startX) * t;
      // 垂直方向：正弦曲线模拟翻越弧线。
      const peakY = GAME.HEIGHT - 315;
      drawY = this.player.y + (peakY - this.player.y) * Math.sin(t * Math.PI);
    }

    // 保留落地点阴影，让越墙高度有参照，不会像俯视图那样漂浮。
    this._drawPlayerShadow(ctx, drawX, drawY);

    // 过场中段使用专用翻墙姿态；资源未加载时回退到放大的奔跑帧。
    const isClimbPoseWindow = this.phase === 'climbing'
      && this.climbProgress >= CLIMB_POSE_START
      && this.climbProgress <= CLIMB_POSE_END;
    const actionDrawn = isClimbPoseWindow && this.gooseSprite?.drawAction(ctx, 'climb', drawX, drawY, {
      width: CLIMB_POSE_WIDTH,
      height: CLIMB_POSE_HEIGHT,
      flipX: this.player.facing < 0,
    });

    const spriteDrawn = actionDrawn || (this.gooseSprite?.draw(ctx, drawX, drawY, {
      width: this.phase === 'climbing' ? 150 : undefined,
      height: this.phase === 'climbing' ? 150 : undefined,
    }) ?? false);
    if (!spriteDrawn) {
      const halfSize = PLAYER_SIZE / 2;
      ctx.save();
      ctx.fillStyle = '#d97706';
      ctx.fillRect(drawX - halfSize, drawY - halfSize, PLAYER_SIZE, PLAYER_SIZE);
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 2;
      ctx.strokeRect(drawX - halfSize, drawY - halfSize, PLAYER_SIZE, PLAYER_SIZE);
      ctx.fillStyle = '#1a1a2e';
      const eyeOffset = this.player.facing === 1 ? 5 : -5;
      ctx.fillRect(drawX + eyeOffset - 6, drawY - 14, 5, 5);
      ctx.fillRect(drawX + eyeOffset + 4, drawY - 14, 5, 5);
      ctx.restore();
    }

    const halfSize = PLAYER_SIZE / 2;
    const characterTopOffset = this.gooseSprite?.height
      ? this.gooseSprite.height * 0.92
      : halfSize;

    // 互动提示（靠近围墙且处于互动阶段时显示）
    if (this.phase === 'interact' && this.player.x >= WALL_X - WALL_PROXIMITY) {
      ctx.save();
      ctx.fillStyle = 'rgba(251, 191, 36, 0.9)';
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('按空格翻墙', drawX, drawY - characterTopOffset - 12);
      ctx.restore();
    }

    // 移动提示（移动阶段显示方向指引）
    if (this.phase === 'move' && this.player.x < WALL_X - WALL_PROXIMITY) {
      ctx.save();
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.font = '13px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('A/D 或 ←/→ 移动 · W/↑ 跳跃', drawX, drawY - characterTopOffset - 12);
      ctx.restore();
    }
  }

  /**
   * 绘制与地面高度绑定的角色阴影。
   * 阴影只表达垂直高度，不参与碰撞，避免把视觉效果混进物理规则。
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} x
   * @param {number} y
   * @private
   */
  _drawPlayerShadow(ctx, x, y) {
    const groundY = PLAYER_START_Y;
    const height = Math.max(0, groundY - y);
    const scale = Math.max(0.45, 1 - height / 220);

    ctx.save();
    ctx.globalAlpha = Math.max(0.08, 0.26 - height / 900);
    ctx.fillStyle = '#111827';
    ctx.beginPath();
    ctx.ellipse(x, groundY + 5, 31 * scale, 8 * scale, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}
