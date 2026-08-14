import { describe, it, expect, vi } from 'vitest';
import { SceneManager } from '../../src/core/SceneManager.js';
import { EventBus } from '../../src/core/EventBus.js';
import { EVENT } from '../../src/config.js';

/** 创建桩场景，记录生命周期调用顺序 */
function createStubScene(name) {
  return {
    name,
    onEnter: vi.fn(),
    update: vi.fn(),
    draw: vi.fn(),
    onExit: vi.fn(),
  };
}

describe('SceneManager 场景状态机', () => {
  it('register 注册场景后可获取', () => {
    const sm = new SceneManager();
    const scene = createStubScene('menu');
    sm.register('menu', scene);

    expect(sm.get('menu')).toBe(scene);
    expect(sm.has('menu')).toBe(true);
  });

  it('可以读取当前场景的精确恢复快照', () => {
    const sm = new SceneManager();
    const scene = createStubScene('play');
    scene.getSaveState = vi.fn(() => ({ phase: 'playing', player: { x: 42, y: 84 } }));
    sm.register('play', scene);

    sm.change('play');

    expect(sm.captureCurrentState()).toEqual({
      scene: 'play',
      state: { phase: 'playing', player: { x: 42, y: 84 } },
    });
  });

  it('change 切换场景时先 onExit 旧场景再 onEnter 新场景，顺序正确', () => {
    const sm = new SceneManager();
    const sceneA = createStubScene('A');
    const sceneB = createStubScene('B');
    sm.register('a', sceneA);
    sm.register('b', sceneB);

    const callOrder = [];
    sceneA.onExit.mockImplementation(() => callOrder.push('A.onExit'));
    sceneB.onEnter.mockImplementation(() => callOrder.push('B.onEnter'));

    // 首次进入场景 A
    sm.change('a');
    expect(sceneA.onEnter).toHaveBeenCalledTimes(1);
    expect(sm.current).toBe(sceneA);

    // 切换到 B
    sm.change('b');
    expect(callOrder).toEqual(['A.onExit', 'B.onEnter']);
    expect(sm.current).toBe(sceneB);
  });

  it('change 传入 params，onEnter 收到参数', () => {
    const sm = new SceneManager();
    const scene = createStubScene('test');
    sm.register('test', scene);

    sm.change('test', { level: 3, from: 'menu' });

    expect(scene.onEnter).toHaveBeenCalledWith({ level: 3, from: 'menu' });
  });

  it('提交切换前调用 beforeChange，且发生在旧场景 onExit 之前', () => {
    const order = [];
    const beforeChange = vi.fn(() => order.push('beforeChange'));
    const sm = new SceneManager({ beforeChange });
    const sceneA = createStubScene('A');
    const sceneB = createStubScene('B');
    sceneA.onExit.mockImplementation(() => order.push('A.onExit'));
    sceneB.onEnter.mockImplementation(() => order.push('B.onEnter'));
    sm.register('a', sceneA);
    sm.register('b', sceneB);

    sm.change('a');
    sm.change('b', { reason: 'resume' });

    expect(beforeChange).toHaveBeenLastCalledWith({
      fromName: 'a',
      toName: 'b',
      params: { reason: 'resume' },
    });
    expect(order).toEqual(['beforeChange', 'beforeChange', 'A.onExit', 'B.onEnter']);
  });

  it('场景切换后启动地图转场，初始化场景不启动', () => {
    const transition = { start: vi.fn(), update: vi.fn(), draw: vi.fn() };
    const sm = new SceneManager({ transition });
    const sceneA = createStubScene('A');
    const sceneB = createStubScene('B');
    sm.register('a', sceneA);
    sm.register('b', sceneB);

    sm.change('a');
    expect(transition.start).not.toHaveBeenCalled();

    sm.change('b', { chapterId: 'b' });
    expect(transition.start).toHaveBeenCalledWith({
      fromName: 'a',
      toName: 'b',
      params: { chapterId: 'b' },
    });
  });

  it('场景切换不会被 skipTransition 参数跳过', () => {
    const transition = { start: vi.fn(), update: vi.fn(), draw: vi.fn() };
    const sm = new SceneManager({ transition });
    sm.register('a', createStubScene('A'));
    sm.register('b', createStubScene('B'));

    sm.change('a');
    sm.change('b', { skipTransition: true });

    expect(transition.start).toHaveBeenCalledWith({
      fromName: 'a',
      toName: 'b',
      params: { skipTransition: true },
    });
  });

  it('获得印记后暂存场景切换，按空格确认后才启动地图转场', () => {
    const eventBus = new EventBus();
    const transition = { start: vi.fn(), update: vi.fn(), draw: vi.fn() };
    const sm = new SceneManager({ eventBus, transition });
    sm.register('a', createStubScene('A'));
    sm.register('b', createStubScene('B'));

    sm.change('a');
    eventBus.emit(EVENT.BADGE_GET, { badge: { id: 'factory_cert' } });

    expect(sm.change('b')).toBe(false);
    expect(sm.currentName).toBe('a');
    expect(transition.start).not.toHaveBeenCalled();

    expect(sm.confirmBadge()).toBe(true);
    expect(sm.currentName).toBe('b');
    expect(transition.start).toHaveBeenCalledWith({
      fromName: 'a',
      toName: 'b',
      params: undefined,
    });
  });

  it('update 与 draw 同时转发到地图转场层', () => {
    const transition = { start: vi.fn(), update: vi.fn(), draw: vi.fn() };
    const sm = new SceneManager({ transition });
    const scene = createStubScene('active');
    sm.register('active', scene);
    sm.change('active');

    const ctx = {};
    sm.update(0.016);
    sm.draw(ctx);

    expect(transition.update).toHaveBeenCalledWith(0.016);
    expect(transition.draw).toHaveBeenCalledWith(ctx);
  });

  it('切换到未注册场景抛出错误', () => {
    const sm = new SceneManager();

    expect(() => sm.change('unknown')).toThrow();
  });

  it('update/draw 转发给当前场景', () => {
    const sm = new SceneManager();
    const scene = createStubScene('active');
    sm.register('active', scene);
    sm.change('active');

    sm.update(0.016);
    sm.draw({});

    expect(scene.update).toHaveBeenCalledWith(0.016);
    expect(scene.draw).toHaveBeenCalledWith({});
  });

  it('无当前场景时 update/draw 不报错', () => {
    const sm = new SceneManager();

    expect(() => sm.update(0.016)).not.toThrow();
    expect(() => sm.draw({})).not.toThrow();
  });

  it('back 返回上一个场景并调用生命周期', () => {
    const sm = new SceneManager();
    const sceneA = createStubScene('A');
    const sceneB = createStubScene('B');
    sm.register('a', sceneA);
    sm.register('b', sceneB);

    sm.change('a');
    sm.change('b');
    expect(sm.current).toBe(sceneB);

    sm.back();

    expect(sceneB.onExit).toHaveBeenCalledTimes(1);
    expect(sceneA.onEnter).toHaveBeenCalledTimes(2);
    expect(sm.current).toBe(sceneA);
  });

  it('历史栈为空时 back 返回 false', () => {
    const sm = new SceneManager();
    const scene = createStubScene('only');
    sm.register('only', scene);
    sm.change('only');

    expect(sm.back()).toBe(false);
  });
});
