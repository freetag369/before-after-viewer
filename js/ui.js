// 小さなDOMヘルパーと、ダイアログ類
export function el(tag, props = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, '');
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null && c !== false) e.append(c);
  return e;
}

const root = () => document.getElementById('modal-root');

// build(close) が返す要素を表示し、close(value) の値で解決する
export function modal(build, { dismissable = true } = {}) {
  return new Promise(resolve => {
    const ov = el('div', { class: 'overlay' });
    const close = v => { ov.remove(); resolve(v); };
    ov.append(build(close));
    if (dismissable) ov.addEventListener('click', e => { if (e.target === ov) close(null); });
    root().append(ov);
  });
}

// options: [{label, value, danger, action}]
// action はタップ直後に同期実行される(iOSでファイル選択を開くために必要)
export function sheet(title, options) {
  return modal(close => el('div', { class: 'dialog sheet' },
    title && el('h3', {}, title),
    options.map(o => el('button', {
      class: 'row' + (o.danger ? ' danger' : ''),
      onclick: () => close(o.action ? o.action() : o.value),
    }, o.label)),
    el('button', { class: 'row cancel', onclick: () => close(null) }, 'キャンセル'),
  ));
}

export function confirmDialog(message, { ok = 'OK', danger = false } = {}) {
  return modal(close => el('div', { class: 'dialog' },
    el('p', { class: 'msg' }, message),
    el('div', { class: 'actions' },
      el('button', { class: 'btn', onclick: () => close(null) }, 'キャンセル'),
      el('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), onclick: () => close(true) }, ok),
    ),
  ));
}

// キャンセル時は null、OK時は入力文字列(空文字のこともある)
export function promptText(title, value = '', placeholder = '') {
  return modal(close => {
    const input = el('input', { class: 'input', type: 'text', placeholder, maxlength: '60' });
    input.value = value;
    input.addEventListener('keydown', e => { if (e.key === 'Enter') close(input.value.trim()); });
    setTimeout(() => input.focus(), 50);
    return el('div', { class: 'dialog' },
      el('h3', {}, title),
      input,
      el('div', { class: 'actions' },
        el('button', { class: 'btn', onclick: () => close(null) }, 'キャンセル'),
        el('button', { class: 'btn primary', onclick: () => close(input.value.trim()) }, 'OK'),
      ),
    );
  });
}

export function toast(message) {
  const t = el('div', { class: 'toast' }, message);
  root().append(t);
  setTimeout(() => t.remove(), 3000);
}

export function busy(message) {
  const text = el('div', {}, message);
  const ov = el('div', { class: 'overlay' },
    el('div', { class: 'dialog busy' }, el('div', { class: 'spinner' }), text));
  root().append(ov);
  return { set: m => { text.textContent = m; }, close: () => ov.remove() };
}

// ファイル選択。必ずタップのハンドラ内から同期的に呼ぶこと
export function pickFiles({ multiple = false, accept = 'image/*' } = {}) {
  return new Promise(resolve => {
    const input = el('input', { type: 'file', accept, multiple, hidden: true });
    document.body.append(input);
    const done = files => { input.remove(); resolve(files); };
    input.addEventListener('change', () => done([...input.files]));
    input.addEventListener('cancel', () => done([]));
    input.click();
  });
}
