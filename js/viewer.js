// 全画面ビューア。セットはスライダー、通常画像は1枚表示。
import * as db from './db.js';
import { el } from './ui.js';
import { thumbEl } from './images.js';
import { createSlider } from './slider.js';

export function openViewer(items, start) {
  const root = document.getElementById('viewer');
  let index = start;
  let token = 0;
  let slider = null;
  let urls = [];

  const stage = el('div', { class: 'v-stage' });
  const title = el('div', { class: 'v-title' });
  const count = el('div', { class: 'v-count' });
  const prev = el('button', { class: 'v-nav prev', 'aria-label': '前へ', onclick: () => go(index - 1) }, '‹');
  const next = el('button', { class: 'v-nav next', 'aria-label': '次へ', onclick: () => go(index + 1) }, '›');
  const thumbs = items.map((it, i) => {
    const t = thumbEl(it, 'v-thumb');
    t.addEventListener('click', () => go(i));
    return t;
  });
  const top = el('div', { class: 'v-top' },
    el('button', { class: 'v-close', onclick: close }, '✕ 閉じる'), title, count);
  const strip = el('div', { class: 'v-strip' }, thumbs);

  root.replaceChildren(stage, prev, next, top, strip);
  root.classList.remove('clean');
  root.hidden = false;
  document.body.classList.add('viewing');

  function clearStage() {
    slider?.destroy();
    slider = null;
    urls.forEach(u => URL.revokeObjectURL(u));
    urls = [];
    stage.replaceChildren();
  }

  async function go(i) {
    if (i < 0 || i >= items.length) return;
    index = i;
    const my = ++token;
    const item = items[i];
    title.textContent = item.title || '';
    count.textContent = `${i + 1} / ${items.length}`;
    prev.disabled = i === 0;
    next.disabled = i === items.length - 1;
    thumbs.forEach((t, j) => t.classList.toggle('active', j === i));
    thumbs[i].scrollIntoView({ inline: 'center', block: 'nearest' });

    const imgs = await db.getImages(item.id);
    if (my !== token) return;   // 読み込み中に別の項目へ移動した
    clearStage();
    const url = role => {
      const im = imgs[role];
      if (!im) return '';
      const u = URL.createObjectURL(new Blob([im.data], { type: im.type }));
      urls.push(u);
      return u;
    };
    if (item.type === 'pair') slider = createSlider(stage, url('before'), url('after'));
    else stage.append(el('img', { class: 'v-single', src: url('image'), alt: '', draggable: 'false' }));
  }

  // タップ: ボタン類の表示/非表示。通常画像は左右スワイプで前後へ。
  let down = null;
  stage.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY }; });
  stage.addEventListener('pointerup', e => {
    if (!down) return;
    const dx = e.clientX - down.x, dy = e.clientY - down.y;
    down = null;
    if (Math.abs(dx) < 8 && Math.abs(dy) < 8) { root.classList.toggle('clean'); return; }
    if (items[index].type !== 'pair' && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      go(index + (dx < 0 ? 1 : -1));
    }
  });

  const onKey = e => {
    if (e.key === 'ArrowLeft') go(index - 1);
    else if (e.key === 'ArrowRight') go(index + 1);
    else if (e.key === 'Escape') close();
  };
  document.addEventListener('keydown', onKey);

  function close() {
    token++;
    document.removeEventListener('keydown', onKey);
    clearStage();
    root.hidden = true;
    root.replaceChildren();
    document.body.classList.remove('viewing');
  }

  go(start);
}
