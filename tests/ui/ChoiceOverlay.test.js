import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ChoiceOverlay } from '../../src/ui/ChoiceOverlay.js';
import { EventBus } from '../../src/core/EventBus.js';
import { EVENT } from '../../src/config.js';

/**
 * ChoiceOverlay 抉择覆盖层测试
 * 对应剧情分支设计 v4 §3 抉择规则：标题 + 两按钮 + 置灰态 + 事件广播。
 */
describe('ChoiceOverlay 抉择覆盖层', () => {
  let eventBus;
  let container;
  let overlay;

  beforeEach(() => {
    eventBus = new EventBus();
    container = document.createElement('div');
    document.body.appendChild(container);
    overlay = new ChoiceOverlay({ eventBus, container });
  });

  afterEach(() => {
    overlay.hide();
    if (container.parentNode) {
      container.parentNode.removeChild(container);
    }
  });

  it('show() 后容器内有抉择覆盖层 DOM', () => {
    overlay.show({
      title: '你要留下吗？',
      stayLabel: '留下',
      continueLabel: '继续探寻',
      stayDisabled: false,
      sceneId: 'ch1',
    });

    const el = container.querySelector('[data-choice-overlay]');
    expect(el).not.toBeNull();
  });

  it('show() 渲染标题和两按钮', () => {
    overlay.show({
      title: '你要留下吗？',
      stayLabel: '留下',
      continueLabel: '继续探寻',
      stayDisabled: false,
      sceneId: 'ch1',
    });

    const title = container.querySelector('[data-choice-title]');
    expect(title.textContent).toBe('你要留下吗？');

    const stayBtn = container.querySelector('[data-choice-stay]');
    expect(stayBtn.textContent).toBe('留下');
    expect(stayBtn.dataset.uiButton).toBe('');

    const continueBtn = container.querySelector('[data-choice-continue]');
    expect(continueBtn.textContent).toBe('继续探寻');
    expect(continueBtn.dataset.uiButton).toBe('');
  });

  it('stayDisabled=true 时"留下"按钮有 disabled 属性', () => {
    overlay.show({
      title: '测试',
      stayLabel: '留下',
      continueLabel: '继续',
      stayDisabled: true,
      sceneId: 'ch1',
    });

    const stayBtn = container.querySelector('[data-choice-stay]');
    expect(stayBtn.disabled).toBe(true);
  });

  it('stayDisabled=true 时"留下"按钮不响应点击（不触发 CHOICE_STAY）', () => {
    const handler = vi.fn();
    eventBus.on(EVENT.CHOICE_STAY, handler);

    overlay.show({
      title: '测试',
      stayLabel: '留下',
      continueLabel: '继续',
      stayDisabled: true,
      sceneId: 'ch1',
    });

    const stayBtn = container.querySelector('[data-choice-stay]');
    stayBtn.click();

    expect(handler).not.toHaveBeenCalled();
  });

  it('点击"留下"按钮触发 CHOICE_STAY 事件，携带 sceneId', () => {
    const handler = vi.fn();
    eventBus.on(EVENT.CHOICE_STAY, handler);

    overlay.show({
      title: '测试',
      stayLabel: '留下',
      continueLabel: '继续',
      stayDisabled: false,
      sceneId: 'ch1',
    });

    const stayBtn = container.querySelector('[data-choice-stay]');
    stayBtn.click();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ sceneId: 'ch1' });
  });

  it('点击"继续"按钮触发 CHOICE_CONTINUE 事件，携带 sceneId', () => {
    const handler = vi.fn();
    eventBus.on(EVENT.CHOICE_CONTINUE, handler);

    overlay.show({
      title: '测试',
      stayLabel: '留下',
      continueLabel: '继续探寻',
      stayDisabled: false,
      sceneId: 'ch2',
    });

    const continueBtn = container.querySelector('[data-choice-continue]');
    continueBtn.click();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ sceneId: 'ch2' });
  });

  it('hide() 后 DOM 被移除', () => {
    overlay.show({
      title: '测试',
      stayLabel: '留下',
      continueLabel: '继续',
      stayDisabled: false,
      sceneId: 'ch1',
    });

    overlay.hide();

    const el = container.querySelector('[data-choice-overlay]');
    expect(el).toBeNull();
  });
});
