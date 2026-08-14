import { GAME, EVENT } from '../config.js';
import { DIALOGUES } from '../data/dialogues.js';
import { getHotspotsByScene } from '../data/hotspots.js';
import { TopdownController } from '../core/TopdownController.js';
import { drawSceneObjects, loadSceneObjectAssets } from '../core/SceneObjectRenderer.js';
import { SCENE_OBJECT_ASSETS } from '../data/sceneObjectAssets.js';
import { sortBySortY, drawCollisionDebug, isCollisionDebugEnabled } from '../core/SceneLayout.js';
import { Toast } from '../ui/Toast.js';
import { ChoiceOverlay } from '../ui/ChoiceOverlay.js';

const INDUSTRIAL_BACKGROUND_URL = new URL('../../assets/bg/industrial_park_map.png', import.meta.url).href;
export const PLAYER_START = Object.freeze({ x: 130, y: 600 });
export const GEAR_POSITIONS = Object.freeze([
  { id: 'gear-1', x: 250, y: 365 },
  { id: 'gear-2', x: 540, y: 560 },
  { id: 'gear-3', x: 1080, y: 360 },
]);
export const ASSEMBLY_STATION = Object.freeze({ id: 'assembly', x: 720, y: 530, radius: 78 });
export const SECURITY_GATE = Object.freeze({ id: 'security-gate', x: 1170, y: 370, radius: 82, isExit: true });
const ENGINEER_POSITION = { x: 760, y: 590 };
const INDUSTRIAL_WORKER_POSITION = { x: 840, y: 575 };
const INDUSTRIAL_WORKER_HOTSPOT_ID = 'industrial_worker_silhouette';
const ASSEMBLY_DURATION = 1.4;

const CHOICE_CONFIG = {
  sceneId: 'ch4',
  nextChapter: 'ch5',
  title: '工程师递来一张工牌',
  stayLabel: '留下研发',
  continueLabel: '继续前行',
};

/**
 * 第四章·工业园区。
 * 把原来的屏幕固定热区改为同一张俯视园区中的观察点、齿轮和安检门互动。
 */
export class IndustrialScene {
  constructor({ sceneManager, eventBus, badgeSystem, dialogueRunner, dialogueBox, input, player = null, container, getChoice, gooseSprite = null, engineerSprite = null, industrialWorkerSprite = null, assetLoader = null }) {
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
    this.engineerSprite = engineerSprite;
    this.industrialWorkerSprite = industrialWorkerSprite;
    this.assetLoader = assetLoader;

    this.phase = 'idle';
    this.hotspots = [];
    this.viewedHotspots = new Set();
    this.collectedGears = new Set();
    this.assemblyProgress = 0;
    this.animTime = 0;
    this.transitioning = false;
    this.gateOpen = false;
    this.assemblyTimerId = null;
    this.timerId = null;
    this.briefLockRemaining = 0;
    this.topdown = null;
    this.toast = null;
    this.choiceOverlay = null;
    this.objectImages = new Map();
    this.objectAssetsPromise = null;
    this.debugCollision = isCollisionDebugEnabled();

    this._onDialogueNext = this._onDialogueNext.bind(this);
    this._onChoiceStay = this._onChoiceStay.bind(this);
    this._onChoiceContinue = this._onChoiceContinue.bind(this);
    this._onInteract = this._onInteract.bind(this);
  }

  /** 初始化园区互动对象并播放开场对话。 */
  onEnter(params = {}) {
    this.phase = 'intro';
    this.hotspots = getHotspotsByScene('ch4');
    this.viewedHotspots = new Set();
    this.collectedGears = new Set();
    this.assemblyProgress = 0;
    this.animTime = 0;
    this.transitioning = false;
    this.timerId = null;
    this.assemblyTimerId = null;
    this.briefLockRemaining = 0;
    this.gateOpen = false;
    this.backgroundImage = null;
    this.backgroundPromise = this._loadBackground();
    this._loadSceneObjects();

    this.player?.setPosition(PLAYER_START.x, PLAYER_START.y);
    this.toast = new Toast({ container: this.container, duration: 2200 });
    this.topdown = new TopdownController({
      player: this.player,
      input: this.input,
      container: this.container,
      onInteract: this._onInteract,
      title: '第四章 · 工业园区',
      objective: '先靠近园区观察点，了解这里的科技与工人',
    });
    this.topdown.setMap({
      bounds: { left: 36, top: 90, right: 1244, bottom: 680 },
      obstacles: this._getObstacles(),
      interactables: this._getInteractables(),
      playerRadius: 20,
    });
    this.topdown.mount();
    this.topdown.setProgress('观察点 0 / 3');
    this.topdown.setExitStatus('安检门：需要访客徽章');
    this.topdown.setMovementLocked(true);
    this.topdown.setInteractionEnabled(false);

    this.eventBus.on(EVENT.DIALOGUE_NEXT, this._onDialogueNext);
    this.eventBus.on(EVENT.CHOICE_STAY, this._onChoiceStay);
    this.eventBus.on(EVENT.CHOICE_CONTINUE, this._onChoiceContinue);
    this.engineerSprite?.playAction('interact', { facing: 1, restart: true });
    this.industrialWorkerSprite?.playAction('work', { facing: -1, restart: true });
    this.dialogueBox.show(DIALOGUES.ch4.slice(0, 3));
    if (params?.restore) this._restoreSaveState(params.restore);
  }

  /** 返回工业园观察/收集/组装进度、角色位置和对话的完整快照。 */
  getSaveState() {
    return {
      phase: this.phase,
      viewedHotspots: [...this.viewedHotspots],
      collectedGears: [...this.collectedGears],
      assemblyProgress: this.assemblyProgress,
      briefLockRemaining: this.briefLockRemaining,
      animTime: this.animTime,
      transitioning: this.transitioning,
      gateOpen: this.gateOpen,
      player: this.player?.getSaveState?.() || this.player?.position || null,
      topdown: this.topdown?.getSaveState?.() || null,
      dialogue: this.dialogueBox?.getSaveState?.() || null,
    };
  }

  /** 恢复园区收集、组装动画剩余时间和尾声抉择。 */
  _restoreSaveState(state) {
    if (!state || typeof state !== 'object') return;
    this.phase = typeof state.phase === 'string' ? state.phase : 'intro';
    this.viewedHotspots = new Set(Array.isArray(state.viewedHotspots) ? state.viewedHotspots : []);
    this.collectedGears = new Set(Array.isArray(state.collectedGears) ? state.collectedGears : []);
    this.assemblyProgress = Number.isFinite(state.assemblyProgress)
      ? Math.max(0, Math.min(1, state.assemblyProgress))
      : 0;
    this.briefLockRemaining = Number.isFinite(state.briefLockRemaining)
      ? Math.max(0, state.briefLockRemaining)
      : 0;
    this.animTime = Number.isFinite(state.animTime) ? Math.max(0, state.animTime) : 0;
    this.transitioning = Boolean(state.transitioning);
    this.gateOpen = Boolean(state.gateOpen);
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

    if (this.phase === 'assembling' && this.assemblyProgress < 1) {
      const remaining = Math.max(0.01, ASSEMBLY_DURATION * (1 - this.assemblyProgress));
      this.assemblyTimerId = setTimeout(() => {
        this.assemblyTimerId = null;
        this._onAssemblyComplete();
      }, remaining * 1000);
    }
    if (this.briefLockRemaining > 0) {
      const remaining = this.briefLockRemaining;
      this.timerId = setTimeout(() => {
        this.timerId = null;
        this.briefLockRemaining = 0;
        if (this.phase === 'explore') this.topdown?.setMovementLocked(false);
        if (this.phase === 'explore' && this.viewedHotspots.size === this.hotspots.length) {
          this.phase = 'collect';
          this.topdown?.setSceneInfo('第四章 · 工业园区', '收集 3 个齿轮零件，并靠近组装台');
          this.topdown?.setProgress('齿轮 0 / 3');
          this.topdown?.setExitStatus('安检门：需要访客徽章');
        }
      }, remaining * 1000);
    }
    if (this.phase === 'choice') this._showChoice();
    if (state.dialogue) this.dialogueBox?.restoreSaveState?.(state.dialogue);
    else this.dialogueBox?.hide?.();
  }

  _syncRestoredPhase() {
    if (!this.topdown) return;
    this.topdown.setSceneInfo('第四章 · 工业园区', '靠近观察点并主动查看');
    this.topdown.setProgress(`观察点 ${this.viewedHotspots.size} / ${this.hotspots.length}`);
    this.topdown.setExitStatus(this.gateOpen ? '安检门：已解锁' : '安检门：需要访客徽章');
    const canInteract = ['explore', 'collect', 'exitReady'].includes(this.phase);
    this.topdown.setMovementLocked(!canInteract);
    this.topdown.setInteractionEnabled(canInteract);
    if (this.phase === 'collect') {
      this.topdown.setSceneInfo('第四章 · 工业园区', '收集 3 个齿轮零件，并靠近组装台');
      this.topdown.setProgress(`齿轮 ${this.collectedGears.size} / 3`);
    } else if (this.phase === 'assembling') {
      this.topdown.setSceneInfo('第四章 · 工业园区', '正在组装访客徽章');
      this.topdown.setProgress(`齿轮 3 / 3 · 组装 ${Math.round(this.assemblyProgress * 100)}%`);
    } else if (this.phase === 'exitReady') {
      this.topdown.setSceneInfo('第四章 · 工业园区', '访客徽章已完成，前往右侧安检门');
      this.topdown.setProgress('齿轮 3 / 3 · 访客徽章已组装');
    }
  }

  /** 更新移动、组装动画和环境脉冲。 */
  update(deltaTime) {
    this.animTime += deltaTime;
    this.briefLockRemaining = Math.max(0, this.briefLockRemaining - Math.max(0, deltaTime));
    this.dialogueBox.update(deltaTime);
    if (this.topdown && ['explore', 'collect', 'exitReady'].includes(this.phase)) {
      this.topdown.update(deltaTime);
    }
    if (this.gooseSprite && this.player) {
      this.gooseSprite.update(deltaTime, this.player.animState, this.player.facing);
    }
    this.engineerSprite?.update(deltaTime, 'idle', 1);
    this.industrialWorkerSprite?.update(deltaTime, 'idle', -1);
    if (this.phase === 'assembling') {
      this.assemblyProgress = Math.min(1, this.assemblyProgress + deltaTime / ASSEMBLY_DURATION);
      if (this.assemblyProgress >= 1) this._onAssemblyComplete();
    }
  }

  /** 绘制俯视园区、观察点、齿轮、安检门和角色。 */
  draw(ctx) {
    if (!ctx) return;
    this._drawMap(ctx);
    this._drawHotspotObjects(ctx);
    this._drawGears(ctx);
    this._drawAssembly(ctx);
    this._drawSecurityGate(ctx);
    const actors = sortBySortY([
      this.engineerSprite ? { sortY: ENGINEER_POSITION.y, draw: () => this._drawEngineer(ctx) } : null,
      this.industrialWorkerSprite ? { sortY: INDUSTRIAL_WORKER_POSITION.y, draw: () => this._drawIndustrialWorker(ctx) } : null,
      // DialogueBox 的莞小鹅立绘已承担角色表现；对话关闭后下一帧立即恢复场内角色。
      !this.dialogueBox?.visible && this.topdown && this.player
        ? { sortY: this.player.y, draw: () => this.topdown.drawPlayer(ctx, this.gooseSprite) }
        : null,
    ].filter(Boolean));
    actors.forEach((actor) => actor.draw());
    // 互动标签属于 UI，置于角色和所有场景物件之上。
    this.topdown?.drawInteractables(ctx, this.animTime);
    this._drawCollisionDebug(ctx);
  }

  /** 释放共享控制器、定时器和覆盖层。 */
  onExit() {
    this.eventBus.off(EVENT.DIALOGUE_NEXT, this._onDialogueNext);
    this.eventBus.off(EVENT.CHOICE_STAY, this._onChoiceStay);
    this.eventBus.off(EVENT.CHOICE_CONTINUE, this._onChoiceContinue);
    if (this.timerId) clearTimeout(this.timerId);
    this.timerId = null;
    if (this.assemblyTimerId) clearTimeout(this.assemblyTimerId);
    this.assemblyTimerId = null;
    this.topdown?.destroy();
    this.topdown = null;
    this.toast?.destroy();
    this.toast = null;
    this._hideChoiceOverlay();
    this.objectAssetsPromise = null;
    this.objectImages = new Map();
    this.dialogueBox?.hide();
    this.engineerSprite?.clearAction();
    this.industrialWorkerSprite?.clearAction();
    this.phase = 'idle';
    this.transitioning = false;
  }

  _onDialogueNext(data) {
    if (!data?.finished) return;
    if (this.phase !== 'intro') {
      if (this.phase === 'outro') this._completeChapter();
      return;
    }
    this.phase = 'explore';
    this.topdown.setSceneInfo('第四章 · 工业园区', '靠近观察点并主动查看');
    this.topdown.setMovementLocked(false);
    this.topdown.setInteractionEnabled(true);
    this.eventBus.emit('observe:start');
  }

  _onInteract(target) {
    this.gooseSprite?.playAction('interact', { facing: this.player?.facing || 1 });
    if (target.id === INDUSTRIAL_WORKER_HOTSPOT_ID) {
      this.industrialWorkerSprite?.playAction('interact', { facing: -1, restart: true });
    } else if (target.isHotspot || target.id === ASSEMBLY_STATION.id || target.isExit) {
      this.engineerSprite?.playAction('interact', { facing: 1, restart: true });
    }
    if (this.phase === 'explore' && target.isHotspot) {
      this._observeHotspot(target);
      return;
    }
    if (this.phase === 'collect' && target.isGear) {
      this._collectGear(target);
      return;
    }
    if (this.phase === 'collect' && target.id === ASSEMBLY_STATION.id && this.collectedGears.size === GEAR_POSITIONS.length) {
      this._startAssembly();
      return;
    }
    if (this.phase === 'exitReady' && target.isExit) this._onExitInteract();
  }

  _observeHotspot(target) {
    if (this.viewedHotspots.has(target.id)) return;
    this.viewedHotspots.add(target.id);
    this.toast?.show(`【${target.name}】${target.text}`);
    const count = this.viewedHotspots.size;
    this.topdown.setProgress(`观察点 ${count} / ${this.hotspots.length}`);
    this._lockBriefly(() => {
      if (this.phase !== 'explore' || count !== this.hotspots.length) return;
      this.phase = 'collect';
      this.topdown.setSceneInfo('第四章 · 工业园区', '收集 3 个齿轮零件，并靠近组装台');
      this.topdown.setProgress('齿轮 0 / 3');
      this.topdown.setExitStatus('安检门：需要访客徽章');
      this.eventBus.emit('puzzle:start');
    });
  }

  _collectGear(target) {
    if (this.collectedGears.has(target.id)) return;
    this.collectedGears.add(target.id);
    this.eventBus.emit(EVENT.SFX_PLAY, { name: 'collect' });
    this.toast?.show(`收集到齿轮零件 ${this.collectedGears.size} / ${GEAR_POSITIONS.length}`);
    this.topdown.setProgress(`齿轮 ${this.collectedGears.size} / 3`);
    if (this.collectedGears.size === GEAR_POSITIONS.length) {
      this.topdown.setSceneInfo('第四章 · 工业园区', '齿轮齐了，靠近组装台制作访客徽章');
    }
  }

  _startAssembly() {
    this.phase = 'assembling';
    this.assemblyProgress = 0;
    this.topdown.setMovementLocked(true);
    this.topdown.setInteractionEnabled(false);
    this.topdown.setSceneInfo('第四章 · 工业园区', '正在组装访客徽章');
    this.engineerSprite?.playAction('inspect', { facing: 1, restart: true });
    this.toast?.show('齿轮零件合拢，访客徽章开始组装！');
    this.assemblyTimerId = setTimeout(() => {
      this.assemblyTimerId = null;
      this._onAssemblyComplete();
    }, ASSEMBLY_DURATION * 1000);
  }

  _onAssemblyComplete() {
    if (this.phase !== 'assembling') return;
    if (this.assemblyTimerId) clearTimeout(this.assemblyTimerId);
    this.assemblyTimerId = null;
    this.phase = 'exitReady';
    this.gateOpen = true;
    this.topdown?.setMap({
      obstacles: this._getObstacles(),
      interactables: this._getInteractables(),
    });
    this.topdown.setSceneInfo('第四章 · 工业园区', '访客徽章已完成，前往右侧安检门');
    this.topdown.setProgress('齿轮 3 / 3 · 访客徽章已组装');
    this.topdown.setExitStatus('安检门：已解锁');
    this.topdown.setMovementLocked(false);
    this.topdown.setInteractionEnabled(true);
    this.eventBus.emit('puzzle:solved');
  }

  _onExitInteract() {
    if (this.phase !== 'exitReady' || this.transitioning) return;
    this.transitioning = true;
    this.phase = 'outro';
    this.topdown.setMovementLocked(true);
    this.topdown.setInteractionEnabled(false);
    this.dialogueBox.show(DIALOGUES.ch4.slice(3));
  }

  _completeChapter() {
    if (this.phase !== 'outro' || !this.transitioning) return;
    this.phase = 'choice';
    this.badgeSystem.unlockOrReveal('industrial');
    this.eventBus.emit(EVENT.CHAPTER_COMPLETE, { chapter: 'ch4' });
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

  _lockBriefly(callback) {
    this.topdown.setMovementLocked(true);
    this.briefLockRemaining = 0.32;
    this.timerId = setTimeout(() => {
      this.timerId = null;
      this.briefLockRemaining = 0;
      if (this.phase === 'explore') this.topdown.setMovementLocked(false);
      callback();
    }, 320);
  }

  _getObstacles() {
    const solid = (id, x, y, width, height) => ({ id, solid: true, x, y, width, height });
    const obstacles = [
      // 这些是底图中建筑/围挡的实际落地边缘，不是把整张建筑立面外接框当作碰撞。
      solid('research-building', 24, 82, 370, 210),
      solid('research-wall', 0, 286, 158, 190),
      solid('research-fence', 142, 438, 224, 30),
      solid('glasshouse-wall', 264, 488, 144, 94),
      solid('factory-hall', 750, 28, 370, 264),
      solid('factory-pipe-wall', 1120, 48, 96, 272),
      solid('factory-fence', 1016, 284, 230, 44),
      // 下方设备区的上沿从道路路缘之后开始，避免把横向道路画进实体碰撞。
      solid('equipment-fence', 612, 416, 120, 44),
      solid('equipment-fence-right', 850, 416, 264, 32),
      solid('yard-equipment', 640, 448, 72, 44),
      solid('warehouse', 878, 420, 178, 180),
      solid('yard-crates', 778, 414, 100, 100),
      solid('yard-machines', 1040, 402, 80, 192),
      solid('equipment-wall', 610, 616, 502, 42),
    ];
    if (!this.gateOpen) obstacles.push(solid('security-gate', 1148, 302, 92, 30));
    return obstacles;
  }

  _getInteractables() {
    return [
      ...this.hotspots.map((spot) => ({
        ...spot,
        isHotspot: true,
        isCharacter: spot.id === INDUSTRIAL_WORKER_HOTSPOT_ID,
        zoneType: 'interaction',
        radius: 84,
        label: spot.name,
        markerLabel: spot.id === INDUSTRIAL_WORKER_HOTSPOT_ID ? '工业园工人' : spot.name,
        actionLabel: '查看',
        hideMarker: spot.id !== INDUSTRIAL_WORKER_HOTSPOT_ID,
        available: () => this.phase === 'explore' && !this.viewedHotspots.has(spot.id),
      })),
      ...GEAR_POSITIONS.map((gear) => ({
        ...gear,
        isGear: true,
        zoneType: 'interaction',
        radius: 72,
        label: '齿轮零件',
        markerLabel: gear.id.replace('gear-', '零件 '),
        actionLabel: '收集',
        hideMarker: true,
        available: () => this.phase === 'collect' && !this.collectedGears.has(gear.id),
      })),
      {
        ...ASSEMBLY_STATION,
        zoneType: 'interaction',
        label: '组装台',
        markerLabel: '组装访客徽章',
        actionLabel: '组装',
        hideMarker: true,
        available: () => this.phase === 'collect' && this.collectedGears.size === GEAR_POSITIONS.length,
      },
      {
        ...SECURITY_GATE,
        zoneType: 'interaction',
        label: '安检门',
        markerLabel: '出口 / 安检门',
        actionLabel: '通过',
        hideMarker: true,
        available: () => this.phase === 'exitReady',
      },
    ];
  }

  /** 绘制正式工业园区底图；资源未就绪时不绘制临时几何占位。 */
  _drawMap(ctx) {
    if (this.backgroundImage) {
      ctx.drawImage(this.backgroundImage, 0, 0, GAME.WIDTH, GAME.HEIGHT);
      return;
    }
    ctx.fillStyle = '#2d4b4d';
    ctx.fillRect(0, 0, GAME.WIDTH, GAME.HEIGHT);
  }

  /** 通过共享资源缓存加载正式工业园区底图。 */
  _loadBackground() {
    if (this.assetLoader?.loadImage) {
      return this.assetLoader.loadImage(INDUSTRIAL_BACKGROUND_URL)
        .then((image) => {
          this.backgroundImage = image;
          return image;
        })
        .catch(() => null);
    }
    if (typeof Image === 'undefined') return Promise.resolve(null);
    return new Promise((resolve) => {
      const image = new Image();
      image.onload = () => {
        this.backgroundImage = image;
        resolve(image);
      };
      image.onerror = () => resolve(null);
      image.src = INDUSTRIAL_BACKGROUND_URL;
    });
  }

  _loadSceneObjects() {
    if (this.objectAssetsPromise) return this.objectAssetsPromise;

    // 园区设备、建筑和关闭的安检门都已经烘焙在正式背景；只加载会变化的齿轮、组装结果和开门状态。
    this.objectAssetsPromise = loadSceneObjectAssets(this.assetLoader, {
      gear: SCENE_OBJECT_ASSETS.industrial.gear,
      assemblyComplete: SCENE_OBJECT_ASSETS.industrial.assemblyComplete,
      gateOpen: SCENE_OBJECT_ASSETS.industrial.gateOpen,
    }).then((images) => {
      this.objectImages = images;
      return images;
    });
    return this.objectAssetsPromise;
  }

  _drawHotspotObjects(ctx) {
    // 观察点所在的设备、工作台和无人机都已经画在正式园区背景中；这里只保留透明互动热区。
  }

  _drawGears(ctx) {
    drawSceneObjects(ctx, this.objectImages, GEAR_POSITIONS
      .filter((gear) => !this.collectedGears.has(gear.id))
      .map((gear, index) => ({
        assetKey: 'gear',
        x: gear.x,
        y: gear.y,
        width: 58 - index * 4,
        height: 58 - index * 4,
        anchorX: 0.5,
        anchorY: 0.5,
        rotation: this.animTime * 1.4 + index * 0.6,
        fallbackColor: SCENE_OBJECT_ASSETS.industrial.gear.fallbackColor,
      })));
  }

  _drawAssembly(ctx) {
    if (!['assembling', 'exitReady'].includes(this.phase)) return;
    drawSceneObjects(ctx, this.objectImages, [{
      assetKey: 'assemblyComplete',
      x: ASSEMBLY_STATION.x,
      y: ASSEMBLY_STATION.y - 2,
      width: 116 + this.assemblyProgress * 36,
      height: 116 + this.assemblyProgress * 36,
      anchorX: 0.5,
      anchorY: 0.5,
      alpha: this.phase === 'assembling' ? 0.68 + this.assemblyProgress * 0.25 : 0.9,
      fallbackColor: SCENE_OBJECT_ASSETS.industrial.assemblyComplete.fallbackColor,
    }]);
  }

  _drawSecurityGate(ctx) {
    if (!this.gateOpen) return;
    drawSceneObjects(ctx, this.objectImages, [{
      assetKey: 'gateOpen',
      x: SECURITY_GATE.x,
      y: 454,
      width: 132,
      height: 198,
      anchorY: 1,
      fallbackColor: SCENE_OBJECT_ASSETS.industrial.gateOpen.fallbackColor,
    }]);
  }

  /** 绘制高新工程师：脚底锚定在组装台，不再用圆形互动图标代替人物。 */
  _drawEngineer(ctx) {
    const { x, y } = ENGINEER_POSITION;
    ctx.save();
    ctx.fillStyle = 'rgba(15, 23, 42, .28)';
    ctx.beginPath();
    ctx.ellipse(x, y + 30, 31, 9, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    this.engineerSprite?.draw(ctx, x, y, {
      width: 146,
      height: 146,
    });
  }

  /** 绘制设备区工业工人：透明动作 Sprite 与设备台错位摆放，保留脚底阴影。 */
  _drawIndustrialWorker(ctx) {
    const { x, y } = INDUSTRIAL_WORKER_POSITION;
    ctx.save();
    ctx.fillStyle = 'rgba(15, 23, 42, .28)';
    ctx.beginPath();
    ctx.ellipse(x, y + 30, 29, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    this.industrialWorkerSprite?.draw(ctx, x, y, {
      width: 136,
      height: 136,
    });
  }

  _drawHudCanvas(ctx) {
    // 互动说明统一由 TopdownController 的底部提示层承载，避免第二层 HUD 叠在摇杆/对话框上。
  }

  _drawCollisionDebug(ctx) {
    if (!this.debugCollision || !this.topdown) return;
    drawCollisionDebug(ctx, {
      obstacles: this.topdown.obstacles,
      interactables: this.topdown.interactables,
      player: this.player,
      playerRadius: this.topdown.playerRadius,
      spawn: PLAYER_START,
      exits: [SECURITY_GATE],
    });
  }
}
