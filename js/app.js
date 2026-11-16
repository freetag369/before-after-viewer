import { showHome } from './library.js';

// iPadのピンチ拡大でレイアウトが崩れるのを防ぐ
document.addEventListener('gesturestart', e => e.preventDefault());

// 端末の空き容量が減っても自動削除されにくくする
navigator.storage?.persist?.().catch(() => {});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

showHome();
