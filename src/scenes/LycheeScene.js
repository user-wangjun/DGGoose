import { GAME, EVENT } from '../config.js';
import { DIALOGUES } from '../data/dialogues.js';
import { TopdownController } from '../core/TopdownController.js';
import { drawSceneObjects, loadSceneObjectAssets } from '../core/SceneObjectRenderer.js';
import { SCENE_OBJECT_ASSETS } from '../data/sceneObjectAssets.js';
import { sortBySortY } from '../core/SceneLayout.js';
import { Toast } from '../ui/Toast.js';
import { ChoiceOverlay } from '../ui/ChoiceOverlay.js';

/** 保留原有谜题答案：玩家需要按 3→1→4→2 摘取。 */
export const LYCHEE_SEQUENCE = [3, 1, 4, 2];

const LYCHEE_BACKGROUND_URL = new URL('../../assets/bg/scene-02-lychee-orchard/scene-02-map.png', import.meta.url).href;
// 原底图包含关门；开门状态切到仅清理出口区域的对应底图，避免与透明开门贴图叠出第二扇门。
const LYCHEE_OPEN_BACKGROUND_URL = new URL('../../assets/bg/scene-02-lychee-orchard/scene-02-map-open.png', import.meta.url).href;
const GATE_OPEN_DURATION = 1;
const HARVEST_FEEDBACK_DURATION = 0.45;
const PLAYER_START = { x: 150, y: 610 };
// 碰撞只取鹅的脚底 footprint，避免点击移动时在树干下角被卡住。
const PLAYER_RADIUS = 16;
const GATE = { x: 1110, y: 112, width: 136, height: 96 };
const EXIT = { x: 1188, y: 158, radius: 82 };
const SIGN = { x: 152, y: 316, radius: 68 };
const GRANDMA = { x: 220, y: 396, radius: 88 };
const WORK_AREA = { x: 22, y: 142, width: 188, height: 172 };

/**
 * 五棵树使用正式地图坐标，互动点和树干碰撞分离，玩家可以绕树移动。
 */
export const LYCHEE_TREES = [
  { id: 'tree-1', label: '1', x: 300, y: 188, visual: { x: 300, y: 248, width: 190, height: 210, anchorY: 0.98, bakedIn: true }, solidFootprint: { x: 277, y: 196, width: 46, height: 52 }, interaction: { x: 300, y: 188, radius: 96 } },
  { id: 'tree-2', label: '2', x: 586, y: 492, visual: { x: 586, y: 552, width: 190, height: 210, anchorY: 0.98, bakedIn: true }, solidFootprint: { x: 563, y: 500, width: 46, height: 52 }, interaction: { x: 586, y: 492, radius: 96 } },
  { id: 'tree-3', label: '3', x: 650, y: 188, visual: { x: 650, y: 248, width: 190, height: 210, anchorY: 0.98, bakedIn: true }, solidFootprint: { x: 627, y: 196, width: 46, height: 52 }, interaction: { x: 650, y: 188, radius: 96 } },
  { id: 'tree-4', label: '4', x: 964, y: 492, visual: { x: 964, y: 552, width: 190, height: 210, anchorY: 0.98, bakedIn: true }, solidFootprint: { x: 941, y: 500, width: 46, height: 52 }, interaction: { x: 964, y: 492, radius: 96 } },
  { id: 'tree-5', label: '5', x: 970, y: 188, visual: { x: 970, y: 248, width: 190, height: 210, anchorY: 0.98, bakedIn: true }, solidFootprint: { x: 947, y: 196, width: 46, height: 52 }, interaction: { x: 970, y: 188, radius: 96 } },
];

const CHOICE_CONFIG = {
  sceneId: 'ch2',
  nextChapter: 'ch3',
  title: '阿婆笑眯眯地看着你',
  stayLabel: '留下种荔枝',
  continueLabel: '继续探寻',
};

/**
 * 第二章·荔枝园。
 * 先与老婆婆交谈，再在同一张俯视果园中自由移动、主动摘取并回去交付。
 */
export class LycheeScene {
  constructor({ sceneManager, eventBus, badgeSystem, dialogueRunner, dialogueBox, input, player, container, assetLoader = null, getChoice, gooseSprite, farmerSprite = null }) {
    this.sceneManager = sceneManager;
    this.eventBus = eventBus;
    this.badgeSystem = badgeSystem;
    this.dialogueRunner = dialogueRunner;
    this.dialogueBox = dialogueBox;
    this.input = input;
    this.player = player;
    this.container = container;
    this.assetLoader = assetLoader;
    this.gooseSprite = gooseSprite || null;
    this.farmerSprite = farmerSprite;
    this.getChoice = getChoice || (() => null);

    this.phase = 'idle';
    this.harvested = new Set();
    this.harvestStep = 0;
    this.gateProgress = 0;
    this.exitOpen = false;
    this.animTime = 0;
    this.feedbackTimer = 0;
    this.transitioning = false;
    this.feedbackTimerId = null;
    this.toast = null;
    this.choiceOverlay = null;
    this.topdown = null;
    this.backgroundImage = null;
    this.openBackgroundImage = null;
    this.backgroundPromise = null;
    this.objectImages = new Map();
    this.objectAssetsPromise = null;

    this._onDialogueNext = this._onDialogueNext.bind(this);
    this._onChoiceStay = this._onChoiceStay.bind(this);
    this._onChoiceContinue = this._onChoiceContinue.bind(this);
    this._onInteract = this._onInteract.bind(this);
  }

  /** 初始化地图、共享交互控制器和开场对话。 */
  onEnter(params = {}) {
    this.phase = 'intro';
    this.harvested = new Set();
    this.harvestStep = 0;
    this.gateProgress = 0;
    this.exitOpen = false;
    this.animTime = 0;
    this.feedbackTimer = 0;
    this.transitioning = false;
    this.feedbackTimerId = null;

    this.player.setPosition(PLAYER_START.x, PLAYER_START.y);
    this._loadBackground();
    this._loadSceneObjects();
    this.toast = new Toast({ container: this.container, duration: 2200 });
    this.topdown = new TopdownController({
      player: this.player,
      input: this.input,
      container: this.container,
      onInteract: this._onInteract,
      title: '第二章 · 荔枝园',
      objective: '先与老婆婆交谈，听取摘荔枝要求',
    });
    this.topdown.setMap({
      bounds: { left: 38, top: 92, right: 1242, bottom: 672 },
      obstacles: this._getObstacles(),
      interactables: this._getInteractables(),
      playerRadius: PLAYER_RADIUS,
    });
    this.topdown.mount();
    this.topdown.setProgress('荔枝 0 / 4');
    this.topdown.setExitStatus('出口：栅栏关闭');
    this.topdown.setMovementLocked(true);
    this.topdown.setInteractionEnabled(false);

    this.eventBus.on(EVENT.DIALOGUE_NEXT, this._onDialogueNext);
    this.eventBus.on(EVENT.CHOICE_STAY, this._onChoiceStay);
    this.eventBus.on(EVENT.CHOICE_CONTINUE, this._onChoiceContinue);
    this.farmerSprite?.playAction('interact', { facing: 1, restart: true });
    this.dialogueBox.show(DIALOGUES.ch2.slice(0, 4));
    if (params?.restore) this._restoreSaveState(params.restore);
  }

  /** 返回果园解谜、开门动画、角色位置和当前对话的完整快照。 */
  getSaveState() {
    return {
      phase: this.phase,
      harvested: [...this.harvested],
      harvestStep: this.harvestStep,
      gateProgress: this.gateProgress,
      exitOpen: this.exitOpen,
      feedbackTimer: this.feedbackTimer,
      transitioning: this.transitioning,
      player: this.player?.getSaveState?.() || this.player?.position || null,
      topdown: this.topdown?.getSaveState?.() || null,
      dialogue: this.dialogueBox?.getSaveState?.() || null,
    };
  }

  /** 恢复果园阶段；摘取反馈的剩余时间从快照继续倒计时。 */
  _restoreSaveState(state) {
    if (!state || typeof state !== 'object') return;
    this.phase = typeof state.phase === 'string' ? state.phase : 'intro';
    this.harvested = new Set(Array.isArray(state.harvested) ? state.harvested : []);
    this.harvestStep = Number.isInteger(state.harvestStep) ? Math.max(0, state.harvestStep) : this.harvested.size;
    this.gateProgress = Number.isFinite(state.gateProgress) ? Math.max(0, Math.min(1, state.gateProgress)) : 0;
    this.exitOpen = Boolean(state.exitOpen);
    this.feedbackTimer = Number.isFinite(state.feedbackTimer) ? Math.max(0, state.feedbackTimer) : 0;
    this.transitioning = Boolean(state.transitioning);

    this.player?.restoreSaveState?.(state.player);
    if (state.player && !this.player?.restoreSaveState) {
      this.player?.setPosition?.(state.player.x, state.player.y);
    }

    this.topdown?.setMap({
      obstacles: this._getObstacles(),
      interactables: this._getInteractables(),
    });
    this._syncRestoredPhase();
    if (state.topdown) this.topdown?.restoreSaveState?.(state.topdown);

    if (this.phase === 'harvesting' && this.feedbackTimer > 0) {
      this.feedbackTimerId = setTimeout(() => {
        this.feedbackTimerId = null;
        this._finishHarvestFeedback();
      }, this.feedbackTimer * 1000);
    }
    if (this.phase === 'choice') this._showChoice();
    if (state.dialogue) {
      this.dialogueBox?.restoreSaveState?.(state.dialogue);
    } else {
      this.dialogueBox?.hide?.();
    }
  }

  /** 根据保存的阶段恢复任务 HUD 和可移动/互动开关。 */
  _syncRestoredPhase() {
    if (!this.topdown) return;
    this.topdown.setSceneInfo('第二章 · 荔枝园', '按顺序找到目标树，靠近后主动摘取');
    this.topdown.setProgress(`荔枝 ${this.harvested.size} / 4`);
    this.topdown.setExitStatus(this.exitOpen ? '出口：已打开' : '出口：栅栏关闭');
    const canMove = ['explore', 'deliveryReady', 'exitReady'].includes(this.phase);
    this.topdown.setMovementLocked(!canMove);
    this.topdown.setInteractionEnabled(canMove);
    if (this.phase === 'deliveryReady') {
      this.topdown.setSceneInfo('第二章 · 荔枝园', '集齐荔枝，回到老婆婆处主动交付');
      this.topdown.setProgress('荔枝 4 / 4 · 请交给老婆婆');
    } else if (this.phase === 'exitReady') {
      this.topdown.setSceneInfo('第二章 · 荔枝园', '栅栏已打开，走到右侧出口继续前行');
      this.topdown.setProgress('荔枝 4 / 4 · 已交付');
    } else if (this.phase === 'harvesting') {
      this.topdown.setMovementLocked(true);
      this.topdown.setProgress(`荔枝 ${this.harvested.size} / 4 · 正在摘取`);
    } else if (this.phase === 'gateOpening') {
      this.topdown.setMovementLocked(true);
      this.topdown.setProgress('荔枝 4 / 4 · 栅栏开启中');
    }
  }

  /** 推进对话、摘取反馈和栅栏开启动画。 */
  update(deltaTime) {
    this.animTime += deltaTime;
    this.dialogueBox.update(deltaTime);

    if (this.topdown && ['explore', 'deliveryReady', 'exitReady'].includes(this.phase)) {
      this.topdown.update(deltaTime);
    }
    if (this.gooseSprite) {
      this.gooseSprite.update(deltaTime, this.player.animState, this.player.facing);
    }
    this.farmerSprite?.update(deltaTime, 'idle', 1);

    if (this.feedbackTimer > 0) {
      this.feedbackTimer = Math.max(0, this.feedbackTimer - deltaTime);
    }
    if (this.phase === 'gateOpening') {
      this.gateProgress = Math.min(1, this.gateProgress + deltaTime / GATE_OPEN_DURATION);
      if (this.gateProgress >= 1) this._onGateOpened();
    }
  }

  /** 绘制正式果园背景，动态角色与互动标记仍由运行时单独叠加。 */
  draw(ctx) {
    if (!ctx) return;
    this._drawMap(ctx);
    this._drawSceneObjects(ctx);
    const actors = sortBySortY([
      this.farmerSprite ? { sortY: GRANDMA.y, draw: () => this._drawFarmer(ctx) } : null,
      // DialogueBox 的莞小鹅立绘已承担角色表现；对话关闭后下一帧立即恢复场内角色。
      !this.dialogueBox?.visible && this.topdown?.player
        ? { sortY: this.topdown.player.y, draw: () => this.topdown.drawPlayer(ctx, this.gooseSprite) }
        : null,
    ].filter(Boolean));
    actors.forEach((actor) => actor.draw());
    // 互动标签是 UI 覆盖层，最后绘制，不改变树木/玩家的遮挡关系。
    this.topdown?.drawInteractables(ctx, this.animTime);
    if (this.feedbackTimer > 0) this._drawFeedback(ctx);
    this.topdown?.drawDebug(ctx, {
      spawn: PLAYER_START,
      exits: [{ id: 'exit', ...EXIT }],
    });
  }

  /** 清理共享控制器、事件、Toast 和剧情覆盖层。 */
  onExit() {
    this.eventBus.off(EVENT.DIALOGUE_NEXT, this._onDialogueNext);
    this.eventBus.off(EVENT.CHOICE_STAY, this._onChoiceStay);
    this.eventBus.off(EVENT.CHOICE_CONTINUE, this._onChoiceContinue);
    if (this.feedbackTimerId) clearTimeout(this.feedbackTimerId);
    this.feedbackTimerId = null;
    this.topdown?.destroy();
    this.topdown = null;
    this.objectAssetsPromise = null;
    this.objectImages = new Map();
    this.toast?.destroy();
    this.toast = null;
    this.farmerSprite?.clearAction();
    this._hideChoiceOverlay();
    this.dialogueBox?.hide();
    this.phase = 'idle';
    this.transitioning = false;
  }

  /** 根据对话所处阶段进入探索或开门动画。 */
  _onDialogueNext(data) {
    if (!data?.finished) return;
    if (this.phase === 'intro') {
      this._startExploration();
    } else if (this.phase === 'outro') {
      this._startGateOpening();
    }
  }

  /** 开始俯视自由移动阶段。 */
  _startExploration() {
    this.phase = 'explore';
    this.topdown.setSceneInfo('第二章 · 荔枝园', '按顺序找到目标树，靠近后主动摘取');
    this.topdown.setMovementLocked(false);
    this.topdown.setInteractionEnabled(true);
    this.topdown.setProgress(`荔枝 ${this.harvested.size} / 4 · 下一棵：${LYCHEE_SEQUENCE[this.harvestStep]}`);
    this.topdown.setExitStatus('出口：栅栏关闭');
  }

  /** 统一处理老婆婆、指示牌、树和出口的主动互动。 */
  _onInteract(target) {
    this.gooseSprite?.playAction('interact', { facing: this.player.facing });
    if (target.id === 'grandma') {
      this.farmerSprite?.playAction('interact', { facing: 1, restart: true });
      this._onGrandmaInteract();
      return;
    }
    if (target.id === 'sign') {
      this.toast?.show('摘取顺序：3 → 1 → 4 → 2。摘错不会清空已完成进度。');
      return;
    }
    if (target.isTree) {
      this._onTreeInteract(target);
      return;
    }
    if (target.isExit) this._onExitInteract();
  }

  /** 处理树木摘取：错误只提示，正确推进已有进度。 */
  _onTreeInteract(tree) {
    if (this.phase !== 'explore' || this.harvested.has(tree.id)) return;
    const expected = LYCHEE_SEQUENCE[this.harvestStep];
    const selected = Number(tree.label);
    if (selected !== expected) {
      this.eventBus.emit(EVENT.SFX_PLAY, { name: 'error' });
      this.toast?.show(`这不是老婆婆要的第 ${expected} 棵，已摘进度不会清空。`);
      return;
    }

    this.phase = 'harvesting';
    this.harvested.add(tree.id);
    this.harvestStep += 1;
    this.farmerSprite?.playAction('lychee', { facing: 1, restart: true });
    this.feedbackTimer = HARVEST_FEEDBACK_DURATION;
    this.topdown.setMovementLocked(true);
    this.eventBus.emit(EVENT.SFX_PLAY, { name: 'collect' });
    this.toast?.show(`摘对了！荔枝 ${this.harvested.size} / 4`);

    this.feedbackTimerId = setTimeout(() => {
      this.feedbackTimerId = null;
      this._finishHarvestFeedback();
    }, HARVEST_FEEDBACK_DURATION * 1000);
  }

  _finishHarvestFeedback() {
    if (this.phase !== 'harvesting') return;
    if (this.harvested.size >= LYCHEE_SEQUENCE.length) {
      this.phase = 'deliveryReady';
      this.topdown.setSceneInfo('第二章 · 荔枝园', '集齐荔枝，回到老婆婆处主动交付');
      this.topdown.setProgress('荔枝 4 / 4 · 请交给老婆婆');
    } else {
      this.phase = 'explore';
      this.topdown.setSceneInfo('第二章 · 荔枝园', '按顺序找到目标树，靠近后主动摘取');
      this.topdown.setProgress(`荔枝 ${this.harvested.size} / 4 · 下一棵：${LYCHEE_SEQUENCE[this.harvestStep]}`);
    }
    this.topdown.setMovementLocked(false);
  }

  /** 只有集齐后才能从老婆婆处触发交付对话。 */
  _onGrandmaInteract() {
    if (this.phase !== 'deliveryReady') {
      this.toast?.show('先按老婆婆说的顺序摘齐 4 串荔枝，再回来交给她。');
      return;
    }
    this.phase = 'outro';
    this.topdown.setMovementLocked(true);
    this.topdown.setInteractionEnabled(false);
    this.dialogueBox.show(DIALOGUES.ch2.slice(5, 9));
  }

  /** 对话完成后才打开栅栏。 */
  _startGateOpening() {
    this.phase = 'gateOpening';
    this.gateProgress = 0;
    this.topdown.setMovementLocked(true);
    this.eventBus.emit(EVENT.SFX_PLAY, { name: 'gate' });
  }

  /** 栅栏打开后才启用出口目标。 */
  _onGateOpened() {
    if (this.phase !== 'gateOpening') return;
    this.phase = 'exitReady';
    this.exitOpen = true;
    this.topdown.setMap({ obstacles: this._getObstacles() });
    this.topdown.setSceneInfo('第二章 · 荔枝园', '栅栏已打开，走到出口继续前行');
    this.topdown.setProgress('荔枝 4 / 4 · 已交付');
    this.topdown.setExitStatus('出口：已打开');
    this.topdown.setMovementLocked(false);
    this.topdown.setInteractionEnabled(true);
    this.toast?.show('栅栏打开了！走到右侧出口继续前行。');
  }

  /** 走到出口后才发放印记并进入原有章节抉择。 */
  _onExitInteract() {
    if (this.phase !== 'exitReady' || !this.exitOpen || this.transitioning) return;
    this.transitioning = true;
    this.phase = 'choice';
    this.topdown.setMovementLocked(true);
    this.topdown.setInteractionEnabled(false);
    this.badgeSystem.unlockOrReveal('lychee');
    this.eventBus.emit(EVENT.CHAPTER_COMPLETE, { chapter: 'ch2' });
    this._showChoice();
  }

  _showChoice() {
    this.dialogueBox?.hide();
    this.choiceOverlay = new ChoiceOverlay({ eventBus: this.eventBus, container: this.container });
    this.choiceOverlay.show({
      title: CHOICE_CONFIG.title,
      stayLabel: CHOICE_CONFIG.stayLabel,
      continueLabel: CHOICE_CONFIG.continueLabel,
      stayDisabled: this.getChoice() !== null && this.getChoice() !== undefined,
      sceneId: CHOICE_CONFIG.sceneId,
    });
  }

  _onChoiceStay(data) {
    if (!this.choiceOverlay || data?.sceneId !== CHOICE_CONFIG.sceneId) return;
    this._advanceToNextScene();
  }

  _onChoiceContinue(data) {
    if (!this.choiceOverlay || data?.sceneId !== CHOICE_CONFIG.sceneId) return;
    this._advanceToNextScene();
  }

  _advanceToNextScene() {
    if (!this.transitioning) return;
    this._hideChoiceOverlay();
    this.sceneManager.change(CHOICE_CONFIG.nextChapter);
  }

  _hideChoiceOverlay() {
    this.choiceOverlay?.hide();
    this.choiceOverlay = null;
  }

  /** 共享碰撞层只描述真正不可穿越的实体，互动点始终独立于 solid 矩形。 */
  _getObstacles() {
    const obstacles = [
      { id: 'fence-left', solid: true, x: 22, y: 88, width: 18, height: 548 },
      { id: 'fence-top', solid: true, x: 206, y: 88, width: 1018, height: 18 },
      { id: 'fence-right-top', solid: true, x: 1228, y: 88, width: 18, height: 34 },
      { id: 'fence-right-bottom', solid: true, x: 1228, y: 204, width: 18, height: 446 },
      { id: 'fence-bottom', solid: true, x: 318, y: 650, width: 908, height: 18 },
      { id: 'work-area', solid: true, ...WORK_AREA },
      ...LYCHEE_TREES.map((tree) => ({
        id: `tree-trunk-${tree.label}`,
        solid: true,
        ...tree.solidFootprint,
      })),
    ];

    if (!this.exitOpen) {
      obstacles.push({ id: 'exit-gate', solid: true, ...GATE });
    }
    return obstacles;
  }

  _getInteractables() {
    return [
      ...LYCHEE_TREES.map((tree) => ({
        ...tree,
        ...tree.interaction,
        isTree: true,
        zoneType: 'interaction',
        markerLabel: `荔枝树 ${tree.label}`,
        actionLabel: '摘取',
        hideMarker: true,
        available: () => this.phase === 'explore' && !this.harvested.has(tree.id),
      })),
      {
        id: 'grandma',
        ...GRANDMA,
        zoneType: 'interaction',
        label: '老婆婆',
        markerLabel: '老婆婆',
        actionLabel: () => (this.phase === 'deliveryReady' ? '交付' : '交谈'),
        isCharacter: true,
        characterLabelOffset: 112,
        available: () => ['explore', 'deliveryReady'].includes(this.phase),
      },
      {
        id: 'sign',
        ...SIGN,
        zoneType: 'interaction',
        label: '指示牌',
        markerLabel: '顺序提示',
        actionLabel: '查看',
        available: () => ['explore', 'deliveryReady'].includes(this.phase),
      },
      {
        id: 'exit',
        ...EXIT,
        zoneType: 'interaction',
        isExit: true,
        label: '果园出口',
        markerLabel: '出口',
        actionLabel: '离开',
        hideMarker: true,
        available: () => this.exitOpen && this.phase === 'exitReady',
      },
    ];
  }

  /** 绘制 16:9 正式地图；资源加载期间只保留无文字的纯色兜底，避免伪造地图物件。 */
  _drawMap(ctx) {
    const backgroundImage = this.exitOpen && this.openBackgroundImage
      ? this.openBackgroundImage
      : this.backgroundImage;
    if (backgroundImage) {
      ctx.drawImage(backgroundImage, 0, 0, GAME.WIDTH, GAME.HEIGHT);
      return;
    }

    ctx.fillStyle = '#7f9d58';
    ctx.fillRect(0, 0, GAME.WIDTH, GAME.HEIGHT);
  }

  _drawFarmer(ctx) {
    if (!this.farmerSprite) return;
    const { x, y } = GRANDMA;
    this.farmerSprite?.draw(ctx, x, y, {
      width: 146,
      height: 146,
    });
  }

  _loadSceneObjects() {
    if (this.objectAssetsPromise) return this.objectAssetsPromise;

    // 树木、围栏、果实和关闭的栅栏都已经烘焙在正式背景；只保留状态变化后的开门贴图。
    this.objectAssetsPromise = loadSceneObjectAssets(this.assetLoader, {
      gateOpen: SCENE_OBJECT_ASSETS.lychee.gateOpen,
    }).then((images) => {
      this.objectImages = images;
      return images;
    });
    return this.objectAssetsPromise;
  }

  _drawSceneObjects(ctx) {
    if (!this.exitOpen) return;
    const gate = {
      assetKey: 'gateOpen',
      x: GATE.x + GATE.width / 2,
      y: GATE.y + GATE.height + 2,
      width: 176,
      height: 142,
      anchorY: 1,
      fallbackColor: SCENE_OBJECT_ASSETS.lychee.gateOpen.fallbackColor,
    };

    drawSceneObjects(ctx, this.objectImages, [gate]);
  }

  /** 异步加载正式地图，地图加载失败不影响对话与解谜逻辑。 */
  _loadBackground() {
    if (this.backgroundPromise) return this.backgroundPromise;

    const loadOrNull = (url) => Promise.resolve(this._loadImage(url)).catch(() => null);
    this.backgroundPromise = Promise.all([
      loadOrNull(LYCHEE_BACKGROUND_URL),
      loadOrNull(LYCHEE_OPEN_BACKGROUND_URL),
    ]).then(([closedImage, openImage]) => {
      this.backgroundImage = closedImage;
      this.openBackgroundImage = openImage;
      return closedImage;
    });
    return this.backgroundPromise;
  }

  /** 统一走资源加载器，测试环境没有 Image 时安全降级。 */
  _loadImage(url) {
    if (this.assetLoader?.loadImage) return this.assetLoader.loadImage(url);
    if (typeof Image === 'undefined') return Promise.resolve(null);

    return new Promise((resolve) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => resolve(null);
      image.src = url;
    });
  }

  _drawFeedback(ctx) {
    ctx.save();
    ctx.globalAlpha = Math.min(1, this.feedbackTimer / 0.2);
    ctx.fillStyle = '#fff3b0';
    ctx.font = '700 24px Microsoft YaHei, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('摘取成功！', this.player.x, this.player.y - 76);
    ctx.restore();
  }
}
