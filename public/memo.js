import {MAX_MEMO_LENGTH, MemoState, memoToken} from './memo-state.js';

export function createMemo() {
  const $ = id => document.getElementById(id);
  const panel = $('memo-panel'), editor = $('memo-editor'), toggle = $('memo-toggle');
  const narrow = matchMedia('(max-width: 900px)');
  let state = new MemoState(), token = '', storageKey = '', passcode = null;
  let generation = 0, timer, busy = false, composing = false, localOK = true, cached = false, status = 'locked';
  let opened = false;
  try { opened = localStorage.getItem('gonta.memo.open') === 'true'; } catch {}

  function layout(focus = false) {
    document.body.classList.toggle('memo-open', opened);
    toggle.setAttribute('aria-expanded', String(opened));
    toggle.setAttribute('aria-label', opened ? 'メモ帳を閉じる' : 'メモ帳を開く');
    toggle.title = toggle.getAttribute('aria-label');
    $('memo-chevron').textContent = opened ? '»' : '«';
    panel.inert = !opened;
    panel.setAttribute('aria-hidden', String(!opened));
    $('conversation-pane').inert = opened && narrow.matches;
    if (focus && opened && !editor.disabled) editor.focus({preventScroll:true});
  }
  toggle.onclick = () => {
    opened = !opened;
    try { localStorage.setItem('gonta.memo.open', String(opened)); } catch {}
    layout(true);
    if (opened) void sync();
  };
  panel.addEventListener('keydown', event => {
    if (event.key === 'Escape') { opened = false; layout(); toggle.focus(); try { localStorage.setItem('gonta.memo.open', 'false'); } catch {} }
  });
  narrow.addEventListener('change', () => layout());
  layout();

  function persist() {
    if (!storageKey) return;
    try { localStorage.setItem(storageKey, JSON.stringify(state.snapshot())); localOK = true; cached = true; }
    catch { localOK = false; }
  }
  function render() {
    // Avoid resetting the caret, selection, undo stack, or an IME composition.
    if (!composing && editor.value !== state.content) editor.value = state.content;
    editor.disabled = !token || status === 'auth' || (!state.loaded && !cached && !state.dirty);
    const labels = {
      locked:'接続設定のアクセスキーで利用できます', loading:'メモを読み込み中…',
      saving:'保存中…', saved:'保存済み', draft:'入力中…',
      offline:state.dirty ? (localOK ? '端末に下書き保存 · 接続後に同期' : '未保存 · この画面を閉じないでください') : '接続を確認しています…',
      auth:'アクセスキーを確認してください', conflict:'別の画面でメモが更新されました',
      size:'10万文字以内にしてください'
    };
    $('memo-status').textContent = labels[state.conflict ? 'conflict' : status] || '';
    $('memo-status').dataset.state = state.conflict ? 'conflict' : status;
    $('memo-conflict').hidden = !state.conflict;
    if (state.conflict) $('memo-remote').textContent = state.conflict.content || '（空のメモ）';
    $('memo-count').textContent = `${state.content.length.toLocaleString('ja-JP')} 文字`;
  }
  function schedule(delay = 750) { clearTimeout(timer); timer = setTimeout(() => void sync(), delay); }
  async function request(method, body, auth) {
    const response = await fetch('/api/memo', {
      method, cache:'no-store', headers:{Authorization:`Bearer ${auth}`, ...(body ? {'Content-Type':'application/json'} : {})},
      ...(body ? {body:JSON.stringify(body)} : {}), signal:AbortSignal.timeout(12000)
    });
    if (response.status === 401) throw Object.assign(new Error('Unauthorized'), {auth:true});
    if (!response.ok && response.status !== 409) throw new Error('Memo unavailable');
    const data = await response.json();
    if (typeof data.content !== 'string' || !Number.isSafeInteger(data.version)) throw new Error('Invalid memo');
    return {conflict:response.status === 409, data};
  }
  async function sync() {
    clearTimeout(timer);
    if (!token || busy || composing || state.conflict || status === 'auth') return;
    if (state.content.length > MAX_MEMO_LENGTH) { status = 'size'; render(); return; }
    const current = generation, auth = token;
    busy = true;
    try {
      if (!state.loaded || !state.dirty) {
        status = state.loaded ? status : 'loading'; render();
        const result = await request('GET', null, auth);
        if (current !== generation) return;
        state.accept(result.data); persist(); render();
      }
      if (state.dirty && !state.conflict && !composing) {
        const sent = state.content;
        status = 'saving'; render();
        const result = await request('PUT', {content:sent, version:state.version}, auth);
        if (current !== generation) return;
        if (result.conflict) state.accept(result.data);
        else state.acknowledge(result.data, sent);
        persist();
      }
      status = state.dirty ? 'draft' : 'saved';
    } catch (error) {
      if (current !== generation) return;
      status = error.auth ? 'auth' : 'offline';
      // Re-read the server before retrying an uncertain write.
      state.loaded = false;
    } finally {
      if (current === generation) {
        busy = false; render();
        if (status === 'offline') schedule(10000);
        else if (state.dirty && !state.conflict && status !== 'auth') schedule();
      }
    }
  }
  function input() {
    state.content = editor.value; persist(); status = 'draft'; render();
    if (!composing) schedule();
  }
  editor.addEventListener('compositionstart', () => { composing = true; clearTimeout(timer); });
  editor.addEventListener('compositionend', () => { composing = false; input(); });
  editor.addEventListener('input', input);
  editor.addEventListener('blur', () => { if (!composing) void sync(); });
  for (const [id, useDraft] of [['memo-use-draft',true], ['memo-use-remote',false]]) {
    $(id).onclick = () => {
      state.resolve(useDraft); persist(); status = state.dirty ? 'draft' : 'saved'; render();
      if (state.dirty) void sync();
    };
  }
  window.addEventListener('online', () => void sync());
  window.addEventListener('focus', () => { if (opened) void sync(); });
  document.addEventListener('visibilitychange', () => { if (state.dirty || (opened && !document.hidden)) void sync(); });
  window.addEventListener('beforeunload', event => {
    if (state.dirty && !localOK) { event.preventDefault(); event.returnValue = ''; }
  });
  setInterval(() => { if (opened && !document.hidden && !composing) void sync(); }, 30000);
  render();

  return {async setCredential(key) {
    if ((key || null) === passcode) return;
    persist(); clearTimeout(timer);
    const current = ++generation;
    passcode = key || null; token = ''; storageKey = ''; busy = false; cached = false; composing = false;
    state = new MemoState(); status = key ? 'loading' : 'locked'; render();
    if (!key) return;
    const derived = await memoToken(key);
    if (current !== generation) return;
    // A second hash identifies the local cache without storing the bearer token.
    const cacheId = await memoToken(derived);
    if (current !== generation) return;
    token = derived;
    storageKey = 'gonta.memo.draft.' + cacheId;
    let draft;
    try { draft = JSON.parse(localStorage.getItem(storageKey) || 'null'); } catch {}
    cached = typeof draft?.content === 'string';
    state = new MemoState(draft); render(); void sync();
  }};
}
