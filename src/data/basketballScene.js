import { GAME } from '../config.js';

/**
 * 篮球馆正式背景与游戏逻辑共用 0~1 归一化坐标。
 * 这样 Canvas 逻辑尺寸、响应式 CSS 缩放和碰撞层永远使用同一套地图比例。
 */
export const BASKETBALL_MAP_BOUNDS = Object.freeze({
  left: 0.035,
  top: 0.34,
  right: 0.965,
  bottom: 0.955,
});

/** 球馆内真正会挡住莞小鹅的实体；球场线、地板、篮网和装饰阴影不在此表。 */
export const BASKETBALL_COLLIDERS = Object.freeze([
  { id: 'far-wall', kind: 'solid', x: 0.02, y: 0.02, width: 0.96, height: 0.075 },
  { id: 'left-bleachers', kind: 'solid', x: 0.105, y: 0.185, width: 0.31, height: 0.13 },
  { id: 'right-bleachers', kind: 'solid', x: 0.58, y: 0.185, width: 0.275, height: 0.13 },
  { id: 'scorer-table', kind: 'solid', x: 0.43, y: 0.255, width: 0.18, height: 0.075 },
  { id: 'entrance-door', kind: 'solid', x: 0.78, y: 0.205, width: 0.09, height: 0.105 },
  { id: 'left-lockers', kind: 'solid', x: 0.018, y: 0.225, width: 0.075, height: 0.17 },
  { id: 'right-lockers', kind: 'solid', x: 0.907, y: 0.225, width: 0.075, height: 0.17 },
  { id: 'equipment-area', kind: 'solid', x: 0.825, y: 0.18, width: 0.095, height: 0.18 },
  { id: 'left-hoop-support', kind: 'solid', x: 0.017, y: 0.48, width: 0.075, height: 0.16 },
  { id: 'left-hoop-backboard', kind: 'solid', x: 0.075, y: 0.385, width: 0.07, height: 0.095 },
  { id: 'right-hoop-support', kind: 'solid', x: 0.92, y: 0.48, width: 0.065, height: 0.16 },
  { id: 'right-hoop-backboard', kind: 'solid', x: 0.85, y: 0.385, width: 0.07, height: 0.095 },
]);

/** 教练与投篮点是可进入的互动热区，刻意不放入 solid 碰撞表。 */
export const BASKETBALL_INTERACTIONS = Object.freeze([
  {
    id: 'coach',
    kind: 'interaction',
    x: 0.275,
    y: 0.55,
    radius: 0.09,
    label: '教练',
    markerLabel: '教练',
    actionLabel: '交谈',
  },
  {
    id: 'shooting-spot',
    kind: 'interaction',
    // 右侧篮架的篮板/支架是实体，互动点放在球场内侧的可达脚底位置，
    // 不再把热区埋进篮板碰撞体里。投篮小游戏的 2D 侧视篮架由独立阶段绘制。
    x: 0.80,
    y: 0.56,
    radius: 0.10,
    label: '篮筐',
    markerLabel: '开始投篮',
    markerLabelOffset: 112,
    actionLabel: '挑战',
  },
]);

/** 地图初始出生点位于下方空旷球场，不覆盖任何正式障碍物。 */
export const BASKETBALL_PLAYER_START = Object.freeze({ x: 0.14, y: 0.78 });

/** 将归一化矩形转换为当前 Canvas 逻辑尺寸。 */
export function scaleBasketballRect(rect, width = GAME.WIDTH, height = GAME.HEIGHT) {
  return {
    ...rect,
    x: rect.x * width,
    y: rect.y * height,
    width: rect.width * width,
    height: rect.height * height,
  };
}

/** 将归一化点转换为当前 Canvas 逻辑尺寸。 */
export function scaleBasketballPoint(point, width = GAME.WIDTH, height = GAME.HEIGHT) {
  const scaled = {
    ...point,
    x: point.x * width,
    y: point.y * height,
  };
  if (typeof point.radius === 'number') {
    scaled.radius = point.radius * Math.min(width, height);
  }
  return scaled;
}

/**
 * 生成 TopdownController 可直接消费的地图对象。
 * width/height 只代表逻辑坐标，不读取 CSS 像素，响应式缩放由 ViewportAdapter 统一处理。
 */
export function createBasketballMap({ width = GAME.WIDTH, height = GAME.HEIGHT } = {}) {
  return {
    bounds: {
      left: BASKETBALL_MAP_BOUNDS.left * width,
      top: BASKETBALL_MAP_BOUNDS.top * height,
      right: BASKETBALL_MAP_BOUNDS.right * width,
      bottom: BASKETBALL_MAP_BOUNDS.bottom * height,
    },
    obstacles: BASKETBALL_COLLIDERS.map((collider) => scaleBasketballRect(collider, width, height)),
    interactables: BASKETBALL_INTERACTIONS.map((target) => scaleBasketballPoint(target, width, height)),
    playerStart: scaleBasketballPoint(BASKETBALL_PLAYER_START, width, height),
  };
}
