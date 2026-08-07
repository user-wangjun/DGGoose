/**
 * 观赏互动点数据（对应 PRD §5 F8）
 *
 * 工业园区与 DGUT 校园各 3 个发光互动点，点击弹出台词气泡。
 * 结构: { id, scene, name, text, x, y }
 * - id: 互动点唯一标识
 * - scene: 所属场景（ch4 工业园区 / ch5 DGUT）
 * - name: 互动点名称
 * - text: 触发台词
 * - x/y: 互动点在画布逻辑坐标系中的位置（占位坐标，美术接入后微调）
 */
export const HOTSPOTS = [
  // ==================== 工业园区（第四章） ====================
  {
    id: 'industrial_smart_workshop',
    scene: 'ch4',
    name: '智能车间',
    text: '科技兴国——机械臂的每一次起落，都是智慧的舞蹈。',
    x: 320,
    y: 280,
  },
  {
    id: 'industrial_drone_pad',
    scene: 'ch4',
    name: '无人机坪',
    text: '无人机掠过厂房上空，东莞的天空也在起飞。',
    x: 640,
    y: 200,
  },
  {
    id: 'industrial_worker_silhouette',
    scene: 'ch4',
    name: '工人剪影',
    text: '工人阶级真伟大——每一颗螺丝都拧得出汗水的重量。',
    x: 960,
    y: 320,
  },

  // ==================== DGUT 校园（第五章） ====================
  {
    id: 'campus_library',
    scene: 'ch5',
    name: '图书馆',
    text: '教育兴邦——笔尖沙沙响，是城市的心跳。',
    x: 320,
    y: 260,
  },
  {
    id: 'campus_study_window',
    scene: 'ch5',
    name: '自习室窗',
    text: '深夜的灯还亮着，少年的梦还醒着。',
    x: 640,
    y: 200,
  },
  {
    id: 'campus_path',
    scene: 'ch5',
    name: '校道',
    text: '学长说："毕业后去造芯片，把知识变成产品。"',
    x: 960,
    y: 300,
  },
];

/**
 * 按场景筛选互动点
 * @param {string} scene - 场景 id（如 'ch4'）
 * @returns {Array} 该场景的互动点数组
 */
export function getHotspotsByScene(scene) {
  return HOTSPOTS.filter((spot) => spot.scene === scene);
}
