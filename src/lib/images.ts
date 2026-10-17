import { useSyncExternalStore } from 'react';
import { liveQuery } from 'dexie';
import { db } from './db';
import type { ImageAsset } from './types';

/**
 * The image library. Documents name a picture, `image:arthrex-logo`, and the
 * name is swapped for the picture itself, as a data: URL, when the page is
 * drawn. So a page still loads nothing from elsewhere, and a design or block
 * of markup stays short enough to read and edit.
 */

export const IMAGE_NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;

/** "Arthrex Logo (white).png" → "arthrex-logo-white". */
export const imageName = (s: string) =>
  s.toLowerCase().replace(/\.[a-z0-9]+$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63) || 'image';

export const dataUrl = (img: Pick<ImageAsset, 'type' | 'base64'>) => `data:${img.type};base64,${img.base64}`;

// --- The library, kept in memory for drawing pages -----------------------------

let urls = new Map<string, string>();
let version = 0;
let loaded = false;
let resolveLoaded: () => void;
const ready = new Promise<void>((r) => (resolveLoaded = r));
const listeners = new Set<() => void>();
let started = false;

function start() {
  if (started) return;
  started = true;
  liveQuery(() => db.images.toArray()).subscribe({
    next: (all) => {
      urls = new Map(all.map((i) => [i.name, dataUrl(i)]));
      version++;
      loaded = true;
      resolveLoaded();
      listeners.forEach((l) => l());
    },
    error: () => {
      loaded = true;
      resolveLoaded();
    },
  });
}

/** Resolves once the library has loaded, so a print waits for its pictures. */
export function imagesReady() {
  start();
  return loaded ? Promise.resolve() : ready;
}

/** Redraws when any picture changes; the number is only for comparing. */
export function useImagesVersion() {
  return useSyncExternalStore(
    (l) => {
      start();
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => version,
  );
}

const IN_CSS = /url\(\s*(['"]?)image:([a-z0-9][a-z0-9-]*)\1\s*\)/gi;
const IN_HTML = /(\ssrc\s*=\s*)(['"])image:([a-z0-9][a-z0-9-]*)\2/gi;

/** A design with its `url(image:name)` references filled in. Unknown names are left for the cleaner to block. */
export const resolveCss = (css: string | undefined) => (css && css.includes('image:') ? css.replace(IN_CSS, (m, _q, n: string) => (urls.has(n) ? `url("${urls.get(n)}")` : m)) : css);

/** Markup with its `src="image:name"` references filled in. */
export const resolveHtml = (html: string | undefined) => (html && html.includes('image:') ? html.replace(IN_HTML, (m, pre: string, q: string, n: string) => (urls.has(n) ? `${pre}${q}${urls.get(n)}${q}` : m)) : html);

/** The image names a design or block of markup asks for. */
export function namesIn(text: string | undefined): string[] {
  if (!text) return [];
  return [...new Set([...text.matchAll(/image:([a-z0-9][a-z0-9-]*)/gi)].map((m) => m[1].toLowerCase()))];
}

// --- Editing -------------------------------------------------------------------------

export type ImageEdit =
  | { op: 'trim'; tolerance?: number }
  | { op: 'crop'; x: number; y: number; width: number; height: number }
  | { op: 'resize'; width?: number; height?: number }
  | { op: 'remove_background'; color?: string; tolerance?: number }
  | { op: 'recolor'; color: string }
  | { op: 'invert' }
  | { op: 'grayscale' }
  | { op: 'adjust'; brightness?: number; contrast?: number; saturation?: number }
  | { op: 'opacity'; value: number }
  | { op: 'rotate'; degrees: 90 | 180 | 270 }
  | { op: 'flip'; horizontal?: boolean; vertical?: boolean }
  | { op: 'pad'; pixels: number; color?: string }
  | { op: 'round'; radius?: number; circle?: boolean }
  | { op: 'convert'; format: 'png' | 'jpeg' | 'webp'; quality?: number; background?: string };

const MAX_SIDE = 4000;

type Canvas = OffscreenCanvas;
const canvas = (w: number, h: number): Canvas => new OffscreenCanvas(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
const ctx2d = (c: Canvas) => c.getContext('2d', { willReadFrequently: true })!;

function parseColor(s: string): [number, number, number, number] {
  const c = canvas(1, 1);
  const g = ctx2d(c);
  g.fillStyle = '#000';
  g.fillStyle = s;
  g.fillRect(0, 0, 1, 1);
  const d = g.getImageData(0, 0, 1, 1).data;
  return [d[0], d[1], d[2], d[3]];
}

/** Decode a picture onto a canvas. An SVG with no size of its own is drawn 1200px wide. */
async function decode(type: string, base64: string): Promise<Canvas> {
  const bytes = Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0));
  const blob = new Blob([bytes], { type });
  if (type !== 'image/svg+xml') {
    const bmp = await createImageBitmap(blob);
    const c = canvas(bmp.width, bmp.height);
    ctx2d(c).drawImage(bmp, 0, 0);
    bmp.close();
    return c;
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    let w = img.naturalWidth || 1200;
    let h = img.naturalHeight || Math.round(w / 2);
    // Vector art drawn small looks soft once printed; draw it at least 1200px across.
    if (w < 1200) {
      h = Math.round((h * 1200) / w);
      w = 1200;
    }
    const c = canvas(w, h);
    ctx2d(c).drawImage(img, 0, 0, w, h);
    return c;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function hasAlpha(c: Canvas) {
  const d = ctx2d(c).getImageData(0, 0, c.width, c.height).data;
  for (let i = 3; i < d.length; i += 4) if (d[i] < 250) return true;
  return false;
}

function pixels(c: Canvas, fn: (d: Uint8ClampedArray, i: number) => void) {
  const g = ctx2d(c);
  const img = g.getImageData(0, 0, c.width, c.height);
  for (let i = 0; i < img.data.length; i += 4) fn(img.data, i);
  g.putImageData(img, 0, 0);
  return c;
}

/** Cut away the edges that are empty: transparent, or the same color as the corner. */
function trim(c: Canvas, tolerance = 10): Canvas {
  const { width: w, height: h } = c;
  const d = ctx2d(c).getImageData(0, 0, w, h).data;
  const alpha = hasAlpha(c);
  const [r0, g0, b0] = [d[0], d[1], d[2]];
  const empty = (i: number) => (alpha ? d[i + 3] <= tolerance : Math.abs(d[i] - r0) <= tolerance && Math.abs(d[i + 1] - g0) <= tolerance && Math.abs(d[i + 2] - b0) <= tolerance);
  let top = h, left = w, right = -1, bottom = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (empty((y * w + x) * 4)) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      bottom = y;
    }
  }
  if (right < 0) return c;
  return crop(c, left, top, right - left + 1, bottom - top + 1);
}

function crop(c: Canvas, x: number, y: number, w: number, h: number): Canvas {
  x = Math.max(0, Math.round(x));
  y = Math.max(0, Math.round(y));
  w = Math.min(c.width - x, Math.round(w));
  h = Math.min(c.height - y, Math.round(h));
  if (w <= 0 || h <= 0) throw new Error(`That crop is outside the ${c.width}×${c.height} image.`);
  const out = canvas(w, h);
  ctx2d(out).drawImage(c, x, y, w, h, 0, 0, w, h);
  return out;
}

function resize(c: Canvas, width?: number, height?: number): Canvas {
  if (!width && !height) throw new Error('Give a width, a height, or both.');
  const w = width ?? (c.width * height!) / c.height;
  const h = height ?? (c.height * width!) / c.width;
  if (w > MAX_SIDE || h > MAX_SIDE) throw new Error(`Images can be up to ${MAX_SIDE}px on a side.`);
  // Halve in steps when shrinking a lot, so thin lines in a logo don't break up.
  let cur = c;
  while (cur.width / 2 >= w && cur.height / 2 >= h) {
    const half = canvas(cur.width / 2, cur.height / 2);
    const g = ctx2d(half);
    g.imageSmoothingQuality = 'high';
    g.drawImage(cur, 0, 0, half.width, half.height);
    cur = half;
  }
  const out = canvas(w, h);
  const g = ctx2d(out);
  g.imageSmoothingQuality = 'high';
  g.drawImage(cur, 0, 0, out.width, out.height);
  return out;
}

/** Make the background color see-through, with a soft edge so outlines stay smooth. */
function removeBackground(c: Canvas, color?: string, tolerance = 32): Canvas {
  const d0 = ctx2d(c).getImageData(0, 0, 1, 1).data;
  const [r, g, b] = color ? parseColor(color) : [d0[0], d0[1], d0[2]];
  const soft = tolerance * 1.6;
  return pixels(c, (d, i) => {
    const dist = Math.max(Math.abs(d[i] - r), Math.abs(d[i + 1] - g), Math.abs(d[i + 2] - b));
    if (dist <= tolerance) d[i + 3] = 0;
    else if (dist < soft) d[i + 3] = Math.round(d[i + 3] * ((dist - tolerance) / (soft - tolerance)));
  });
}

function filtered(c: Canvas, filter: string): Canvas {
  const out = canvas(c.width, c.height);
  const g = ctx2d(out);
  g.filter = filter;
  g.drawImage(c, 0, 0);
  return out;
}

function rotate(c: Canvas, degrees: number): Canvas {
  const quarter = degrees % 180 !== 0;
  const out = canvas(quarter ? c.height : c.width, quarter ? c.width : c.height);
  const g = ctx2d(out);
  g.translate(out.width / 2, out.height / 2);
  g.rotate((degrees * Math.PI) / 180);
  g.drawImage(c, -c.width / 2, -c.height / 2);
  return out;
}

function flip(c: Canvas, h?: boolean, v?: boolean): Canvas {
  const out = canvas(c.width, c.height);
  const g = ctx2d(out);
  g.translate(h ? c.width : 0, v ? c.height : 0);
  g.scale(h ? -1 : 1, v ? -1 : 1);
  g.drawImage(c, 0, 0);
  return out;
}

function pad(c: Canvas, px: number, color?: string): Canvas {
  const out = canvas(c.width + px * 2, c.height + px * 2);
  const g = ctx2d(out);
  if (color) {
    g.fillStyle = color;
    g.fillRect(0, 0, out.width, out.height);
  }
  g.drawImage(c, px, px);
  return out;
}

function round(c: Canvas, radius?: number, circle?: boolean): Canvas {
  let src = c;
  if (circle) {
    const side = Math.min(c.width, c.height);
    src = crop(c, (c.width - side) / 2, (c.height - side) / 2, side, side);
  }
  const out = canvas(src.width, src.height);
  const g = ctx2d(out);
  g.beginPath();
  if (circle) g.arc(out.width / 2, out.height / 2, out.width / 2, 0, Math.PI * 2);
  else g.roundRect(0, 0, out.width, out.height, radius ?? Math.round(Math.min(out.width, out.height) * 0.08));
  g.clip();
  g.drawImage(src, 0, 0);
  return out;
}

async function encode(c: Canvas, type: string, quality?: number): Promise<string> {
  const blob = await c.convertToBlob({ type, quality });
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}

/**
 * Apply edits in order. An SVG with no edits stays vector; any edit draws it
 * as pixels first. The result keeps transparency as PNG unless an edit asks
 * for another format.
 */
export async function editImage(img: { type: string; base64: string }, edits: ImageEdit[]): Promise<{ type: string; base64: string; width: number; height: number }> {
  if (!edits.length) {
    const c = await decode(img.type, img.base64);
    return { ...img, width: c.width, height: c.height };
  }
  let c = await decode(img.type, img.base64);
  let type = img.type === 'image/jpeg' ? 'image/jpeg' : img.type === 'image/webp' ? 'image/webp' : 'image/png';
  let quality: number | undefined;
  for (const e of edits) {
    switch (e.op) {
      case 'trim': c = trim(c, e.tolerance); break;
      case 'crop': c = crop(c, e.x, e.y, e.width, e.height); break;
      case 'resize': c = resize(c, e.width, e.height); break;
      case 'remove_background': c = removeBackground(c, e.color, e.tolerance); if (type === 'image/jpeg') type = 'image/png'; break;
      case 'recolor': {
        const [r, g, b] = parseColor(e.color);
        c = pixels(c, (d, i) => { d[i] = r; d[i + 1] = g; d[i + 2] = b; });
        break;
      }
      case 'invert': c = pixels(c, (d, i) => { d[i] = 255 - d[i]; d[i + 1] = 255 - d[i + 1]; d[i + 2] = 255 - d[i + 2]; }); break;
      case 'grayscale': c = filtered(c, 'grayscale(1)'); break;
      case 'adjust': c = filtered(c, `brightness(${e.brightness ?? 1}) contrast(${e.contrast ?? 1}) saturate(${e.saturation ?? 1})`); break;
      case 'opacity': c = pixels(c, (d, i) => { d[i + 3] = Math.round(d[i + 3] * Math.max(0, Math.min(1, e.value))); }); if (type === 'image/jpeg') type = 'image/png'; break;
      case 'rotate': c = rotate(c, e.degrees); break;
      case 'flip': c = flip(c, e.horizontal, e.vertical); break;
      case 'pad': c = pad(c, e.pixels, e.color); break;
      case 'round': c = round(c, e.radius, e.circle); if (type === 'image/jpeg') type = 'image/png'; break;
      case 'convert': {
        type = `image/${e.format}`;
        quality = e.quality;
        // JPEG has no transparency: put it on a background, white unless said.
        if (e.format === 'jpeg') c = pad(c, 0, e.background ?? '#ffffff');
        break;
      }
    }
    if (c.width > MAX_SIDE || c.height > MAX_SIDE) c = resize(c, c.width >= c.height ? MAX_SIDE : undefined, c.height > c.width ? MAX_SIDE : undefined);
  }
  return { type, base64: await encode(c, type, quality), width: c.width, height: c.height };
}

/** A small JPEG of a picture on a checkerboard, so the agent can see it, transparency and all. */
export async function previewImage(img: { type: string; base64: string }, max = 640): Promise<{ data: string; mimeType: string; width: number; height: number }> {
  const src = await decode(img.type, img.base64);
  const k = Math.min(1, max / Math.max(src.width, src.height));
  const out = canvas(src.width * k, src.height * k);
  const g = ctx2d(out);
  const cell = 10;
  for (let y = 0; y < out.height; y += cell) {
    for (let x = 0; x < out.width; x += cell) {
      g.fillStyle = (x / cell + y / cell) % 2 ? '#d9d9d9' : '#f4f4f4';
      g.fillRect(x, y, cell, cell);
    }
  }
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, 0, 0, out.width, out.height);
  return { data: await encode(out, 'image/jpeg', 0.85), mimeType: 'image/jpeg', width: src.width, height: src.height };
}

/** The colors that cover most of a picture, ignoring see-through pixels: what a logo is made of. */
export async function mainColors(img: { type: string; base64: string }, n = 4): Promise<string[]> {
  const src = await decode(img.type, img.base64);
  const small = resize(src, Math.min(src.width, 160));
  const d = ctx2d(small).getImageData(0, 0, small.width, small.height).data;
  const counts = new Map<string, number>();
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) continue;
    const key = [d[i], d[i + 1], d[i + 2]].map((v) => Math.min(255, Math.round(v / 24) * 24).toString(16).padStart(2, '0')).join('');
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => `#${k}`);
}
