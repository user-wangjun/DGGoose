import { describe, it, expect, vi } from 'vitest';
import { EventBus } from '../../src/core/EventBus.js';

describe('EventBus 事件总线', () => {
  it('on 订阅后 emit 触发回调并传递参数', () => {
    const bus = new EventBus();
    const handler = vi.fn();

    bus.on('test', handler);
    bus.emit('test', { value: 42 });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ value: 42 });
  });

  it('多个 on 订阅同一事件全部触发', () => {
    const bus = new EventBus();
    const h1 = vi.fn();
    const h2 = vi.fn();

    bus.on('go', h1);
    bus.on('go', h2);
    bus.emit('go');

    expect(h1).toHaveBeenCalledTimes(1);
    expect(h2).toHaveBeenCalledTimes(1);
  });

  it('off 解绑后不再触发', () => {
    const bus = new EventBus();
    const handler = vi.fn();

    bus.on('x', handler);
    bus.off('x', handler);
    bus.emit('x');

    expect(handler).not.toHaveBeenCalled();
  });

  it('off 只解绑指定 handler，其他 handler 不受影响', () => {
    const bus = new EventBus();
    const h1 = vi.fn();
    const h2 = vi.fn();

    bus.on('e', h1);
    bus.on('e', h2);
    bus.off('e', h1);
    bus.emit('e');

    expect(h1).not.toHaveBeenCalled();
    expect(h2).toHaveBeenCalledTimes(1);
  });

  it('once 只触发一次', () => {
    const bus = new EventBus();
    const handler = vi.fn();

    bus.once('once-test', handler);
    bus.emit('once-test');
    bus.emit('once-test');

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('off 解绑不存在的事件不报错', () => {
    const bus = new EventBus();

    expect(() => bus.off('nonexistent', () => {})).not.toThrow();
  });

  it('emit 触发不存在的事件不报错', () => {
    const bus = new EventBus();

    expect(() => bus.emit('nothing')).not.toThrow();
  });

  it('clear 清空所有订阅', () => {
    const bus = new EventBus();
    const h1 = vi.fn();
    const h2 = vi.fn();

    bus.on('a', h1);
    bus.on('b', h2);
    bus.clear();

    bus.emit('a');
    bus.emit('b');

    expect(h1).not.toHaveBeenCalled();
    expect(h2).not.toHaveBeenCalled();
  });
});
