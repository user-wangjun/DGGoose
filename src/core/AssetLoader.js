/**
 * 资源加载器（对应 PRD §6.2 + Task 1.4）
 * 预加载图集/JSON/音频，Promise + 缓存 + 容错降级。
 * 同一资源只加载一次（缓存），失败时跳过并告警不中断整体加载。
 */
export class AssetLoader {
  constructor() {
    /** @type {Map<string, Object>} JSON 资源缓存 */
    this.jsonCache = new Map();
    /** @type {Map<string, HTMLImageElement>} 图片资源缓存 */
    this.imageCache = new Map();
    /** @type {Map<string, HTMLAudioElement>} 音频资源缓存 */
    this.audioCache = new Map();
    /** @type {Array<{url: string, error: Error}>} 加载失败的资源列表 */
    this.errors = [];
  }

  /**
   * 加载 JSON 资源（带缓存）
   * @param {string} url - 资源 URL
   * @returns {Promise<Object>}
   */
  async loadJson(url) {
    if (this.jsonCache.has(url)) {
      return this.jsonCache.get(url);
    }

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`JSON 加载失败: ${url} (${response.status})`);
    }

    const data = await response.json();
    this.jsonCache.set(url, data);
    return data;
  }

  /**
   * 加载图片资源（带缓存）
   * @param {string} url - 资源 URL
   * @returns {Promise<HTMLImageElement>}
   */
  loadImage(url) {
    if (this.imageCache.has(url)) {
      return Promise.resolve(this.imageCache.get(url));
    }

    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        this.imageCache.set(url, img);
        resolve(img);
      };
      img.onerror = () => reject(new Error(`图片加载失败: ${url}`));
      img.src = url;
    });
  }

  /**
   * 加载音频资源（带缓存）
   * @param {string} url - 资源 URL
   * @returns {Promise<HTMLAudioElement>}
   */
  loadAudio(url) {
    if (this.audioCache.has(url)) {
      return Promise.resolve(this.audioCache.get(url));
    }

    return new Promise((resolve) => {
      const audio = new Audio(url);
      audio.preload = 'auto';
      audio.addEventListener('canplaythrough', () => {
        this.audioCache.set(url, audio);
        resolve(audio);
      }, { once: true });
      // 音频加载失败不拒绝，静默降级
      audio.addEventListener('error', () => {
        resolve(null);
      }, { once: true });
      audio.load();
    });
  }

  /**
   * 按清单批量预加载（并行化，利用多连接加速）
   * 单个资源失败不中断整体加载（容错降级）
   * @param {Array<{type: string, url: string}>} manifest - 资源清单
   * @param {Function} [onProgress] - 进度回调 (0~1)
   * @returns {Promise<{json: Map, images: Map, audio: Map, errors: Array}>}
   */
  async loadManifest(manifest, onProgress) {
    const results = { json: new Map(), images: new Map(), audio: new Map(), errors: [] };
    const total = manifest.length;
    if (total === 0) return results;
    let completed = 0;

    // 并行加载所有资源，单个失败不影响其他
    const tasks = manifest.map(async (item) => {
      try {
        if (item.type === 'json') {
          const data = await this.loadJson(item.url);
          results.json.set(item.url, data);
        } else if (item.type === 'image') {
          const img = await this.loadImage(item.url);
          results.images.set(item.url, img);
        } else if (item.type === 'audio') {
          const audio = await this.loadAudio(item.url);
          if (audio) results.audio.set(item.url, audio);
        }
      } catch (err) {
        // 容错：记录错误但继续加载其他资源
        results.errors.push({ url: item.url, error: err });
        this.errors.push({ url: item.url, error: err });
      } finally {
        completed++;
        if (onProgress) {
          onProgress(completed / total);
        }
      }
    });

    await Promise.all(tasks);
    return results;
  }

  /**
   * 清空所有缓存
   */
  clearCache() {
    this.jsonCache.clear();
    this.imageCache.clear();
    this.audioCache.clear();
    this.errors = [];
  }
}
