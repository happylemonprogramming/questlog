import { db } from './db';
import { reducedMotion } from './motion';

/**
 * Confetti when a listing becomes an offer, and a smaller burst when an
 * application goes out. One short-lived canvas, removed when the pieces land.
 */

const COLORS = ['--gold', '--violet', '--info', '--success', '--warning'];

export function celebrate(size: 'big' | 'small' = 'big') {
  if (reducedMotion() || document.visibilityState !== 'visible') return;
  const css = getComputedStyle(document.documentElement);
  const colors = COLORS.map((v) => `hsl(${css.getPropertyValue(v).trim()})`);
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  Object.assign(canvas.style, { position: 'fixed', inset: '0', width: '100vw', height: '100vh', pointerEvents: 'none', zIndex: '100' });
  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);

  const big = size === 'big';
  // Big: two cannons from the bottom corners. Small: one puff from the top middle.
  const origins = big ? [[0.08, 1.02, -60], [0.92, 1.02, -120]] : [[0.5, 0.18, 90]];
  const pieces = origins.flatMap(([x, y, angle]) =>
    Array.from({ length: big ? 90 : 36 }, () => {
      const a = ((angle + (Math.random() - 0.5) * (big ? 50 : 140)) * Math.PI) / 180;
      const v = (big ? 15 : 7) + Math.random() * (big ? 9 : 5);
      return {
        x: x * innerWidth,
        y: y * innerHeight,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        w: 6 + Math.random() * 6,
        h: 4 + Math.random() * 4,
        r: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.3,
        c: colors[Math.floor(Math.random() * colors.length)],
      };
    }),
  );

  const start = performance.now();
  const life = big ? 2600 : 1400;
  const frame = (t: number) => {
    const age = t - start;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    ctx.globalAlpha = Math.max(0, 1 - Math.max(0, age - life * 0.6) / (life * 0.4));
    for (const p of pieces) {
      p.vy += 0.32;
      p.vx *= 0.985;
      p.vy *= 0.985;
      p.x += p.vx;
      p.y += p.vy;
      p.r += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.r);
      ctx.fillStyle = p.c;
      // Flat pieces flutter by squashing as they turn.
      ctx.fillRect(-p.w / 2, (-p.h / 2) * Math.cos(p.r * 2), p.w, p.h * Math.cos(p.r * 2));
      ctx.restore();
    }
    if (age < life) requestAnimationFrame(frame);
    else canvas.remove();
  };
  requestAnimationFrame(frame);
}

let last = 0;

/** Watch stage changes from anywhere: a click, a drag, the assistant. */
export function watchMilestones() {
  db.jobs.hook('updating', (mods, _key, job) => {
    const stage = (mods as { stage?: string }).stage;
    if (!stage || stage === job.stage) return;
    const kind = stage === 'offer' ? 'big' : stage === 'applied' ? 'small' : null;
    // Imports can move many listings at once; one celebration is enough.
    if (!kind || Date.now() - last < 2500) return;
    last = Date.now();
    setTimeout(() => celebrate(kind), 0);
  });
}
