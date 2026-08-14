#!/usr/bin/env node
/**
 * The mark's file-shaped consumers: `app/icon.svg`, `app/favicon.ico`, and the
 * two avatars in `public/`.
 *
 * PLAN-V5 §3.2. The geometry lives in `apps/web/src/lib/mark.ts` and the colours
 * in `apps/web/src/lib/theme.ts`; this script is what turns them into the two
 * artefacts Next.js serves from disk. Node strips the types on import, so both
 * files are read directly rather than transcribed — a transcribed mark is a
 * second definition, which is the failure `lib/theme.ts` exists to prevent.
 *
 *     npm run mark          regenerate both files
 *     npm run mark:check    fail if either has drifted
 *
 * `--check` is here for the local loop, but it is deliberately *not* the gate.
 * `design-system.test.ts` imports the two builders below and byte-compares their
 * output against the committed files, so the pin runs inside the ordinary test
 * suite at no extra cost in CI. That is only possible because the output is
 * exactly reproducible, which took two decisions:
 *
 *   - Every coordinate in the mark is a multiple of 1.5 on a 24 grid, so at 16,
 *     32 and 48px every edge lands on a whole pixel. Nothing is anti-aliased,
 *     and the rasteriser below is arithmetic rather than a rendering engine — no
 *     browser, no image library, nothing whose version could change a pixel.
 *
 *   - The PNGs are written with *stored* deflate blocks rather than compressed
 *     ones. `zlib.deflateSync` is deterministic for a given zlib build and not
 *     across builds, so a Node upgrade could have changed these bytes and turned
 *     a green test red for no reason anybody could see. Stored blocks cost about
 *     9KB of favicon and buy a file that is the same forever.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP = join(root, 'apps', 'web', 'src', 'app');
const PUBLIC = join(root, 'apps', 'web', 'public');

const { MARK_GRID, MARK_RECTS, markSvg } = await import(
  join(root, 'apps', 'web', 'src', 'lib', 'mark.ts')
);
const { TEXT, GROUND } = await import(join(root, 'apps', 'web', 'src', 'lib', 'theme.ts'));

/**
 * The sizes packed into `favicon.ico`.
 *
 * The classic three. 16 is the tab strip, 32 is the bookmark bar and the
 * high-DPI tab, 48 is the Windows shortcut. All three are exact multiples of the
 * mark's grid, which is the property that keeps every edge on a pixel.
 */
const ICO_SIZES = [16, 32, 48];

/* --- the two artefacts ---------------------------------------------------- */

/**
 * `app/icon.svg` — the primary icon, and the one modern browsers actually use.
 *
 * It carries the dark-tab rule; see `markSvg`. The `.ico` below cannot, which is
 * why the two differ in more than format.
 */
export function iconSvg() {
  return `${markSvg({ ink: TEXT.foreground, inkOnDark: GROUND.background })}\n`;
}

/**
 * `app/favicon.ico` — the fallback, for browsers that will not take an SVG.
 *
 * Ink on paper rather than ink on transparency, which is the one place this
 * artefact deliberately disagrees with every other drawing of the mark. A
 * transparent favicon inherits the tab strip's colour, and an `.ico` has no way
 * to ask what that colour is — the media query the SVG uses does not exist in
 * this format. Near-black ink on a dark tab strip is an invisible mark, so the
 * fallback carries its own paper and is legible on any chrome. It is also, for
 * what it is worth, exactly what this product claims to be: ink on paper.
 */
export function iconIco() {
  return ico(ICO_SIZES, TEXT.foreground, GROUND.background);
}

/**
 * The avatars, which are a different artefact from a favicon and not a bigger
 * one.
 *
 * Three things differ, and each is forced by where an avatar is shown.
 *
 *  - **It carries its ground.** Every platform composites an avatar onto a
 *    background nobody controls, so transparency is not restraint here, it is
 *    an unknown backdrop. Paper, like the `.ico` and for a stronger reason.
 *
 *  - **It has real margin.** A favicon fills its box. An avatar is cropped to a
 *    circle by every platform that shows one, so the mark has to sit inside the
 *    inscribed circle with room to spare. The mark's farthest ink is the sill's
 *    corner, 13.83 grid units from centre; at these scales that lands at 83% of
 *    the circle's radius, leaving a sixth of it clear.
 *
 *  - **The scale is chosen, not derived.** `size / MARK_GRID` is what fills the
 *    box; these are deliberately smaller, and each has to keep every coordinate
 *    on a whole pixel. `avatarBits` enforces that rather than trusting the table
 *    below — see the two fences there.
 *
 * 1000 is for the platforms that ask for it. 400 is the one that gets looked at,
 * and both were checked at 48px and 24px, which is the size an avatar is
 * actually seen at in a timeline.
 */
export const AVATARS = [
  // 24 × 12 = 288 in a 400 box: 56px inset, 252 × 216 of ink.
  { size: 400, scale: 12 },
  // 24 × 30 = 720 in a 1000 box: 140px inset, 630 × 540 of ink. The same
  // geometry as above, so the two cannot disagree about how the mark is placed.
  { size: 1000, scale: 30 },
];

export function avatarPngs() {
  return AVATARS.map(({ size, scale }) => ({
    name: `avatar-${size}.png`,
    bytes: png1(size, scale, TEXT.foreground, GROUND.background),
  }));
}

/* --- rasteriser ----------------------------------------------------------- */

/** `#rrggbb` to three bytes. The palette is written one way; this reads that way. */
function rgb(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (m === null) throw new Error(`mark: ${hex} is not a six-digit hex colour`);
  const n = Number.parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * How much of one pixel the mark covers, drawn at `scale` pixels per grid unit
 * and inset `offset` pixels into the image. 0 to 1.
 *
 * Coverage is summed rather than unioned, which is correct only because
 * `MARK_RECTS` is non-overlapping — see the note in `lib/mark.ts`. At every
 * size this file produces, each value comes out exactly 0 or 1; the area
 * arithmetic is here so that a size off the grid degrades to a soft edge rather
 * than to a wrong one.
 *
 * `offset` exists for the avatars, which draw the mark smaller than their own
 * box so it survives a circular crop. The favicon passes 0 and is unaffected —
 * that this refactor moved no favicon byte is not an argument, it is what
 * `mark:check` and `design-system.test.ts` compare.
 */
function coverage(px, py, scale, offset) {
  let covered = 0;
  for (const { x, y, width, height } of MARK_RECTS) {
    const w = Math.max(
      0,
      Math.min((x + width) * scale + offset, px + 1) - Math.max(x * scale + offset, px),
    );
    const h = Math.max(
      0,
      Math.min((y + height) * scale + offset, py + 1) - Math.max(y * scale + offset, py),
    );
    covered += w * h;
  }
  return Math.min(1, covered);
}

/**
 * The mark at `size`, filling its box, as raw RGBA.
 *
 * The favicon's rasteriser. Ink composited onto paper, opaque throughout, so
 * the icon carries its own ground rather than inheriting a tab strip's colour —
 * see `iconIco`.
 */
function rasterise(size, ink, paper) {
  const scale = size / MARK_GRID;
  const [ir, ig, ib] = rgb(ink);
  const [pr, pg, pb] = rgb(paper);
  const out = Buffer.alloc(size * size * 4);

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const a = coverage(px, py, scale, 0);
      const at = (py * size + px) * 4;
      out[at] = Math.round(pr + (ir - pr) * a);
      out[at + 1] = Math.round(pg + (ig - pg) * a);
      out[at + 2] = Math.round(pb + (ib - pb) * a);
      out[at + 3] = 255;
    }
  }
  return out;
}

/* --- PNG ------------------------------------------------------------------ */

const CRC = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC[(c ^ byte) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(buffer) {
  let a = 1;
  let b = 0;
  for (const byte of buffer) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, tail]);
}

/** A zlib stream of stored blocks. Deterministic across every zlib there is. */
function stored(raw) {
  const parts = [Buffer.from([0x78, 0x01])];
  for (let at = 0; at < raw.length || at === 0; at += 65535) {
    const slice = raw.subarray(at, at + 65535);
    const header = Buffer.alloc(5);
    header[0] = at + 65535 >= raw.length ? 1 : 0;
    header.writeUInt16LE(slice.length, 1);
    header.writeUInt16LE(~slice.length & 0xffff, 3);
    parts.push(header, slice);
  }
  const check = Buffer.alloc(4);
  check.writeUInt32BE(adler32(raw), 0);
  parts.push(check);
  return Buffer.concat(parts);
}

/**
 * The mark as one bit per pixel, centred in a square with margin around it.
 *
 * Returns packed rows: `ceil(size / 8)` bytes each, most significant bit
 * leftmost, 1 for ink and 0 for paper. That is the PNG scanline format for a
 * bit depth of 1, so nothing repacks it afterwards.
 *
 * ## Two fences, and they are the reason this is safe to compare byte for byte
 *
 * `scale` has to be a multiple of ⅔ and the resulting `offset` a whole number,
 * or a coordinate that is a multiple of 1.5 stops landing on a pixel boundary.
 * When that holds, every pixel is fully inside the ink or fully outside it, and
 * one bit per pixel is lossless rather than a rounding.
 *
 * When it does not hold, this throws. It does not round. A silently
 * anti-aliased avatar is exactly the drift the whole module exists to prevent,
 * and it would be invisible in a byte comparison against a file generated by
 * the same broken arithmetic.
 */
export function avatarBits(size, scale) {
  if ((scale * 3) % 2 !== 0) {
    throw new Error(
      `mark: avatar scale ${scale} is not a multiple of 2/3, so a coordinate at a multiple of 1.5 would not land on a whole pixel`,
    );
  }
  const offset = (size - MARK_GRID * scale) / 2;
  if (!Number.isInteger(offset)) {
    throw new Error(
      `mark: avatar ${size}px at scale ${scale} centres on a half-pixel (offset ${offset})`,
    );
  }

  const stride = Math.ceil(size / 8);
  const rows = Buffer.alloc(size * stride);

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const a = coverage(px, py, scale, offset);
      if (a !== 0 && a !== 1) {
        throw new Error(
          `mark: avatar ${size}px at scale ${scale} anti-aliases at (${px}, ${py}) — coverage ${a}. One bit per pixel cannot hold that, and rounding it would make this file a lie about the geometry.`,
        );
      }
      if (a === 1) rows[py * stride + (px >> 3)] |= 0x80 >> (px & 7);
    }
  }
  return { rows, stride };
}

/**
 * A two-colour palette PNG, stored-deflate, exactly reproducible.
 *
 * The favicon is truecolour-with-alpha because Next.js decodes `favicon.ico` at
 * build time and its decoder rejects a PNG inside an ICO that is not RGBA. That
 * constraint is about the container, not about the image — these avatars are
 * standalone files with no such consumer, and the picture has exactly two
 * colours in it.
 *
 * Which matters more than it sounds. Stored blocks are what make these files
 * the same bytes under every zlib there is, and at 1000×1000 an RGBA payload
 * stored uncompressed is about **4MB**. One bit per pixel with a two-entry
 * palette is ~126KB for the same image, byte-identical forever, and still no
 * image library anywhere near it.
 */
function png1(size, scale, ink, paper) {
  const { rows, stride } = avatarBits(size, scale);

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 1; // one bit per pixel
  header[9] = 3; // indexed colour
  // 10, 11, 12 stay zero: deflate, adaptive filtering, no interlace.

  // Index 0 is paper and index 1 is ink, matching the bit sense in
  // `avatarBits`. Order is the palette, not a convention to remember.
  const palette = Buffer.concat([Buffer.from(rgb(paper)), Buffer.from(rgb(ink))]);

  // One filter byte per row, always zero — filtering exists to help a
  // compressor and there is no compressor here.
  const raw = Buffer.alloc(size * (stride + 1));
  for (let row = 0; row < size; row++) {
    rows.copy(raw, row * (stride + 1) + 1, row * stride, (row + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('PLTE', palette),
    chunk('IDAT', stored(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function png(size, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // eight bits per channel
  // Truecolour *with* alpha, every pixel opaque. Three bytes per pixel would be
  // the honest encoding of an image that has no transparency in it, and it is
  // what this wrote first — but Next.js decodes `favicon.ico` at build time to
  // read its dimensions, and its decoder rejects a PNG inside an ICO that is not
  // RGBA outright: "Format error decoding Ico: The PNG is not in RGBA format".
  // A fourth channel of nothing but 255 is the price of the file being readable.
  header[9] = 6;
  // 10, 11, 12 stay zero: deflate, adaptive filtering, no interlace.

  // One filter byte per row, always zero. Filtering exists to help the
  // compressor, and there is no compressor here.
  const stride = size * 4;
  const raw = Buffer.alloc(size * (stride + 1));
  for (let row = 0; row < size; row++) {
    pixels.copy(raw, row * (stride + 1) + 1, row * stride, (row + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', stored(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* --- ICO ------------------------------------------------------------------ */

/**
 * PNG-in-ICO, which every browser and every Windows since Vista reads, and which
 * keeps this file a container around the same encoder rather than a second one.
 */
function ico(sizes, ink, paper) {
  const images = sizes.map((size) => png(size, rasterise(size, ink, paper)));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // 1 = icon, 2 would be a cursor
  header.writeUInt16LE(sizes.length, 4);

  let offset = 6 + sizes.length * 16;
  const entries = sizes.map((size, index) => {
    const entry = Buffer.alloc(16);
    entry[0] = size === 256 ? 0 : size;
    entry[1] = size === 256 ? 0 : size;
    entry[2] = 0; // not a palette
    entry[3] = 0;
    entry.writeUInt16LE(1, 4); // planes
    entry.writeUInt16LE(32, 6); // bits per pixel, matching the RGBA payload
    entry.writeUInt32LE(images[index].length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += images[index].length;
    return entry;
  });

  return Buffer.concat([header, ...entries, ...images]);
}

/* --- write, or check ------------------------------------------------------ */

if (import.meta.url === `file://${process.argv[1]}`) {
  const files = [
    [join(APP, 'icon.svg'), Buffer.from(iconSvg(), 'utf8')],
    [join(APP, 'favicon.ico'), iconIco()],
    // `public/` rather than `app/`: these are not an icon convention Next.js
    // serves from the route tree, they are files to hand to a platform. Being
    // served at `/avatar-400.png` is the convenience of putting them there.
    ...avatarPngs().map(({ name, bytes }) => [join(PUBLIC, name), bytes]),
  ];
  const check = process.argv.includes('--check');
  const stale = [];

  for (const [path, content] of files) {
    const name = path.slice(root.length + 1);
    if (check) {
      if (!existsSync(path) || !readFileSync(path).equals(content)) stale.push(name);
    } else {
      writeFileSync(path, content);
      console.log(`mark: wrote ${name} (${content.length} bytes)`);
    }
  }

  if (check) {
    if (stale.length > 0) {
      console.error(
        `mark: ${stale.join(' and ')} no longer ${stale.length === 1 ? 'matches' : 'match'} ` +
          'lib/mark.ts — run `npm run mark` and commit the result.',
      );
      process.exit(1);
    }
    console.log('mark: up to date');
  }
}
