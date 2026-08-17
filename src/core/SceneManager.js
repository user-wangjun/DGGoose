/**
 * 场景管理器：场景状态机
 * 负责场景注册、切换（onExit→onEnter 生命周期）与历史栈返回。
 * 每个场景需实现 { onEnter(params), update(dt), draw(ctx), onExit() } 接口。
 */
import { EVENT } from '../config.js';

export class SceneManager {
  /**
   * @param {Object} [options] - 初始化选项
   * @param {EventBus} [options.eventBus] - 事件总线（可选，用于广播场景切换事件）
   * @param {Object} [options.transition] - 可选的场景转场叠加层
   * @param {Function|null} [options.beforeChange] - 提交场景切换前调用的钩子
   */
  constructor({ eventBus, transition = null, beforeChange = null } = {}) {
    this.scenes = new Map();
    this.current = null;
    this.currentName = null;
    this.history = [];
    /** @type {EventBus|null} 事件总线引用 */
    this.eventBus = eventBus || null;
    /** @type {Object|null} 地图转场叠加层 */
    this.transition = transition;
    /** @type {Function|null} 提交切换前的钩子；用于保存旧场景快照 */
    this.beforeChange = typeof beforeChange === 'function' ? beforeChange : null;
    /** @type {boolean} 新印记展示期间，暂停提交下一场景 */
    this.badgeGateActive = false;
    /** @type {{type:'change'|'back', name?:string, params?:*}|null} 待印记确认的场景操作 */
    this.pendingSceneChange = null;
    this._onBadgeGet = this._onBadgeGet.bind(this);
    if (this.eventBus) {
      this.eventBus.on(EVENT.BADGE_GET, this._onBadgeGet);
    }
  }

  /**
   * 注册场景
   * @param {string} name - 场景唯一标识
   * @param {Object} scene - 场景对象
   */
  register(name, scene) {
    this.scenes.set(name, scene);
  }

  /**
   * 是否已注册某场景
   * @param {string} name
   * @returns {boolean}
   */
  has(name) {
    return this.scenes.has(name);
  }

  /**
   * 获取已注册的场景对象
   * @param {string} name
   * @returns {Object|undefined}
   */
  get(name) {
    return this.scenes.get(name);
  }

  /**
   * 设置提交场景切换前的钩子。钩子在旧场景 onExit 之前执行，
   * 适合保存“实际退出点”而不依赖调用方记住每一条路由。
   * @param {Function|null} handler
   */
  setBeforeChange(handler) {
    this.beforeChange = typeof handler === 'function' ? handler : null;
    return this;
  }

  /**
   * 捕获当前场景的可持久化状态。没有实现快照的菜单/旧场景返回 null，
   * 由入口层决定是否只保存章节完成兼容字段。
   * @returns {{scene:string,state:Object}|null}
   */
  captureCurrentState() {
    if (!this.current || !this.currentName || typeof this.current.getSaveState !== 'function') {
      return null;
    }
    const state = this.current.getSaveState();
    if (!state || typeof state !== 'object') return null;
    return { scene: this.currentName, state };
  }

  /**
   * 切换场景，执行 旧场景.onExit → 新场景.onEnter 生命周期
   * @param {string} name - 目标场景名
   * @param {*} [params] - 传给 onEnter 的参数
   */
  change(name, params) {
    const scene = this.scenes.get(name);
    if (!scene) {
      throw new Error(`场景未注册: ${name}`);
    }

    if (this.badgeGateActive) {
      this.pendingSceneChange = { type: 'change', name, params };
      return false;
    }

    return this._commitChange(name, params);
  }

  /**
   * 确认已获得的印记，并提交之前被挂起的场景操作。
   * 由印记展示层在玩家按空格后调用。
   * @returns {boolean} 是否消费了一次印记确认
   */
  confirmBadge() {
    if (!this.badgeGateActive) return false;

    this.badgeGateActive = false;
    const pending = this.pendingSceneChange;
    this.pendingSceneChange = null;
    if (!pending) return true;

    if (pending.type === 'back') {
      return this._commitBack(pending.params);
    }
    return this._commitChange(pending.name, pending.params);
  }

  /** @private */
  _onBadgeGet(data) {
    if (!data?.badge) return;
    this.badgeGateActive = true;
    this.pendingSceneChange = null;
  }

  /** @private */
  _commitChange(name, params) {
    const scene = this.scenes.get(name);
    if (!scene) {
      throw new Error(`场景未注册: ${name}`);
    }

    // 先退出当前场景（如果有），并压入历史栈
    const previousName = this.currentName;
    this.beforeChange?.({ fromName: previousName, toName: name, params });
    if (this.current && this.currentName) {
      if (this.current.onExit) {
        this.current.onExit();
      }
      this.history.push(this.currentName);
    }

    // 进入新场景
    this.current = scene;
    this.currentName = name;
    if (scene.onEnter) {
      scene.onEnter(params);
    }

    this._startTransition(previousName, name, params);

    // 广播场景切换事件（供音频路由、预加载等订阅）
    if (this.eventBus) {
      this.eventBus.emit(EVENT.SCENE_CHANGE, { name });
    }
    return true;
  }

  /**
   * 返回上一个场景，执行当前 onExit → 上一个 onEnter
   * @param {*} [params] - 传给 onEnter 的参数
   * @returns {boolean} 是否成功返回
   */
  back(params) {
    if (this.history.length === 0) {
      return false;
    }

    if (this.badgeGateActive) {
      this.pendingSceneChange = { type: 'back', params };
      return true;
    }

    return this._commitBack(params);
  }

  /** @private */
  _commitBack(params) {
    if (this.history.length === 0) {
      return false;
    }

    const prevName = this.history.pop();
    const previousName = this.currentName;
    this.beforeChange?.({ fromName: previousName, toName: prevName, params });
    if (this.current && this.current.onExit) {
      this.current.onExit();
    }

    const prevScene = this.scenes.get(prevName);
    this.current = prevScene;
    this.currentName = prevName;
    if (prevScene && prevScene.onEnter) {
      prevScene.onEnter(params);
    }
    this._startTransition(previousName, prevName, params);
    return true;
  }

  /**
   * 转发 update 给当前场景
   * @param {number} deltaTime
   */
  update(deltaTime) {
    if (this.current && this.current.update) {
      this.current.update(deltaTime);
    }
    if (this.transition && this.transition.update) {
      this.transition.update(deltaTime);
    }
  }

  /**
   * 转发 draw 给当前场景
   * @param {*} ctx
   */
  draw(ctx) {
    if (this.current && this.current.draw) {
      this.current.draw(ctx);
    }
    if (this.transition && this.transition.draw) {
      this.transition.draw(ctx);
    }
  }

  /**
   * 启动完整地图转场；初始化场景或没有目标转场时保持原行为。
   * @param {string|null} fromName
   * @param {string} toName
   * @param {*} params
   * @private
   */
  _startTransition(fromName, toName, params) {
    if (!this.transition || !fromName) return;
    const scene = this.scenes.get(toName);
    const readyPromise = scene?.getAssetReadyPromise?.();
    const transitionOptions = { fromName, toName, params };
    if (readyPromise && typeof readyPromise.then === 'function') {
      transitionOptions.readyPromise = readyPromise;
    }
    this.transition.start(transitionOptions);
  }
}
