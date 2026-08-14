import { GAME } from '../config.js';
import {
  drawCollisionDebug,
  isCollisionDebugEnabled,
} from './SceneLayout.js';

const ZERO_INPUT = Object.freeze({ x: 0, y: 0, run: false });

/**
 * 判断互动目标在当前阶段是否可用。
 * 把条件集中在共享层，场景只描述“什么时候可用”，避免每个场景再写一套热区判断。
 * @param {Object} target - 互动目标
 * @returns {boolean}
 */
export function isInteractableAvailable(target) {
  if (!target) return false;
  if (typeof target.available === 'function') return Boolean(target.available());
  return target.available !== false;
}

/**
 * 在互动范围内寻找最近的可用目标。
 * @param {{x:number,y:number}} position - 玩家位置
 * @param {Array<Object>} targets - 互动目标列表
 * @returns {Object|null}
 */
export function findNearbyInteractable(position, targets = []) {
  if (!position || !Array.isArray(targets)) return null;

  return targets
    .filter((target) => isInteractableAvailable(target))
    .map((target) => ({
      target,
      distance: Math.hypot(position.x - target.x, position.y - target.y),
    }))
    .filter(({ target, distance }) => distance <= (target.radius ?? 72))
    .sort((a, b) => a.distance - b.distance)[0]?.target || null;
}

/**
 * 检查圆形角色是否与矩形碰撞层重叠。
 * @param {{x:number,y:number}} position - 角色中心
 * @param {Object} obstacle - 矩形障碍物
 * @param {number} radius - 角色碰撞半径
 * @returns {boolean}
 */
export function circleOverlapsRect(position, obstacle, radius) {
  const nearestX = Math.max(obstacle.x, Math.min(position.x, obstacle.x + obstacle.width));
  const nearestY = Math.max(obstacle.y, Math.min(position.y, obstacle.y + obstacle.height));
  return Math.hypot(position.x - nearestX, position.y - nearestY) < radius;
}

/**
 * 用分轴移动解决基础矩形碰撞。
 * 先尝试水平轴，再尝试垂直轴，让玩家贴着障碍物边缘滑动而不是被整帧卡死。
 * @param {{x:number,y:number}} from - 当前中心位置
 * @param {{x:number,y:number}} to - 控制器计算出的目标位置
 * @param {Object} options - 边界、碰撞层和角色半径
 * @returns {{x:number,y:number}}
 */
export function resolveTopdownMovement(from, to, {
  bounds = { left: 24, top: 80, right: GAME.WIDTH - 24, bottom: GAME.HEIGHT - 24 },
  obstacles = [],
  radius = 20,
} = {}) {
  const clamp = (position) => ({
    x: Math.max(bounds.left, Math.min(position.x, bounds.right)),
    y: Math.max(bounds.top, Math.min(position.y, bounds.bottom)),
  });
  const clamped = clamp(to);
  const canOccupy = (position) => !obstacles.some((obstacle) => circleOverlapsRect(position, obstacle, radius));

  // 点击移动和低帧率都可能一次请求几十/几百像素；逐小步检查，避免
  // “起点和终点都在障碍外”时直接穿过中间的实体。
  const distance = Math.hypot(clamped.x - from.x, clamped.y - from.y);
  const stepCount = Math.max(1, Math.ceil(distance / 8));
  let current = clamp(from);

  for (let stepIndex = 1; stepIndex <= stepCount; stepIndex += 1) {
    const progress = stepIndex / stepCount;
    const desired = {
      x: from.x + (clamped.x - from.x) * progress,
      y: from.y + (clamped.y - from.y) * progress,
    };
    const horizontal = clamp({ x: desired.x, y: current.y });
    const nextX = canOccupy(horizontal) ? horizontal.x : current.x;
    const vertical = clamp({ x: nextX, y: desired.y });
    const nextY = canOccupy(vertical) ? vertical.y : current.y;
    current = { x: nextX, y: nextY };
  }

  return current;
}

/**
 * 统一俯视场景控制器。
 * 负责移动、碰撞、靠近提示、互动动作和任务 HUD；各章节只需要提供地图对象与事件回调。
 */
export class TopdownController {
  /**
   * @param {Object} options - 控制器依赖
   * @param {import('./PlayerController.js').PlayerController} options.player - 共享玩家控制器
   * @param {import('./InputManager.js').InputManager} options.input - 统一输入
   * @param {HTMLElement} [options.container] - HUD 容器
   * @param {HTMLCanvasElement} [options.canvas] - 用于桌面点击移动的 Canvas
   * @param {string} [options.title] - 地点标题
   * @param {string} [options.objective] - 当前目标
   * @param {Function} [options.onInteract] - 互动回调
   * @param {Function} [options.onGroundClick] - 点击地面后的额外回调
   * @param {boolean} [options.debug] - 显式开启开发碰撞调试层
   */
  constructor({ player, input, container, canvas, title = '', objective = '', onInteract = null, onGroundClick = null, debug = false }) {
    this.player = player;
    this.input = input;
    this.container = container || null;
    this.canvas = canvas || (typeof document !== 'undefined' ? document.getElementById('game') : null);
    this.onInteract = onInteract;
    this.onGroundClick = onGroundClick;
    this.debug = Boolean(debug || isCollisionDebugEnabled());
    this.title = title;
    this.objective = objective;
    this.progress = '';
    this.exitStatus = '';
    this.bounds = { left: 24, top: 80, right: GAME.WIDTH - 24, bottom: GAME.HEIGHT - 24 };
    this.obstacles = [];
    this.interactables = [];
    this.playerRadius = 20;
    this.movementLocked = false;
    this.interactionEnabled = false;
    this.moveTarget = null;
    this.activeInteractable = null;
    this._blockedTargetFrames = 0;
    this.domRoot = null;
    this.promptElement = null;
    this.promptButton = null;
    this.objectiveElement = null;
    this.progressElement = null;
    this.exitElement = null;
    this._mounted = false;

    this._onAction = this._onAction.bind(this);
    this._onCanvasPointerDown = this._onCanvasPointerDown.bind(this);
  }

  /**
   * 挂载共享 HUD 和输入监听。
   * DOM 不承担地图坐标判定，只显示 Canvas 逻辑层已经算出的当前目标。
   */
  mount() {
    if (this._mounted) return;
    this._mounted = true;
    if (this.input?.onAction) this.input.onAction(this._onAction);
    if (this.canvas?.addEventListener) {
      this.canvas.addEventListener('pointerdown', this._onCanvasPointerDown);
    }
    this._buildHud();
  }

  /**
   * 配置当前地图的边界、障碍物和互动目标。
   * @param {Object} map - 地图配置
   */
  setMap({ bounds, obstacles, interactables, playerRadius } = {}) {
    if (bounds) this.bounds = { ...this.bounds, ...bounds };
    // 场景会在开门/解锁后只更新碰撞层；未传入的地图字段必须保留，
    // 否则出口等互动目标会在阶段切换时被默认空数组清掉。
    if (obstacles !== undefined) this.obstacles = obstacles;
    if (interactables !== undefined) this.interactables = interactables;
    if (playerRadius !== undefined) this.playerRadius = playerRadius;
    this._refreshActiveTarget();
  }

  /** 设置地点标题和当前目标。 */
  setSceneInfo(title, objective) {
    this.title = title || this.title;
    this.objective = objective || '';
    this._syncHud();
  }

  /** 设置任务进度文字。 */
  setProgress(progress) {
    this.progress = progress || '';
    this._syncHud();
  }

  /** 设置出口状态文字。 */
  setExitStatus(status) {
    this.exitStatus = status || '';
    this._syncHud();
  }

  /**
   * 开启或关闭地图阶段的互动提示。
   * @param {boolean} enabled - 是否允许寻找互动目标
   */
  setInteractionEnabled(enabled) {
    this.interactionEnabled = Boolean(enabled);
    this._refreshActiveTarget();
  }

  /**
   * 锁定角色移动并清除当前点击移动目标。
   * 对话、摘取反馈和局部小游戏都通过这个入口锁定。
   * @param {boolean} locked - 是否锁定
   */
  setMovementLocked(locked) {
    this.movementLocked = Boolean(locked);
    if (locked) {
      this.moveTarget = null;
      this._blockedTargetFrames = 0;
      this.input?.setJoystickVector?.(0, 0);
    }
    this._refreshActiveTarget();
  }

  /**
   * 每帧更新角色和当前互动目标。
   * @param {number} deltaTime - 秒
   */
  update(deltaTime) {
    if (!this.player?.update) return;

    const from = this._getPlayerPosition();
    if (this.movementLocked) {
      this.player.update(deltaTime, { getVector: () => ZERO_INPUT });
      this._refreshActiveTarget();
      return;
    }

    const vector = this._getMovementVector(from);
    this.player.update(deltaTime, { getVector: () => vector });
    const to = this._getPlayerPosition();
    const hadClickTarget = Boolean(this.moveTarget);
    const resolved = resolveTopdownMovement(from, to, {
      bounds: this.bounds,
      obstacles: this.obstacles,
      radius: this.playerRadius,
    });
    this.player.setPosition(resolved.x, resolved.y);
    this.player.syncResolvedMovement?.(from, resolved, deltaTime, vector);
    if (hadClickTarget) {
      const movedDistance = Math.hypot(resolved.x - from.x, resolved.y - from.y);
      const targetDistance = Math.hypot(this.moveTarget.x - resolved.x, this.moveTarget.y - resolved.y);
      if (movedDistance < 0.01 && targetDistance > 12) this._blockedTargetFrames += 1;
      else this._blockedTargetFrames = 0;
      // 点击障碍物后方时，短暂确认确实被挡住后清除目标，避免每帧持续顶墙。
      if (this._blockedTargetFrames >= 10) {
        this.moveTarget = null;
        this._blockedTargetFrames = 0;
      }
    }
    this._refreshActiveTarget();
  }

  /**
   * 主动触发当前目标。
   * @returns {boolean} 是否成功触发
   */
  handleInteract() {
    if (!this.interactionEnabled || this.movementLocked) return false;
    const target = this._refreshActiveTarget();
    if (!target || typeof this.onInteract !== 'function') return false;
    this.onInteract(target);
    return true;
  }

  /** 绘制障碍物的碰撞层可视化。 */
  drawObstacles(ctx, { fill = 'rgba(15, 23, 42, 0.58)', stroke = 'rgba(255,255,255,0.14)' } = {}) {
    if (!ctx) return;
    ctx.save();
    for (const obstacle of this.obstacles) {
      ctx.fillStyle = obstacle.fill || fill;
      ctx.fillRect(obstacle.x, obstacle.y, obstacle.width, obstacle.height);
      ctx.strokeStyle = obstacle.stroke || stroke;
      ctx.lineWidth = 2;
      ctx.strokeRect(obstacle.x, obstacle.y, obstacle.width, obstacle.height);
    }
    ctx.restore();
  }

  /** 只在开发环境显式打开时绘制共享碰撞、互动、出生点和巡逻调试层。 */
  drawDebug(ctx, options = {}) {
    if (!this.debug) return;
    drawCollisionDebug(ctx, {
      obstacles: this.obstacles,
      interactables: this.interactables,
      player: this._getPlayerPosition(),
      playerRadius: this.playerRadius,
      ...options,
    });
  }

  /**
   * 绘制地图中的互动标记、出口和当前目标高亮。
   * @param {CanvasRenderingContext2D} ctx - Canvas 上下文
   * @param {number} time - 场景累计时间
   */
  drawInteractables(ctx, time = 0) {
    if (!ctx || !this.interactionEnabled) return;
    const pulse = 0.5 + Math.sin(time * 4) * 0.5;
    const canvasScale = this._getCanvasScale(ctx);
    const logicalPixels = (screenPixels) => screenPixels / canvasScale;
    ctx.save();
    for (const target of this.interactables) {
      if (!isInteractableAvailable(target)) continue;
      const isActive = target === this.activeInteractable;
      const baseFontSize = isActive ? 14 : 12;
      // Canvas 在手机横屏时通常只有 0.54 倍 CSS 缩放；直接使用 12px
      // 会把目标名称压成 6px 左右，组件虽然存在但用户看不清。
      const fontSize = Math.max(baseFontSize, logicalPixels(12));
      // 正式 PNG 物件已经由场景层绘制；这里只保留当前目标文字，
      // 避免圆环/圆点再次伪装成齿轮、篮筐、围栏或图书馆。
      if (target.hideMarker) {
        if (target.markerLabel) {
          ctx.globalAlpha = isActive ? 0.98 : 0.82;
          ctx.font = `${isActive ? 700 : 600} ${fontSize}px Microsoft YaHei, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          ctx.fillStyle = '#fff8e7';
          ctx.fillText(target.markerLabel, target.x, target.y - (target.markerLabelOffset ?? 72));
        }
        continue;
      }
      if (target.isCharacter) {
        // 角色已有透明 Sprite；这里只保留必要的名字标签，避免圆点/圆环再次伪装成人物。
        ctx.globalAlpha = isActive ? 0.98 : 0.82;
        ctx.font = `${isActive ? 700 : 600} ${fontSize}px Microsoft YaHei, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillStyle = '#fff8e7';
        ctx.fillText(
          target.markerLabel || target.label || '',
          target.x,
          target.y - (target.characterLabelOffset ?? 86),
        );
        continue;
      }
      const radius = Math.max(target.markerRadius || 18, logicalPixels(18)) + (isActive ? pulse * 4 : 0);
      const color = target.isExit ? '#60a5fa' : isActive ? '#fbbf24' : '#d8b35f';

      ctx.globalAlpha = isActive ? 0.95 : 0.72;
      ctx.fillStyle = `${color}33`;
      ctx.beginPath();
      ctx.arc(target.x, target.y, radius + 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = isActive ? 3 : 2;
      ctx.beginPath();
      ctx.arc(target.x, target.y, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(target.x, target.y, 5, 0, Math.PI * 2);
      ctx.fill();

      ctx.font = `${isActive ? 700 : 600} ${fontSize}px Microsoft YaHei, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillStyle = '#fff8e7';
      ctx.fillText(target.markerLabel || target.label || '', target.x, target.y - radius - logicalPixels(8));
    }
    ctx.restore();
  }

  /**
   * 返回 Canvas 逻辑像素到 CSS 像素的缩放比例。
   * 逻辑测试上下文没有 canvas 时按 1 倍处理，真实手机/平板则按画框实际尺寸计算。
   */
  _getCanvasScale(ctx) {
    const canvas = ctx?.canvas;
    const rect = canvas?.getBoundingClientRect?.();
    const dpr = typeof window !== 'undefined' ? Math.max(1, Number(window.devicePixelRatio) || 1) : 1;
    const logicalWidth = canvas?.width ? canvas.width / dpr : GAME.WIDTH;
    const logicalHeight = canvas?.height ? canvas.height / dpr : GAME.HEIGHT;
    if (!rect?.width || !rect?.height || !logicalWidth || !logicalHeight) return 1;
    return Math.max(0.25, Math.min(rect.width / logicalWidth, rect.height / logicalHeight));
  }

  /**
   * 绘制莞小鹅的共享透明行走图，资源未加载时保留一个明确的临时角色占位。
   * @param {CanvasRenderingContext2D} ctx - Canvas 上下文
   * @param {Object} gooseSprite - GooseSprite 实例
   * @param {Object} [spriteOptions] - 仅影响显示尺寸，不改变逻辑碰撞半径
   */
  drawPlayer(ctx, gooseSprite, spriteOptions = {}) {
    if (!ctx || !this.player) return;
    const drawn = gooseSprite?.draw(ctx, this.player.x, this.player.y, spriteOptions) ?? false;
    if (drawn) return;

    const x = this.player.x;
    const y = this.player.y;
    const scaleX = Number.isFinite(spriteOptions.width) ? spriteOptions.width / 124 : 1;
    const scaleY = Number.isFinite(spriteOptions.height) ? spriteOptions.height / 124 : 1;
    ctx.save();
    ctx.fillStyle = '#c27a3e';
    ctx.beginPath();
    ctx.ellipse(x, y - 18 * scaleY, 23 * scaleX, 28 * scaleY, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f1c24b';
    ctx.beginPath();
    ctx.ellipse(
      x + (this.player.facing < 0 ? -16 : 16) * scaleX,
      y - 24 * scaleY,
      10 * scaleX,
      6 * scaleY,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    ctx.fillStyle = '#2a1b15';
    ctx.beginPath();
    ctx.arc(x + (this.player.facing < 0 ? -7 : 7) * scaleX, y - 29 * scaleY, 3 * Math.min(scaleX, scaleY), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /**
   * 返回俯视地图控制器的运行时快照。地图几何由章节代码在 onEnter 重建，
   * 这里只保存会随玩家离开位置变化的状态。
   */
  getSaveState() {
    return {
      player: this.player?.getSaveState?.() || this._getPlayerPosition(),
      moveTarget: this.moveTarget ? { ...this.moveTarget } : null,
      blockedTargetFrames: this._blockedTargetFrames,
      movementLocked: this.movementLocked,
      interactionEnabled: this.interactionEnabled,
      title: this.title,
      objective: this.objective,
      progress: this.progress,
      exitStatus: this.exitStatus,
    };
  }

  /** 恢复共享玩家、点击移动目标和 HUD 状态，并重新计算当前互动目标。 */
  restoreSaveState(state) {
    if (!state || typeof state !== 'object') return;
    this.player?.restoreSaveState?.(state.player);
    if (state.player && !this.player?.restoreSaveState) {
      this.player?.setPosition?.(state.player.x, state.player.y);
    }
    this.moveTarget = Number.isFinite(state.moveTarget?.x) && Number.isFinite(state.moveTarget?.y)
      ? { x: state.moveTarget.x, y: state.moveTarget.y }
      : null;
    this._blockedTargetFrames = Number.isFinite(state.blockedTargetFrames)
      ? Math.max(0, state.blockedTargetFrames)
      : 0;
    this.movementLocked = Boolean(state.movementLocked);
    this.interactionEnabled = Boolean(state.interactionEnabled);
    if (typeof state.title === 'string') this.title = state.title;
    if (typeof state.objective === 'string') this.objective = state.objective;
    if (typeof state.progress === 'string') this.progress = state.progress;
    if (typeof state.exitStatus === 'string') this.exitStatus = state.exitStatus;
    this._refreshActiveTarget();
  }

  /** 销毁共享 HUD 和监听。 */
  destroy() {
    if (this.input?.offAction) this.input.offAction(this._onAction);
    if (this.canvas?.removeEventListener) {
      this.canvas.removeEventListener('pointerdown', this._onCanvasPointerDown);
    }
    if (this.domRoot?.parentNode) this.domRoot.parentNode.removeChild(this.domRoot);
    this.domRoot = null;
    this.promptElement = null;
    this.promptButton = null;
    this._mounted = false;
    this.moveTarget = null;
    this.activeInteractable = null;
  }

  /** @private */
  _getPlayerPosition() {
    if (this.player?.position) return this.player.position;
    return { x: this.player?.x || 0, y: this.player?.y || 0 };
  }

  /** @private */
  _getMovementVector(position) {
    const inputVector = this.input?.getVector?.() || ZERO_INPUT;
    if (Math.hypot(inputVector.x, inputVector.y) > 0.01) {
      this.moveTarget = null;
      return inputVector;
    }
    if (!this.moveTarget) return ZERO_INPUT;

    const dx = this.moveTarget.x - position.x;
    const dy = this.moveTarget.y - position.y;
    const distance = Math.hypot(dx, dy);
    if (distance < 10) {
      this.moveTarget = null;
      return ZERO_INPUT;
    }
    return { x: dx / distance, y: dy / distance, run: false };
  }

  /** @private */
  _refreshActiveTarget() {
    if (!this.interactionEnabled || this.movementLocked) {
      this.activeInteractable = null;
    } else {
      this.activeInteractable = findNearbyInteractable(this._getPlayerPosition(), this.interactables);
    }
    this._syncHud();
    return this.activeInteractable;
  }

  /** @private */
  _onAction(action) {
    if (action === 'interact') this.handleInteract();
  }

  /** @private */
  _onCanvasPointerDown(event) {
    if (this.movementLocked || !this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const target = {
      x: ((event.clientX - rect.left) / rect.width) * GAME.WIDTH,
      y: ((event.clientY - rect.top) / rect.height) * GAME.HEIGHT,
    };
    this.moveTarget = {
      x: Math.max(this.bounds.left, Math.min(target.x, this.bounds.right)),
      y: Math.max(this.bounds.top, Math.min(target.y, this.bounds.bottom)),
    };
    this.onGroundClick?.(this.moveTarget);
  }

  /** @private */
  _buildHud() {
    if (!this.container || typeof document === 'undefined') return;
    this.domRoot = document.createElement('div');
    this.domRoot.setAttribute('data-topdown-hud', '');
    // Canvas 会在非 16:9 视口中留出黑边；HUD 必须跟随同一个游戏画框，
    // 否则手机上右侧任务/出口文字会漂到 Canvas 外的黑边区域。
    this.domRoot.style.cssText = 'position:fixed;top:50%;left:50%;width:var(--gxe-game-frame-width);height:var(--gxe-game-frame-height);transform:translate(-50%, -50%);z-index:120;pointer-events:none;font-family:inherit;';

    const title = document.createElement('div');
    title.setAttribute('data-topdown-title', '');
    title.style.cssText = 'position:absolute;top:max(12px,env(safe-area-inset-top));left:max(12px,env(safe-area-inset-left));padding:8px 12px;border:1px solid rgba(255,255,255,.18);border-radius:12px;background:rgba(11,18,28,.82);color:#fff8e7;font-size:17px;font-weight:700;box-shadow:0 8px 24px rgba(0,0,0,.22);';
    this.titleElement = title;

    this.objectiveElement = document.createElement('div');
    this.objectiveElement.setAttribute('data-topdown-objective', '');
    this.objectiveElement.style.cssText = 'position:absolute;top:max(12px,env(safe-area-inset-top));left:50%;transform:translateX(-50%);max-width:min(42vw,560px);padding:8px 14px;border:1px solid rgba(251,191,36,.3);border-radius:999px;background:rgba(11,18,28,.82);color:#fef3c7;font-size:13px;text-align:center;white-space:normal;';

    this.progressElement = document.createElement('div');
    this.progressElement.setAttribute('data-topdown-progress', '');
    this.progressElement.style.cssText = 'position:absolute;top:max(12px,env(safe-area-inset-top));right:max(12px,env(safe-area-inset-right));max-width:24vw;padding:8px 12px;border:1px solid rgba(255,255,255,.16);border-radius:10px;background:rgba(11,18,28,.82);color:#dbeafe;font-size:13px;text-align:right;';

    this.exitElement = document.createElement('div');
    this.exitElement.setAttribute('data-topdown-exit', '');
    this.exitElement.style.cssText = 'position:absolute;right:max(12px,env(safe-area-inset-right));top:58px;color:#bfdbfe;font-size:11px;text-align:right;max-width:30vw;';

    this.promptElement = document.createElement('div');
    this.promptElement.setAttribute('data-topdown-interaction', '');
    this.promptElement.style.cssText = 'position:absolute;left:50%;bottom:max(18px,env(safe-area-inset-bottom));transform:translateX(-50%);display:none;align-items:center;gap:10px;max-width:min(78vw,420px);padding:9px 12px 9px 15px;border:1px solid rgba(251,191,36,.45);border-radius:12px;background:rgba(10,16,25,.92);color:#fff8e7;font-size:14px;box-shadow:0 10px 28px rgba(0,0,0,.25);';

    const promptText = document.createElement('span');
    promptText.setAttribute('data-topdown-prompt-text', '');
    this.promptTextElement = promptText;
    this.promptElement.appendChild(promptText);

    this.promptButton = document.createElement('button');
    this.promptButton.type = 'button';
    this.promptButton.setAttribute('data-topdown-interact-button', '');
    this.promptButton.textContent = '互动';
    this.promptButton.style.cssText = 'min-width:60px;min-height:40px;padding:7px 12px;border:1px solid rgba(251,191,36,.7);border-radius:9px;background:#f59e0b;color:#2b1605;font:700 13px inherit;cursor:pointer;pointer-events:auto;';
    this.promptButton.addEventListener('click', () => this.handleInteract());
    this.promptElement.appendChild(this.promptButton);

    this.domRoot.append(title, this.objectiveElement, this.progressElement, this.exitElement, this.promptElement);
    this.container.appendChild(this.domRoot);
    this._syncHud();
  }

  /** @private */
  _syncHud() {
    if (!this.domRoot) return;
    this.titleElement.textContent = this.title;
    this.objectiveElement.textContent = this.objective;
    this.progressElement.textContent = this.progress;
    this.exitElement.textContent = this.exitStatus;

    const target = this.activeInteractable;
    if (!target || !this.interactionEnabled || this.movementLocked) {
      this.promptElement.style.display = 'none';
      return;
    }
    this.promptTextElement.textContent = `靠近：${target.label}`;
    const actionLabel = typeof target.actionLabel === 'function' ? target.actionLabel() : target.actionLabel;
    this.promptButton.textContent = actionLabel || '互动';
    this.promptElement.style.display = 'flex';
  }
}
