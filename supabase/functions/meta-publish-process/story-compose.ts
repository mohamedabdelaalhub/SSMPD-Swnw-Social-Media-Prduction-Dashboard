// Story (9:16) background: soft blur of the design tinted with the page's brand colours,
// design centred with rounded corners + soft shadow + a short brand-accent line under it.
// Pure pixel math (ImageScript 1.3 only has nearest-neighbour resize, which caused the old mosaic look).
type RGB = [number, number, number];
const STORY_THEMES: Record<string, { top: RGB; bottom: RGB; accent: RGB }> = {
  dr_dina: { top: [58, 16, 52], bottom: [112, 32, 92], accent: [230, 38, 60] },
  sono: { top: [12, 36, 110], bottom: [19, 120, 200], accent: [240, 90, 26] },
};
const DEFAULT_THEME = { top: [24, 24, 32] as RGB, bottom: [60, 60, 72] as RGB, accent: [255, 255, 255] as RGB };

// deno-lint-ignore no-explicit-any
export function composeStoryBitmap(ImageCls: any, src: any, brand: string | null) {
  const W = 1080, H = 1920, TINT = 0.72, FW = 1000, R = 28;
  const theme = (brand && STORY_THEMES[brand]) || DEFAULT_THEME;
  const sb = src.bitmap as Uint8ClampedArray, sw = src.width as number, shh = src.height as number;

  // 1) tiny "cover" grid of the design by area sampling, then box-blur it
  const GW = 27, GH = 48;
  const k = Math.max(W / sw, H / shh), cw = W / k, ch = H / k, ox = (sw - cw) / 2, oy = (shh - ch) / 2;
  const grid = new Float32Array(GW * GH * 3);
  for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < GW; gx++) {
    let r = 0, g = 0, b = 0, n = 0;
    for (let sy = 0; sy < 6; sy++) for (let sx = 0; sx < 6; sx++) {
      const px = Math.min(sw - 1, Math.floor(ox + (gx + (sx + 0.5) / 6) * cw / GW));
      const py = Math.min(shh - 1, Math.floor(oy + (gy + (sy + 0.5) / 6) * ch / GH));
      const i = (py * sw + px) * 4; r += sb[i]; g += sb[i + 1]; b += sb[i + 2]; n++;
    }
    const o = (gy * GW + gx) * 3; grid[o] = r / n; grid[o + 1] = g / n; grid[o + 2] = b / n;
  }
  for (let pass = 0; pass < 3; pass++) {
    const tmp = grid.slice();
    for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < GW; gx++) {
      let r = 0, g = 0, b = 0, n = 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const x = Math.min(GW - 1, Math.max(0, gx + dx)), y = Math.min(GH - 1, Math.max(0, gy + dy));
        const o = (y * GW + x) * 3; r += tmp[o]; g += tmp[o + 1]; b += tmp[o + 2]; n++;
      }
      const o = (gy * GW + gx) * 3; grid[o] = r / n; grid[o + 1] = g / n; grid[o + 2] = b / n;
    }
  }

  // 2) foreground size/position
  const FH = Math.round(shh * FW / sw), fx = Math.round((W - FW) / 2), fy = Math.max(0, Math.round((H - FH) / 2));

  // 3) background: bilinear upsample + brand gradient tint + soft shadow + accent line
  const out = new ImageCls(W, H), ob = out.bitmap as Uint8ClampedArray;
  const sdRound = (px: number, py: number, x0: number, y0: number, x1: number, y1: number, r: number) => {
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, hx = (x1 - x0) / 2 - r, hy = (y1 - y0) / 2 - r;
    const qx = Math.abs(px - cx) - hx, qy = Math.abs(py - cy) - hy;
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
  };
  const ay0 = fy + FH + 40, ay1 = ay0 + 8, ax0 = W / 2 - 70, ax1 = W / 2 + 70;
  for (let y = 0; y < H; y++) {
    const t = y / (H - 1);
    const tr = theme.top[0] * (1 - t) + theme.bottom[0] * t, tg = theme.top[1] * (1 - t) + theme.bottom[1] * t, tb = theme.top[2] * (1 - t) + theme.bottom[2] * t;
    const gyf = Math.min(GH - 1.001, Math.max(0, (y + 0.5) / H * GH - 0.5)), gy0 = Math.floor(gyf), wy = gyf - gy0;
    for (let x = 0; x < W; x++) {
      const gxf = Math.min(GW - 1.001, Math.max(0, (x + 0.5) / W * GW - 0.5)), gx0 = Math.floor(gxf), wx = gxf - gx0;
      const o00 = (gy0 * GW + gx0) * 3, o10 = o00 + 3, o01 = o00 + GW * 3, o11 = o01 + 3;
      const i = (y * W + x) * 4;
      let shadow = 0;
      const d = sdRound(x, y, fx, fy + 16, fx + FW, fy + FH + 16, R);
      if (d < 60) shadow = 0.55 * (d <= 0 ? 1 : Math.pow(1 - d / 60, 2));
      for (let c = 0; c < 3; c++) {
        const v = (grid[o00 + c] * (1 - wx) + grid[o10 + c] * wx) * (1 - wy) + (grid[o01 + c] * (1 - wx) + grid[o11 + c] * wx) * wy;
        let px = v * (1 - TINT) + (c === 0 ? tr : c === 1 ? tg : tb) * TINT;
        px *= 1 - shadow;
        if (y >= ay0 && y < ay1 && x >= ax0 && x < ax1) {
          const a = Math.max(0, Math.min(1, 0.5 - sdRound(x + 0.5, y + 0.5, ax0, ay0, ax1, ay1, 4)));
          px = px * (1 - a) + theme.accent[c] * a;
        }
        ob[i + c] = px;
      }
      ob[i + 3] = 255;
    }
  }

  // 4) design: bilinear downscale onto the background with anti-aliased rounded corners
  const sx = sw / FW, sy = shh / FH;
  for (let y = 0; y < FH; y++) {
    const syf = Math.min(shh - 1.001, Math.max(0, (y + 0.5) * sy - 0.5)), y0 = Math.floor(syf), wy = syf - y0;
    for (let x = 0; x < FW; x++) {
      const d = sdRound(x + 0.5, y + 0.5, 0, 0, FW, FH, R);
      if (d >= 1) continue;
      const a = d <= 0 ? 1 : 1 - d;
      const sxf = Math.min(sw - 1.001, Math.max(0, (x + 0.5) * sx - 0.5)), x0 = Math.floor(sxf), wx = sxf - x0;
      const i00 = (y0 * sw + x0) * 4, i10 = i00 + 4, i01 = i00 + sw * 4, i11 = i01 + 4;
      const o = ((fy + y) * W + fx + x) * 4;
      for (let c = 0; c < 3; c++) {
        const v = (sb[i00 + c] * (1 - wx) + sb[i10 + c] * wx) * (1 - wy) + (sb[i01 + c] * (1 - wx) + sb[i11 + c] * wx) * wy;
        ob[o + c] = ob[o + c] * (1 - a) + v * a;
      }
    }
  }
  return out;
}
