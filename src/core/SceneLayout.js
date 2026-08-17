/**
 * 场景布局的几何与分层工具。
 *
 * 视觉、碰撞和互动不再各自维护一份“看起来差不多”的坐标：布局对象
 * 可以同时携带 visual、solidFootprint、interaction 和 renderLayer，场景
 * 再从同一对象派生控制器与绘制数据。
 */

/** 运行时场景物件的固定分层名称，便于场景按语义组织绘制。 */
export const RENDER_LAYERS = Object.freeze({
  GROUND: 'ground',
  ACTOR: 'actor',
  FOREGROUND: 'foreground',
  UI: 'ui',
});

/**
 * 创建可被视觉/碰撞/互动共同引用的布局对象。
 * @param {Object} config
 * @returns {Object}
 */
export function createSceneLayoutObject(config = {}) {
  const visual = config.visual ? { ...config.visual } : null;
  const solidFootprint = config.solidFootprint ? { ...config.solidFootprint } : null;
  const interaction = config.interaction ? { ...config.interaction } : null;
  const sortY = config.sortY ?? visual?.sortY ?? visual?.y ?? solidFootprint?.y ?? interaction?.y ?? 0;

  return {
    ...config,
    id: config.id,
    visual,
    solidFootprint,
    interaction,
    sortY,
    renderLayer: config.renderLayer || RENDER_LAYERS.GROUND,
  };
}

/** 从布局对象中取得 solid 足印，保留源对象 id 便于调试与报错。 */
export function getSolidFootprints(layout = []) {
  return layout
    .filter((object) => object?.solidFootprint?.width > 0 && object?.solidFootprint?.height > 0)
    .map((object) => ({
      ...object.solidFootprint,
      id: object.id,
      kind: object.kind || object.id,
      solid: true,
      layoutObject: object,
    }));
}

/** 按脚底 sortY 排序实体，保证角色和可穿行物件的遮挡顺序稳定。 */
export function sortBySortY(entities = []) {
  return [...entities].sort((a, b) => (a.sortY ?? a.y ?? 0) - (b.sortY ?? b.y ?? 0));
}

/** 将矩形向外扩张，用于带半径角色的导航和碰撞校验。 */
export function expandRect(rect, margin = 0) {
  const safeMargin = Math.max(0, Number(margin) || 0);
  return {
    ...rect,
    x: rect.x - safeMargin,
    y: rect.y - safeMargin,
    width: rect.width + safeMargin * 2,
    height: rect.height + safeMargin * 2,
  };
}

/** 点是否位于矩形内；导航校验使用 inclusive 边界避免擦边穿模。 */
export function pointInRect(point, rect) {
  return point.x >= rect.x
    && point.x <= rect.x + rect.width
    && point.y >= rect.y
    && point.y <= rect.y + rect.height;
}

/** 线段是否与矩形相交，采用 slab 算法，支持水平/垂直和大步长路线。 */
export function segmentIntersectsRect(start, end, rect) {
  let entering = 0;
  let exiting = 1;
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  const axes = [
    { origin: start.x, delta: deltaX, min: rect.x, max: rect.x + rect.width },
    { origin: start.y, delta: deltaY, min: rect.y, max: rect.y + rect.height },
  ];

  for (const axis of axes) {
    if (Math.abs(axis.delta) < 0.000001) {
      if (axis.origin < axis.min || axis.origin > axis.max) return false;
      continue;
    }

    const first = (axis.min - axis.origin) / axis.delta;
    const second = (axis.max - axis.origin) / axis.delta;
    entering = Math.max(entering, Math.min(first, second));
    exiting = Math.min(exiting, Math.max(first, second));
    if (entering > exiting) return false;
  }

  return exiting >= 0 && entering <= 1;
}

/** 角色中心点在指定半径下能否位于该位置。 */
export function canOccupyPoint(point, obstacles = [], radius = 0) {
  return !obstacles.some((obstacle) => pointInRect(point, expandRect(obstacle, radius)));
}

/** 检查带半径角色沿线段移动时是否不会穿过任何 solid。 */
export function isSegmentClear(start, end, obstacles = [], radius = 0) {
  return !obstacles.some((obstacle) => segmentIntersectsRect(start, end, expandRect(obstacle, radius)));
}

/**
 * 校验一条巡逻路线。问题保留为结构化结果，既可供测试断言，也可在开发
 * 调试层显示；路线本身不会因为调试而被静默修正。
 */
export function validateNavigationRoute(route = [], obstacles = [], { radius = 0, bounds = null } = {}) {
  const issues = [];
  const points = Array.isArray(route) ? route : [];

  points.forEach((point, index) => {
    if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) {
      issues.push({ type: 'invalid-node', index, point });
      return;
    }
    if (bounds && (point.x < bounds.left || point.x > bounds.right || point.y < bounds.top || point.y > bounds.bottom)) {
      issues.push({ type: 'out-of-bounds-node', index, point });
    }
    if (!canOccupyPoint(point, obstacles, radius)) {
      issues.push({ type: 'node-inside-solid', index, point });
    }
  });

  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    if (!start || !end || !Number.isFinite(start.x) || !Number.isFinite(end.x)) continue;
    if (!isSegmentClear(start, end, obstacles, radius)) {
      issues.push({ type: 'segment-through-solid', index: index - 1, start, end });
    }
  }

  return { valid: issues.length === 0 && points.length >= 2, issues };
}

/** 仅开发环境且显式带 query 时开启碰撞可视化，正式构建默认永远关闭。 */
export function isCollisionDebugEnabled() {
  if (globalThis.__GOOSE_COLLISION_DEBUG__ === true) return true;
  if (typeof window === 'undefined') return false;
  const isDev = typeof import.meta !== 'undefined' && import.meta.env?.DEV;
  return Boolean(isDev && new URLSearchParams(window.location.search).has('debugCollision'));
}

/** 绘制共享碰撞/互动调试层；不参与正常画面。 */
export function drawCollisionDebug(ctx, {
  obstacles = [],
  interactables = [],
  player = null,
  playerRadius = 0,
  spawn = null,
  exits = [],
  patrolRoute = [],
  boss = null,
  bossRadius = 0,
} = {}) {
  if (!ctx) return;
  ctx.save();
  ctx.lineWidth = 2;

  for (const obstacle of obstacles) {
    ctx.fillStyle = 'rgba(239, 68, 68, 0.16)';
    ctx.strokeStyle = 'rgba(248, 113, 113, 0.9)';
    ctx.fillRect(obstacle.x, obstacle.y, obstacle.width, obstacle.height);
    ctx.strokeRect(obstacle.x, obstacle.y, obstacle.width, obstacle.height);
    if (obstacle.id) {
      ctx.fillStyle = '#fecaca';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(obstacle.id, obstacle.x + 3, obstacle.y - 3);
    }
  }

  for (const target of interactables) {
    if (!Number.isFinite(target?.x) || !Number.isFinite(target?.y)) continue;
    const radius = target.radius ?? 0;
    ctx.strokeStyle = target.isExit ? 'rgba(96, 165, 250, 0.95)' : 'rgba(250, 204, 21, 0.9)';
    ctx.fillStyle = target.isExit ? 'rgba(96, 165, 250, 0.12)' : 'rgba(250, 204, 21, 0.10)';
    ctx.beginPath();
    ctx.arc(target.x, target.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  if (Array.isArray(patrolRoute) && patrolRoute.length > 1) {
    ctx.strokeStyle = 'rgba(45, 212, 191, 0.95)';
    ctx.setLineDash?.([8, 5]);
    ctx.beginPath();
    patrolRoute.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.stroke();
    ctx.setLineDash?.([]);
    for (const point of patrolRoute) {
      ctx.fillStyle = '#2dd4bf';
      ctx.beginPath();
      ctx.arc(point.x, point.y, 5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const drawPoint = (point, color, label) => {
    if (!point) return;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(point.x, point.y, 6, 0, Math.PI * 2);
    ctx.fill();
    if (label) {
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(label, point.x + 8, point.y + 6);
    }
  };
  drawPoint(spawn, '#a78bfa', 'spawn');
  exits.forEach((exit) => drawPoint(exit, '#60a5fa', exit.id || 'exit'));

  if (player) {
    ctx.strokeStyle = '#f8fafc';
    ctx.beginPath();
    ctx.arc(player.x, player.y, playerRadius, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (boss) {
    ctx.strokeStyle = '#fb7185';
    ctx.beginPath();
    ctx.arc(boss.x, boss.y, bossRadius, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}
