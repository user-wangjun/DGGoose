import { describe, it, expect, vi } from 'vitest';
import { SceneManager } from '../../src/core/SceneManager.js';

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
