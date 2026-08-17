import { describe, expect, it, vi } from 'vitest';
import { RunSaveController } from '../../src/core/RunSaveController.js';
import { SceneManager } from '../../src/core/SceneManager.js';

function createController(sceneManager, saveSystem = { autoSave: vi.fn() }) {
  return {
    controller: new RunSaveController({
      sceneManager,
      saveSystem,
      badgeSystem: { unlockedIds: ['factory_cert'] },
      settingsService: { getAll: () => ({ bgm: 70, sfx: 55 }) },
    }),
    saveSystem,
  };
}

describe('RunSaveController 运行中存档协调', () => {
  it('在旧场景 onExit 前保存实际退出点，而不是清理后的初始位置', () => {
    const state = { x: 742, y: 418 };
    const playScene = {
      getSaveState: vi.fn(() => ({ phase: 'explore', player: { ...state } })),
      onExit: vi.fn(() => {
        state.x = 130;
        state.y = 600;
      }),
      onEnter: vi.fn(),
    };
    const menuScene = { onEnter: vi.fn(), onExit: vi.fn() };
    const sceneManager = new SceneManager();
    sceneManager.register('play', playScene);
    sceneManager.register('menu', menuScene);
    const { controller, saveSystem } = createController(sceneManager);

    sceneManager.setBeforeChange((change) => controller.onBeforeSceneChange(change));
    sceneManager.change('play');
    sceneManager.change('menu');

    expect(saveSystem.autoSave).toHaveBeenCalledWith(expect.objectContaining({
      chapter: 'play',
      checkpoint: { phase: 'explore', player: { x: 742, y: 418 } },
    }));
    expect(playScene.onExit).toHaveBeenCalledOnce();
    expect(playScene.getSaveState).toHaveBeenCalledBefore(playScene.onExit);
  });

  it('页面隐藏、pagehide 和 beforeunload 都保存当前运行快照', () => {
    const sceneManager = {
      currentName: 'play',
      captureCurrentState: vi.fn(() => ({ scene: 'play', state: { phase: 'playing' } })),
    };
    const saveSystem = { autoSave: vi.fn() };
    const { controller } = createController(sceneManager, saveSystem);
    const windowTarget = new EventTarget();
    const documentTarget = new EventTarget();
    Object.defineProperty(documentTarget, 'visibilityState', {
      configurable: true,
      value: 'visible',
      writable: true,
    });
    controller.bindLifecycle({ windowTarget, documentTarget });

    documentTarget.visibilityState = 'hidden';
    documentTarget.dispatchEvent(new Event('visibilitychange'));
    windowTarget.dispatchEvent(new Event('pagehide'));
    windowTarget.dispatchEvent(new Event('beforeunload'));

    expect(saveSystem.autoSave).toHaveBeenCalledTimes(3);
    controller.unbindLifecycle();
    windowTarget.dispatchEvent(new Event('pagehide'));
    expect(saveSystem.autoSave).toHaveBeenCalledTimes(3);
  });

  it('菜单与章节选择不是可恢复玩法点，不会误写存档', () => {
    const sceneManager = {
      currentName: 'menu',
      captureCurrentState: vi.fn(),
    };
    const { controller, saveSystem } = createController(sceneManager);

    expect(controller.saveCurrentRun()).toBe(false);
    sceneManager.currentName = 'chapterSelect';
    expect(controller.saveCurrentRun()).toBe(false);
    expect(saveSystem.autoSave).not.toHaveBeenCalled();
    expect(sceneManager.captureCurrentState).not.toHaveBeenCalled();
  });
});
