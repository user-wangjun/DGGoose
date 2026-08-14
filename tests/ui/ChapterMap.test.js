import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ChapterMap } from '../../src/ui/ChapterMap.js';
import { BadgeSystem } from '../../src/core/BadgeSystem.js';
import { StorageService } from '../../src/core/StorageService.js';
import { EventBus } from '../../src/core/EventBus.js';

/**
 * ChapterMap 章节地图测试
 * 对应 M5 §5.7 章节地图与收集联动：
 * - 抉择状态展示（已留下/未留下）
 * - 结局印记收集进度条
 * - 信息卡中的结局印记状态
 */
describe('ChapterMap 章节地图', () => {
  let storage;
  let eventBus;
  let badgeSystem;
  let container;
  let toast;
  let chapterMap;

  beforeEach(() => {
    localStorage.clear();
    storage = new StorageService();
    eventBus = new EventBus();
    badgeSystem = new BadgeSystem({ storage, eventBus });
    container = document.createElement('div');
    document.body.appendChild(container);
    toast = { show: vi.fn(), destroy: vi.fn() };
  });

  afterEach(() => {
    if (chapterMap) {
      chapterMap.destroy();
      chapterMap = null;
    }
    if (container.parentNode) {
      container.parentNode.removeChild(container);
    }
  });

  /**
   * 辅助函数：创建并初始化 ChapterMap 实例
   */
  function createMap(options = {}) {
    chapterMap = new ChapterMap({
      container,
      badgeSystem,
      toast,
      onEnterChapter: vi.fn(),
      ...options,
    });
    chapterMap.create();
    return chapterMap;
  }

  describe('基础渲染', () => {
    it('create() 后容器内有章节地图 DOM', () => {
      createMap();
      const el = container.querySelector('[data-chapter-map]');
      expect(el).not.toBeNull();
    });

    it('渲染所有 7 个章节节点', () => {
      createMap();
      const nodes = container.querySelectorAll('[data-chapter-node]');
      expect(nodes.length).toBe(7);
    });

    it('章节信息卡使用对应的正式徽章图进行核验', () => {
      badgeSystem.unlock('factory_cert');
      createMap();
      chapterMap.setState(['prologue'], ['prologue'], []);
      chapterMap.selectNode('prologue');

      const image = container.querySelector('[data-chapter-badge-image="factory_cert"]');
      expect(image).not.toBeNull();
      expect(image.src).toContain('badge_factory_color.png');
    });
  });

  describe('抉择状态展示', () => {
    it('setState 传入 choices 后，已完成章节的信息卡显示"已选择留下"', () => {
      // 解锁 ch1 并标记为已完成
      badgeSystem.unlock('basketball');
      createMap();
      chapterMap.setState(['prologue', 'ch1'], ['ch1'], ['ch1']);

      // 选中 ch1 节点，触发信息卡展示
      chapterMap.selectNode('ch1');

      const infoCard = container.querySelector('[data-chapter-info-card]');
      expect(infoCard.style.display).not.toBe('none');

      // 信息卡中应包含"已选择留下"文本
      expect(infoCard.textContent).toContain('已选择留下');
    });

    it('未选择留下的章节，信息卡显示"未选择留下"', () => {
      badgeSystem.unlock('basketball');
      createMap();
      chapterMap.setState(['prologue', 'ch1'], ['ch1'], []);

      chapterMap.selectNode('ch1');

      const infoCard = container.querySelector('[data-chapter-info-card]');
      expect(infoCard.textContent).toContain('未选择留下');
    });

    it('无 choice 字段的章节（如序章）不显示抉择状态行', () => {
      badgeSystem.unlock('factory_cert');
      createMap();
      chapterMap.setState(['prologue'], ['prologue'], []);

      chapterMap.selectNode('prologue');

      const infoCard = container.querySelector('[data-chapter-info-card]');
      expect(infoCard.textContent).not.toContain('留下');
    });
  });

  describe('结局印记收集进度', () => {
    it('地图底部渲染结局印记收集进度条', () => {
      createMap();

      const progressEl = container.querySelector('[data-ending-progress]');
      expect(progressEl).not.toBeNull();
    });

    it('未收集任何结局印记时显示 0/6', () => {
      createMap();

      const progressEl = container.querySelector('[data-ending-progress]');
      expect(progressEl.textContent).toContain('0');
      expect(progressEl.textContent).toContain('6');
    });

    it('收集 1 枚结局印记后显示 1/6', () => {
      badgeSystem.unlock('training_camp');
      createMap();

      const progressEl = container.querySelector('[data-ending-progress]');
      expect(progressEl.textContent).toContain('1');
      expect(progressEl.textContent).toContain('6');
    });

    it('收集全部 6 枚结局印记后显示 6/6', () => {
      badgeSystem.unlock('training_camp');
      badgeSystem.unlock('lychee_gardener');
      badgeSystem.unlock('goose_chef');
      badgeSystem.unlock('developer');
      badgeSystem.unlock('student');
      badgeSystem.unlock('lake');
      createMap();

      const progressEl = container.querySelector('[data-ending-progress]');
      expect(progressEl.textContent).toContain('6');
      expect(progressEl.textContent).toContain('6');
    });
  });

  describe('信息卡结局印记状态', () => {
    it('有 choice 的章节信息卡显示对应结局印记状态', () => {
      badgeSystem.unlock('basketball');
      createMap();
      chapterMap.setState(['prologue', 'ch1'], ['ch1'], []);

      chapterMap.selectNode('ch1');

      const infoCard = container.querySelector('[data-chapter-info-card]');
      // 应包含"结局印记"标签
      expect(infoCard.textContent).toContain('结局印记');
    });

    it('结局印记已解锁时信息卡显示印记名称', () => {
      badgeSystem.unlock('basketball');
      badgeSystem.unlock('training_camp');
      createMap();
      chapterMap.setState(['prologue', 'ch1'], ['ch1'], []);

      chapterMap.selectNode('ch1');

      const infoCard = container.querySelector('[data-chapter-info-card]');
      // training_camp 印记名称为"训练营"
      expect(infoCard.textContent).toContain('训练营');
    });

    it('结局印记未解锁时信息卡显示"未获得"', () => {
      badgeSystem.unlock('basketball');
      createMap();
      chapterMap.setState(['prologue', 'ch1'], ['ch1'], []);

      chapterMap.selectNode('ch1');

      const infoCard = container.querySelector('[data-chapter-info-card]');
      // 信息卡中结局印记行应包含"未获得"
      expect(infoCard.textContent).toContain('未获得');
    });
  });

  describe('setState 更新抉择数据', () => {
    it('setState 传入 choices 后更新信息卡抉择状态', () => {
      badgeSystem.unlock('basketball');
      createMap();
      // 初始无抉择
      chapterMap.setState(['prologue', 'ch1'], ['ch1'], []);
      chapterMap.selectNode('ch1');
      let infoCard = container.querySelector('[data-chapter-info-card]');
      expect(infoCard.textContent).toContain('未选择留下');

      // 更新为已抉择
      chapterMap.setState(['prologue', 'ch1'], ['ch1'], ['ch1']);
      chapterMap.selectNode('ch1');
      infoCard = container.querySelector('[data-chapter-info-card]');
      expect(infoCard.textContent).toContain('已选择留下');
    });
  });
});
