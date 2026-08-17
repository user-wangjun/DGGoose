import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../../src/core/EventBus.js';
import { StealthScene } from '../../src/scenes/StealthScene.js';

function createScene() {
  const dialogueBox = { show: vi.fn(), hide: vi.fn(), update: vi.fn() };
  const sceneManager = { change: vi.fn() };
  const scene = new StealthScene({
    sceneManager,
    eventBus: new EventBus(),
    badgeSystem: { unlockOrReveal: vi.fn() },
    dialogueRunner: {},
    dialogueBox,
    input: {},
    player: { x: 150, y: 580, facing: 1, setPosition: vi.fn() },
    container: document.createElement('div'),
    getChoice: () => null,
  });
  return { scene, dialogueBox, sceneManager };
}

describe('烧鹅店场景物件与交互契约', () => {
  it('掩体和烧鹅台使用 PNG 图层，且仍是非阻挡 interaction zone', () => {
    const { scene } = createScene();
    const interactables = scene._getInteractables();
    const covers = interactables.filter((target) => target.isCover);
    const table = interactables.find((target) => target.id === 'goose-table');
    const obstacles = scene._getObstacles();
    const leftCabinet = obstacles.find((obstacle) => obstacle.id === 'left-cabinet');
    const serviceCounter = obstacles.find((obstacle) => obstacle.id === 'service-counter');
    const display = obstacles.find((obstacle) => obstacle.id === 'roast-goose-display');
    const middleTable = obstacles.find((obstacle) => obstacle.id === 'table-middle-top');
    const rightTable = obstacles.find((obstacle) => obstacle.id === 'table-right-top');

    expect(covers).toHaveLength(3);
    expect(covers.every((target) => target.kind === 'interaction' && target.solid === false && target.hideMarker)).toBe(true);
    expect(table).toEqual(expect.objectContaining({ kind: 'interaction', solid: false, hideMarker: true }));
    expect(obstacles.every((obstacle) => obstacle.solid === true)).toBe(true);
    // 柜体碰撞不能向下伸进空地，展示柜则必须覆盖到底座，避免出现穿柜/撞空气。
    expect(leftCabinet).toEqual(expect.objectContaining({ x: 176, y: 200, width: 126, height: 168 }));
    expect(obstacles.find((obstacle) => obstacle.id === 'back-cabinet')).toEqual(
      expect.objectContaining({ x: 610, y: 190, width: 88, height: 112 }),
    );
    expect(serviceCounter).toEqual(expect.objectContaining({ x: 720, y: 190, width: 244, height: 124 }));
    expect(display).toEqual(expect.objectContaining({ x: 968, y: 178, width: 200, height: 150 }));
    expect(middleTable).toEqual(expect.objectContaining({ x: 718, y: 478, width: 142, height: 42 }));
    expect(rightTable).toEqual(expect.objectContaining({ x: 942, y: 478, width: 190, height: 42 }));
  });

  it('烧鹅台偷尝成功与店门逃出仍推进原有阶段', () => {
    const { scene, dialogueBox } = createScene();
    scene.phase = 'stealth';

    scene._onTopdownInteract({ id: 'goose-table' });
    expect(scene.hasStolen).toBe(true);
    expect(scene.phase).toBe('escaping');

    scene._onTopdownInteract({ id: 'shop-exit' });
    expect(scene.phase).toBe('outro');
    expect(dialogueBox.show).toHaveBeenCalled();
  });

  it('偷盗后被抓会丢失烧鹅，复位后必须重新进入潜行阶段', () => {
    const { scene } = createScene();
    scene.phase = 'stealth';
    scene.logic = {
      resetAlert: vi.fn(),
      resetPatrol: vi.fn(),
      getAlert: vi.fn(() => 0),
    };
    scene.topdown = {
      setSceneInfo: vi.fn(),
      setExitStatus: vi.fn(),
      setMovementLocked: vi.fn(),
      setInteractionEnabled: vi.fn(),
      setProgress: vi.fn(),
    };

    scene._onTopdownInteract({ id: 'goose-table' });
    expect(scene.hasStolen).toBe(true);
    expect(scene.phase).toBe('escaping');

    scene._onCaught();
    expect(scene.hasStolen).toBe(false);
    expect(scene.phase).toBe('caught');

    scene._onCaughtReset();
    expect(scene.hasStolen).toBe(false);
    expect(scene.phase).toBe('stealth');
    expect(scene.topdown.setSceneInfo).toHaveBeenLastCalledWith(
      '第三章 · 烧鹅店',
      '躲开老板视线，靠近掩体并前往烧鹅台',
    );
    expect(scene.topdown.setExitStatus).toHaveBeenLastCalledWith('出口：先拿到烧鹅');
  });

  it('手电筒照中且未藏好时立即抓捕，不等待警觉值爬满', () => {
    const { scene } = createScene();
    scene.phase = 'stealth';
    scene.logic = {
      updateBoss: vi.fn(),
      getBossPosition: vi.fn(() => ({ direction: 1 })),
      isInFlashlight: vi.fn(() => true),
      isNearCover: vi.fn(() => false),
      markCaughtIfVisible: vi.fn((inDangerZone, isHidden) => inDangerZone && !isHidden),
      getAlert: vi.fn(() => 100),
      isCaught: vi.fn(() => false),
    };
    scene.topdown = {
      setSceneInfo: vi.fn(),
      setMovementLocked: vi.fn(),
      setInteractionEnabled: vi.fn(),
      setProgress: vi.fn(),
    };

    scene._updateStealth(1 / 60);

    expect(scene.logic.markCaughtIfVisible).toHaveBeenCalledWith(true, false);
    expect(scene.phase).toBe('caught');
    expect(scene.topdown.setProgress).toHaveBeenCalledWith('警觉度 100% · 被发现');
    expect(scene.topdown.setSceneInfo).toHaveBeenCalledWith(
      '第三章 · 烧鹅店',
      '被手电筒照到了！烧鹅掉回去了，等待老板复位',
    );
  });

  it('尾声完成后释放尾声锁，选择留下可以进入第四章', () => {
    const { scene, sceneManager } = createScene();
    scene.phase = 'outro';
    scene.transitioning = true;

    scene._onOutroComplete();

    expect(scene.phase).toBe('choice');
    expect(scene.transitioning).toBe(false);
    scene._onChoiceStay({ sceneId: 'ch3' });

    expect(sceneManager.change).toHaveBeenCalledWith('ch4');
  });

  it('从存档恢复到抉择阶段时，留下按钮仍可推进', () => {
    const { scene, sceneManager } = createScene();

    scene._restoreSaveState({ phase: 'choice', transitioning: true });
    scene._onChoiceStay({ sceneId: 'ch3' });

    expect(sceneManager.change).toHaveBeenCalledWith('ch4');
  });
});
