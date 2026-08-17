/**
 * 场景物件的统一加载与绘制工具。
 * 图片失败时只绘制无结构纯色块，避免把 Canvas 几何图形误当成正式物件。
 */

function loadImage(url, assetLoader) {
  if (assetLoader?.loadImage) return assetLoader.loadImage(url).catch(() => null);
  if (typeof Image === 'undefined') return Promise.resolve(null);

  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

/** 按配置批量载入物件图，单张失败不影响同场景其它资源。 */
export async function loadSceneObjectAssets(assetLoader, assetSpecs) {
  const entries = await Promise.all(Object.entries(assetSpecs).map(async ([key, spec]) => (
    [key, await loadImage(spec.src, assetLoader)]
  )));
  return new Map(entries);
}

/** 绘制带脚底/底部锚点的单个物件，失败时只保留无结构的纯色块。 */
export function drawSceneObject(ctx, image, object, options = {}) {
  if (!ctx || !object) return false;
  const width = object.width ?? image?.naturalWidth ?? image?.width ?? 1;
  const height = object.height ?? image?.naturalHeight ?? image?.height ?? 1;
  const anchorX = object.anchorX ?? 0.5;
  const anchorY = object.anchorY ?? 1;

  ctx.save();
  ctx.globalAlpha = object.alpha ?? 1;
  ctx.translate(object.x, object.y);
  if (object.rotation) ctx.rotate(object.rotation);
  if (object.flipX) ctx.scale(-1, 1);

  if (image) {
    ctx.drawImage(image, -width * anchorX, -height * anchorY, width, height);
    ctx.restore();
    return true;
  }

  ctx.fillStyle = options.fallbackColor || object.fallbackColor || '#64748b';
  ctx.fillRect(-width * anchorX, -height * anchorY, width, height);
  ctx.restore();
  return false;
}

/** 依次绘制场景物件实例，调用方按 solid/interaction/foreground 分组传入。 */
export function drawSceneObjects(ctx, imageMap, objects = []) {
  for (const object of objects) {
    drawSceneObject(ctx, imageMap?.get(object.assetKey) || null, object, {
      fallbackColor: object.fallbackColor,
    });
  }
}

