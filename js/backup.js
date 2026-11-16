// 設定画面と、全データのバックアップ(無圧縮ZIP)の書き出し・読み込み
import * as db from './db.js';
import { el, modal, confirmDialog, toast, busy, pickFiles } from './ui.js';
import { clearThumbs } from './images.js';

// ---------- ZIP(無圧縮) ----------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(u8) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

class ZipWriter {
  parts = [];
  entries = [];
  offset = 0;

  add(name, buffer) {
    const data = new Uint8Array(buffer);
    const nameBytes = new TextEncoder().encode(name);
    const crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true);
    h.setUint16(4, 20, true);
    h.setUint16(12, 0x21, true);            // 日付 1980-01-01
    h.setUint32(14, crc, true);
    h.setUint32(18, data.length, true);
    h.setUint32(22, data.length, true);
    h.setUint16(26, nameBytes.length, true);
    this.entries.push({ nameBytes, crc, size: data.length, offset: this.offset });
    this.parts.push(h.buffer, nameBytes, new Blob([data]));
    this.offset += 30 + nameBytes.length + data.length;
    if (this.offset > 0xFFF00000 || this.entries.length > 65000) {
      throw new Error('データが大きすぎてバックアップを作成できません(上限 約4GB)。');
    }
  }

  finish() {
    const cdStart = this.offset;
    let cdSize = 0;
    for (const e of this.entries) {
      const h = new DataView(new ArrayBuffer(46));
      h.setUint32(0, 0x02014b50, true);
      h.setUint16(4, 20, true);
      h.setUint16(6, 20, true);
      h.setUint16(14, 0x21, true);
      h.setUint32(16, e.crc, true);
      h.setUint32(20, e.size, true);
      h.setUint32(24, e.size, true);
      h.setUint16(28, e.nameBytes.length, true);
      h.setUint32(42, e.offset, true);
      this.parts.push(h.buffer, e.nameBytes);
      cdSize += 46 + e.nameBytes.length;
    }
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, this.entries.length, true);
    end.setUint16(10, this.entries.length, true);
    end.setUint32(12, cdSize, true);
    end.setUint32(16, cdStart, true);
    this.parts.push(end.buffer);
    return new Blob(this.parts, { type: 'application/zip' });
  }
}

const BAD_FILE = 'このファイルはバックアップとして読み込めません。';

async function readZip(file) {
  const tail = new DataView(await file.slice(Math.max(0, file.size - 65558)).arrayBuffer());
  let p = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === 0x06054b50) { p = i; break; }
  }
  if (p < 0) throw new Error(BAD_FILE);
  const total = tail.getUint16(p + 10, true);
  const cdSize = tail.getUint32(p + 12, true);
  const cdStart = tail.getUint32(p + 16, true);
  const cd = new DataView(await file.slice(cdStart, cdStart + cdSize).arrayBuffer());
  const dec = new TextDecoder();
  const entries = new Map();
  let o = 0;
  for (let i = 0; i < total; i++) {
    if (cd.getUint32(o, true) !== 0x02014b50 || cd.getUint16(o + 10, true) !== 0) throw new Error(BAD_FILE);
    const nameLen = cd.getUint16(o + 28, true);
    entries.set(dec.decode(new Uint8Array(cd.buffer, o + 46, nameLen)),
      { size: cd.getUint32(o + 20, true), offset: cd.getUint32(o + 42, true) });
    o += 46 + nameLen + cd.getUint16(o + 30, true) + cd.getUint16(o + 32, true);
  }
  return async name => {
    const e = entries.get(name);
    if (!e) return null;
    const lh = new DataView(await file.slice(e.offset, e.offset + 30).arrayBuffer());
    const start = e.offset + 30 + lh.getUint16(26, true) + lh.getUint16(28, true);
    return file.slice(start, start + e.size).arrayBuffer();
  };
}

// ---------- 書き出し ----------

async function buildBackup() {
  const b = busy('バックアップを作成中…');
  try {
    const folders = await db.getFolders();
    const items = await db.getAllItems();
    const zip = new ZipWriter();
    const meta = [];
    for (let i = 0; i < items.length; i++) {
      b.set(`バックアップを作成中… ${i + 1} / ${items.length}`);
      const { thumbs = {}, ...rest } = items[i];
      const images = [];
      for (const [role, im] of Object.entries(await db.getImages(rest.id))) {
        zip.add(`images/${rest.id}_${role}`, im.data);
        if (thumbs[role]) zip.add(`thumbs/${rest.id}_${role}`, thumbs[role]);
        images.push({ role, type: im.type });
      }
      meta.push({ ...rest, images });
    }
    const json = JSON.stringify({ app: 'ba-viewer', version: 1, folders, items: meta });
    zip.add('data.json', new TextEncoder().encode(json).buffer);
    return zip.finish();
  } finally {
    b.close();
  }
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: name, hidden: true });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

async function exportBackup() {
  let blob;
  try { blob = await buildBackup(); } catch (e) { return toast(e.message || 'バックアップを作成できませんでした。'); }
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  const name = `beforeafter-backup-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.zip`;
  const mb = (blob.size / 1048576).toFixed(1);

  // 共有シートはタップ直後でないと開けないため、作成後に保存ボタンを出す
  await modal(close => el('div', { class: 'dialog' },
    el('h3', {}, 'バックアップの準備ができました'),
    el('p', { class: 'msg' }, `${name}(${mb} MB)\n「保存する」から「ファイルに保存」などを選んでください。`),
    el('div', { class: 'actions' },
      el('button', { class: 'btn', onclick: () => close(null) }, '閉じる'),
      el('button', { class: 'btn primary', onclick: async () => {
        const file = new File([blob], name, { type: 'application/zip' });
        if (navigator.maxTouchPoints > 1 && navigator.canShare?.({ files: [file] })) {
          try { await navigator.share({ files: [file] }); }
          catch (e) { if (e.name !== 'AbortError') download(blob, name); }
        } else {
          download(blob, name);
        }
      } }, '保存する'),
    ),
  ));
}

// ---------- 読み込み ----------

async function importBackup(file, replace) {
  const b = busy('バックアップを読み込み中…');
  try {
    const read = await readZip(file);
    const raw = await read('data.json');
    if (!raw) throw new Error(BAD_FILE);
    const data = JSON.parse(new TextDecoder().decode(raw));
    if (data.app !== 'ba-viewer' || !Array.isArray(data.folders) || !Array.isArray(data.items)) {
      throw new Error(BAD_FILE);
    }
    if (replace) await db.clearAll();
    clearThumbs();
    for (const f of data.folders) await db.putFolder(f);
    for (let i = 0; i < data.items.length; i++) {
      b.set(`バックアップを読み込み中… ${i + 1} / ${data.items.length}`);
      const { images = [], ...item } = data.items[i];
      item.thumbs = {};
      const records = [];
      for (const { role, type } of images) {
        const bytes = await read(`images/${item.id}_${role}`);
        if (!bytes) continue;
        records.push({ role, type, data: bytes });
        const thumb = await read(`thumbs/${item.id}_${role}`);
        if (thumb) item.thumbs[role] = thumb;
      }
      if (records.length) await db.addItem(item, records);
    }
    toast('バックアップを読み込みました。');
  } catch (e) {
    toast(e.message?.includes('バックアップ') ? e.message : '読み込みに失敗しました。空き容量を確認してください。');
  } finally {
    b.close();
  }
}

async function chooseImport() {
  const [file] = await pickFiles({ accept: '.zip,application/zip' });
  if (!file) return false;
  const mode = await modal(close => el('div', { class: 'dialog' },
    el('h3', {}, '読み込み方法'),
    el('p', { class: 'msg' }, '「追加」は今あるデータを残したまま取り込みます。\n「置き換え」は今あるデータをすべて消してから取り込みます。'),
    el('div', { class: 'actions' },
      el('button', { class: 'btn', onclick: () => close(null) }, 'キャンセル'),
      el('button', { class: 'btn danger', onclick: () => close('replace') }, '置き換え'),
      el('button', { class: 'btn primary', onclick: () => close('add') }, '追加'),
    ),
  ));
  if (!mode) return false;
  if (mode === 'replace' &&
      !await confirmDialog('今あるフォルダと画像をすべて削除して、バックアップの内容に置き換えます。元に戻せません。', { ok: '置き換える', danger: true })) {
    return false;
  }
  await importBackup(file, mode === 'replace');
  return true;
}

// ---------- 設定画面 ----------

export async function openSettings(onChanged) {
  let usage = '';
  try {
    const est = await navigator.storage?.estimate?.();
    if (est?.usage != null) usage = `使用中の容量: 約 ${(est.usage / 1048576).toFixed(0)} MB`;
  } catch { /* 取得できない環境では表示しない */ }

  await modal(close => el('div', { class: 'dialog' },
    el('h3', {}, '設定・バックアップ'),
    el('p', { class: 'msg' },
      '画像はこの端末の中だけに保存されます。アプリを削除したりSafariのデータを消去すると画像も消えるため、ときどきバックアップを書き出してください。'),
    usage && el('p', { class: 'msg sub' }, usage),
    el('button', { class: 'row', onclick: exportBackup }, 'バックアップを書き出す'),
    el('button', { class: 'row', onclick: async () => {
      if (await chooseImport()) { close(null); onChanged(); }
    } }, 'バックアップを読み込む'),
    el('button', { class: 'row cancel', onclick: () => close(null) }, '閉じる'),
  ));
}
