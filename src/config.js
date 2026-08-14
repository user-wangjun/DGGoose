/**
 * 全局配置与常量
 * 集中管理游戏逻辑尺寸、帧率、设置默认值与事件名。
 * 章节与印记数据从 data/ 目录导入并重新导出，避免重复定义（DRY）。
 */

/** 画布逻辑尺寸与帧率目标 */
export const GAME = {
  WIDTH: 1280,
  HEIGHT: 720,
  TARGET_FPS: 60,
  /** deltaTime 钳制上限（秒），防止切后台后大跳跃 */
  MAX_DELTA_TIME: 0.05,
};

/** 存储键统一前缀 */
export const STORAGE_PREFIX = 'gxe:';

// 章节与印记数据从 data/ 导入并重新导出，单一数据源
export { CHAPTERS } from './data/chapters.js';
export { BADGES, BADGE_TYPE } from './data/badges.js';
export { ENDINGS, getEndingById, getEndingByScene } from './data/endings.js';

/** 设置默认值（对应 PRD §5 F12） */
export const SETTINGS_DEFAULTS = {
  bgm: 70,
  sfx: 55,
  textSpeed: 30,
  lang: 'zh-CN',
  shake: true,
};

/** 摇杆拉满判定阈值（归一化向量幅值 > 此值时标记 run） */
export const JOYSTICK_RUN_THRESHOLD = 0.92;

/** 角色移动速度（px/s），对应 PRD F2 速度档 */
export const PLAYER_SPEEDS = {
  WALK: 150,
  RUN: 260,
};

/** 事件名常量，统一管理避免拼写不一致 */
export const EVENT = {
  SCORE: 'score',
  BADGE_GET: 'badge:get',
  BADGE_ALL: 'badge:all',
  CHAPTER_COMPLETE: 'chapter:complete',
  SCENE_CHANGE: 'scene:change',
  DIALOGUE_NEXT: 'dialogue:next',
  DIALOGUE_TAG: 'dialogue:tag',
  DIALOGUE_SKIP: 'dialogue:skip',
  SAVE_WRITE: 'save:write',
  SAVE_LOAD: 'save:load',
  SETTING_CHANGE: 'setting:change',
  /** 播放音效（data.name 为音效名） */
  SFX_PLAY: 'sfx:play',
  /** 播放 BGM（data.name 为 BGM 名） */
  BGM_PLAY: 'bgm:play',
  /** 停止 BGM */
  BGM_STOP: 'bgm:stop',
  // ===== M5 剧情分支事件 =====
  /** 玩家在某场景选"留下"（data.scene 为场景 id） */
  CHOICE_STAY: 'choice:stay',
  /** 玩家选"继续探寻"（data.scene 为当前场景 id） */
  CHOICE_CONTINUE: 'choice:continue',
  /** 触发结局 CG（data.endingId 为结局 id） */
  ENDING_CG: 'ending:cg',
};

/**
 * 场景 BGM 映射表（对应 PRD §7.8 每章 1 首 BGM）
 * 音频文件后置，缺文件时 AudioManager 静默降级不报错。
 */
export const BGM_MAP = {
  menu: 'menu',
  prologue: 'factory',
  ch1: 'basketball',
  ch2: 'lychee',
  ch3: 'goose',
  ch4: 'industrial',
  ch5: 'campus',
  finale: 'songshan',
};

/**
 * 音频资源清单（对应美术 TODO P0）。
 * BGM 使用已验收的 MP3 试听母带；SFX 暂保留现有 WAV 占位资源。
 * AssetLoader 缺文件时静默降级，但 P0 资源包应包含完整 8 首 BGM + 12 条 SFX。
 */
export const AUDIO_MANIFEST = [
  // BGM
  { type: 'audio', url: 'assets/audio/bgm_menu.mp3' },
  { type: 'audio', url: 'assets/audio/bgm_factory.mp3' },
  { type: 'audio', url: 'assets/audio/bgm_basketball.mp3' },
  { type: 'audio', url: 'assets/audio/bgm_lychee.mp3' },
  { type: 'audio', url: 'assets/audio/bgm_goose.mp3' },
  { type: 'audio', url: 'assets/audio/bgm_industrial.mp3' },
  { type: 'audio', url: 'assets/audio/bgm_campus.mp3' },
  { type: 'audio', url: 'assets/audio/bgm_songshan.mp3' },
  // SFX
  { type: 'audio', url: 'assets/audio/sfx_click.wav' },
  { type: 'audio', url: 'assets/audio/sfx_typewriter.wav' },
  { type: 'audio', url: 'assets/audio/sfx_goal.wav' },
  { type: 'audio', url: 'assets/audio/sfx_miss.wav' },
  { type: 'audio', url: 'assets/audio/sfx_caught.wav' },
  { type: 'audio', url: 'assets/audio/sfx_steal.wav' },
  { type: 'audio', url: 'assets/audio/sfx_collect.wav' },
  { type: 'audio', url: 'assets/audio/sfx_gate.wav' },
  { type: 'audio', url: 'assets/audio/sfx_error.wav' },
  { type: 'audio', url: 'assets/audio/sfx_transition.wav' },
  { type: 'audio', url: 'assets/audio/sfx_ending.wav' },
  { type: 'audio', url: 'assets/audio/sfx_jump.wav' },
];

/** 第一章俯视移动地图使用的正式篮球馆背景。 */
export const BASKETBALL_SCENE_BACKGROUND_URL = new URL(
  '../assets/bg/scene-02-basketball-gym/scene-02-background.png',
  import.meta.url,
).href;

/** 第一章投篮玩法背景；移除静态右侧篮架，由 Canvas 前景篮筐负责上下移动。 */
export const BASKETBALL_SHOOTING_BACKGROUND_URL = new URL(
  '../assets/bg/scene-02-basketball-gym/scene-02-background-shooting.png',
  import.meta.url,
).href;

/** 第三章烧鹅店正式横屏地图背景；由 Vite 统一收集到构建产物。 */
export const STEALTH_BACKGROUND_URL = new URL(
  '../assets/bg/scene-04-roast-goose-shop/scene-04-background.png',
  import.meta.url,
).href;

import { SCENE_OBJECT_PRELOAD } from './data/sceneObjectAssets.js';

/**
 * 分章节预加载清单（对应 PRD §6.3 首屏仅加载主菜单资源，章节按需预加载）
 * 首屏（menu）仅加载菜单 BGM；进入各章节时预加载该章资源。
 */
export const CHAPTER_PRELOAD = {
  menu: [
    { type: 'audio', url: 'assets/audio/bgm_menu.mp3' },
  ],
  prologue: [
    ...SCENE_OBJECT_PRELOAD.prologue,
    { type: 'audio', url: 'assets/audio/bgm_factory.mp3' },
  ],
  ch1: [
    ...SCENE_OBJECT_PRELOAD.ch1,
    { type: 'image', url: BASKETBALL_SCENE_BACKGROUND_URL },
    { type: 'image', url: BASKETBALL_SHOOTING_BACKGROUND_URL },
    { type: 'audio', url: 'assets/audio/bgm_basketball.mp3' },
    { type: 'audio', url: 'assets/audio/sfx_goal.wav' },
    { type: 'audio', url: 'assets/audio/sfx_miss.wav' },
  ],
  ch2: [
    ...SCENE_OBJECT_PRELOAD.ch2,
    { type: 'audio', url: 'assets/audio/bgm_lychee.mp3' },
    { type: 'audio', url: 'assets/audio/sfx_gate.wav' },
    { type: 'audio', url: 'assets/audio/sfx_error.wav' },
  ],
  ch3: [
    ...SCENE_OBJECT_PRELOAD.ch3,
    { type: 'image', url: STEALTH_BACKGROUND_URL },
    { type: 'audio', url: 'assets/audio/bgm_goose.mp3' },
    { type: 'audio', url: 'assets/audio/sfx_caught.wav' },
    { type: 'audio', url: 'assets/audio/sfx_steal.wav' },
  ],
  ch4: [
    ...SCENE_OBJECT_PRELOAD.ch4,
    { type: 'audio', url: 'assets/audio/bgm_industrial.mp3' },
  ],
  ch5: [
    ...SCENE_OBJECT_PRELOAD.ch5,
    { type: 'audio', url: 'assets/audio/bgm_campus.mp3' },
  ],
  finale: [
    ...SCENE_OBJECT_PRELOAD.finale,
    { type: 'audio', url: 'assets/audio/bgm_songshan.mp3' },
    { type: 'audio', url: 'assets/audio/sfx_ending.wav' },
  ],
};

/** 主菜单背景样板 URL，由 Vite 负责产出开发/构建环境下的最终资源地址。 */
export const MAIN_MENU_BACKGROUND_URL = new URL('../assets/bg/bg_menu_cn.png', import.meta.url).href;

/** 六个正式结尾 CG 的本地资源 URL，按结局 id 与数据层保持一一对应。 */
export const ENDING_CG_URL_MAP = {
  basketball_life: new URL('../assets/bg/cg_ending_basketball_life.png', import.meta.url).href,
  lychee_heir: new URL('../assets/bg/cg_ending_lychee_heir.png', import.meta.url).href,
  goose_heir: new URL('../assets/bg/cg_ending_goose_heir.png', import.meta.url).href,
  tech_star: new URL('../assets/bg/cg_ending_tech_star.png', import.meta.url).href,
  college_freshman: new URL('../assets/bg/cg_ending_college_freshman.png', import.meta.url).href,
  intro_dongguan: new URL('../assets/bg/cg_ending_intro_dongguan.png', import.meta.url).href,
};

/** 主菜单正面莞小鹅贴图 URL，独立于章节侧身序列帧。 */
export const MAIN_MENU_GOOSE_URL = new URL('../assets/characters/gxe/gxe_menu_front.png', import.meta.url).href;

/** Vite 可追踪的莞小鹅透明立绘资源 URL，原始色键图仅作为源文件保留。 */
const GXE_PORTRAIT_URL = new URL('../assets/ui/portraits/gxe_portrait_default_alpha.png', import.meta.url).href;

/**
 * 五张已复核的 NPC 对话立绘资源。
 * 这些图是对话 UI 用的透明立绘，不等同于场景内透明 NPC 动作资源。
 */
const NPC_PORTRAIT_URLS = {
  coach: new URL('../assets/characters/npcs/npc_coach_dialogue.png', import.meta.url).href,
  lycheeFarmer: new URL('../assets/characters/npcs/npc_farmer_lychee_dialogue.png', import.meta.url).href,
  roastGooseOwner: new URL('../assets/characters/npcs/npc_roast_goose_shop_owner_dialogue.png', import.meta.url).href,
  senior: new URL('../assets/characters/npcs/npc_dgut_senior_dialogue.png', import.meta.url).href,
  seniorFemale: new URL('../assets/characters/npcs/npc_dgut_senior_female_dialogue.png', import.meta.url).href,
};

/**
 * 对话立绘资源映射表
 * key: 说话人名称，value: 立绘图片路径
 * 莞小鹅为左侧固定立绘，其他角色显示在右侧
 * NPC 立绘使用 Vite 可追踪的本地资源 URL；找不到角色时由 DialogueBox 隐藏右侧立绘。
 */
export const PORTRAIT_MAP = {
  '莞小鹅': GXE_PORTRAIT_URL,
  '教练': NPC_PORTRAIT_URLS.coach,
  '果农阿婆': NPC_PORTRAIT_URLS.lycheeFarmer,
  '烧鹅店老板': NPC_PORTRAIT_URLS.roastGooseOwner,
  '学长': NPC_PORTRAIT_URLS.senior,
  '学姐': NPC_PORTRAIT_URLS.seniorFemale,
};
