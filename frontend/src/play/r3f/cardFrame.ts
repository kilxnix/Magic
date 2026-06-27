import { CanvasTexture, SRGBColorSpace } from 'three';
import type { Placement, TypeKind } from './placements';
import { parseManaPips } from '../manaColors';

export function frameSignature(
  p: Pick<Placement, 'name' | 'power' | 'toughness' | 'tapped' | 'counters' | 'manaCost' | 'typeKind' | 'isCommander'>,
): string {
  const pt = p.power != null || p.toughness != null ? `${p.power ?? ''}/${p.toughness ?? ''}` : '';
  const counters = p.counters
    ? Object.keys(p.counters)
        .sort()
        .map((k) => `${k}:${p.counters![k]}`)
        .join(',')
    : '';
  // tapped does NOT change the drawn frame (tapping is a mesh rotation), so it is
  // intentionally excluded — identical cards share one texture whether tapped or not.
  return `${p.name}|${pt}|${counters}|${p.manaCost ?? ''}|${p.typeKind ?? ''}|${p.isCommander ? 'c' : ''}`;
}

const TINT: Record<string, string> = { W: '#e9e3c0', U: '#1e5fb4', B: '#3b3b46', R: '#b1361e', G: '#1c6b3c' };
const TINT_MULTI = '#c9a227';
const TINT_LAND = '#6b4f2a';
const TINT_COLORLESS = '#7a7f87';

function tintFor(colorIdentity: string[] | undefined, typeKind: TypeKind): string {
  const ci = colorIdentity ?? [];
  if (ci.length >= 2) return TINT_MULTI;
  if (ci.length === 1) return TINT[ci[0]] ?? TINT_COLORLESS;
  return typeKind === 'land' ? TINT_LAND : TINT_COLORLESS;
}

export interface FrameSpec {
  name: string;
  tint: string;
  manaPips: string[];
  pt: string | null;
  typeKind: TypeKind;
  isCommander: boolean;
  isToken: boolean;
  counterText: string | null;
}

export function frameSpec(p: Placement): FrameSpec {
  const pt = p.typeKind === 'creature' ? `${p.power ?? 0}/${p.toughness ?? 0}` : null;
  const counterText = p.counters && Object.keys(p.counters).length > 0
    ? Object.entries(p.counters).map(([k, v]) => `${k}×${v}`).join(' ')
    : null;
  return {
    name: p.name,
    tint: tintFor(p.colorIdentity, p.typeKind),
    manaPips: parseManaPips(p.manaCost ?? ''),
    pt,
    typeKind: p.typeKind,
    isCommander: Boolean(p.isCommander),
    isToken: Boolean(p.isToken),
    counterText,
  };
}

export function createFrameCache<T>(make: (p: Placement) => T): { get(p: Placement): T; size(): number } {
  const store = new Map<string, T>();
  return {
    get(p: Placement): T {
      const sig = frameSignature(p);
      let v = store.get(sig);
      if (v === undefined) {
        v = make(p);
        store.set(sig, v);
      }
      return v;
    },
    size: () => store.size,
  };
}

const PIP_FILL: Record<string, string> = { W: '#f5f0d8', U: '#3a7bd5', B: '#5a5a66', R: '#d6492b', G: '#2e9e54' };
const FRAME_W = 256;
const FRAME_H = 358;

function drawFrame(ctx: CanvasRenderingContext2D, spec: FrameSpec): void {
  // Base + border tint.
  ctx.fillStyle = '#15140f';
  ctx.fillRect(0, 0, FRAME_W, FRAME_H);
  ctx.lineWidth = 14;
  ctx.strokeStyle = spec.tint;
  ctx.strokeRect(7, 7, FRAME_W - 14, FRAME_H - 14);
  // Art region placeholder (filled by the art loader later) — tinted panel.
  ctx.fillStyle = spec.tint;
  ctx.globalAlpha = 0.35;
  ctx.fillRect(20, 44, FRAME_W - 40, 180);
  ctx.globalAlpha = 1;
  // Name banner.
  ctx.fillStyle = 'rgba(0,0,0,0.72)';
  ctx.fillRect(16, 16, FRAME_W - 32, 30);
  ctx.fillStyle = '#f4f1e6';
  ctx.font = 'bold 20px system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  const name = spec.name.length > 20 ? spec.name.slice(0, 19) + '…' : spec.name;
  ctx.fillText(name, 24, 32, FRAME_W - 70);
  // Mana pips, right-aligned in the name banner.
  let px = FRAME_W - 26;
  for (const pip of [...spec.manaPips].reverse()) {
    const color = PIP_FILL[pip] ?? '#c9c2b6';
    ctx.beginPath();
    ctx.arc(px, 31, 9, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    if (!(pip in PIP_FILL)) {
      ctx.fillStyle = '#1a1a1a';
      ctx.font = 'bold 12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(pip, px, 32);
      ctx.textAlign = 'left';
    }
    px -= 21;
  }
  // Type strip.
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(16, 232, FRAME_W - 32, 24);
  ctx.fillStyle = '#e7e2d2';
  ctx.font = '14px system-ui, sans-serif';
  const typeLabel = spec.isCommander ? 'Commander' : spec.isToken ? 'Token' : spec.typeKind;
  ctx.fillText(typeLabel[0].toUpperCase() + typeLabel.slice(1), 24, 245);
  // P/T badge.
  if (spec.pt) {
    ctx.fillStyle = '#15140f';
    ctx.strokeStyle = spec.tint;
    ctx.lineWidth = 3;
    ctx.fillRect(FRAME_W - 78, FRAME_H - 52, 60, 34);
    ctx.strokeRect(FRAME_W - 78, FRAME_H - 52, 60, 34);
    ctx.fillStyle = '#f4f1e6';
    ctx.font = 'bold 22px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(spec.pt, FRAME_W - 48, FRAME_H - 33);
    ctx.textAlign = 'left';
  }
}

/** Same-origin card-art proxy URL (art is resolved by card name). */
export function cardImageUrl(name: string): string {
  return `/api/card-image/${encodeURIComponent(name)}`;
}

const ART = { x: 20, y: 44, w: FRAME_W - 40, h: 180 };
let inFlight = 0;
const MAX_INFLIGHT = 6;
const artQueue: (() => void)[] = [];

function pump(): void {
  while (inFlight < MAX_INFLIGHT && artQueue.length > 0) {
    const job = artQueue.shift()!;
    job();
  }
}

/** Lazily paint the card art into the inset region; on any failure keep the tinted panel. */
function loadArtInset(name: string, canvas: HTMLCanvasElement, tex: CanvasTexture): void {
  if (typeof Image === 'undefined') return;
  const job = () => {
    inFlight++;
    const img = new Image();
    img.onload = () => {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(ART.x, ART.y, ART.w, ART.h);
        ctx.clip();
        const scale = Math.max(ART.w / img.width, ART.h / img.height); // cover-fit
        const dw = img.width * scale;
        const dh = img.height * scale;
        ctx.drawImage(img, ART.x + (ART.w - dw) / 2, ART.y + (ART.h - dh) / 2, dw, dh);
        ctx.restore();
        tex.needsUpdate = true;
      }
      inFlight--;
      pump();
    };
    img.onerror = () => { inFlight--; pump(); }; // keep the tinted panel
    img.src = cardImageUrl(name);
  };
  artQueue.push(job);
  pump();
}

/** Build a card-frame texture. Returns null when no 2D context (test/headless). */
export function makeFrameTexture(spec: FrameSpec, name?: string): CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = FRAME_W;
  canvas.height = FRAME_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  drawFrame(ctx, spec);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  if (name) loadArtInset(name, canvas, tex);
  return tex;
}

const frameTextureCache = createFrameCache<CanvasTexture | null>((p) => makeFrameTexture(frameSpec(p), p.name));

export function getFrameTexture(p: Placement): CanvasTexture | null {
  return frameTextureCache.get(p);
}
