// 画像の取り込み(縮小・サムネイル作成)と、サムネイル表示
import { el } from './ui.js';

const MAX_SIDE = 2560;   // 保存する画像の長辺の上限
const THUMB_SIDE = 400;

function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('画像を読み込めません')); };
    img.src = url;
  });
}

function toJpeg(img, maxSide, quality) {
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.naturalWidth * scale));
  c.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return new Promise((resolve, reject) =>
    c.toBlob(b => (b ? resolve(b) : reject(new Error('画像を変換できません'))), 'image/jpeg', quality));
}

// → {data: ArrayBuffer, type, thumb: ArrayBuffer}
export async function processFile(file) {
  const { img, url } = await loadImage(file);
  try {
    const small = Math.max(img.naturalWidth, img.naturalHeight) <= MAX_SIDE;
    const keep = small && /^image\/(jpeg|png|webp)$/.test(file.type);
    const full = keep ? file : await toJpeg(img, MAX_SIDE, 0.9);
    const thumb = await toJpeg(img, THUMB_SIDE, 0.8);
    return { data: await full.arrayBuffer(), type: full.type, thumb: await thumb.arrayBuffer() };
  } finally {
    URL.revokeObjectURL(url);
  }
}

const cache = new Map();

function thumbUrl(item, role) {
  const key = `${item.id}:${role}`;
  let url = cache.get(key);
  if (!url && item.thumbs?.[role]) {
    url = URL.createObjectURL(new Blob([item.thumbs[role]], { type: 'image/jpeg' }));
    cache.set(key, url);
  }
  return url || '';
}

export function dropThumbs(itemId) {
  for (const role of ['before', 'after', 'image']) {
    const key = `${itemId}:${role}`;
    if (cache.has(key)) { URL.revokeObjectURL(cache.get(key)); cache.delete(key); }
  }
}

export function clearThumbs() {
  cache.forEach(u => URL.revokeObjectURL(u));
  cache.clear();
}

// セットは左半分ビフォー・右半分アフター、通常画像は1枚
export function thumbEl(item, cls = 'thumb') {
  const part = role => {
    const d = el('div', {});
    d.style.backgroundImage = `url(${thumbUrl(item, role)})`;
    return d;
  };
  return item.type === 'pair'
    ? el('div', { class: cls + ' pair' }, part('before'), part('after'))
    : el('div', { class: cls }, part('image'));
}
