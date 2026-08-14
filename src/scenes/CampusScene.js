import { GAME, EVENT } from '../config.js';
import { DIALOGUES } from '../data/dialogues.js';
import { getHotspotsByScene } from '../data/hotspots.js';
import { TopdownController } from '../core/TopdownController.js';
// Static campus objects are intentionally not requested: the formal background
// already contains them, while this import preserves the shared asset contract.
import { drawSceneObjects, loadSceneObjectAssets } from '../core/SceneObjectRenderer.js';
import { SCENE_OBJECT_ASSETS } from '../data/sceneObjectAssets.js';
import { sortBySortY, drawCollisionDebug, isCollisionDebugEnabled } from '../core/SceneLayout.js';
import { Toast } from '../ui/Toast.js';
import { ChoiceOverlay } from '../ui/ChoiceOverlay.js';

// 第五章采用 DGUT 松山湖校区图书馆正门广场的“参考重绘”底图：
// 这版收紧到正门、台阶和右侧相邻自习楼前场，并把中央过道还原为带树池、花坛、
// 长椅和轻微转折的真实校园步行空间；建筑比例与空间关系来自真实资料，
// 但最终仍保持与其他章节一致的俯视插画风格。
export const CAMPUS_BACKGROUND_URL = new URL('../../assets/bg/bg_campus_dgut_library_illustrated_v9_1280.png', import.meta.url).href;
export const CAMPUS_CHARACTER_SCALE = 1.12;
const CAMPUS_NPC_DRAW_SIZE = 146 * CAMPUS_CHARACTER_SCALE;
const CAMPUS_PLAYER_DRAW_SIZE = 124 * CAMPUS_CHARACTER_SCALE;
const PLAYER_START = { x: 640, y: 610 };
const CAMPUS_EXIT = { id: 'campus-exit', x: 640, y: 680, radius: 48, isExit: true };
const LEAF_COUNT = 18;
const LEAF_COLORS = ['#d97706', '#b45309', '#92400e', '#a16207', '#ca8a04'];
// 学长在中央步道前，学姐在右侧玻璃阅览立面前；两人落在同一段前场尺度内。
const SENIOR_POSITION = { x: 640, y: 500 };
const SENIOR_FEMALE_POSITION = { x: 1060, y: 430 };

const CHOICE_CONFIG = {
  sceneId: 'ch5',
  nextChapter: 'finale',
  title: '学姐真诚地看着你',
  stayLabel: '留下入学',
  continueLabel: '继续前行',
};

/**
 * 第五章·DGUT 校园。
 * 观察点是地图上的场景角色/物件，必须靠近并主动查看；全部完成后从校园出口进入收尾对话。
 */
export class CampusScene {
  constructor({ sceneManager, eventBus, badgeSystem, dialogueRunner, dialogueBox, input, player = null, container, getChoice, gooseSprite = null, seniorSprite = null, seniorFemaleSprite = null, assetLoader = null }) {
    this.sceneManager = sceneManager;
    this.eventBus = eventBus;
    this.badgeSystem = badgeSystem;
    this.dialogueRunner = dialogueRunner;
    this.dialogueBox = dialogueBox;
    this.input = input;
    this.player = player;
    this.container = container;
    this.getChoice = getChoice || (() => null);
    this.gooseSprite = gooseSprite;
    this.seniorSprite = seniorSprite;
    this.seniorFemaleSprite = seniorFemaleSprite;
    this.assetLoader = assetLoader;

    this.phase = 'idle';
    this.hotspots = [];
    this.viewedHotspots = new Set();
    this.leaves = [];
    this.animTime = 0;
    this.interactionLock = 0;
    this.transitioning = false;
    this.topdown = null;
    this.toast = null;
    this.choiceOverlay = null;
    this.backgroundImage = null;
    this.backgroundLoadPromise = null;
    this.debugCollision = isCollisionDebugEnabled();

    this._onDialogueNext = this._onDialogueNext.bind(this);
    this._onChoiceStay = this._onChoiceStay.bind(this);
    this._onChoiceContinue = this._onChoiceContinue.bind(this);
    this._onInteract = this._onInteract.bind(this);
  }

  /** 初始化校园地图、观察点和开场对话。 */
  onEnter(params = {}) {
    this.phase = 'intro';
    this.hotspots = getHotspotsByScene('ch5');
    this.viewedHotspots = new Set();
    this.animTime = 0;
    this.interactionLock = 0;
    this.transitioning = false;
    this._initLeaves();
    this._loadBackground();
    this.player?.setPosition(PLAYER_START.x, PLAYER_START.y);
    this.toast = new Toast({ container: this.container, duration: 2600 });
    this.topdown = new TopdownController({
      player: this.player,
      input: this.input,
      container: this.container,
      onInteract: this._onInteract,
      title: '第五章 · DGUT 校园',
      objective: '先在图书馆前场移动，靠近 3 个观察点主动查看',
    });
    this.topdown.setMap({
      bounds: { left: 28, top: 70, right: 1252, bottom: 680 },
      obstacles: this._getObstacles(),
      interactables: this._getInteractables(),
      playerRadius: 20,
    });
    this.topdown.mount();
    this.topdown.setProgress('观察 0 / 3');
    this.topdown.setExitStatus('前场出口：完成观察后开放');
    this.topdown.setMovementLocked(true);
    this.topdown.setInteractionEnabled(false);

    this.eventBus.on(EVENT.DIALOGUE_NEXT, this._onDialogueNext);
    this.eventBus.on(EVENT.CHOICE_STAY, this._onChoiceStay);
    this.eventBus.on(EVENT.CHOICE_CONTINUE, this._onChoiceContinue);
    this.dialogueBox.show(DIALOGUES.ch5.slice(0, 2));
    if (params?.restore) this._restoreSaveState(params.restore);
  }

  /** 返回校园观察进度、落叶动画、玩家位置和当前对话的完整快照。 */
  getSaveState() {
    return {
      phase: this.phase,
      viewedHotspots: [...this.viewedHotspots],
      leaves: this.leaves.map((leaf) => ({ ...leaf })),
      animTime: this.animTime,
      interactionLock: this.interactionLock,
      transitioning: this.transitioning,
      player: this.player?.getSaveState?.() || this.player?.position || null,
      topdown: this.topdown?.getSaveState?.() || null,
      dialogue: this.dialogueBox?.getSaveState?.() || null,
    };
  }

  /** 恢复校园观察点、出口开放状态和短暂互动锁。 */
  _restoreSaveState(state) {
    if (!state || typeof state !== 'object') return;
    this.phase = typeof state.phase === 'string' ? state.phase : 'intro';
    this.viewedHotspots = new Set(Array.isArray(state.viewedHotspots) ? state.viewedHotspots : []);
    if (Array.isArray(state.leaves) && state.leaves.length > 0) {
      this.leaves = state.leaves.map((leaf) => ({ ...leaf }));
    }
    this.animTime = Number.isFinite(state.animTime) ? Math.max(0, state.animTime) : 0;
    this.interactionLock = Number.isFinite(state.interactionLock) ? Math.max(0, state.interactionLock) : 0;
    this.transitioning = Boolean(state.transitioning);
    this.player?.restoreSaveState?.(state.player);
    if (state.player && !this.player?.restoreSaveState) {
      this.player?.setPosition?.(state.player.x, state.player.y);
    }
    this._syncRestoredPhase();
    if (state.topdown) this.topdown?.restoreSaveState?.(state.topdown);
    if (this.phase === 'choice') this._showChoice();
    if (state.dialogue) this.dialogueBox?.restoreSaveState?.(state.dialogue);
    else this.dialogueBox?.hide?.();
  }

  _syncRestoredPhase() {
    if (!this.topdown) return;
    const complete = this.viewedHotspots.size >= this.hotspots.length;
    if (this.phase === 'explore') {
      this.topdown.setSceneInfo('第五章 · DGUT 校园', '靠近图书馆入口、中央步道和玻璃阅览立面');
      this.topdown.setProgress(`观察 ${this.viewedHotspots.size} / ${this.hotspots.length}`);
      this.topdown.setExitStatus('前场出口：完成观察后开放');
      this.topdown.setMovementLocked(this.interactionLock > 0);
      this.topdown.setInteractionEnabled(true);
    } else if (this.phase === 'exitReady' || complete) {
      this.topdown.setSceneInfo('第五章 · DGUT 校园', '校园观察完成，回到图书馆前场继续前行');
      this.topdown.setProgress('观察 3 / 3 · 已完成');
      this.topdown.setExitStatus('前场出口：已开放');
      this.topdown.setMovementLocked(this.interactionLock > 0);
      this.topdown.setInteractionEnabled(true);
    } else {
      this.topdown.setMovementLocked(true);
      this.topdown.setInteractionEnabled(false);
    }
  }

  /** 更新落叶、角色移动和对话。 */
  update(deltaTime) {
    this.animTime += deltaTime;
    this._updateLeaves(deltaTime);
    this.dialogueBox.update(deltaTime);
    if (this.topdown && ['explore', 'exitReady'].includes(this.phase)) this.topdown.update(deltaTime);
    if (this.gooseSprite && this.player) this.gooseSprite.update(deltaTime, this.player.animState, this.player.facing);
    this.seniorSprite?.update(deltaTime, 'idle', 1);
    this.seniorFemaleSprite?.update(deltaTime, 'idle', 1);

    if (this.interactionLock > 0) {
      this.interactionLock = Math.max(0, this.interactionLock - deltaTime);
      if (this.interactionLock === 0 && ['explore', 'exitReady'].includes(this.phase)) this.topdown.setMovementLocked(false);
    }
  }

  /** 绘制正式校园底图、观察点、出口和角色。 */
  draw(ctx) {
    if (!ctx) return;
    this._drawMap(ctx);
    const actors = sortBySortY([
      this.seniorSprite ? { sortY: SENIOR_POSITION.y, draw: () => this._drawCampusCharacter(ctx, this.seniorSprite, SENIOR_POSITION) } : null,
      this.seniorFemaleSprite ? { sortY: SENIOR_FEMALE_POSITION.y, draw: () => this._drawCampusCharacter(ctx, this.seniorFemaleSprite, SENIOR_FEMALE_POSITION) } : null,
      this.topdown && this.player
        ? {
          sortY: this.player.y,
          draw: () => this.topdown.drawPlayer(ctx, this.gooseSprite, {
            width: CAMPUS_PLAYER_DRAW_SIZE,
            height: CAMPUS_PLAYER_DRAW_SIZE,
          }),
        }
        : null,
    ].filter(Boolean));
    actors.forEach((actor) => actor.draw());
    this._drawLeaves(ctx);
    this.topdown?.drawInteractables(ctx, this.animTime);
    if (this.debugCollision && this.topdown) {
      drawCollisionDebug(ctx, {
        obstacles: this.topdown.obstacles,
        interactables: this.topdown.interactables,
        player: this.player,
        playerRadius: this.topdown.playerRadius,
        spawn: PLAYER_START,
        exits: [CAMPUS_EXIT],
      });
    }
  }

  /** 清理场景资源。 */
  onExit() {
    this.eventBus.off(EVENT.DIALOGUE_NEXT, this._onDialogueNext);
    this.eventBus.off(EVENT.CHOICE_STAY, this._onChoiceStay);
    this.eventBus.off(EVENT.CHOICE_CONTINUE, this._onChoiceContinue);
    this.topdown?.destroy();
    this.topdown = null;
    this.toast?.destroy();
    this.toast = null;
    this._hideChoiceOverlay();
    this.dialogueBox?.hide();
    this.seniorSprite?.clearAction();
    this.seniorFemaleSprite?.clearAction();
    this.backgroundImage = null;
    this.backgroundLoadPromise = null;
    this.phase = 'idle';
    this.transitioning = false;
    this.leaves = [];
  }

  _onDialogueNext(data) {
    if (!data?.finished) return;
    if (this.phase === 'intro') {
      this.phase = 'explore';
      this.topdown.setSceneInfo('第五章 · DGUT 校园', '靠近图书馆入口、中央步道和玻璃阅览立面');
      this.topdown.setMovementLocked(false);
      this.topdown.setInteractionEnabled(true);
      this.eventBus.emit('observe:start');
    } else if (this.phase === 'outro') {
      this._completeChapter();
    }
  }

  _onInteract(target) {
    this.gooseSprite?.playAction('interact', { facing: this.player?.facing || 1 });
    if (target.id === 'campus_path') {
      this.seniorSprite?.playAction('guide', { facing: 1, restart: true });
    } else if (target.id === 'campus_study_window') {
      this.seniorFemaleSprite?.playAction('bookmark', { facing: 1, restart: true });
    } else if (target.isHotspot) {
      this.seniorFemaleSprite?.playAction('interact', { facing: 1, restart: true });
    }
    if (this.phase === 'explore' && target.isHotspot) {
      this._observeHotspot(target);
    } else if (this.phase === 'exitReady' && target.isExit) {
      this._enterOutro();
    }
  }

  _observeHotspot(target) {
    if (this.viewedHotspots.has(target.id)) return;
    this.viewedHotspots.add(target.id);
    this.toast?.show(`【${target.name}】${target.text}`);
    this.topdown.setProgress(`观察 ${this.viewedHotspots.size} / ${this.hotspots.length}`);
    this.topdown.setMovementLocked(true);
    this.interactionLock = 0.35;
    if (this.viewedHotspots.size === this.hotspots.length) {
      this.phase = 'exitReady';
      this.topdown.setSceneInfo('第五章 · DGUT 校园', '校园观察完成，回到图书馆前场继续前行');
      this.topdown.setProgress('观察 3 / 3 · 已完成');
      this.topdown.setExitStatus('前场出口：已开放');
    }
  }

  _enterOutro() {
    if (this.phase !== 'exitReady') return;
    this.phase = 'outro';
    this.topdown.setMovementLocked(true);
    this.topdown.setInteractionEnabled(false);
    // 观察点台词已经在地图上读过，这里进入学长学姐的正式收尾对话。
    this.seniorSprite?.playAction('interact', { facing: 1, restart: true });
    this.seniorFemaleSprite?.playAction('interact', { facing: 1, restart: true });
    this.dialogueBox.show(DIALOGUES.ch5.slice(5, 9));
  }

  _completeChapter() {
    if (this.transitioning) return;
    this.transitioning = true;
    this.phase = 'choice';
    this.badgeSystem.unlockOrReveal('campus');
    this.eventBus.emit(EVENT.CHAPTER_COMPLETE, { chapter: 'ch5' });
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
    this._hideChoiceOverlay();
    this.sceneManager.change(CHOICE_CONFIG.nextChapter);
  }

  _hideChoiceOverlay() {
    this.choiceOverlay?.hide();
    this.choiceOverlay = null;
  }

  _getObstacles() {
    const solid = (x, y, width, height, kind) => ({ solid: true, x, y, width, height, kind });

    return [
      // 参考图书馆的主体建筑；台阶和柱廊以下留出正门前场通行口。
      solid(0, 0, 380, 360, 'building'),
      solid(380, 40, 220, 320, 'building'),
      solid(600, 0, 510, 325, 'building'),
      // 右侧相邻教学/自习楼，正面窗带与侧门都可作为视觉地标。
      solid(1110, 0, 170, 290, 'building'),

      // 收紧后的正门前场绿化岛，中央铺装区保持连续可通行。
      solid(0, 405, 112, 92, 'flower-bed'),
      solid(190, 382, 194, 110, 'flower-bed'),
      solid(620, 335, 155, 105, 'flower-bed'),
      solid(1030, 290, 130, 70, 'flower-bed'),
      solid(1160, 350, 120, 95, 'flower-bed'),
      solid(1000, 515, 190, 115, 'flower-bed'),
      solid(0, 620, 430, 100, 'flower-bed'),
      solid(1135, 645, 145, 75, 'flower-bed'),
      // 只锁定右下花坛的实际底座，保留上方斜向通路。
      solid(830, 600, 180, 60, 'flower-bed'),
      solid(130, 545, 30, 18, 'tree'),
      solid(1210, 470, 30, 18, 'tree'),
      solid(420, 650, 55, 12, 'bench'),
      solid(1070, 570, 50, 12, 'bench'),
    ];
  }

  _getInteractables() {
    return [
      ...this.hotspots.map((spot) => ({
        ...spot,
        isHotspot: true,
        isCharacter: ['campus_study_window', 'campus_path'].includes(spot.id),
        characterLabelOffset: 112 * CAMPUS_CHARACTER_SCALE,
        radius: 82,
        label: spot.name,
        markerLabel: spot.id === 'campus_path'
          ? '学长'
          : spot.id === 'campus_study_window' ? '学姐' : spot.name,
        actionLabel: '观察',
        hideMarker: spot.id === 'campus_library',
        available: () => this.phase === 'explore' && !this.viewedHotspots.has(spot.id),
      })),
      {
        ...CAMPUS_EXIT,
        label: '图书馆前场出口',
        markerLabel: '前场出口',
        actionLabel: '前行',
        available: () => this.phase === 'exitReady',
      },
    ];
  }

  /** 绘制由正式美术资源提供的校园底图，逻辑碰撞层不叠加到画面。 */
  _drawMap(ctx) {
    if (this.backgroundImage) {
      ctx.drawImage(this.backgroundImage, 0, 0, GAME.WIDTH, GAME.HEIGHT);
      return;
    }

    // 资源正在异步加载时只保留无结构的底色，避免重新出现临时地图几何块。
    ctx.fillStyle = '#b8d6a6';
    ctx.fillRect(0, 0, GAME.WIDTH, GAME.HEIGHT);
  }

  /** 绘制校园里的真实透明学长与学姐 Sprite；建筑只来自正式底图。 */
  _drawCampusCharacter(ctx, sprite, position) {
    ctx.save();
    ctx.fillStyle = 'rgba(24, 65, 78, .24)';
    ctx.beginPath();
    ctx.ellipse(
      position.x,
      position.y + 30 * CAMPUS_CHARACTER_SCALE,
      30 * CAMPUS_CHARACTER_SCALE,
      9 * CAMPUS_CHARACTER_SCALE,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    ctx.restore();
    sprite.draw(ctx, position.x, position.y, {
      width: CAMPUS_NPC_DRAW_SIZE,
      height: CAMPUS_NPC_DRAW_SIZE,
    });
  }

  /** 通过共享资源缓存加载正式校园底图，避免场景重复创建图片对象。 */
  _loadBackground() {
    if (this.assetLoader?.loadImage) {
      this.backgroundLoadPromise = this.assetLoader.loadImage(CAMPUS_BACKGROUND_URL)
        .then((image) => {
          this.backgroundImage = image;
          return image;
        })
        .catch(() => null);
      return this.backgroundLoadPromise;
    }

    if (typeof Image === 'undefined') return null;
    const image = new Image();
    this.backgroundLoadPromise = new Promise((resolve) => {
      image.onload = () => {
        this.backgroundImage = image;
        resolve(image);
      };
      image.onerror = () => resolve(null);
    });
    image.src = CAMPUS_BACKGROUND_URL;
    return this.backgroundLoadPromise;
  }

  _initLeaves() {
    this.leaves = Array.from({ length: LEAF_COUNT }, () => this._createLeaf(true));
  }

  _createLeaf(randomY) {
    return {
      x: Math.random() * GAME.WIDTH,
      y: randomY ? Math.random() * GAME.HEIGHT : -20,
      size: 4 + Math.random() * 5,
      sway: Math.random() * Math.PI * 2,
      speed: 18 + Math.random() * 32,
      color: LEAF_COLORS[Math.floor(Math.random() * LEAF_COLORS.length)],
    };
  }

  _updateLeaves(deltaTime) {
    for (const leaf of this.leaves) {
      leaf.y += leaf.speed * deltaTime;
      leaf.sway += deltaTime * 1.6;
      if (leaf.y > GAME.HEIGHT + 10) Object.assign(leaf, this._createLeaf(false));
    }
  }

  _drawLeaves(ctx) {
    for (const leaf of this.leaves) {
      ctx.save();
      ctx.translate(leaf.x + Math.sin(leaf.sway) * 18, leaf.y);
      ctx.rotate(leaf.sway);
      ctx.fillStyle = leaf.color;
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.ellipse(0, 0, leaf.size, leaf.size * 0.45, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
}
