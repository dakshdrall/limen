'use client';

import { useEffect, useRef } from 'react';

/**
 * THIS IS DECORATION. IT IS NOT A PRICE FEED.
 *
 * Every candle below comes from a seeded random walk computed in this file. It
 * is not connected to Soroswap, the Route API, Horizon, the RPC, `readPrice`,
 * or anything in `packages/chain`, and it makes no fetch, opens no socket and
 * has no route handler behind it. It must stay that way, and the reason is not
 * only that a landing page should not hold a market data dependency.
 *
 * A testnet XLM/USDC quote is a pure function of the pool's reserves. Nobody is
 * arbitraging a testnet pool, so those reserves change only when someone
 * deliberately swaps against them — which, on this network, is us. Wired to the
 * real quote, this canvas would draw a flat line that twitched when the demo ran
 * and sat still the rest of the time. That is an accurate chart of nothing, and
 * it would read as a broken widget rather than as an honest one.
 *
 * So the choice is between a chart that is obviously an illustration and one
 * that looks broken while claiming to be live. This is the first. Whether the
 * page should show a real quote at all is a product decision — it would need a
 * venue with real volume behind it — and it is not part of porting the
 * prototype. If that decision is ever made, it belongs in a component that says
 * where its numbers come from, not in this one.
 *
 * The line across the chart is drawn from `limit`, a constant in the walk's own
 * units. It is a visual rhyme with the cap demonstration further down the page,
 * not the recorded cap: the recorded cap is 1 XLM of spend per window and this
 * axis is a price in USDC. Drawing the real figure here would put a true number
 * on an axis it does not belong to, which is worse than an invented one that
 * is obviously part of the illustration.
 *
 * ## What the animation does, and when it refuses to
 *
 * The newest candle keeps ticking while it forms; every STEP ms it is closed,
 * a new one opens, and the whole series slides left by exactly one candle
 * width so the tape appears to advance continuously rather than in jumps.
 *
 * The loop does not run when it cannot be seen. It stops when the canvas
 * scrolls out of view and when the document is hidden — a background tab
 * throttles rAF but does not stop it, and this is a page people leave open.
 * Under `prefers-reduced-motion` it draws exactly one frame and never starts:
 * the chart is present, complete and still, which is the same rule the rest of
 * this surface follows.
 */

/** ms per new candle. */
const STEP = 1400;
/** candle body width, and the gap between bodies. */
const CW = 9;
const GAP = 4;
/** share of the canvas height given to the volume bars. */
const VOL_H = 0.17;

/**
 * A seeded generator, so the walk is reproducible.
 *
 * `Math.random()` would redraw a different tape on every load, which makes a
 * visual regression impossible to review — two screenshots of an unchanged page
 * would never match. mulberry32 is four lines, needs no dependency, and is far
 * better than this use deserves.
 */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Candle {
  o: number;
  c: number;
  h: number;
  l: number;
  v: number;
}

export function CandleTape() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = ref.current;
    if (cv === null) return;
    const ctx = cv.getContext('2d');
    if (ctx === null) return;

    const random = mulberry32(0x11e0);
    const rnd = (a: number, b: number) => a + random() * (b - a);

    let w = 0;
    let h = 0;
    let dpr = 1;
    const candles: Candle[] = [];
    let price = 0.1756;
    let born = performance.now();
    let limit = 0;
    let scale: { hi: number; lo: number } | null = null;

    function newCandle(open: number): Candle {
      // Wanders, but not away: the drift is pulled back toward 0.1762 in
      // proportion to how far it has strayed, so the walk stays on the axis
      // without ever being clamped to it.
      const drift = rnd(-0.0016, 0.0016) + (0.1762 - open) * 0.06;
      const close = Math.max(0.16, Math.min(0.195, open + drift));
      const wick = Math.abs(drift) * rnd(0.4, 1.6) + 0.0004;
      return {
        o: open,
        c: close,
        h: Math.max(open, close) + rnd(0.0001, wick),
        l: Math.min(open, close) - rnd(0.0001, wick),
        v: Math.min(1, (Math.abs(drift) / 0.0016) * rnd(0.45, 1.15) + rnd(0.05, 0.18)),
      };
    }

    function seed() {
      candles.length = 0;
      let p = 0.174;
      for (let i = 0; i < 140; i++) {
        const k = newCandle(p);
        candles.push(k);
        p = k.c;
      }
      price = candles[candles.length - 1].c;
      limit = 0.1788;
    }

    function resize() {
      if (cv === null) return;
      // Capped at 2: a 3x phone gains nothing visible here and pays for every
      // pixel of it on every frame.
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      const r = cv.getBoundingClientRect();
      w = r.width;
      h = r.height;
      cv.width = Math.max(1, w * dpr);
      cv.height = Math.max(1, h * dpr);
      ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function draw(now: number) {
      if (ctx === null || !w || !h) return;
      const shown = Math.ceil(w / (CW + GAP)) + 2;
      const view = candles.slice(-shown);
      const priceH = h * (1 - VOL_H) - 6;

      let hi = -Infinity;
      let lo = Infinity;
      let vmax = 0;
      for (const k of view) {
        if (k.h > hi) hi = k.h;
        if (k.l < lo) lo = k.l;
        if (k.v > vmax) vmax = k.v;
      }
      hi = Math.max(hi, limit);
      lo = Math.min(lo, limit);
      const pad = (hi - lo) * 0.12 || 0.001;
      const target = { hi: hi + pad, lo: lo - pad };
      if (scale === null) scale = target;
      // Eased rather than snapped, so a new extreme rescales the axis over
      // about a second instead of making the whole tape jump.
      scale.hi += (target.hi - scale.hi) * 0.06;
      scale.lo += (target.lo - scale.lo) * 0.06;
      const y = (p: number) => priceH - ((p - scale!.lo) / (scale!.hi - scale!.lo)) * priceH;

      const slide = ((now - born) / STEP) * (CW + GAP);
      const x0 = w - (view.length - 1) * (CW + GAP) - slide + CW;

      ctx.clearRect(0, 0, w, h);

      // The limit, drawn across the market.
      const ly = y(limit);
      ctx.save();
      ctx.setLineDash([5, 6]);
      ctx.strokeStyle = 'rgba(201,162,39,.5)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, ly + 0.5);
      ctx.lineTo(w, ly + 0.5);
      ctx.stroke();
      ctx.restore();

      for (let i = 0; i < view.length; i++) {
        const k = view[i];
        const x = x0 + i * (CW + GAP);
        if (x < -CW || x > w + CW) continue;
        const up = k.c >= k.o;
        // Pushed past the line: drawn dimmer, so the eye reads the line as a
        // ceiling rather than as an annotation laid over the series.
        const over = Math.max(k.o, k.c) > limit;
        const body = up ? (over ? '#5d4715' : '#8a6a24') : '#1b1d21';
        const edge = up
          ? over
            ? 'rgba(201,162,39,.55)'
            : 'rgba(201,162,39,.85)'
          : 'rgba(146,152,160,.55)';

        ctx.strokeStyle = edge;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x + CW / 2 + 0.5, y(k.h));
        ctx.lineTo(x + CW / 2 + 0.5, y(k.l));
        ctx.stroke();

        const yt = y(Math.max(k.o, k.c));
        const yb = y(Math.min(k.o, k.c));
        ctx.fillStyle = body;
        ctx.fillRect(x, yt, CW, Math.max(1.2, yb - yt));
        ctx.strokeRect(x + 0.5, yt + 0.5, CW - 1, Math.max(1.2, yb - yt) - 1);

        // Volume, scaled off this candle's own range against the largest in
        // view rather than off an absolute figure — the walk has no volume
        // units, only relative activity.
        const vh = (k.v / (vmax || 1)) * (h * VOL_H - 4);
        ctx.fillStyle = up ? 'rgba(201,162,39,.13)' : 'rgba(146,152,160,.08)';
        ctx.fillRect(x, h - vh, CW, vh);
      }
    }

    let raf: number | null = null;
    let running = false;

    function frame(now: number) {
      if (now - born >= STEP) {
        born += STEP;
        candles.push(newCandle(price));
        price = candles[candles.length - 1].c;
        if (candles.length > 400) candles.splice(0, candles.length - 400);
      } else {
        // The forming candle still ticks.
        const live = candles[candles.length - 1];
        live.c = Math.max(0.16, Math.min(0.195, live.c + rnd(-0.00022, 0.00022)));
        live.h = Math.max(live.h, live.c);
        live.l = Math.min(live.l, live.c);
      }
      draw(now);
      raf = requestAnimationFrame(frame);
    }

    function start() {
      if (running) return;
      running = true;
      born = performance.now();
      raf = requestAnimationFrame(frame);
    }

    function stop() {
      running = false;
      if (raf !== null) cancelAnimationFrame(raf);
      raf = null;
    }

    seed();
    resize();
    draw(performance.now());

    const onResize = () => {
      resize();
      draw(performance.now());
    };
    window.addEventListener('resize', onResize);

    const still =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // One frame is already drawn above. Under reduced motion that frame is the
    // whole chart, and nothing below this line runs.
    if (still || typeof IntersectionObserver === 'undefined') {
      return () => window.removeEventListener('resize', onResize);
    }

    const onVisibility = () => {
      if (document.hidden) stop();
      else start();
    };
    document.addEventListener('visibilitychange', onVisibility);

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          // Never start behind a hidden document: leaving the tab and scrolling
          // back would otherwise restart the loop in a tab nobody is looking at.
          if (entry.isIntersecting && !document.hidden) start();
          else stop();
        }
      },
      { threshold: 0 },
    );
    observer.observe(cv);

    return () => {
      stop();
      observer.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  return <canvas ref={ref} className="art art-candles" aria-hidden="true" />;
}
