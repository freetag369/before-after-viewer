// ビフォーアフターのスライダー。左がビフォー、右がアフター。
import { el } from './ui.js';

const KNOB = '<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 7l-5 5 5 5M15 7l5 5-5 5"/></svg>';

export function createSlider(stage, beforeUrl, afterUrl) {
  const after = el('img', { class: 'ba-img', src: afterUrl, alt: '', draggable: 'false' });
  const before = el('img', { class: 'ba-img ba-before', src: beforeUrl, alt: '', draggable: 'false' });
  const knob = el('div', { class: 'ba-knob' });
  knob.innerHTML = KNOB;
  const labelB = el('span', { class: 'ba-label b' }, 'BEFORE');
  const labelA = el('span', { class: 'ba-label a' }, 'AFTER');
  const box = el('div', { class: 'ba' }, after, before, el('div', { class: 'ba-line' }, knob), labelB, labelA);

  let pos = 50;
  let ratio = 0;

  const apply = () => {
    box.style.setProperty('--pos', pos + '%');
    labelB.style.opacity = pos < 14 ? 0 : 1;
    labelA.style.opacity = pos > 86 ? 0 : 1;
  };

  // アフター画像の縦横比に合わせて、画面内に収まる最大サイズにする
  const fit = () => {
    if (!ratio) return;
    const W = stage.clientWidth, H = stage.clientHeight;
    let w = W, h = W / ratio;
    if (h > H) { h = H; w = H * ratio; }
    box.style.width = w + 'px';
    box.style.height = h + 'px';
  };

  after.addEventListener('load', () => {
    ratio = after.naturalWidth / after.naturalHeight;
    fit();
    box.classList.add('ready');
  });
  const ro = new ResizeObserver(fit);
  ro.observe(stage);

  // 少し動かしてからドラッグ開始(タップは画面側でボタン表示切替に使う)
  let drag = null;
  box.addEventListener('pointerdown', e => {
    drag = { id: e.pointerId, x: e.clientX, active: false };
    box.setPointerCapture(e.pointerId);
  });
  box.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.active && Math.abs(e.clientX - drag.x) < 5) return;
    drag.active = true;
    const r = box.getBoundingClientRect();
    pos = Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100));
    apply();
  });
  const end = e => { if (drag && e.pointerId === drag.id) drag = null; };
  box.addEventListener('pointerup', end);
  box.addEventListener('pointercancel', end);

  apply();
  stage.append(box);
  return { destroy() { ro.disconnect(); box.remove(); } };
}
