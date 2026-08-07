/**
 * 游戏入口（M3 章节玩法集成版）
 *
 * 初始化全部核心系统 → 创建所有场景 → 注册到 SceneManager → 从主菜单启动。
 * 支持全流程 7 章节主线、12 个功能模块、双结局与 7 枚东莞印记收集。
 *
 * 架构分层：
 * - core：引擎层（Game/SceneManager/EventBus/InputManager/PlayerController 等）
 * - scenes：场景层（主菜单 + 7 章节场景 + 章节选择）
 * - ui：DOM 组件层（DialogueBox/SettingsPanel/ChargeMeter 等）
 * - data：数据层（对话/章节/印记/互动点 JSON）
 */
import { GAME, EVENT, SETTINGS_DEFAULTS, BGM_MAP, AUDIO_MANIFEST, CHAPTER_PRELOAD, PORTRAIT_MAP } from './config.js';
import { Game } from './core/Game.js';
import { EventBus } from './core/EventBus.js';
import { StorageService } from './core/StorageService.js';
import { InputManager } from './core/InputManager.js';
import { PlayerController } from './core/PlayerController.js';
import { ViewportAdapter } from './core/ViewportAdapter.js';
import { AudioManager } from './core/AudioManager.js';
import { AssetLoader } from './core/AssetLoader.js';
import { ParticleSystem } from './core/ParticleSystem.js';
import { DialogueRunner } from './core/DialogueRunner.js';
import { BadgeSystem } from './core/BadgeSystem.js';
import { SaveSystem } from './core/SaveSystem.js';
import { SettingsService } from './core/SettingsService.js';
import { SceneManager } from './core/SceneManager.js';
import { GooseSprite } from './core/GooseSprite.js';
import { VirtualJoystick } from './ui/VirtualJoystick.js';
import { DialogueBox } from './ui/DialogueBox.js';
import { SettingsPanel } from './ui/SettingsPanel.js';
import { MainMenuScene } from './scenes/MainMenuScene.js';
import { createChapterSelectScene } from './scenes/ChapterSelectScene.js';
import { FactoryScene } from './scenes/FactoryScene.js';
import { BasketballScene } from './scenes/BasketballScene.js';
import { LycheeScene } from './scenes/LycheeScene.js';
import { StealthScene } from './scenes/StealthScene.js';
import { IndustrialScene } from './scenes/IndustrialScene.js';
import { CampusScene } from './scenes/CampusScene.js';
import { SongshanScene } from './scenes/SongshanScene.js';

/**
 * 初始化画布与 2D 上下文
 * 按 DPI 适配设置物理像素与 CSS 尺寸，保证高清屏不模糊
 * @returns {{ canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D }}
 */
function initCanvas() {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const dpr = ViewportAdapter.getDpr();
  canvas.width = GAME.WIDTH * dpr;
  canvas.height = GAME.HEIGHT * dpr;
  ctx.scale(dpr, dpr);
  return { canvas, ctx };
}

/**
 * 检测设备是否支持触摸
 * @returns {boolean}
 */
function isTouchDevice() {
  return navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
}

/**
 * 印记收集闪光动效（对应 PRD §7.7 印记收集闪光：3 帧闪光序列 + 旋转）
 * 使用 DOM CSS 动画实现，0.8 秒后自动移除
 * @param {HTMLElement} container - UI 挂载容器
 */
function _showBadgeFlash(container) {
  const flash = document.createElement('div');
  flash.setAttribute('data-badge-flash', '');
  flash.style.cssText = `
    position: fixed; top: 50%; left: 50%;
    transform: translate(-50%, -50%) scale(0);
    z-index: 5000; pointer-events: none;
    width: 120px; height: 120px; border-radius: 50%;
    background: radial-gradient(circle, rgba(255,255,255,0.9) 0%, rgba(251,191,36,0.6) 50%, rgba(251,191,36,0) 100%);
    animation: gxe-badge-flash 0.8s ease-out forwards;
  `;
  container.appendChild(flash);

  // 动画结束后移除元素
  flash.addEventListener('animationend', () => {
    if (flash.parentNode) flash.parentNode.removeChild(flash);
  });
}

/**
 * 程序入口
 * 初始化画布 → 创建核心系统 → 组装场景 → 注册到 SceneManager → 启动主循环
 */
function main() {
  const { canvas, ctx } = initCanvas();
  const uiRoot = document.getElementById('ui-root');

  // ==================== 1. 核心系统初始化 ====================

  // 事件总线（全局事件通信枢纽）
  const eventBus = new EventBus();

  // 持久化存储（localStorage 封装）
  const storage = new StorageService();

  // 视口适配器（横屏检测 + 旋转遮罩 + 画布缩放 + 安全区）
  const viewport = new ViewportAdapter();
  viewport.mount();
  viewport.fitCanvas(canvas);
  ViewportAdapter.applySafeArea(uiRoot);

  // 输入管理器（键盘 + 摇杆统一抽象）
  const input = new InputManager();
  input.mount(window);

  // 虚拟摇杆（仅触屏设备显示）
  let joystick = null;
  if (isTouchDevice()) {
    joystick = new VirtualJoystick({ container: uiRoot });
    joystick.mount();
  }

  // 角色控制器（共享实例，场景切换时重置位置）
  const player = new PlayerController({
    x: GAME.WIDTH / 2,
    y: GAME.HEIGHT / 2,
    bounds: { width: GAME.WIDTH, height: GAME.HEIGHT },
  });

  // 音频管理器（骨架，音源资源后置）
  const audio = new AudioManager();

  // 资源加载器（分章节预加载音频资源，主菜单背景由 MainMenuScene 按需加载）
  const assetLoader = new AssetLoader();

  // 莞小鹅核心序列帧：菜单阶段提前加载，进入序章时避免回退到色块占位
  const gooseSprite = new GooseSprite({ assetLoader });
  gooseSprite.load();

  // P0 音频清单一次性预加载；浏览器自动播放策略仍由首次用户交互解锁。
  assetLoader.loadManifest(AUDIO_MANIFEST).then((results) => {
    audio.loadFromCache(results.audio);
  });

  // FPS 提供函数（供粒子系统降级判断，game 实例创建后更新引用）
  let _game = null;
  const getFps = () => (_game ? _game.fps : 60);

  // ==================== 1.5 音频路由（集中式，对应 Task 4.1） ====================
  // 所有音效/BGM 通过 EventBus 统一路由到 AudioManager，场景只需 emit 事件

  // 播放音效
  eventBus.on(EVENT.SFX_PLAY, (data) => {
    if (data && data.name) audio.playSfx(data.name);
  });

  // 播放 BGM
  eventBus.on(EVENT.BGM_PLAY, (data) => {
    if (data && data.name) audio.playBgm(data.name);
  });

  // 停止 BGM
  eventBus.on(EVENT.BGM_STOP, () => {
    audio.stopBgm();
  });

  // 统一给所有 DOM 按钮提供 P0 点击反馈，避免每个 UI 组件重复注入音频依赖。
  document.addEventListener('click', (event) => {
    if (event.target instanceof Element && event.target.closest('button')) {
      audio.playSfx('click');
    }
  }, true);

  // 场景切换时自动切换 BGM + 预加载章节资源 + 播放过场音效
  eventBus.on(EVENT.SCENE_CHANGE, (data) => {
    const sceneName = data && data.name;
    if (!sceneName) return;

    // 摇杆只属于可移动章节；主菜单/章节选择需要保持画面干净。
    if (joystick && joystick.baseElement) {
      const menuLikeScene = sceneName === 'menu' || sceneName === 'chapterSelect';
      joystick.baseElement.style.display = menuLikeScene ? 'none' : '';
    }

    // 播放过场音效
    audio.playSfx('transition');

    // 按 BGM_MAP 切换背景音乐
    const bgmName = BGM_MAP[sceneName];
    if (bgmName) {
      audio.playBgm(bgmName);
    }

    // 分章节预加载该章音频资源（对应 PRD §6.3 按需预加载）
    const preloadList = CHAPTER_PRELOAD[sceneName];
    if (preloadList && preloadList.length > 0) {
      assetLoader.loadManifest(preloadList).then((results) => {
        // 将加载成功的音频注册到 AudioManager
        if (results.audio.size > 0) {
          audio.loadFromCache(results.audio);
        }
      });
    }
  });

  // 印记收集时播放收集音效
  eventBus.on(EVENT.BADGE_GET, () => {
    audio.playSfx('collect');
    _showBadgeFlash(uiRoot);
  });

  // 设置变更时联动音频音量
  eventBus.on(EVENT.SETTING_CHANGE, (data) => {
    if (!data) return;
    if (data.key === 'bgm') audio.setBgmVolume(data.value);
    if (data.key === 'sfx') audio.setSfxVolume(data.value);
  });

  // 对话运行器（逐字显示、标签解析、跳段）
  const dialogueRunner = new DialogueRunner({
    eventBus,
    textSpeed: SETTINGS_DEFAULTS.textSpeed,
  });

  // 对话框 UI（共享单例，挂载一次跨场景复用）
  const dialogueBox = new DialogueBox({
    container: uiRoot,
    runner: dialogueRunner,
    eventBus,
    input,
    portraitMap: PORTRAIT_MAP,
  });
  dialogueBox.mount();

  // 印记收集系统
  const badgeSystem = new BadgeSystem({ storage, eventBus });

  // 存档系统
  const saveSystem = new SaveSystem({ storage, eventBus });

  // 设置系统
  const settingsService = new SettingsService({ storage });

  // 设置面板（共享单例）
  const settingsPanel = new SettingsPanel({
    settingsService,
    audioManager: audio,
    eventBus,
    container: uiRoot,
  });

  // 场景管理器（注入 eventBus 以广播场景切换事件）
  const sceneManager = new SceneManager({ eventBus });

  // ==================== 2. 摇杆向量同步 ====================
  // 在主循环外注册 input 的动作事件，确保全局可用
  input.onAction((action) => {
    if (action === 'pause') {
      // Esc 暂停：返回主菜单（仅游戏中可用）
      if (sceneManager.currentName && sceneManager.currentName !== 'menu') {
        sceneManager.change('menu');
      }
    }
  });

  // ==================== 2.5 自动存档连接 ====================
  // 监听章节完成事件，自动写入 slot1 存档（对应 PRD F11 自动存档）
  eventBus.on(EVENT.CHAPTER_COMPLETE, (data) => {
    saveSystem.autoSave({
      chapter: data.chapter || 'finale',
      checkpoint: data.ending || '',
      badges: badgeSystem.unlockedIds.slice(),
      settings: settingsService.getAll(),
      ending: data.ending || null,
    });
  });

  // ==================== 2.6 剧情抉择记录（M5 伞形多结局） ====================
  // 监听 CHOICE_STAY 事件，将玩家"留下"选择写入自动存档（slot1）
  // 伞形多结局仅允许一次留下：setChoice 内部有唯一性校验，已有 choice 时返回 false
  eventBus.on(EVENT.CHOICE_STAY, (data) => {
    if (!data || !data.sceneId) return;
    saveSystem.setChoice('slot1', data.sceneId);
  });

  /**
   * 读取当前 choice 的回调（供场景判断"留下"按钮是否置灰）
   * 从自动存档 slot1 读取，返回场景 id 或 null
   */
  const getChoice = () => saveSystem.getChoice('slot1');

  // ==================== 3. 场景创建与注册 ====================

  // 主菜单（对应 PRD F1）
  const menuScene = new MainMenuScene({
    sceneManager,
    saveSystem,
    settingsPanel,
    assetLoader,
    container: uiRoot,
  });
  sceneManager.register('menu', menuScene);

  // 章节选择（对应 PRD F4）
  const chapterSelectScene = createChapterSelectScene({
    saveSystem,
    badgeSystem,
    sceneManager,
    uiRoot,
  });
  sceneManager.register('chapterSelect', chapterSelectScene);

  // 序章 · 生产线觉醒（对应 PRD F2 教学序章）
  const factoryScene = new FactoryScene({
    sceneManager,
    eventBus,
    badgeSystem,
    dialogueRunner,
    dialogueBox,
    input,
    player,
    container: uiRoot,
    getFps,
    gooseSprite,
  });
  sceneManager.register('prologue', factoryScene);

  // 第一章 · 篮球馆（对应 PRD F5 投篮小游戏）
  const basketballScene = new BasketballScene({
    sceneManager,
    eventBus,
    badgeSystem,
    dialogueRunner,
    dialogueBox,
    input,
    container: uiRoot,
    getFps,
    getChoice,
  });
  sceneManager.register('ch1', basketballScene);

  // 第二章 · 荔枝园（对应 PRD F7 序列点触解谜）
  const lycheeScene = new LycheeScene({
    sceneManager,
    eventBus,
    badgeSystem,
    dialogueRunner,
    dialogueBox,
    input,
    player,
    container: uiRoot,
    getChoice,
    gooseSprite,
  });
  sceneManager.register('ch2', lycheeScene);

  // 第三章 · 烧鹅店（对应 PRD F6 潜行追逐）
  const stealthScene = new StealthScene({
    sceneManager,
    eventBus,
    badgeSystem,
    dialogueRunner,
    dialogueBox,
    input,
    player,
    container: uiRoot,
    getFps,
    getChoice,
    gooseSprite,
  });
  sceneManager.register('ch3', stealthScene);

  // 第四章 · 工业园区（对应 PRD F8 收集组合 + 观赏互动）
  const industrialScene = new IndustrialScene({
    sceneManager,
    eventBus,
    badgeSystem,
    dialogueRunner,
    dialogueBox,
    input,
    container: uiRoot,
    getChoice,
  });
  sceneManager.register('ch4', industrialScene);

  // 第五章 · DGUT 校园（对应 PRD F8 观赏互动）
  const campusScene = new CampusScene({
    sceneManager,
    eventBus,
    badgeSystem,
    dialogueRunner,
    dialogueBox,
    input,
    container: uiRoot,
    getChoice,
  });
  sceneManager.register('ch5', campusScene);

  // 终章 · 松山湖（对应 PRD F9 走马灯 + 结算分支）
  const songshanScene = new SongshanScene({
    sceneManager,
    eventBus,
    badgeSystem,
    dialogueRunner,
    dialogueBox,
    input,
    container: uiRoot,
    getFps,
    getChoice,
  });
  sceneManager.register('finale', songshanScene);

  // ==================== 4. 启动主循环 ====================

  // 将 SceneManager 设为 Game 的"场景"，Game 每帧调用 SceneManager.update/draw
  // SceneManager 转发给当前注册的场景
  const game = new Game({ ctx });
  _game = game;

  // 包装 SceneManager 的 update，注入摇杆向量同步
  const originalUpdate = sceneManager.update.bind(sceneManager);
  sceneManager.update = function (deltaTime) {
    // 每帧同步摇杆向量到 InputManager（统一在主循环中处理，避免双 rAF）
    if (joystick) {
      const joyVec = joystick.getVector();
      input.setJoystickVector(joyVec.x, joyVec.y);
    }
    originalUpdate(deltaTime);
  };

  game.setScene(sceneManager);
  sceneManager.change('menu');
  game.start();

  console.log('[鹅厂出逃记] M3 章节玩法已启动');
  console.log('[鹅厂出逃记] 全 7 章节主线已注册，从主菜单开始');
}

main();
