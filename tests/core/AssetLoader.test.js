import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AssetLoader } from '../../src/core/AssetLoader.js';

/**
 * AssetLoader 测试套件
 * 对应 PRD §6.2 + Task 1.4：预加载图集/JSON/音频，Promise + 缓存 + 容错
 */
describe('AssetLoader 资源加载', () => {
  let loader;

  beforeEach(() => {
    loader = new AssetLoader();
  });

  afterEach(() => {
    loader.clearCache();
  });

  describe('缓存机制', () => {
    it('同一 URL 第二次加载命中缓存（不重复请求）', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({ test: true }),
      });

      await loader.loadJson('test.json');
      await loader.loadJson('test.json');

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      fetchSpy.mockRestore();
    });

    it('clearCache 后重新请求', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({ test: true }),
      });

      await loader.loadJson('test.json');
      loader.clearCache();
      await loader.loadJson('test.json');

      expect(fetchSpy).toHaveBeenCalledTimes(2);
      fetchSpy.mockRestore();
    });
  });

  describe('loadJson', () => {
    it('成功加载 JSON 并返回解析结果', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({ name: '莞小鹅', frames: 4 }),
      });

      const result = await loader.loadJson('anim.json');
      expect(result.name).toBe('莞小鹅');
      expect(result.frames).toBe(4);
      fetchSpy.mockRestore();
    });

    it('HTTP 错误 → 抛错', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: false,
        status: 404,
      });

      await expect(loader.loadJson('missing.json')).rejects.toThrow();
      fetchSpy.mockRestore();
    });
  });

  describe('loadImage', () => {
    it('成功加载图片并缓存', async () => {
      const mockImage = { src: '', naturalWidth: 128, naturalHeight: 128 };
      const originalImage = globalThis.Image;
      globalThis.Image = vi.fn(() => mockImage);

      // mockImage.src 赋值时触发 load 事件
      Object.defineProperty(mockImage, 'src', {
        set(val) {
          this._src = val;
          setTimeout(() => this.onload && this.onload(), 0);
        },
        get() { return this._src; },
      });

      const result = await loader.loadImage('sprite.png');
      expect(result).toBe(mockImage);
      globalThis.Image = originalImage;
    });
  });

  describe('loadManifest（批量预加载）', () => {
    it('按清单加载多种资源，返回汇总结果', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({ data: true }),
      });

      const manifest = [
        { type: 'json', url: 'a.json' },
        { type: 'json', url: 'b.json' },
      ];

      const results = await loader.loadManifest(manifest);
      expect(results.json.size).toBe(2);
      fetchSpy.mockRestore();
    });

    it('onProgress 回调报告加载进度', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({ data: true }),
      });

      const progressValues = [];
      const manifest = [
        { type: 'json', url: 'a.json' },
        { type: 'json', url: 'b.json' },
      ];

      await loader.loadManifest(manifest, (progress) => {
        progressValues.push(progress);
      });

      expect(progressValues).toContain(0.5);
      expect(progressValues).toContain(1);
      fetchSpy.mockRestore();
    });

    it('单个资源失败不中断整体加载（容错降级）', async () => {
      let callCount = 0;
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({ ok: false, status: 404 });
        }
        return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
      });

      const manifest = [
        { type: 'json', url: 'fail.json' },
        { type: 'json', url: 'ok.json' },
      ];

      const results = await loader.loadManifest(manifest);
      // 失败的资源不在结果中，成功的在
      expect(results.json.has('ok.json')).toBe(true);
      expect(results.errors.length).toBe(1);
      fetchSpy.mockRestore();
    });
  });
});
