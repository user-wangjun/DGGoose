import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const INTRO_PAGE_HTML = fs.readFileSync(
  path.resolve(process.cwd(), 'ai-city-ip-intro.html'),
  'utf8',
);

describe('入口页莞小鹅资源一致性', () => {
  it('外层介绍页两处入口都裁切游戏内正式待机图集', () => {
    expect(INTRO_PAGE_HTML.match(/assets\/characters\/gxe\/gxe_idle_sheet\.png/g)).toHaveLength(2);
    expect(INTRO_PAGE_HTML.match(/runtime-goose-frame/g)).toHaveLength(6);
    expect(INTRO_PAGE_HTML).not.toContain('assets/characters/gxe/gxe_menu_front.png');
  });

  it('入口页待机图集按 8 帧循环播放，不再是静态摆放', () => {
    expect(INTRO_PAGE_HTML).toContain('animation: runtime-goose-idle-frames 1.333s steps(1, end) infinite;');
    expect(INTRO_PAGE_HTML).toContain('@keyframes runtime-goose-idle-frames');
    expect(INTRO_PAGE_HTML).toContain("translate(-75%, -50%)");
  });
});
