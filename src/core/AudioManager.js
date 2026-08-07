import { SETTINGS_DEFAULTS } from '../config.js';

/**
 * 音频管理器（对应 PRD §6.2 + Task 1.7）
 * BGM/SFX 播放、暂停、音量（联动设置 bgm/sfx）。
 * 预加载列表来自资源清单 §7.8；资源缺失时静默降级，不报错。
 *
 * P0 首版音源通过 AUDIO_MANIFEST 预加载；单个文件缺失时仍静默降级。
 */
export class AudioManager {
  /**
   * @param {Object} [settings] - 初始音量设置
   * @param {number} [settings.bgm=70] - BGM 音量 0-100
   * @param {number} [settings.sfx=55] - SFX 音量 0-100
   */
  constructor(settings = {}) {
    /** @type {Map<string, HTMLAudioElement>} BGM 音频缓存 */
    this.bgmCache = new Map();
    /** @type {Map<string, HTMLAudioElement>} SFX 音频缓存 */
    this.sfxCache = new Map();
    /** @type {string|null} 当前播放的 BGM 名 */
    this.currentBgm = null;
    /** @type {number} BGM 音量（0-100） */
    this.bgmVolume = settings.bgm ?? SETTINGS_DEFAULTS.bgm;
    /** @type {number} SFX 音量（0-100） */
    this.sfxVolume = settings.sfx ?? SETTINGS_DEFAULTS.sfx;
    /** @type {boolean} 音频是否可用（有音频文件时为 true） */
    this.enabled = true;
  }

  /**
   * 注册 BGM 音频
   * @param {string} name - BGM 名称
   * @param {HTMLAudioElement|null} audio - 音频元素（null 时静默降级）
   */
  registerBgm(name, audio) {
    if (audio) {
      audio.loop = true;
      this.bgmCache.set(name, audio);
    }
  }

  /**
   * 注册 SFX 音频
   * @param {string} name - SFX 名称
   * @param {HTMLAudioElement|null} audio - 音频元素（null 时静默降级）
   */
  registerSfx(name, audio) {
    if (audio) {
      this.sfxCache.set(name, audio);
    }
  }

  /**
   * 播放 BGM
   * @param {string} name - BGM 名称
   */
  playBgm(name) {
    if (!this.enabled) return;

    // 停止当前 BGM
    this.stopBgm();

    const audio = this.bgmCache.get(name);
    if (!audio) return; // 资源缺失时静默降级

    audio.volume = this.bgmVolume / 100;
    audio.currentTime = 0;
    audio.play().catch(() => {
      // 浏览器自动播放策略可能阻止，静默处理
    });
    this.currentBgm = name;
  }

  /**
   * 停止当前 BGM
   */
  stopBgm() {
    if (this.currentBgm) {
      const audio = this.bgmCache.get(this.currentBgm);
      if (audio) {
        audio.pause();
        audio.currentTime = 0;
      }
      this.currentBgm = null;
    }
  }

  /**
   * 暂停当前 BGM（保留进度）
   */
  pauseBgm() {
    if (this.currentBgm) {
      const audio = this.bgmCache.get(this.currentBgm);
      if (audio) {
        audio.pause();
      }
    }
  }

  /**
   * 恢复 BGM 播放
   */
  resumeBgm() {
    if (this.currentBgm) {
      const audio = this.bgmCache.get(this.currentBgm);
      if (audio) {
        audio.play().catch(() => {});
      }
    }
  }

  /**
   * 播放音效
   * @param {string} name - SFX 名称
   */
  playSfx(name) {
    if (!this.enabled) return;

    const audio = this.sfxCache.get(name);
    if (!audio) return; // 资源缺失时静默降级

    // 音效可叠加播放，克隆一份避免打断正在播放的同名音效
    const clone = audio.cloneNode();
    clone.volume = this.sfxVolume / 100;
    clone.play().catch(() => {});
  }

  /**
   * 设置 BGM 音量（联动设置系统）
   * @param {number} volume - 0-100
   */
  setBgmVolume(volume) {
    this.bgmVolume = Math.max(0, Math.min(100, volume));
    if (this.currentBgm) {
      const audio = this.bgmCache.get(this.currentBgm);
      if (audio) {
        audio.volume = this.bgmVolume / 100;
      }
    }
  }

  /**
   * 设置 SFX 音量（联动设置系统）
   * @param {number} volume - 0-100
   */
  setSfxVolume(volume) {
    this.sfxVolume = Math.max(0, Math.min(100, volume));
  }

  /**
   * 从 AssetLoader 批量注册音频。
   * 未传 type 时按文件名前缀自动分流，避免 BGM 被误注册到 SFX 缓存。
   * @param {Map<string, HTMLAudioElement>} audioMap - AssetLoader 返回的音频缓存
   * @param {string} [type='auto'] - 'bgm'、'sfx' 或按 URL 自动识别
   */
  loadFromCache(audioMap, type = 'auto') {
    for (const [url, audio] of audioMap) {
      // 从 URL 提取名称：bgm_menu.mp3 → menu, sfx_goal.mp3 → goal
      const match = url.match(/(?:bgm|sfx)_([^/.]+)\./);
      const name = match ? match[1] : url;
      const isBgm = type === 'bgm' || (type === 'auto' && /(?:^|\/)bgm_[^/]+\./.test(url));
      const isSfx = type === 'sfx' || (type === 'auto' && /(?:^|\/)sfx_[^/]+\./.test(url));
      if (isBgm) {
        this.registerBgm(name, audio);
      } else if (isSfx) {
        this.registerSfx(name, audio);
      }
    }
  }

  /**
   * 禁用音频（如设置中关闭）
   */
  disable() {
    this.enabled = false;
    this.stopBgm();
  }

  /**
   * 启用音频
   */
  enable() {
    this.enabled = true;
  }
}
