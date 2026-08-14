import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DialogueBox } from '../../src/ui/DialogueBox.js';
import { DialogueRunner } from '../../src/core/DialogueRunner.js';
import { EventBus } from '../../src/core/EventBus.js';
import { EVENT } from '../../src/config.js';

/**
 * DialogueBox 对话框测试套件
 * 覆盖立绘显示、明暗切换、说话人映射等核心行为。
 */
describe('DialogueBox 对话框', () => {
  let eventBus;
  let runner;
  let container;
  let dialogueBox;
  let mockInput;

  /** 立绘资源映射表（测试用） */
  const testPortraitMap = {
    '莞小鹅': 'assets/ui/portraits/gxe_portrait_default.png',
    '教练': 'assets/ui/portraits/coach_portrait_default.png',
    '果农阿婆': 'assets/ui/portraits/grandma_portrait_default.png',
  };

  beforeEach(() => {
    eventBus = new EventBus();
    runner = new DialogueRunner({ eventBus, textSpeed: 100 });
    container = document.createElement('div');
    document.body.appendChild(container);
    // 模拟 InputManager
    mockInput = {
      onAction: vi.fn(),
      offAction: vi.fn(),
      setJoystickVector: vi.fn(),
    };
    dialogueBox = new DialogueBox({
      container,
      runner,
      eventBus,
      input: mockInput,
      portraitMap: testPortraitMap,
    });
    dialogueBox.mount();
  });

  afterEach(() => {
    dialogueBox.destroy();
    if (container.parentNode) {
      container.parentNode.removeChild(container);
    }
  });

  describe('立绘容器 - 基础结构', () => {
    it('mount() 后创建左侧立绘容器（莞小鹅）', () => {
      const leftPortrait = container.querySelector('[data-portrait-left]');
      expect(leftPortrait).not.toBeNull();
    });

    it('mount() 后创建右侧立绘容器（NPC）', () => {
      const rightPortrait = container.querySelector('[data-portrait-right]');
      expect(rightPortrait).not.toBeNull();
    });

    it('左侧立绘默认使用莞小鹅图片', () => {
      const leftImg = container.querySelector('[data-portrait-left] img');
      expect(leftImg).not.toBeNull();
      expect(leftImg.src).toContain('gxe_portrait_default.png');
    });

    it('对话框初始隐藏时，立绘也隐藏', () => {
      const leftPortrait = container.querySelector('[data-portrait-left]');
      const rightPortrait = container.querySelector('[data-portrait-right]');
      expect(leftPortrait.style.display).toBe('none');
      expect(rightPortrait.style.display).toBe('none');
    });
  });

  describe('立绘显示 - show/hide', () => {
    it('show() 后左右立绘显示（NPC对话场景）', () => {
      // NPC说话时，左右立绘都应显示
      dialogueBox.show([
        { who: '教练', txt: '你好，欢迎来篮球馆', tags: [] },
      ]);
      const leftPortrait = container.querySelector('[data-portrait-left]');
      const rightPortrait = container.querySelector('[data-portrait-right]');
      expect(leftPortrait.style.display).not.toBe('none');
      expect(rightPortrait.style.display).not.toBe('none');
    });

    it('hide() 后左右立绘隐藏', () => {
      dialogueBox.show([
        { who: '教练', txt: '你好', tags: [] },
      ]);
      dialogueBox.hide();
      const leftPortrait = container.querySelector('[data-portrait-left]');
      const rightPortrait = container.querySelector('[data-portrait-right]');
      expect(leftPortrait.style.display).toBe('none');
      expect(rightPortrait.style.display).toBe('none');
    });

    it('对白显示时消费 interact，避免结束对白的空格继续触发场景动作', () => {
      dialogueBox.show([
        { who: '旁白', txt: '前面有堵墙。', tags: [] },
      ]);

      expect(dialogueBox._onInteract('interact')).toBe(true);
      dialogueBox.hide();
      expect(dialogueBox._onInteract('interact')).toBeUndefined();
    });
  });

  describe('立绘明暗切换 - 说话人高亮', () => {
    it('莞小鹅说话时，左侧立绘高亮（无暗色滤镜）', () => {
      dialogueBox.show([
        { who: '莞小鹅', txt: '这是哪里？', tags: ['疑惑'] },
      ]);
      const leftPortrait = container.querySelector('[data-portrait-left]');
      // 高亮状态：没有 data-portrait-dim 属性
      expect(leftPortrait.hasAttribute('data-portrait-dim')).toBe(false);
    });

    it('莞小鹅说话时（NPC已出场），右侧立绘暗化', () => {
      // 先让NPC说一句话，确保右侧立绘已显示
      dialogueBox.show([
        { who: '教练', txt: '你好', tags: [] },
        { who: '莞小鹅', txt: '这是哪里？', tags: ['疑惑'] },
      ]);
      // 推进到第二行（莞小鹅说话）
      runner.update(10);
      runner.advance();
      dialogueBox.update(0);

      const rightPortrait = container.querySelector('[data-portrait-right]');
      // 暗化状态：有 data-portrait-dim 属性
      expect(rightPortrait.hasAttribute('data-portrait-dim')).toBe(true);
    });

    it('NPC说话时，右侧立绘高亮', () => {
      dialogueBox.show([
        { who: '教练', txt: '欢迎来到篮球馆', tags: [] },
      ]);
      const rightPortrait = container.querySelector('[data-portrait-right]');
      expect(rightPortrait.hasAttribute('data-portrait-dim')).toBe(false);
    });

    it('NPC说话时，左侧立绘暗化', () => {
      dialogueBox.show([
        { who: '教练', txt: '欢迎来到篮球馆', tags: [] },
      ]);
      const leftPortrait = container.querySelector('[data-portrait-left]');
      expect(leftPortrait.hasAttribute('data-portrait-dim')).toBe(true);
    });

    it('旁白说话时保留低亮度莞小鹅，但不显示右侧 NPC 头像', () => {
      // 先让 NPC 出场，再切换到旁白；旁白不能借用上一位 NPC 的头像。
      dialogueBox.show([
        { who: '教练', txt: '你好', tags: [] },
        { who: '旁白', txt: '夜幕降临，工厂里一片寂静。', tags: [] },
      ]);
      // 推进到第二行（旁白）
      runner.update(10);
      runner.advance();
      dialogueBox.update(0);

      const leftPortrait = container.querySelector('[data-portrait-left]');
      const rightPortrait = container.querySelector('[data-portrait-right]');
      expect(leftPortrait.hasAttribute('data-portrait-dim')).toBe(true);
      expect(rightPortrait.style.display).toBe('none');
      expect(rightPortrait.hasAttribute('data-portrait-dim')).toBe(false);
    });

    it('切换说话人时，明暗状态正确切换', () => {
      dialogueBox.show([
        { who: '教练', txt: '你好啊', tags: [] },
        { who: '莞小鹅', txt: '你好', tags: [] },
      ]);
      const leftPortrait = container.querySelector('[data-portrait-left]');
      const rightPortrait = container.querySelector('[data-portrait-right]');

      // 第一行：教练说话 → 右亮左暗
      expect(leftPortrait.hasAttribute('data-portrait-dim')).toBe(true);
      expect(rightPortrait.hasAttribute('data-portrait-dim')).toBe(false);

      // 推进到第二行：莞小鹅说话 → 左亮右暗
      runner.update(10); // 补全第一行
      runner.advance(); // 进入第二行
      dialogueBox.update(0); // 触发渲染
      expect(leftPortrait.hasAttribute('data-portrait-dim')).toBe(false);
      expect(rightPortrait.hasAttribute('data-portrait-dim')).toBe(true);
    });
  });

  describe('右侧立绘切换 - 根据说话人', () => {
    it('教练说话时，右侧显示教练立绘', () => {
      dialogueBox.show([
        { who: '教练', txt: '来打球吧', tags: [] },
      ]);
      const rightImg = container.querySelector('[data-portrait-right] img');
      expect(rightImg.src).toContain('coach_portrait_default.png');
    });

    it('果农阿婆说话时，右侧显示果农阿婆立绘', () => {
      dialogueBox.show([
        { who: '果农阿婆', txt: '尝尝荔枝吧', tags: [] },
      ]);
      const rightImg = container.querySelector('[data-portrait-right] img');
      expect(rightImg.src).toContain('grandma_portrait_default.png');
    });

    it('说话人在映射表中找不到时，右侧立绘隐藏', () => {
      dialogueBox.show([
        { who: '陌生人', txt: '你好', tags: [] },
      ]);
      const rightPortrait = container.querySelector('[data-portrait-right]');
      expect(rightPortrait.style.display).toBe('none');
    });

    it('旁白说话时，右侧立绘隐藏', () => {
      dialogueBox.show([
        { who: '旁白', txt: '故事开始了', tags: [] },
      ]);
      const rightPortrait = container.querySelector('[data-portrait-right]');
      expect(rightPortrait.style.display).toBe('none');
    });

    it('从NPC切换到莞小鹅说话时，右侧保持上一个NPC立绘但暗化', () => {
      dialogueBox.show([
        { who: '教练', txt: '你好', tags: [] },
        { who: '莞小鹅', txt: '你好教练', tags: [] },
      ]);
      // 第一行：教练说话
      runner.update(10);
      runner.advance(); // 进入第二行（莞小鹅说话）
      dialogueBox.update(0);

      const rightImg = container.querySelector('[data-portrait-right] img');
      const rightPortrait = container.querySelector('[data-portrait-right]');
      // 右侧仍显示教练立绘
      expect(rightImg.src).toContain('coach_portrait_default.png');
      // 但处于暗化状态
      expect(rightPortrait.hasAttribute('data-portrait-dim')).toBe(true);
    });
  });

  describe('无 portraitMap 配置时降级', () => {
    it('未传入 portraitMap 时不创建立绘元素', () => {
      // 先销毁 beforeEach 创建的带 portraitMap 的实例，避免容器污染
      dialogueBox.destroy();
      // 使用干净容器测试
      const cleanContainer = document.createElement('div');
      document.body.appendChild(cleanContainer);
      const simpleBox = new DialogueBox({
        container: cleanContainer,
        runner,
        eventBus,
        input: mockInput,
      });
      simpleBox.mount();
      const leftPortrait = cleanContainer.querySelector('[data-portrait-left]');
      const rightPortrait = cleanContainer.querySelector('[data-portrait-right]');
      // 不应该有立绘元素
      expect(leftPortrait).toBeNull();
      expect(rightPortrait).toBeNull();
      simpleBox.destroy();
      cleanContainer.remove();
    });

    it('头像映射不完整时不创建可见的空头像框或破图', () => {
      dialogueBox.destroy();
      const cleanContainer = document.createElement('div');
      document.body.appendChild(cleanContainer);
      const partialBox = new DialogueBox({
        container: cleanContainer,
        runner,
        eventBus,
        input: mockInput,
        portraitMap: { '教练': 'assets/ui/portraits/coach_portrait_default.png' },
      });
      partialBox.mount();
      partialBox.show([{ who: '未知角色', txt: '这是一条安全降级提示。', tags: [] }]);

      const leftPortrait = cleanContainer.querySelector('[data-portrait-left]');
      const rightPortrait = cleanContainer.querySelector('[data-portrait-right]');
      expect(leftPortrait.querySelector('img')).toBeNull();
      expect(leftPortrait.style.display).toBe('none');
      expect(rightPortrait.style.display).toBe('none');
      expect(rightPortrait.querySelector('img').getAttribute('src')).toBeNull();

      partialBox.destroy();
      cleanContainer.remove();
    });
  });

  describe('正式纸张布局与关闭恢复', () => {
    it('对话框与 16:9 游戏画框对齐，不覆盖画框外黑边', () => {
      const box = container.querySelector('[data-dialogue-box]');

      expect(box.style.position).toBe('fixed');
      expect(box.style.left).toContain('var(--gxe-game-frame-left');
      expect(box.style.right).toContain('var(--gxe-game-frame-right');
      expect(box.style.bottom).toContain('var(--gxe-game-frame-bottom');
      expect(box.style.height).toContain('var(--gxe-game-frame-height');
      expect(box.style.maxHeight).toContain('var(--gxe-game-frame-height');
    });

    it('长文本保持单一正文节点并启用换行与滚动保护', () => {
      const longText = '岭南的风从荔枝园一路吹到松山湖，'.repeat(80);
      dialogueBox.show([{ who: '莞小鹅', txt: longText, tags: [] }]);
      runner.update(longText.length / 100 + 1);
      dialogueBox.update(0);

      const box = container.querySelector('[data-dialogue-box]');
      const text = container.querySelector('[data-dialogue-text]');
      expect(box.getAttribute('data-dialogue-mode')).toBe('gxe');
      expect(text.textContent).toBe(longText);
      expect(text.parentElement).toBe(container.querySelector('[data-dialogue-content]'));
      expect(text.style.overflowY).toBe('auto');
      expect(text.style.overflowWrap).toBe('anywhere');
      expect(text.style.wordBreak).toBe('break-word');
      expect(container.querySelectorAll('[data-dialogue-text]').length).toBe(1);
    });

    it('关闭对话后隐藏立绘、清空运行器并恢复输入状态', () => {
      dialogueBox.show([{ who: '教练', txt: '欢迎来到篮球馆。', tags: [] }]);
      expect(dialogueBox._inputLocked).toBe(true);
      expect(mockInput.setJoystickVector).toHaveBeenCalledWith(0, 0);

      dialogueBox.hide();

      expect(dialogueBox.visible).toBe(false);
      expect(dialogueBox._inputLocked).toBe(false);
      expect(dialogueBox.runner.getCurrent()).toBeNull();
      expect(container.querySelector('[data-dialogue-box]').style.display).toBe('none');
      expect(container.querySelector('[data-portrait-left]').style.display).toBe('none');
      expect(container.querySelector('[data-portrait-right]').style.display).toBe('none');
    });

    it('系统提示使用独立模式并隐藏所有立绘', () => {
      dialogueBox.show([{ who: '系统', txt: '已获得出厂合格证。', tags: [] }]);

      const box = container.querySelector('[data-dialogue-box]');
      const leftPortrait = container.querySelector('[data-portrait-left]');
      const rightPortrait = container.querySelector('[data-portrait-right]');
      expect(box.getAttribute('data-dialogue-mode')).toBe('system');
      expect(box.getAttribute('data-dialogue-speaker')).toBe('系统');
      expect(leftPortrait.style.display).toBe('none');
      expect(rightPortrait.style.display).toBe('none');
    });
  });
});
