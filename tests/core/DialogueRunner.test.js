import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { DialogueRunner } from '../../src/core/DialogueRunner.js';
import { EventBus } from '../../src/core/EventBus.js';
import { EVENT } from '../../src/config.js';

/**
 * DialogueRunner 测试套件
 * 覆盖逐字推进、补全逻辑、防连点、标签解析、跳段、结束检测等核心行为。
 */
describe('DialogueRunner', () => {
  let eventBus;
  let runner;
  let mockLines;

  beforeEach(() => {
    eventBus = new EventBus();
    runner = new DialogueRunner({ eventBus, textSpeed: 30 });
    mockLines = [
      { who: '旁白', txt: '流水线上，一只烧鹅造型的玩具缓缓睁开眼睛。', tags: [] },
      { who: '莞小鹅', txt: '这是哪里？', tags: ['疑惑'] },
      { who: '莞小鹅', txt: '不行，我得出去看看。', tags: ['坚定'] },
    ];
  });

  describe('start - 开始对话', () => {
    it('加载对话数据后从第一行开始', () => {
      runner.start(mockLines);
      const current = runner.getCurrent();
      expect(current.who).toBe('旁白');
      expect(current.txt).toBe('流水线上，一只烧鹅造型的玩具缓缓睁开眼睛。');
      expect(current.displayedTxt).toBe('');
    });

    it('重置状态后可以重新开始', () => {
      runner.start(mockLines);
      runner.advance(); // 补全第一行
      runner.start(mockLines); // 重新开始
      expect(runner.getCurrent().displayedTxt).toBe('');
      expect(runner.getCurrent().who).toBe('旁白');
    });

    it('空对话数据安全处理不崩溃', () => {
      runner.start([]);
      expect(runner.isFinished()).toBe(true);
      expect(runner.getCurrent()).toBeNull();
    });
  });

  describe('update - 逐字推进', () => {
    it('按 textSpeed 推进显示字符数', () => {
      runner.start(mockLines);
      // textSpeed=30 字/秒，每帧 deltaTime=0.1s 推进 3 字
      runner.update(0.1);
      expect(runner.getCurrent().displayedTxt.length).toBe(3);
      runner.update(0.1);
      expect(runner.getCurrent().displayedTxt.length).toBe(6);
    });

    it('推进不超过当前行总字数', () => {
      runner.start(mockLines);
      // 第二行只有5个字，大 deltaTime 一次性推进
      runner.start([mockLines[1]]);
      runner.update(10);
      expect(runner.getCurrent().displayedTxt).toBe('这是哪里？');
      expect(runner.getCurrent().isComplete).toBe(true);
    });

    it('textSpeed 可调', () => {
      runner.setTextSpeed(60);
      // 使用足够长的文本确保 60字/秒 × 0.1s = 6 字不超限
      runner.start([{ who: '测试', txt: '这是一段足够长的测试文本内容', tags: [] }]);
      runner.update(0.1);
      expect(runner.getCurrent().displayedTxt.length).toBe(6);
    });
  });

  describe('advance - 补全与推进', () => {
    it('逐字进行中 advance 补全当前行', () => {
      runner.start(mockLines);
      runner.update(0.05); // 推进部分字符
      const beforeLen = runner.getCurrent().displayedTxt.length;
      runner.advance();
      expect(runner.getCurrent().displayedTxt).toBe(mockLines[0].txt);
      expect(runner.getCurrent().isComplete).toBe(true);
    });

    it('已补全时 advance 进入下一行', () => {
      runner.start(mockLines);
      runner.update(10); // 补全第一行
      runner.advance(); // 进入第二行
      expect(runner.getCurrent().who).toBe('莞小鹅');
      expect(runner.getCurrent().displayedTxt).toBe('');
    });

    it('120ms 防连点：两次 advance 间隔小于 120ms 时第二次被忽略', () => {
      runner.start(mockLines);
      runner.update(10); // 补全第一行
      runner.advance(); // 进入第二行
      const whoAfterFirst = runner.getCurrent().who;
      runner.advance(); // 120ms 内再次 advance，应被忽略
      expect(runner.getCurrent().who).toBe(whoAfterFirst);
    });

    it('防连点 120ms 后可以正常 advance', () => {
      // 直接控制 performance.now 返回值，模拟时间流逝
      const nowSpy = vi.spyOn(performance, 'now');
      let mockTime = 1000;
      nowSpy.mockImplementation(() => mockTime);

      runner.start(mockLines); // lastAdvanceTime 重置为 0
      runner.update(10); // 补全第一行

      mockTime = 1000;
      runner.advance(); // 1000-0 >= 120，通过冷却，进入第二行
      expect(runner.getCurrent().who).toBe('莞小鹅');

      mockTime = 1130; // 130ms 后，冷却已过
      runner.advance(); // 补全第二行
      expect(runner.getCurrent().isComplete).toBe(true);

      nowSpy.mockRestore();
    });

    it('最后一行已补全时 advance 标记结束', () => {
      runner.start([mockLines[0]]);
      runner.update(10); // 补全
      runner.advance(); // 试图进入下一行，但已无更多行
      expect(runner.isFinished()).toBe(true);
    });
  });

  describe('标签解析', () => {
    it('进入带 tags 的行时触发事件', () => {
      const handler = vi.fn();
      eventBus.on('dialogue:tag', handler);
      runner.start([mockLines[1]]); // tags: ['疑惑']
      // start 时应触发标签事件
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({
        tag: '疑惑',
        who: '莞小鹅',
      }));
    });

    it('无 tags 的行不触发事件', () => {
      const handler = vi.fn();
      eventBus.on('dialogue:tag', handler);
      runner.start([mockLines[0]]); // tags: []
      expect(handler).not.toHaveBeenCalled();
    });

    it('多个标签触发多次事件', () => {
      const handler = vi.fn();
      eventBus.on('dialogue:tag', handler);
      runner.start([
        { who: '莞小鹅', txt: '测试多标签', tags: ['惊讶', '疑惑'] },
      ]);
      expect(handler).toHaveBeenCalledTimes(2);
    });
  });

  describe('skipLine - 跳过当前行', () => {
    it('直接补全当前行所有字符', () => {
      runner.start(mockLines);
      runner.skipLine();
      expect(runner.getCurrent().displayedTxt).toBe(mockLines[0].txt);
      expect(runner.getCurrent().isComplete).toBe(true);
    });
  });

  describe('skipAll - 跳过整段对话', () => {
    it('直接跳到对话末尾', () => {
      runner.start(mockLines);
      runner.skipAll();
      expect(runner.isFinished()).toBe(true);
    });
  });

  describe('isFinished - 结束检测', () => {
    it('未开始时返回 false', () => {
      expect(runner.isFinished()).toBe(false);
    });

    it('最后一行补全后返回 true', () => {
      runner.start([mockLines[0]]);
      runner.update(10);
      runner.advance();
      expect(runner.isFinished()).toBe(true);
    });

    it('中间行补全后返回 false', () => {
      runner.start(mockLines);
      runner.update(10);
      runner.advance();
      expect(runner.isFinished()).toBe(false);
    });
  });

  describe('getCurrent - 获取当前状态', () => {
    it('返回当前行的完整信息', () => {
      runner.start(mockLines);
      const current = runner.getCurrent();
      expect(current).toEqual({
        who: '旁白',
        txt: mockLines[0].txt,
        displayedTxt: '',
        tags: [],
        isComplete: false,
        lineIndex: 0,
        totalLines: 3,
      });
    });

    it('对话结束后返回 null', () => {
      runner.start([mockLines[0]]);
      runner.update(10);
      runner.advance();
      expect(runner.getCurrent()).toBeNull();
    });
  });

  describe('reset - 重置', () => {
    it('清空所有状态', () => {
      runner.start(mockLines);
      runner.update(10);
      runner.reset();
      expect(runner.isFinished()).toBe(false);
      expect(runner.getCurrent()).toBeNull();
    });
  });

  describe('DIALOGUE_NEXT 事件', () => {
    it('advance 进入下一行时触发 DIALOGUE_NEXT 事件', () => {
      const handler = vi.fn();
      eventBus.on(EVENT.DIALOGUE_NEXT, handler);
      runner.start(mockLines);
      runner.update(10); // 补全第一行
      // 120ms 后 advance
      vi.useFakeTimers();
      vi.advanceTimersByTime(130);
      runner.advance(); // 进入第二行，应触发事件
      expect(handler).toHaveBeenCalled();
      vi.useRealTimers();
    });
  });
});
