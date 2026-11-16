// IndexedDB への保存。画像はすべて端末内に置かれ、外部には送信しない。
//   folders: {id, name, order}
//   items:   {id, folderId, type:'pair'|'single', title, order, createdAt, thumbs:{role: ArrayBuffer}}
//   images:  {id:`${itemId}:${role}`, itemId, role, data: ArrayBuffer, type}
const DB_NAME = 'ba-viewer';
let dbPromise;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = () => {
        const db = r.result;
        db.createObjectStore('folders', { keyPath: 'id' });
        db.createObjectStore('items', { keyPath: 'id' }).createIndex('folderId', 'folderId');
        db.createObjectStore('images', { keyPath: 'id' }).createIndex('itemId', 'itemId');
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  return dbPromise;
}

// fn(tx, done) を1トランザクションで実行し、done(value) に渡した値を返す
async function run(stores, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    let result;
    t.oncomplete = () => resolve(result);
    t.onerror = t.onabort = () => reject(t.error || new Error('保存に失敗しました'));
    fn(t, v => { result = v; });
  });
}

const byOrder = (a, b) => a.order - b.order;

// 作成順に並ぶID
export const uid = () =>
  Date.now().toString(36).padStart(9, '0') + Math.random().toString(36).slice(2, 8);

export const getFolders = () => run(['folders'], 'readonly', (t, done) => {
  t.objectStore('folders').getAll().onsuccess = e => done(e.target.result.sort(byOrder));
});

export const putFolder = f => run(['folders'], 'readwrite', t => { t.objectStore('folders').put(f); });

// 件数と表紙(最初に作った項目)
export const folderSummary = folderId => run(['items'], 'readonly', (t, done) => {
  const idx = t.objectStore('items').index('folderId');
  const out = { count: 0, cover: null };
  done(out);
  idx.count(folderId).onsuccess = e => { out.count = e.target.result; };
  idx.openCursor(folderId).onsuccess = e => { if (e.target.result) out.cover = e.target.result.value; };
});

export const getItems = folderId => run(['items'], 'readonly', (t, done) => {
  t.objectStore('items').index('folderId').getAll(folderId).onsuccess =
    e => done(e.target.result.sort(byOrder));
});

export const getAllItems = () => run(['items'], 'readonly', (t, done) => {
  t.objectStore('items').getAll().onsuccess = e => done(e.target.result);
});

export const putItem = item => run(['items'], 'readwrite', t => { t.objectStore('items').put(item); });

// images: [{role, data, type}]
export const addItem = (item, images) => run(['items', 'images'], 'readwrite', t => {
  t.objectStore('items').put(item);
  const s = t.objectStore('images');
  for (const im of images) s.put({ id: `${item.id}:${im.role}`, itemId: item.id, ...im });
});

function deleteItemIn(t, id) {
  t.objectStore('items').delete(id);
  const s = t.objectStore('images');
  s.index('itemId').getAllKeys(id).onsuccess = e => e.target.result.forEach(k => s.delete(k));
}

export const deleteItem = id => run(['items', 'images'], 'readwrite', t => deleteItemIn(t, id));

export const deleteFolder = id => run(['folders', 'items', 'images'], 'readwrite', t => {
  t.objectStore('folders').delete(id);
  t.objectStore('items').index('folderId').getAllKeys(id).onsuccess =
    e => e.target.result.forEach(k => deleteItemIn(t, k));
});

// → {before:{data,type}, after:{...}} または {image:{...}}
export const getImages = itemId => run(['images'], 'readonly', (t, done) => {
  t.objectStore('images').index('itemId').getAll(itemId).onsuccess = e => {
    const out = {};
    for (const r of e.target.result) out[r.role] = { data: r.data, type: r.type };
    done(out);
  };
});

// ビフォーとアフターを入れ替える
export const swapPair = id => run(['items', 'images'], 'readwrite', t => {
  const items = t.objectStore('items');
  const images = t.objectStore('images');
  items.get(id).onsuccess = e => {
    const item = e.target.result;
    if (!item) return;
    item.thumbs = { before: item.thumbs.after, after: item.thumbs.before };
    items.put(item);
  };
  images.get(`${id}:before`).onsuccess = e1 => {
    images.get(`${id}:after`).onsuccess = e2 => {
      const b = e1.target.result, a = e2.target.result;
      if (!a || !b) return;
      images.put({ ...b, id: `${id}:after`, role: 'after' });
      images.put({ ...a, id: `${id}:before`, role: 'before' });
    };
  };
});

export const clearAll = () => run(['folders', 'items', 'images'], 'readwrite', t => {
  for (const s of ['folders', 'items', 'images']) t.objectStore(s).clear();
});
