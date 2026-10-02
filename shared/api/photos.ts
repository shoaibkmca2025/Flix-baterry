import { File } from 'expo-file-system';
import { apiGet, apiPost } from './client';
import type { Entry } from '../domain';

/**
 * The dealer's photos on the server (memory.md D-10: Neon Object Storage, 2 Oct 2026).
 * The app keeps a photo as a tile tag ('New label', 'Old battery · item 2', …) and a uri — a
 * data: URL in a browser, a file:// path on a phone. After a request is accepted, each one is
 * sent to POST /entries/:id/photos; head office reads them back with signed links.
 */
export type EntryPhoto = { id: string; tag: string; itemId: string | null; itemSeq: number | null; contentType: string; sizeBytes: number; createdAt: string; url: string };
type PhotoType = 'image/jpeg' | 'image/png' | 'image/webp';

export function listPhotos(entryApiId: string, accessToken: string) {
  return apiGet<{ items: EntryPhoto[] }>(`/entries/${entryApiId}/photos`, { accessToken });
}

export function uploadPhoto(entryApiId: string, input: { tag: string; itemSeq?: number; contentType: PhotoType; data: string }, accessToken: string) {
  return apiPost<{ id: string }>(`/entries/${entryApiId}/photos`, input, { accessToken });
}

/** 'Old battery · item 2' → the tile 'Old battery' on the second battery (itemSeq 1). */
export function splitTag(tag: string): { tag: string; itemSeq: number } {
  const m = / · item (\d+)$/.exec(tag);
  return m ? { tag: tag.slice(0, m.index), itemSeq: Number(m[1]) - 1 } : { tag, itemSeq: 0 };
}

/**
 * The longest side a stored photo needs. These are read on a laptop to check a serial against a
 * label, never printed — and the console was downloading 3 MB per thumbnail, which is what made
 * the review page slow (client, 2 Oct 2026). 1600px keeps a serial perfectly legible at roughly
 * a tenth of the bytes.
 */
const MAX_EDGE = 1600;

/**
 * Shrink an oversized photo before it is sent. Browser-only: it needs a canvas, and that is where
 * the dealer app runs today. On a native build this returns the original untouched, so nothing
 * breaks — it just does not save anything until expo-image-manipulator is added.
 */
async function shrink(dataUrl: string): Promise<string> {
  if (typeof document === 'undefined' || typeof Image === 'undefined') return dataUrl;
  try {
    const img = await new Promise<HTMLImageElement>((ok, bad) => {
      const el = new Image();
      el.onload = () => ok(el); el.onerror = bad;
      el.src = dataUrl;
    });
    const edge = Math.max(img.width, img.height);
    if (!edge || edge <= MAX_EDGE) return dataUrl;
    const scale = MAX_EDGE / edge;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return dataUrl;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const out = canvas.toDataURL('image/jpeg', 0.7);
    // never send something larger than what we started with
    return out.length < dataUrl.length ? out : dataUrl;
  } catch { return dataUrl; } // a photo that will not shrink is still worth sending whole
}

async function payloadOf(uri: string): Promise<{ contentType: PhotoType; data: string }> {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,(.*)$/s.exec(uri);
  if (m) {
    const smaller = await shrink(uri);
    const s = /^data:(image\/(?:jpeg|png|webp));base64,(.*)$/s.exec(smaller);
    return s ? { contentType: s[1] as PhotoType, data: s[2]! } : { contentType: m[1] as PhotoType, data: m[2]! };
  }
  const lower = uri.toLowerCase();
  const contentType: PhotoType = lower.endsWith('.png') ? 'image/png' : lower.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
  return { contentType, data: await new File(uri).base64() };
}

/**
 * Sends every photo on a request that the server has just accepted. One photo failing does
 * not stop the others, and never undoes the request — the caller says how many did not go.
 */
export async function uploadEntryPhotos(e: Pick<Entry, 'evidence' | 'evidenceTags'>, entryApiId: string, accessToken: string): Promise<{ sent: number; failed: number }> {
  const tags = e.evidenceTags && e.evidenceTags.length === e.evidence.length ? e.evidenceTags : e.evidence.map(() => 'Photo');
  let sent = 0, failed = 0;
  for (let i = 0; i < e.evidence.length; i++) {
    const uri = e.evidence[i];
    if (!uri) continue;
    try {
      await uploadPhoto(entryApiId, { ...splitTag(tags[i]!), ...(await payloadOf(uri)) }, accessToken);
      sent++;
    } catch { failed++; }
  }
  return { sent, failed };
}
