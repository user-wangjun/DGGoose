import { EVENT } from '../config.js';

/** 防连点间隔（毫秒）：防止快速点击跳过两行 */
const ADVANCE_COOLDOWN = 120;

/**
 * 对话运行器（对应 PRD §5 F3 + Task 2.2）
 * 管理 typewriter 逐字显示、补全/推进逻辑、标签解析与跳段。
 * 通过 EventBus 广播对话推进与标签事件，与 UI 层解耦。
 */
export class DialogueRunner {
  /**
   * @param {Object} deps - 依赖注入
   * @param {EventBus} deps.eventBus - 事件总线
   * @param {number} deps.textSpeed - 逐字速度（字/秒），默认 30
   */
  constructor({ eventBus, textSpeed = 30 }) {
    this.eventBus = eventBus;
    this.textSpeed = textSpeed;
    this.lines = [];
    this.lineIndex = -1;
    this.displayedCount = 0;
    this.elapsed = 0;
    this.finished = false;
    this.lastAdvanceTime = 0;
  }

  /**
   * 开始一段对话，重置所有状态并从第一行开始
   * @param {Array<{who:string, txt:string, tags:string[]}>} lines - 对话行数组
   */
  start(lines) {
    this.lines = lines || [];
    this.lineIndex = -1;
    this.finished = this.lines.length === 0;
    this.displayedCount = 0;
    this.elapsed = 0;
    this.lastAdvanceTime = 0;
    if (!this.finished) {
      this._enterLine(0);
    }
  }

  /**
   * 按时间推进逐字显示
   * @param {number} deltaTime - 帧间隔（秒）
   */
  update(deltaTime) {
    if (this.finished || this.lineIndex < 0) return;

    const currentLine = this.lines[this.lineIndex];
    if (!currentLine) return;

    // 当前行已全部显示时不再推进
    if (this.displayedCount >= currentLine.txt.length) return;

    this.elapsed += deltaTime;
    // 按 textSpeed（字/秒）计算应显示的字符数
    const targetCount = Math.floor(this.elapsed * this.textSpeed);
    this.displayedCount = Math.min(targetCount, currentLine.txt.length);
  }

  /**
   * 推进对话（点击/空格时调用）
   * 正在逐字时 -> 补全当前行；已补全时 -> 进入下一行
   * 有 120ms 防连点保护
   */
  advance() {
    if (this.finished) return;

    // 防连点：两次 advance 间隔小于 120ms 时忽略
    const now = performance.now();
    if (now - this.lastAdvanceTime < ADVANCE_COOLDOWN) return;
    this.lastAdvanceTime = now;

    const currentLine = this.lines[this.lineIndex];
    if (!currentLine) return;

    // 正在逐字时：补全当前行
    if (this.displayedCount < currentLine.txt.length) {
      this.displayedCount = currentLine.txt.length;
      return;
    }

    // 已补全：进入下一行
    const nextIndex = this.lineIndex + 1;
    if (nextIndex >= this.lines.length) {
      // 最后一行已补全，标记对话结束
      this.finished = true;
      return;
    }

    this._enterLine(nextIndex);

    // 通知 UI 层对话已推进到下一行
    this.eventBus.emit(EVENT.DIALOGUE_NEXT, { lineIndex: nextIndex });
  }

  /**
   * 跳过当前行，直接补全所有字符
   */
  skipLine() {
    if (this.finished || this.lineIndex < 0) return;
    const currentLine = this.lines[this.lineIndex];
    if (currentLine) {
      this.displayedCount = currentLine.txt.length;
    }
  }

  /**
   * 跳过整段对话到结束
   */
  skipAll() {
    this.finished = true;
  }

  /**
   * 检查对话是否已结束
   * @returns {boolean}
   */
  isFinished() {
    return this.finished;
  }

  /**
   * 获取当前对话状态
   * @returns {Object|null} 当前行信息，对话结束时返回 null
   */
  getCurrent() {
    if (this.finished || this.lineIndex < 0 || this.lineIndex >= this.lines.length) {
      return null;
    }
    const line = this.lines[this.lineIndex];
    return {
      who: line.who,
      txt: line.txt,
      displayedTxt: line.txt.substring(0, this.displayedCount),
      tags: line.tags || [],
      isComplete: this.displayedCount >= line.txt.length,
      lineIndex: this.lineIndex,
      totalLines: this.lines.length,
    };
  }

  /**
   * 返回可持久化的逐字状态。
   * 对话行本身也写入快照，避免继续游戏时只恢复到章节开头而丢失当前段落。
   * @returns {{lines:Array, lineIndex:number, displayedCount:number, elapsed:number, finished:boolean}}
   */
  getSaveState() {
    return {
      lines: this.lines.map((line) => ({
        ...line,
        tags: Array.isArray(line?.tags) ? line.tags.slice() : [],
      })),
      lineIndex: this.lineIndex,
      displayedCount: this.displayedCount,
      elapsed: this.elapsed,
      finished: this.finished,
    };
  }

  /**
   * 从存档恢复逐字游标，不触发当前行标签，避免恢复时重复播放动作/音效。
   * @param {Object} state - getSaveState 返回的状态
   * @returns {Object|null} 恢复后的当前行
   */
  restoreSaveState(state) {
    const lines = Array.isArray(state?.lines) ? state.lines : [];
    this.lines = lines.map((line) => ({
      ...line,
      who: typeof line?.who === 'string' ? line.who : '',
      txt: typeof line?.txt === 'string' ? line.txt : '',
      tags: Array.isArray(line?.tags) ? line.tags.slice() : [],
    }));
    const maxIndex = this.lines.length - 1;
    this.lineIndex = Number.isInteger(state?.lineIndex)
      ? Math.max(-1, Math.min(state.lineIndex, maxIndex))
      : -1;
    const currentLine = this.lines[this.lineIndex];
    const maxDisplayed = currentLine?.txt?.length || 0;
    this.displayedCount = Number.isFinite(state?.displayedCount)
      ? Math.max(0, Math.min(state.displayedCount, maxDisplayed))
      : 0;
    this.elapsed = Number.isFinite(state?.elapsed) ? Math.max(0, state.elapsed) : 0;
    this.finished = Boolean(state?.finished);
    if (this.lines.length === 0) {
      this.lineIndex = -1;
      this.displayedCount = 0;
      this.finished = true;
    }
    this.lastAdvanceTime = 0;
    return this.getCurrent();
  }

  /**
   * 设置逐字速度
   * @param {number} speed - 字/秒
   */
  setTextSpeed(speed) {
    this.textSpeed = Math.max(1, speed);
  }

  /**
   * 重置所有状态，清空对话数据
   */
  reset() {
    this.lines = [];
    this.lineIndex = -1;
    this.displayedCount = 0;
    this.elapsed = 0;
    this.finished = false;
    this.lastAdvanceTime = 0;
  }

  /**
   * 进入指定行，重置逐字计数并触发标签事件
   * @param {number} index - 行索引
   * @private
   */
  _enterLine(index) {
    this.lineIndex = index;
    this.displayedCount = 0;
    this.elapsed = 0;

    // 解析标签并逐个触发事件，供角色帧切换
    const line = this.lines[index];
    if (line && line.tags) {
      for (const tag of line.tags) {
        this.eventBus.emit(EVENT.DIALOGUE_TAG, { tag, who: line.who });
      }
    }
  }
}
