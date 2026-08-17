/**
 * 运行中存档协调器。
 *
 * 存档必须发生在场景 onExit 之前，否则场景清理会把玩家位置和当前阶段
 * 重置成初始值。这个协调器同时覆盖“返回主菜单”和移动端页面生命周期，
 * 让所有退出路径都复用同一份当前场景快照。
 */
export class RunSaveController {
  /**
   * @param {Object} deps
   * @param {Object} deps.sceneManager
   * @param {Object} deps.saveSystem
   * @param {Object} deps.badgeSystem
   * @param {Object} deps.settingsService
   */
  constructor({ sceneManager, saveSystem, badgeSystem, settingsService }) {
    this.sceneManager = sceneManager;
    this.saveSystem = saveSystem;
    this.badgeSystem = badgeSystem;
    this.settingsService = settingsService;
    this.windowTarget = null;
    this.documentTarget = null;

    this._onBeforeUnload = this._onBeforeUnload.bind(this);
    this._onPageHide = this._onPageHide.bind(this);
    this._onVisibilityChange = this._onVisibilityChange.bind(this);
  }

  /**
   * 捕获并写入当前可玩的场景。
   * 必须在 SceneManager 调用当前场景 onExit 之前执行。
   * @returns {boolean} 是否实际写入了一份快照
   */
  saveCurrentRun() {
    if (!this.sceneManager || ['menu', 'chapterSelect'].includes(this.sceneManager.currentName)) {
      return false;
    }

    const snapshot = this.sceneManager.captureCurrentState?.();
    if (!snapshot) return false;

    try {
      this.saveSystem.autoSave({
        chapter: snapshot.scene,
        checkpoint: snapshot.state,
        badges: this.badgeSystem?.unlockedIds?.slice?.() || [],
        settings: this.settingsService?.getAll?.() || {},
        ending: snapshot.state?.endingId || null,
      });
      return true;
    } catch {
      // 页面退出阶段不能因为 localStorage 不可写而阻断场景切换；
      // 下次进入时 SaveSystem 仍会按旧存档的完整性规则拒绝坏数据。
      return false;
    }
  }

  /**
   * SceneManager 的切换前钩子。只拦截真正离开玩法的菜单入口，
   * 避免章节内部切换把“章节完成快照”提前覆盖掉。
   * @param {{toName?: string}} change
   */
  onBeforeSceneChange({ toName } = {}) {
    if (toName !== 'menu') return false;
    return this.saveCurrentRun();
  }

  /**
   * 绑定页面关闭、切后台和 bfcache 进入前的生命周期事件。
   * @param {Object} [targets]
   * @param {EventTarget} [targets.windowTarget]
   * @param {EventTarget} [targets.documentTarget]
   */
  bindLifecycle({ windowTarget = globalThis.window, documentTarget = globalThis.document } = {}) {
    this.windowTarget = windowTarget || null;
    this.documentTarget = documentTarget || null;

    this.windowTarget?.addEventListener('beforeunload', this._onBeforeUnload);
    this.windowTarget?.addEventListener('pagehide', this._onPageHide);
    this.documentTarget?.addEventListener('visibilitychange', this._onVisibilityChange);
    return this;
  }

  /** 解除生命周期监听，便于测试或宿主重建。 */
  unbindLifecycle() {
    this.windowTarget?.removeEventListener('beforeunload', this._onBeforeUnload);
    this.windowTarget?.removeEventListener('pagehide', this._onPageHide);
    this.documentTarget?.removeEventListener('visibilitychange', this._onVisibilityChange);
    this.windowTarget = null;
    this.documentTarget = null;
  }

  /** @private */
  _onBeforeUnload() {
    this.saveCurrentRun();
  }

  /** @private */
  _onPageHide() {
    this.saveCurrentRun();
  }

  /** @private */
  _onVisibilityChange() {
    if (this.documentTarget?.visibilityState === 'hidden') {
      this.saveCurrentRun();
    }
  }
}
