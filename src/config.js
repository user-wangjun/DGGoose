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

/**
 * 分章节预加载清单（对应 PRD §6.3 首屏仅加载主菜单资源，章节按需预加载）
 * 首屏（menu）仅加载菜单 BGM；进入各章节时预加载该章资源。
 */
export const CHAPTER_PRELOAD = {
  menu: [
    { type: 'audio', url: 'assets/audio/bgm_menu.mp3' },
  ],
  prologue: [
    { type: 'audio', url: 'assets/audio/bgm_factory.mp3' },
  ],
  ch1: [
    { type: 'audio', url: 'assets/audio/bgm_basketball.mp3' },
    { type: 'audio', url: 'assets/audio/sfx_goal.wav' },
    { type: 'audio', url: 'assets/audio/sfx_miss.wav' },
  ],
  ch2: [
    { type: 'audio', url: 'assets/audio/bgm_lychee.mp3' },
    { type: 'audio', url: 'assets/audio/sfx_gate.wav' },
    { type: 'audio', url: 'assets/audio/sfx_error.wav' },
  ],
  ch3: [
    { type: 'audio', url: 'assets/audio/bgm_goose.mp3' },
    { type: 'audio', url: 'assets/audio/sfx_caught.wav' },
    { type: 'audio', url: 'assets/audio/sfx_steal.wav' },
  ],
  ch4: [
    { type: 'audio', url: 'assets/audio/bgm_industrial.mp3' },
  ],
  ch5: [
    { type: 'audio', url: 'assets/audio/bgm_campus.mp3' },
  ],
  finale: [
    { type: 'audio', url: 'assets/audio/bgm_songshan.mp3' },
    { type: 'audio', url: 'assets/audio/sfx_ending.wav' },
  ],
};

/** 主菜单背景样板 URL，由 Vite 负责产出开发/构建环境下的最终资源地址。 */
export const MAIN_MENU_BACKGROUND_URL = new URL('../assets/bg/bg_menu_cn.png', import.meta.url).href;

/** 主菜单正面莞小鹅贴图 URL，独立于章节侧身序列帧。 */
export const MAIN_MENU_GOOSE_URL = new URL('../assets/characters/gxe/gxe_menu_front.png', import.meta.url).href;

/** Vite 可追踪的莞小鹅透明立绘资源 URL，原始色键图仅作为源文件保留。 */
const GXE_PORTRAIT_URL = new URL('../assets/ui/portraits/gxe_portrait_default_alpha.png', import.meta.url).href;

/**
 * 对话立绘资源映射表
 * key: 说话人名称，value: 立绘图片路径
 * 莞小鹅为左侧固定立绘，其他角色显示在右侧
 * 暂无图片资源的NPC使用占位路径，AssetLoader缺文件时静默降级。
 */
export const PORTRAIT_MAP = {
  '莞小鹅': GXE_PORTRAIT_URL,
  '教练': 'assets/ui/portraits/coach_portrait_default.png',
  '果农阿婆': 'assets/ui/portraits/grandma_portrait_default.png',
  '烧鹅店老板': 'assets/ui/portraits/boss_portrait_default.png',
  '学长': 'assets/ui/portraits/senior_bro_portrait_default.png',
  '学姐': 'assets/ui/portraits/senior_sis_portrait_default.png',
};
