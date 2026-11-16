// フォルダ一覧と、フォルダ内の一覧・編集操作
import * as db from './db.js';
import { el, modal, sheet, confirmDialog, promptText, toast, busy, pickFiles } from './ui.js';
import { processFile, thumbEl, dropThumbs } from './images.js';
import { openViewer } from './viewer.js';
import { openSettings } from './backup.js';

const SAVE_ERROR = '保存できませんでした。空き容量を確認してください。';

function render(...nodes) {
  document.getElementById('app').replaceChildren(...nodes.flat().filter(Boolean));
}

const moreButton = onTap => el('button', {
  class: 'more', 'aria-label': 'メニュー',
  onclick: e => { e.stopPropagation(); onTap(); },
}, '⋯');

// ---------- フォルダ一覧 ----------

export async function showHome() {
  const folders = await db.getFolders();
  const sums = await Promise.all(folders.map(f => db.folderSummary(f.id)));

  render(
    el('header', { class: 'bar' },
      el('h1', {}, 'ビフォーアフター'),
      el('span', { class: 'spacer' }),
      el('button', { class: 'btn', onclick: () => openSettings(showHome) }, '設定・バックアップ'),
    ),
    !folders.length && el('p', { class: 'hint' }, 'まずフォルダを作って、画像を追加しましょう。'),
    el('div', { class: 'grid' },
      folders.map((f, i) => el('div', { class: 'card', onclick: () => showFolder(f.id) },
        sums[i].cover ? thumbEl(sums[i].cover) : el('div', { class: 'thumb empty' }, '空のフォルダ'),
        el('div', { class: 'meta' },
          el('div', { class: 'name' }, f.name),
          el('div', { class: 'sub' }, `${sums[i].count} 件`)),
        moreButton(() => folderMenu(f, sums[i].count)),
      )),
      el('button', { class: 'card add-card', onclick: newFolder },
        el('span', { class: 'plus' }, '＋'), '新しいフォルダ'),
    ),
  );
  window.scrollTo(0, 0);
}

async function newFolder() {
  const name = await promptText('新しいフォルダ', '', 'フォルダ名');
  if (!name) return;
  const id = db.uid();
  await db.putFolder({ id, name, order: Date.now() });
  showFolder(id);
}

async function folderMenu(folder, count) {
  const act = await sheet(folder.name, [
    { label: '名前を変更', value: 'rename' },
    { label: 'フォルダを削除', value: 'delete', danger: true },
  ]);
  if (act === 'rename') {
    const name = await promptText('フォルダ名を変更', folder.name, 'フォルダ名');
    if (!name) return;
    await db.putFolder({ ...folder, name });
  } else if (act === 'delete') {
    const msg = count
      ? `「${folder.name}」と、中の ${count} 件をすべて削除します。元に戻せません。`
      : `「${folder.name}」を削除します。`;
    if (!await confirmDialog(msg, { ok: '削除', danger: true })) return;
    (await db.getItems(folder.id)).forEach(it => dropThumbs(it.id));
    await db.deleteFolder(folder.id);
  } else return;
  showHome();
}

// ---------- フォルダ内 ----------

async function showFolder(folderId) {
  const folder = (await db.getFolders()).find(f => f.id === folderId);
  if (!folder) return showHome();
  const items = await db.getItems(folderId);
  const refresh = () => showFolder(folderId);

  render(
    el('header', { class: 'bar' },
      el('button', { class: 'btn', onclick: showHome }, '‹ フォルダ一覧'),
      el('h1', {}, folder.name),
      el('span', { class: 'spacer' }),
      el('button', { class: 'btn primary', onclick: () => addMenu(folderId, refresh) }, '＋ 追加'),
    ),
    !items.length && el('p', { class: 'hint' }, '「＋ 追加」から、ビフォーアフターのセットや画像を登録できます。'),
    el('div', { class: 'grid' },
      items.map((item, i) => el('div', { class: 'card', onclick: () => openViewer(items, i) },
        thumbEl(item),
        item.type === 'pair' && el('span', { class: 'badge' }, 'BEFORE / AFTER'),
        item.title && el('div', { class: 'meta' }, el('div', { class: 'name' }, item.title)),
        moreButton(() => itemMenu(item, i, items, refresh)),
      )),
    ),
  );
  window.scrollTo(0, 0);
}

async function itemMenu(item, i, items, refresh) {
  const pair = item.type === 'pair';
  const act = await sheet(item.title || (pair ? 'ビフォーアフター' : '画像'), [
    { label: item.title ? 'タイトルを変更' : 'タイトルを付ける', value: 'title' },
    i > 0 && { label: '前へ移動', value: 'up' },
    i < items.length - 1 && { label: '後ろへ移動', value: 'down' },
    { label: '別のフォルダへ移動', value: 'move' },
    pair && { label: 'ビフォーとアフターを入れ替える', value: 'swap' },
    { label: '削除', value: 'delete', danger: true },
  ].filter(Boolean));

  if (act === 'title') {
    const title = await promptText('タイトル', item.title, 'タイトル(空欄でも構いません)');
    if (title === null) return;
    await db.putItem({ ...item, title });
  } else if (act === 'up' || act === 'down') {
    const other = items[i + (act === 'up' ? -1 : 1)];
    await db.putItem({ ...item, order: other.order });
    await db.putItem({ ...other, order: item.order });
  } else if (act === 'move') {
    const others = (await db.getFolders()).filter(f => f.id !== item.folderId);
    if (!others.length) return toast('移動先のフォルダがありません。先にフォルダを作ってください。');
    const target = await sheet('移動先のフォルダ', others.map(f => ({ label: f.name, value: f.id })));
    if (!target) return;
    await db.putItem({ ...item, folderId: target, order: Date.now() });
  } else if (act === 'swap') {
    await db.swapPair(item.id);
    dropThumbs(item.id);
  } else if (act === 'delete') {
    const what = pair ? 'このセット(ビフォー・アフターの2枚)' : 'この画像';
    if (!await confirmDialog(`${what}を削除します。元に戻せません。`, { ok: '削除', danger: true })) return;
    await db.deleteItem(item.id);
    dropThumbs(item.id);
  } else return;
  refresh();
}

// ---------- 追加 ----------

async function addMenu(folderId, refresh) {
  const picked = await sheet('追加するもの', [
    { label: 'ビフォーアフターのセット', value: 'pair' },
    { label: '画像(複数まとめて選べます)', action: () => pickFiles({ multiple: true }) },
  ]);
  if (picked === 'pair') {
    if (await addPair(folderId)) refresh();
  } else if (Array.isArray(picked) && picked.length) {
    await addSingles(folderId, picked);
    refresh();
  }
}

async function addSingles(folderId, files) {
  const b = busy('取り込み中…');
  let failed = 0;
  try {
    for (let i = 0; i < files.length; i++) {
      b.set(`取り込み中… ${i + 1} / ${files.length}`);
      let p;
      try { p = await processFile(files[i]); } catch { failed++; continue; }
      const now = Date.now();
      await db.addItem(
        { id: db.uid(), folderId, type: 'single', title: '', order: now + i, createdAt: now, thumbs: { image: p.thumb } },
        [{ role: 'image', data: p.data, type: p.type }],
      );
    }
  } catch {
    toast(SAVE_ERROR);
  } finally {
    b.close();
  }
  if (failed) toast(`${failed} 件の画像は読み込めませんでした。`);
}

function addPair(folderId) {
  const picked = {};
  const previews = [];
  return modal(close => {
    const title = el('input', { class: 'input', type: 'text', placeholder: 'タイトル(省略できます)', maxlength: '60' });
    const save = el('button', { class: 'btn primary', disabled: true, onclick: onSave }, '保存');

    const slot = (role, label) => {
      const s = el('button', { class: 'slot', onclick: async () => {
        const [file] = await pickFiles();
        if (!file) return;
        s.classList.add('loading');
        try {
          picked[role] = await processFile(file);
          const u = URL.createObjectURL(new Blob([picked[role].thumb], { type: 'image/jpeg' }));
          previews.push(u);
          s.style.backgroundImage = `url(${u})`;
          s.classList.add('filled');
        } catch {
          toast('この画像は読み込めませんでした。');
        }
        s.classList.remove('loading');
        save.disabled = !(picked.before && picked.after);
      } }, el('span', {}, label));
      return s;
    };

    const finish = v => { previews.forEach(u => URL.revokeObjectURL(u)); close(v); };

    async function onSave() {
      save.disabled = true;
      const now = Date.now();
      try {
        await db.addItem(
          { id: db.uid(), folderId, type: 'pair', title: title.value.trim(), order: now, createdAt: now,
            thumbs: { before: picked.before.thumb, after: picked.after.thumb } },
          ['before', 'after'].map(role => ({ role, data: picked[role].data, type: picked[role].type })),
        );
        finish(true);
      } catch {
        toast(SAVE_ERROR);
        save.disabled = false;
      }
    }

    return el('div', { class: 'dialog wide' },
      el('h3', {}, 'ビフォーアフターのセットを追加'),
      el('div', { class: 'slots' },
        slot('before', 'ビフォー画像を選ぶ'),
        slot('after', 'アフター画像を選ぶ')),
      title,
      el('div', { class: 'actions' },
        el('button', { class: 'btn', onclick: () => finish(null) }, 'キャンセル'),
        save),
    );
  }, { dismissable: false });
}
