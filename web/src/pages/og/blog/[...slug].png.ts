import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import satori from 'satori';
import { html } from 'satori-html';
import sharp from 'sharp';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Per-post Open Graph image rendered at build time. 1200×630 PNG with the
// post title in Fraunces over the brand background. Uses satori (HTML/CSS
// → SVG) + sharp (SVG → PNG). Both run in Node at build time; no runtime
// cost on Cloudflare Pages.
//
// If the Fraunces woff2 isn't yet checked in / fetched (web/scripts/
// fetch-fonts.sh hasn't run), we degrade gracefully to a solid-color
// placeholder PNG so the build never fails on missing fonts. The
// production deploy will then serve the default /og/default.png if a
// post doesn't override `ogImage`.

export async function getStaticPaths() {
  const posts = await getCollection('blog', ({ data }) => !data.draft);
  return posts.map((post) => ({ params: { slug: post.slug }, props: { post } }));
}

const fontPath = fileURLToPath(
  new URL('../../../../public/fonts/fraunces/fraunces-roman-latin-ext.woff2', import.meta.url),
);

let cachedFont: ArrayBuffer | null = null;
async function loadFont(): Promise<ArrayBuffer | null> {
  if (cachedFont !== null) return cachedFont;
  try {
    const buf = await readFile(fontPath);
    if (buf.byteLength === 0) return null;
    // Satori parses TTF/OTF only; woff2 (magic "wOF2") would crash opentype.js.
    // The browser-shipped fonts are woff2, so degrade to placeholder until a
    // TTF copy is added alongside.
    if (buf[0] === 0x77 && buf[1] === 0x4f && buf[2] === 0x46 && buf[3] === 0x32) {
      return null;
    }
    cachedFont = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    return cachedFont;
  } catch {
    return null;
  }
}

async function renderPlaceholder(): Promise<Buffer> {
  // Solid brand-color rectangle with a small accent stripe. Satori-free —
  // sharp can synthesize this without any font dependency.
  return sharp({
    create: {
      width: 1200,
      height: 630,
      channels: 4,
      background: { r: 253, g: 250, b: 243, alpha: 1 },
    },
  })
    .composite([
      {
        input: Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"><rect x="0" y="600" width="1200" height="30" fill="#B06E52"/></svg>',
        ),
        top: 0,
        left: 0,
      },
    ])
    .png()
    .toBuffer();
}

export const GET: APIRoute = async ({ props }) => {
  const post = (props as { post: { data: { title: string; description: string } } }).post;
  const fontBuf = await loadFont();

  if (!fontBuf) {
    const png = await renderPlaceholder();
    return new Response(new Uint8Array(png), {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  }

  const tree = html(`
    <div style="display:flex;flex-direction:column;justify-content:space-between;width:100%;height:100%;background:#FDFAF3;padding:64px;">
      <div style="display:flex;align-items:center;gap:16px;color:#1C1917;font-size:32px;">
        <div style="width:48px;height:48px;border-radius:12px;background:#B06E52;"></div>
        <span style="font-weight:550;">Tricho</span>
      </div>
      <div style="display:flex;flex-direction:column;gap:24px;">
        <h1 style="margin:0;font-size:64px;color:#1C1917;font-weight:550;line-height:1.1;">${escapeHtml(post.data.title)}</h1>
        <p style="margin:0;font-size:24px;color:#736D64;line-height:1.4;max-width:1000px;">${escapeHtml(post.data.description)}</p>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:flex-end;color:#9F9990;font-size:20px;">
        <span>tricho.app/blog</span>
        <span style="color:#B06E52;">end-to-end šifrováno</span>
      </div>
    </div>
  `);

  const svg = await satori(tree as Parameters<typeof satori>[0], {
    width: 1200,
    height: 630,
    fonts: [{ name: 'Fraunces', data: fontBuf, weight: 500 as const, style: 'normal' as const }],
  });

  const png = await sharp(Buffer.from(svg)).png().toBuffer();

  return new Response(new Uint8Array(png), {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
