import { describe, it, expect, beforeEach } from 'vitest';
import { StealthLogic } from '../../src/core/StealthLogic.js';
import { validateNavigationRoute } from '../../src/core/SceneLayout.js';

/**
 * StealthLogic 烧鹅店潜行逻辑测试（对应 PRD §5 F6 + Task 3.5）
 *
 * 覆盖核心潜行逻辑：
 * - 老板巡逻：匀速往返（92px/s），边界 40 ~ W-40
 * - 警觉度系统：警戒区未藏好 +45/s，离开/藏好 -20/s，满值 100 触发被抓
 * - 掩体判定：近掩体 < 26px 算藏好，3 个掩体（桌底/木桶/门帘）
 * - 被抓触发：警觉度满值返回 true
 * - 烧鹅台到达判定：到达烧鹅台位置可偷尝
 */
describe('StealthLogic 烧鹅店潜行逻辑', () => {
  let logic;

  beforeEach(() => {
    // 标准配置：画布 1280×720，老板巡逻速度 92px/s
    logic = new StealthLogic({
      canvasWidth: 1280,
      canvasHeight: 720,
      patrolSpeed: 92,
      alertRate: 45,
      alertDecay: 20,
      alertMax: 100,
      coverThreshold: 26,
      bossY: 400,
      gooseTable: { x: 640, y: 200, radius: 30 },
    });
  });

  // ==================== 老板巡逻 ====================

  describe('老板巡逻', () => {
    it('初始位置在左边界 40，方向向右', () => {
      const pos = logic.getBossPosition();
      expect(pos.x).toBe(40);
      expect(pos.direction).toBe(1);
    });

    it('老板 Y 坐标固定为配置值', () => {
      expect(logic.getBossPosition().y).toBe(400);
    });

    it('以 92px/s 匀速向右巡逻', () => {
      logic.updateBoss(1.0); // 1 秒
      // 40 + 92 = 132
      expect(logic.getBossPosition().x).toBeCloseTo(132, 1);
    });

    it('0.5 秒后移动 46px', () => {
      logic.updateBoss(0.5);
      // 40 + 46 = 86
      expect(logic.getBossPosition().x).toBeCloseTo(86, 1);
    });

    it('到达右边界（W-40=1240）后反向为向左', () => {
      logic._setBossState(1230, 1); // 接近右边界
      logic.updateBoss(0.2); // 92*0.2=18.4，1230+18.4=1248.4 超过 1240
      const pos = logic.getBossPosition();
      expect(pos.x).toBe(1240);
      expect(pos.direction).toBe(-1);
    });

    it('到达左边界（40）后反向为向右', () => {
      logic._setBossState(50, -1); // 接近左边界
      logic.updateBoss(0.2); // 50-18.4=31.6 小于 40
      const pos = logic.getBossPosition();
      expect(pos.x).toBe(40);
      expect(pos.direction).toBe(1);
    });

    it('老板巡逻始终在 40 ~ W-40 区间内', () => {
      // 模拟长时间巡逻，确认不会越界
      for (let i = 0; i < 500; i++) {
        logic.updateBoss(0.05);
        const x = logic.getBossPosition().x;
        expect(x).toBeGreaterThanOrEqual(40);
        expect(x).toBeLessThanOrEqual(1240);
      }
    });

    it('反向后继续按反方向匀速移动', () => {
      logic._setBossState(1240, -1); // 在右边界，向左
      logic.updateBoss(1.0); // 向左移动 92
      expect(logic.getBossPosition().x).toBeCloseTo(1148, 1);
    });

    it('沿巡逻节点连续寻路，拐角处会消耗剩余移动距离并反向', () => {
      const routeLogic = new StealthLogic({
        canvasWidth: 1280,
        canvasHeight: 720,
        patrolSpeed: 100,
        alertRate: 45,
        alertDecay: 20,
        alertMax: 100,
        coverThreshold: 26,
        patrolRoute: [
          { x: 100, y: 440 },
          { x: 300, y: 440 },
          { x: 300, y: 520 },
          { x: 380, y: 520 },
        ],
      });

      expect(routeLogic.getBossPosition()).toMatchObject({ x: 100, y: 440, direction: 1 });
      routeLogic.updateBoss(2.5);

      // 先走完第一段 200px，再沿第二段向下走 50px，不能把剩余距离丢掉。
      expect(routeLogic.getBossPosition().x).toBeCloseTo(300, 1);
      expect(routeLogic.getBossPosition().y).toBeCloseTo(490, 1);

      routeLogic.updateBoss(1.2);
      // 走到末端后立即沿原路线反向，下一段应回到 x 方向。
      expect(routeLogic.getBossPosition().x).toBeCloseTo(370, 1);
      expect(routeLogic.getBossPosition().y).toBeCloseTo(520, 1);
      expect(routeLogic.getBossPosition().direction).toBe(-1);
    });

    it('以老板碰撞半径扩张 solid 后拒绝穿过障碍的节点和线段', () => {
      const obstacles = [{ id: 'counter', x: 200, y: 400, width: 120, height: 40 }];
      const blocked = validateNavigationRoute(
        [{ x: 100, y: 420 }, { x: 500, y: 420 }],
        obstacles,
        { radius: 18 },
      );
      const clear = validateNavigationRoute(
        [{ x: 100, y: 360 }, { x: 500, y: 360 }],
        obstacles,
        { radius: 18 },
      );

      expect(blocked.valid).toBe(false);
      expect(blocked.issues.some((issue) => issue.type === 'segment-through-solid')).toBe(true);
      expect(clear.valid).toBe(true);
    });

    it('路线节点和老板碰撞半径在完整往返周期内保持合法', () => {
      const obstacles = [
        { id: 'counter', x: 200, y: 300, width: 100, height: 80 },
        { id: 'table', x: 400, y: 460, width: 120, height: 40 },
      ];
      const route = [
        { x: 100, y: 420 },
        { x: 340, y: 420 },
        { x: 340, y: 560 },
        { x: 600, y: 560 },
      ];
      const routeCheck = validateNavigationRoute(route, obstacles, { radius: 18 });
      expect(routeCheck.valid).toBe(true);

      const routeLogic = new StealthLogic({
        canvasWidth: 1280,
        canvasHeight: 720,
        patrolSpeed: 92,
        alertRate: 45,
        alertDecay: 20,
        alertMax: 100,
        coverThreshold: 26,
        bossRadius: 18,
        patrolRoute: route,
        patrolObstacles: obstacles,
      });
      for (let frame = 0; frame < 900; frame += 1) {
        routeLogic.updateBoss(1 / 60);
        const position = routeLogic.getBossPosition();
        expect(routeCheck.valid).toBe(true);
        expect(position.x).toBeGreaterThanOrEqual(0);
        expect(position.x).toBeLessThanOrEqual(1280);
        expect(position.y).toBeGreaterThanOrEqual(0);
        expect(position.y).toBeLessThanOrEqual(720);
      }
    });

    it('大帧间隔跨越拐点仍保留真实方向，并支持被抓后的合法节点复位', () => {
      const routeLogic = new StealthLogic({
        canvasWidth: 1280,
        canvasHeight: 720,
        patrolSpeed: 100,
        alertRate: 45,
        alertDecay: 20,
        alertMax: 100,
        coverThreshold: 26,
        bossRadius: 18,
        patrolRoute: [
          { x: 100, y: 440 },
          { x: 300, y: 440 },
          { x: 300, y: 540 },
        ],
      });

      routeLogic.updateBoss(2.5);
      expect(routeLogic.getBossPosition()).toMatchObject({ x: 300, y: 490, angle: Math.PI / 2 });
      routeLogic.resetPatrol({ index: 1, travelDirection: -1 });
      expect(routeLogic.getBossPosition()).toMatchObject({ x: 300, y: 440, direction: -1 });
      routeLogic.updateBoss(0.2);
      expect(routeLogic.getBossPosition().x).toBeLessThan(300);
      expect(routeLogic.getBossPosition().angle).toBeCloseTo(Math.PI, 5);
    });

    it('上下拐角时手电筒仍跟随老板左右面向，而不是照向巡逻切线', () => {
      const routeLogic = new StealthLogic({
        canvasWidth: 1280,
        canvasHeight: 720,
        patrolSpeed: 100,
        alertRate: 45,
        alertDecay: 20,
        alertMax: 100,
        coverThreshold: 26,
        patrolRoute: [
          { x: 100, y: 440 },
          { x: 300, y: 440 },
          { x: 300, y: 540 },
        ],
      });

      routeLogic.updateBoss(2.5);
      const position = routeLogic.getBossPosition();

      expect(position.angle).toBeCloseTo(Math.PI / 2, 5);
      expect(position.direction).toBe(1);
      expect(position.flashlightAngle).toBe(0);
      expect(position.flashlightOrigin).toEqual({ x: 328, y: 470 });
      expect(routeLogic.isInFlashlight(500, 490, { range: 220, halfAngle: 0.35 })).toBe(true);
      expect(routeLogic.isInFlashlight(300, 650, { range: 220, halfAngle: 0.35 })).toBe(false);
    });

    it('没有巡逻路线时边界反向会同步手电筒朝向', () => {
      logic._setBossState(1230, 1);
      logic.updateBoss(0.2);

      const position = logic.getBossPosition();
      expect(position.direction).toBe(-1);
      expect(position.angle).toBe(Math.PI);
      expect(position.flashlightAngle).toBe(Math.PI);
      expect(logic.isInFlashlight(1000, 400, { range: 240, halfAngle: 0.35 })).toBe(true);
      expect(logic.isInFlashlight(1240, 400, { range: 240, halfAngle: 0.35 })).toBe(false);
    });
  });

  describe('手电筒视野', () => {
    it('只照亮老板朝向的光锥范围，而不是整片半圆', () => {
      expect(logic.isInFlashlight(220, 400, { range: 240, halfAngle: 0.35 })).toBe(true);
      expect(logic.isInFlashlight(220, 500, { range: 240, halfAngle: 0.35 })).toBe(false);
    });

    it('光锥被地图实体遮挡时不应继续发现玩家', () => {
      const blockedLogic = new StealthLogic({
        canvasWidth: 1280,
        canvasHeight: 720,
        patrolSpeed: 92,
        alertRate: 45,
        alertDecay: 20,
        alertMax: 100,
        coverThreshold: 26,
        bossY: 400,
        patrolObstacles: [{ x: 120, y: 380, width: 36, height: 48 }],
      });
      blockedLogic._setBossState(80, 1);

      expect(blockedLogic.isInFlashlight(240, 400, { range: 240, halfAngle: 0.35 })).toBe(false);
    });
  });

  // ==================== 警觉度系统 ====================

  describe('警觉度系统', () => {
    it('初始警觉度为 0', () => {
      expect(logic.getAlert()).toBe(0);
    });

    it('在警戒区且未藏好时警觉度 +45/s', () => {
      logic.updateAlert(1.0, true, false);
      expect(logic.getAlert()).toBeCloseTo(45, 1);
    });

    it('0.5 秒在警戒区未藏好警觉度增加 22.5', () => {
      logic.updateAlert(0.5, true, false);
      expect(logic.getAlert()).toBeCloseTo(22.5, 1);
    });

    it('离开警戒区后警觉度 -20/s', () => {
      logic.updateAlert(2.0, true, false); // 先升到 90
      logic.updateAlert(1.0, false, false); // 再降 20
      expect(logic.getAlert()).toBeCloseTo(70, 1);
    });

    it('藏好后即使仍在警戒区警觉度也下降 -20/s', () => {
      logic.updateAlert(2.0, true, false); // 升到 90
      logic.updateAlert(1.0, true, true); // 藏好，降 20
      expect(logic.getAlert()).toBeCloseTo(70, 1);
    });

    it('警觉度钳制在 0~100 以内', () => {
      // 持续在警戒区未藏好，超过满值后钳制
      logic.updateAlert(3.0, true, false); // 45*3=135，应钳制为 100
      expect(logic.getAlert()).toBe(100);
    });

    it('警觉度不为负', () => {
      logic.updateAlert(1.0, false, false); // 0-20=-20，应钳制为 0
      expect(logic.getAlert()).toBe(0);
    });

    it('resetAlert 将警觉度归零', () => {
      logic.updateAlert(2.0, true, false); // 升到 90
      logic.resetAlert();
      expect(logic.getAlert()).toBe(0);
    });

    it('不在警戒区且未藏好时警觉度下降（默认衰减）', () => {
      logic.updateAlert(1.0, true, false); // 升到 45
      logic.updateAlert(0.5, false, false); // 降 10
      expect(logic.getAlert()).toBeCloseTo(35, 1);
    });

    it('保存并恢复老板巡逻、警觉度和路线游标', () => {
      logic.updateBoss(1.37);
      logic.updateAlert(0.8, true, false);
      const snapshot = logic.getSaveState();

      const restored = new StealthLogic({
        canvasWidth: 1280,
        canvasHeight: 720,
        patrolSpeed: 92,
        alertRate: 45,
        alertDecay: 20,
        alertMax: 100,
        coverThreshold: 26,
        bossY: 400,
        gooseTable: { x: 640, y: 200, radius: 30 },
      });
      restored.restoreSaveState(snapshot);

      expect(restored.getSaveState()).toEqual(snapshot);
    });
  });

  // ==================== 被抓触发 ====================

  describe('被抓触发', () => {
    it('手电筒照中且未藏好时立即满警觉并触发被抓', () => {
      expect(logic.markCaughtIfVisible(true, false)).toBe(true);
      expect(logic.getAlert()).toBe(100);
      expect(logic.isCaught()).toBe(true);
    });

    it('手电筒照中但处于掩体时不触发即时抓捕', () => {
      expect(logic.markCaughtIfVisible(true, true)).toBe(false);
      expect(logic.getAlert()).toBe(0);
      expect(logic.isCaught()).toBe(false);
    });

    it('警觉度未满时不算被抓', () => {
      logic.updateAlert(1.0, true, false); // 45
      expect(logic.isCaught()).toBe(false);
    });

    it('警觉度满值（100）触发被抓', () => {
      logic.updateAlert(3.0, true, false); // 钳制到 100
      expect(logic.isCaught()).toBe(true);
    });

    it('警觉度从满值下降后不再处于被抓状态', () => {
      logic.updateAlert(3.0, true, false); // 满值
      expect(logic.isCaught()).toBe(true);
      logic.resetAlert();
      expect(logic.isCaught()).toBe(false);
    });

    it('初始状态不算被抓', () => {
      expect(logic.isCaught()).toBe(false);
    });
  });

  // ==================== 掩体判定 ====================

  describe('掩体判定', () => {
    // 3 个掩体：桌底 / 木桶 / 门帘
    const covers = [
      { x: 200, y: 500, name: '桌底' },
      { x: 600, y: 550, name: '木桶' },
      { x: 1000, y: 480, name: '门帘' },
    ];

    it('距掩体 < 26px 判定为已藏好', () => {
      // 距桌底中心 25px
      expect(logic.isNearCover(225, 500, covers)).toBe(true);
    });

    it('距掩体 >= 26px 不算藏好', () => {
      // 距桌底中心 26px（恰好在阈值边界外）
      expect(logic.isNearCover(226, 500, covers)).toBe(false);
    });

    it('距掩体较远不算藏好', () => {
      // 距所有掩体都很远
      expect(logic.isNearCover(500, 300, covers)).toBe(false);
    });

    it('3 个掩体中任一近则判定藏好', () => {
      // 靠近木桶
      expect(logic.isNearCover(610, 555, covers)).toBe(true);
      // 靠近门帘
      expect(logic.isNearCover(1010, 485, covers)).toBe(true);
    });

    it('空掩体数组返回 false', () => {
      expect(logic.isNearCover(200, 500, [])).toBe(false);
    });

    it('null 掩体返回 false', () => {
      expect(logic.isNearCover(200, 500, null)).toBe(false);
    });

    it('距桌底中心 25.9px 仍算藏好（边界内侧）', () => {
      // 精确构造距离 25.9：dx=25.9, dy=0
      expect(logic.isNearCover(225.9, 500, covers)).toBe(true);
    });
  });

  // ==================== 烧鹅台到达判定 ====================

  describe('烧鹅台到达判定', () => {
    it('到达烧鹅台中心判定为到达', () => {
      expect(logic.isAtGooseTable(640, 200)).toBe(true);
    });

    it('在烧鹅台判定半径内判定为到达', () => {
      // 距中心 29px（< radius 30）
      expect(logic.isAtGooseTable(669, 200)).toBe(true);
    });

    it('超出烧鹅台判定半径不算到达', () => {
      // 距中心 30px（>= radius 30）
      expect(logic.isAtGooseTable(670, 200)).toBe(false);
    });

    it('远离烧鹅台不算到达', () => {
      expect(logic.isAtGooseTable(100, 600)).toBe(false);
    });
  });
});
