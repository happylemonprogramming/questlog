import { defineTool, type Tool } from '@porygon/core';
import { z } from 'zod';
import { db } from '@/lib/db';
import { desktop } from '@/lib/desktop';
import { editImage, IMAGE_NAME, imageName, mainColors, previewImage, type ImageEdit } from '@/lib/images';
import type { ImageAsset } from '@/lib/types';
import type { ToolHost } from './tools';

/**
 * The image library, for the agent: bring in a picture (a company's logo, a
 * headshot) from the web, a shared folder or SVG it writes itself, edit it,
 * and look at it. Documents use a picture by name, so the agent never has to
 * handle its bytes.
 */

const color = z.string().describe('A CSS color: "#000", "white", "rgb(0 70 140)".');

const edit = z.discriminatedUnion('op', [
  z.object({ op: z.literal('trim'), tolerance: z.number().min(0).max(255).optional() }).describe('Cut away empty edges: transparent, or the same color as the top-left corner.'),
  z.object({ op: z.literal('crop'), x: z.number(), y: z.number(), width: z.number().positive(), height: z.number().positive() }).describe('Keep this rectangle, in pixels of the image as it is at this step.'),
  z.object({ op: z.literal('resize'), width: z.number().positive().optional(), height: z.number().positive().optional() }).describe('Give one side to keep the proportions, or both to set them exactly. A print logo needs about 2-3x its printed size in pixels (96px = 1in).'),
  z.object({ op: z.literal('remove_background'), color: color.optional().describe('The background to remove; the top-left pixel if not given.'), tolerance: z.number().min(0).max(255).optional().describe('How far from that color still counts, 0-255. Default 32.') }).describe('Make a solid background see-through, with soft edges.'),
  z.object({ op: z.literal('recolor'), color }).describe('Paint every visible pixel one color, keeping transparency and edges: turn a white logo black, or into a brand color. Remove any solid background first.'),
  z.object({ op: z.literal('invert') }).describe('Swap light and dark.'),
  z.object({ op: z.literal('grayscale') }),
  z.object({ op: z.literal('adjust'), brightness: z.number().optional(), contrast: z.number().optional(), saturation: z.number().optional() }).describe('Multipliers: 1 leaves it, 1.2 is 20% more, 0.8 is 20% less.'),
  z.object({ op: z.literal('opacity'), value: z.number().min(0).max(1) }),
  z.object({ op: z.literal('rotate'), degrees: z.union([z.literal(90), z.literal(180), z.literal(270)]) }).describe('Clockwise.'),
  z.object({ op: z.literal('flip'), horizontal: z.boolean().optional(), vertical: z.boolean().optional() }),
  z.object({ op: z.literal('pad'), pixels: z.number().int().min(0).max(1000), color: color.optional().describe('Fill for the new margin; see-through if not given.') }),
  z.object({ op: z.literal('round'), radius: z.number().min(0).optional(), circle: z.boolean().optional().describe('Crop to a centered circle, for a headshot.') }).describe('Round the corners.'),
  z.object({ op: z.literal('convert'), format: z.enum(['png', 'jpeg', 'webp']), quality: z.number().min(0).max(1).optional(), background: color.optional().describe('For JPEG, which has no transparency. White if not given.') }).describe('Change the file format. PNG keeps transparency and is the default; JPEG suits photos.'),
]);

const name = z.string().regex(IMAGE_NAME).describe('Lowercase letters, digits and dashes, e.g. "arthrex-logo".');

const kb = (base64: string) => {
  const bytes = Math.round((base64.length * 3) / 4);
  return bytes < 1024 ? `${bytes} bytes` : `${Math.round(bytes / 1024)} KB`;
};
const usage = (n: string) => `Use it as url("image:${n}") in a design, or <img src="image:${n}" alt="…"> in an html section.`;

async function describe(img: Pick<ImageAsset, 'name' | 'type' | 'base64' | 'original'>, host: ToolHost, verb: string) {
  const p = await previewImage(img);
  host.attachImage?.({ data: p.data, mimeType: p.mimeType });
  const colors = await mainColors(img).catch(() => []);
  return [
    `${verb} image:${img.name}: ${p.width}×${p.height}px ${img.type.replace('image/', '').replace('+xml', '')}, ${kb(img.base64)}.`,
    colors.length ? `Main colors: ${colors.join(', ')}.` : '',
    host.attachImage ? 'A preview is attached, on a checkerboard where it is see-through.' : '',
    img.original ? 'The original is kept; reset_image undoes every edit.' : '',
    usage(img.name),
  ].filter(Boolean).join(' ');
}

async function save(n: string, img: { type: string; base64: string }, original?: { type: string; base64: string }) {
  const asset: ImageAsset = { name: n, type: img.type, base64: img.base64, updatedAt: Date.now(), ...(original ? { original } : {}) };
  await db.images.put(asset);
  return asset;
}

const err = (content: string) => ({ content, isError: true });

export function imageTools(host: ToolHost): Record<string, Tool> {
  return {
    add_image: defineTool({
      description:
        "Add a picture to the image library: a company's logo, the user's headshot, an icon. Give one source: a direct image URL (PNG, JPEG, WebP, GIF or SVG; " +
        'find the image file itself, not the page it is on), a path in a folder the user shared, SVG markup you write, or another library image to copy. ' +
        'Optionally edit it on the way in. Returns its size and main colors, and a preview to check. Documents then use it by name; never paste image data into a design.',
      inputSchema: z.object({
        name: name.optional().describe('Defaults to one made from the file name.'),
        url: z.string().optional(),
        path: z.string().optional().describe('A file in a shared folder (see local_folders).'),
        svg: z.string().optional().describe('SVG markup, starting with <svg.'),
        copy_of: name.optional(),
        edits: z.array(edit).optional().describe('Applied in order. Common for a logo: trim, then remove_background or recolor.'),
        replace: z.boolean().optional().describe('Replace an existing image of that name.'),
      }),
      write: true,
      timeoutMs: 60_000,
      run: async ({ name: want, url, path, svg, copy_of, edits, replace }) => {
        const sources = [url, path, svg, copy_of].filter((x) => x !== undefined).length;
        if (sources !== 1) return err('Give exactly one of url, path, svg or copy_of.');
        let src: { type: string; base64: string };
        let from: string;
        try {
          if (url) {
            const d = desktop();
            if (d) src = await d.fetchImage(url);
            else {
              const res = await fetch(url);
              if (!res.ok) throw new Error(`The server said ${res.status}.`);
              const blob = await res.blob();
              if (!blob.type.startsWith('image/')) throw new Error(`That address isn't an image (${blob.type || 'unknown'}).`);
              src = { type: blob.type, base64: await toBase64(blob) };
            }
            from = new URL(url).pathname.split('/').pop() || 'image';
          } else if (path) {
            const d = desktop();
            if (!d) return err('Shared folders are only in the desktop app.');
            const f = await d.local.readImage(path);
            src = f;
            from = f.name;
          } else if (svg) {
            if (!/^\s*(<\?xml[^>]*>\s*)?<svg[\s>]/i.test(svg)) return err('That isn\'t SVG markup: it should start with <svg.');
            if (/<script|\son\w+\s*=|javascript:/i.test(svg)) return err('SVG for a document can\'t have scripts or event handlers.');
            src = { type: 'image/svg+xml', base64: btoa(unescape(encodeURIComponent(svg))) };
            from = 'drawing';
          } else {
            const other = await db.images.get(copy_of!);
            if (!other) return err(`No image ${copy_of} in the library.`);
            src = { type: other.type, base64: other.base64 };
            from = `${copy_of}-copy`;
          }
        } catch (e) {
          return err(`Couldn't get the image: ${(e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}`);
        }
        const n = want ?? imageName(from);
        if (!IMAGE_NAME.test(n)) return err(`"${n}" can't be an image name; give one with letters, digits and dashes.`);
        if (!replace && (await db.images.get(n))) return err(`There's already an image:${n}. Pick another name, or pass replace: true.`);
        try {
          const out = edits?.length ? await editImage(src, edits as ImageEdit[]) : src;
          const asset = await save(n, out, edits?.length ? src : undefined);
          return describe(asset, host, 'Added');
        } catch (e) {
          return err(`Couldn't read or edit that image: ${(e as Error).message}`);
        }
      },
    }),

    edit_image: defineTool({
      description:
        'Edit a library image: trim, crop, resize, remove a background, recolor (e.g. a white logo to black for a light page), invert, grayscale, adjust, ' +
        'rotate, flip, pad, round or circle-crop, convert format. Edits apply in order to the image as it is now. Documents using it update at once; ' +
        'give save_as to keep the current one and make a variant (e.g. "arthrex-logo-dark"). Look at the preview it returns.',
      inputSchema: z.object({ name, edits: z.array(edit).min(1), save_as: name.optional() }),
      write: true,
      timeoutMs: 60_000,
      run: async ({ name: n, edits, save_as }) => {
        const img = await db.images.get(n);
        if (!img) return err(`No image ${n} in the library.`);
        try {
          const out = await editImage(img, edits as ImageEdit[]);
          if (save_as) {
            if (await db.images.get(save_as)) return err(`There's already an image:${save_as}.`);
            return describe(await save(save_as, out, img.original ?? { type: img.type, base64: img.base64 }), host, 'Saved');
          }
          return describe(await save(n, out, img.original ?? { type: img.type, base64: img.base64 }), host, 'Edited');
        } catch (e) {
          return err(`Couldn't edit it: ${(e as Error).message}`);
        }
      },
    }),

    reset_image: defineTool({
      description: 'Undo every edit to a library image, back to how it first came in.',
      inputSchema: z.object({ name }),
      write: true,
      run: async ({ name: n }) => {
        const img = await db.images.get(n);
        if (!img) return err(`No image ${n} in the library.`);
        if (!img.original) return `image:${n} hasn't been edited.`;
        return describe(await save(n, img.original), host, 'Reset');
      },
    }),

    view_image: defineTool({
      description: 'Look at a library image: its size, format, main colors and a preview.',
      inputSchema: z.object({ name }),
      run: async ({ name: n }) => {
        const img = await db.images.get(n);
        return img ? describe(img, host, 'This is') : err(`No image ${n} in the library.`);
      },
    }),

    list_images: defineTool({
      description: 'List the image library: each picture\'s name, format and size.',
      inputSchema: z.object({}),
      run: async () => {
        const all = await db.images.orderBy('updatedAt').reverse().toArray();
        if (!all.length) return 'The image library is empty. Add pictures with add_image.';
        return all.map((i) => `image:${i.name} (${i.type.replace('image/', '').replace('+xml', '')}, ${kb(i.base64)}${i.original ? ', edited' : ''})`).join('\n');
      },
    }),

    delete_image: defineTool({
      description: 'Remove a picture from the library. Documents that use it show nothing in its place.',
      inputSchema: z.object({ name }),
      write: true,
      run: async ({ name: n }) => {
        if (!(await db.images.get(n))) return err(`No image ${n} in the library.`);
        await db.images.delete(n);
        return `Deleted image:${n}.`;
      },
    }),
  };
}

async function toBase64(blob: Blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}
