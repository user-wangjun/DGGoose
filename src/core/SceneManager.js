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
   */
  constructor({ eventBus } = {}) {
    this.scenes = new Map();
    this.current = null;
    this.currentName = null;
    this.history = [];
    /** @type {EventBus|null} 事件总线引用 */
    this.eventBus = eventBus || null;
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
   * 切换场景，执行 旧场景.onExit → 新场景.onEnter 生命周期
   * @param {string} name - 目标场景名
   * @param {*} [params] - 传给 onEnter 的参数
   */
  change(name, params) {
    const scene = this.scenes.get(name);
    if (!scene) {
      throw new Error(`场景未注册: ${name}`);
    }

    // 先退出当前场景（如果有），并压入历史栈
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

    // 广播场景切换事件（供音频路由、预加载等订阅）
    if (this.eventBus) {
      this.eventBus.emit(EVENT.SCENE_CHANGE, { name });
    }
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

    const prevName = this.history.pop();
    if (this.current && this.current.onExit) {
      this.current.onExit();
    }

    const prevScene = this.scenes.get(prevName);
    this.current = prevScene;
    this.currentName = prevName;
    if (prevScene && prevScene.onEnter) {
      prevScene.onEnter(params);
    }
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
  }

  /**
   * 转发 draw 给当前场景
   * @param {*} ctx
   */
  draw(ctx) {
    if (this.current && this.current.draw) {
      this.current.draw(ctx);
    }
  }
}
