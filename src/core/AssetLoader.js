/**
 * 资源加载器（对应 PRD §6.2 + Task 1.4）
 * 预加载图集/JSON/音频，Promise + 缓存 + 容错降级。
 * 同一资源只加载一次（缓存），失败时跳过并告警不中断整体加载。
 */
export class AssetLoader {
  constructor({ imageConcurrency = 3 } = {}) {
    /** @type {Map<string, Object>} JSON 资源缓存 */
    this.jsonCache = new Map();
    /** @type {Map<string, HTMLImageElement>} 图片资源缓存 */
    this.imageCache = new Map();
    /** @type {Map<string, Promise<HTMLImageElement>>} 正在加载的图片请求 */
    this.imagePromises = new Map();
    /** @type {Array<{url: string, resolve: Function, reject: Function}>} 图片加载队列 */
    this.imageQueue = [];
    /** @type {number} 当前正在下载/解码的图片数量 */
    this.activeImageLoads = 0;
    /** @type {number} 移动端安全的图片并发上限，避免同时解码多张大图 */
    this.imageConcurrency = Math.max(1, Number(imageConcurrency) || 3);
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
    if (this.imagePromises.has(url)) {
      return this.imagePromises.get(url);
    }

    let resolveRequest;
    let rejectRequest;
    const request = new Promise((resolve, reject) => {
      resolveRequest = resolve;
      rejectRequest = reject;
    });
    this.imagePromises.set(url, request);
    this.imageQueue.push({ url, resolve: resolveRequest, reject: rejectRequest });
    this._drainImageQueue();

    // 失败请求不能留在 in-flight 表里，否则后续进入场景时永远拿到同一个失败 Promise。
    request.then(
      () => {
        if (this.imagePromises.get(url) === request) this.imagePromises.delete(url);
      },
      () => {
        if (this.imagePromises.get(url) === request) this.imagePromises.delete(url);
      },
    );
    return request;
  }

  /** 按并发上限启动图片下载，完成后继续处理队列。 */
  _drainImageQueue() {
    while (this.activeImageLoads < this.imageConcurrency && this.imageQueue.length > 0) {
      const task = this.imageQueue.shift();
      if (!task) break;

      // 同一 URL 可能在入队后被其它调用提前缓存，避免重复创建 Image。
      if (this.imageCache.has(task.url)) {
        task.resolve(this.imageCache.get(task.url));
        continue;
      }

      this.activeImageLoads += 1;
      this._loadImageNow(task.url).then(
        (image) => {
          this.imageCache.set(task.url, image);
          task.resolve(image);
        },
        (error) => {
          task.reject(error);
        },
      ).then(() => {
        this.activeImageLoads -= 1;
        this._drainImageQueue();
      });
    }
  }

  /** 创建单张 Image；队列和缓存策略由 loadImage 统一管理。 */
  _loadImageNow(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        // 移动端可能在 load 事件后才真正解码大图；等 decode 完成，
        // 场景转场才会放行，避免首帧先露出纯色底或几何降级块。
        if (typeof img.decode === 'function') {
          const decodeResult = img.decode();
          if (decodeResult && typeof decodeResult.then === 'function') {
            decodeResult.then(() => resolve(img), () => resolve(img));
          } else {
            resolve(img);
          }
          return;
        }
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

    // 资源请求同时提交；图片由 loadImage 按并发上限排队，单个失败不影响其他资源。
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
