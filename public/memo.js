import {MAX_MEMO_LENGTH, MAX_MEMOS, MAX_MEMO_TITLE_LENGTH, MemoState, memoToken} from './memo-state.js';

export function createMemo() {
  const $ = id => document.getElementById(id);
  const panel = $('memo-panel'), editor = $('memo-editor'), toggle = $('memo-toggle');
  const narrow = matchMedia('(max-width: 900px)');
  const freshNotes = () => Array.from({length:MAX_MEMOS}, (_, index) => ({
    id:index + 1, state:new MemoState(), storageKey:'', timer:null,
    busy:false, composing:false, localOK:true, cached:false, status:'locked',
    selection:[0,0,'none'], scrollTop:0
  }));
  let notes = freshNotes(), active = 0, token = '', passcode = null, generation = 0;
  let renaming = null;
  const nameOf = note => note.state.title || `メモ${note.id}`;
  let opened = false;
  try {
    opened = localStorage.getItem('gonta.memo.open') === 'true';
    const saved = Number(localStorage.getItem('gonta.memo.active'));
    if (Number.isInteger(saved) && saved >= 0 && saved < MAX_MEMOS) active = saved;
  } catch {}

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
    finishRename();
    opened = !opened;
    try { localStorage.setItem('gonta.memo.open', String(opened)); } catch {}
    layout(true);
    if (opened) syncPending();
  };
  panel.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !event.isComposing && !notes[active].composing && !renaming) {
      opened = false; layout(); toggle.focus();
      try { localStorage.setItem('gonta.memo.open', 'false'); } catch {}
    }
  });
  narrow.addEventListener('change', () => layout());
  layout();

  function persist(note) {
    if (!note.storageKey) return;
    try { localStorage.setItem(note.storageKey, JSON.stringify(note.state.snapshot())); note.localOK = true; note.cached = true; }
    catch { note.localOK = false; }
  }
  function render() {
    const {state, status, composing, cached, localOK} = notes[active];
    // Avoid resetting the caret, selection, undo stack, or an IME composition.
    if (!composing && editor.value !== state.content) editor.value = state.content;
    editor.disabled = !token || status === 'auth' || (!state.loaded && !cached && !state.dirty);
    $('memo-rename').disabled = editor.disabled || composing;
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
    $('memo-remote').textContent = state.conflict ? (state.conflict.content || '（空のメモ）') : '';
    $('memo-remote-title').textContent = state.conflict ? `名前：${state.conflict.title || `メモ${active + 1}`}` : '';
    $('memo-count').textContent = `${state.content.length.toLocaleString('ja-JP')} 文字`;
    $('memo-page').setAttribute('aria-labelledby', `memo-tab-${active + 1}`);
    $('memo-editor-label').textContent = `${nameOf(notes[active])}の内容`;
    notes.forEach((note, index) => {
      const tab = $(`memo-tab-${note.id}`), selected = index === active, name = nameOf(note);
      const nameEditor = $(`memo-name-${note.id}`), editing = renaming?.note === note;
      if (tab.textContent !== name) tab.textContent = name;
      tab.hidden = editing;
      nameEditor.hidden = !editing;
      if (!editing) nameEditor.value = '';
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      tab.dataset.pending = String(note.state.dirty || !!note.state.conflict);
      tab.title = `${name} · ダブルクリックまたはF2で名前変更${note.state.conflict ? ' · 保存する内容を選んでください' : note.state.dirty ? ' · 未同期の変更あり' : ''}`;
    });
  }
  function finishRename(commit = true, focus = false) {
    if (!renaming) return;
    const {note, initialValue} = renaming, nameEditor = $(`memo-name-${note.id}`);
    const title = nameEditor.value.replace(/[\r\n\t]/g, ' ').trim().slice(0, MAX_MEMO_TITLE_LENGTH);
    renaming = null;
    if (commit && title !== initialValue && title !== note.state.title) {
      note.state.title = title; persist(note); note.status = 'draft'; schedule(note);
    }
    render();
    if (focus) $(`memo-tab-${note.id}`).focus();
  }
  function startRename(index = active) {
    if (notes[active].composing) return;
    if (renaming?.note === notes[index]) return;
    finishRename(); selectNote(index);
    if (editor.disabled) return;
    const note = notes[active], nameEditor = $(`memo-name-${note.id}`);
    renaming = {note, initialValue:nameOf(note), composing:false};
    nameEditor.value = renaming.initialValue;
    render(); nameEditor.focus({preventScroll:true}); nameEditor.select();
  }
  $('memo-rename').onclick = () => startRename();
  function selectNote(index) {
    const previous = notes[active];
    if (index === active || previous.composing) return;
    finishRename();
    previous.selection = [editor.selectionStart, editor.selectionEnd, editor.selectionDirection];
    previous.scrollTop = editor.scrollTop;
    persist(previous);
    void sync(previous);
    active = index;
    try { localStorage.setItem('gonta.memo.active', String(active)); } catch {}
    render();
    editor.setSelectionRange(...notes[active].selection);
    editor.scrollTop = notes[active].scrollTop;
    void sync(notes[active]);
  }
  for (let index = 0; index < MAX_MEMOS; index++) {
    const tab = $(`memo-tab-${index + 1}`);
    tab.onclick = () => selectNote(index);
    tab.addEventListener('dblclick', () => startRename(index));
    tab.addEventListener('keydown', event => {
      if (event.isComposing || notes[active].composing) return;
      if (event.key === 'F2') { event.preventDefault(); startRename(index); return; }
      const next = {ArrowRight:(index + 1) % MAX_MEMOS, ArrowLeft:(index + MAX_MEMOS - 1) % MAX_MEMOS, Home:0, End:MAX_MEMOS - 1}[event.key];
      if (next === undefined) return;
      event.preventDefault(); selectNote(next); $(`memo-tab-${next + 1}`).focus();
    });
    const nameEditor = $(`memo-name-${index + 1}`);
    nameEditor.maxLength = MAX_MEMO_TITLE_LENGTH;
    nameEditor.addEventListener('keydown', event => {
      if (event.isComposing || event.keyCode === 229 || renaming?.composing) return;
      if (event.key === 'Enter' || event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation(); finishRename(event.key === 'Enter', true);
      }
    });
    nameEditor.addEventListener('compositionstart', () => { if (renaming) renaming.composing = true; });
    nameEditor.addEventListener('compositionend', () => { if (renaming) renaming.composing = false; });
    nameEditor.addEventListener('blur', () => finishRename());
  }
  function schedule(note, delay = 750) {
    clearTimeout(note.timer); note.timer = setTimeout(() => void sync(note), delay);
  }
  async function request(id, method, body, auth) {
    const response = await fetch(`/api/memo?id=${id}`, {
      method, cache:'no-store', headers:{Authorization:`Bearer ${auth}`, ...(body ? {'Content-Type':'application/json'} : {})},
      ...(body ? {body:JSON.stringify(body)} : {}), signal:AbortSignal.timeout(12000)
    });
    if (response.status === 401) throw Object.assign(new Error('Unauthorized'), {auth:true});
    if (!response.ok && response.status !== 409) throw new Error('Memo unavailable');
    const data = await response.json();
    // An old proxy/Worker may drop the id; never treat another tab as this memo.
    if (!data || data.id !== id || typeof data.content !== 'string' || typeof data.title !== 'string' || !Number.isSafeInteger(data.version)) throw new Error('Invalid memo');
    return {conflict:response.status === 409, data};
  }
  async function sync(note) {
    clearTimeout(note.timer);
    const {state} = note;
    if (!token || note.busy || note.composing || state.conflict || note.status === 'auth') return;
    if (state.content.length > MAX_MEMO_LENGTH) { note.status = 'size'; render(); return; }
    const current = generation, auth = token;
    note.busy = true;
    try {
      if (!state.loaded || !state.dirty) {
        note.status = state.loaded ? note.status : 'loading'; render();
        const result = await request(note.id, 'GET', null, auth);
        if (current !== generation) return;
        state.accept(result.data); persist(note); render();
      }
      if (state.dirty && !state.conflict && !note.composing) {
        const sent = {content:state.content, title:state.title};
        note.status = 'saving'; render();
        const result = await request(note.id, 'PUT', {...sent, version:state.version}, auth);
        if (current !== generation) return;
        if (result.conflict) state.accept(result.data);
        else state.acknowledge(result.data, sent.content, sent.title);
        persist(note);
      }
      note.status = state.dirty ? 'draft' : 'saved';
    } catch (error) {
      if (current !== generation) return;
      note.status = error.auth ? 'auth' : 'offline';
      // Re-read the server before retrying an uncertain write.
      state.loaded = false;
    } finally {
      if (current === generation) {
        note.busy = false; render();
        if (note.status === 'offline') schedule(note, 10000);
        else if (state.dirty && !state.conflict && note.status !== 'auth') schedule(note);
      }
    }
  }
  function syncPending() {
    notes.forEach((note, index) => { if (index === active || note.state.dirty) void sync(note); });
  }
  function input() {
    const note = notes[active];
    note.state.content = editor.value; persist(note); note.status = 'draft'; render();
    if (!note.composing) schedule(note);
  }
  editor.addEventListener('compositionstart', () => { const note = notes[active]; note.composing = true; clearTimeout(note.timer); });
  editor.addEventListener('compositionend', () => { notes[active].composing = false; input(); });
  editor.addEventListener('input', input);
  editor.addEventListener('blur', () => { if (!notes[active].composing) void sync(notes[active]); });
  for (const [id, useDraft] of [['memo-use-draft',true], ['memo-use-remote',false]]) {
    $(id).onclick = () => {
      const note = notes[active];
      note.state.resolve(useDraft); persist(note); note.status = note.state.dirty ? 'draft' : 'saved'; render();
      if (note.state.dirty) void sync(note);
    };
  }
  window.addEventListener('online', syncPending);
  window.addEventListener('focus', () => { if (opened) syncPending(); });
  document.addEventListener('visibilitychange', () => {
    notes.forEach((note, index) => { if (note.state.dirty || (index === active && opened && !document.hidden)) void sync(note); });
  });
  window.addEventListener('beforeunload', event => {
    finishRename();
    if (notes.some(note => note.state.dirty && !note.localOK)) { event.preventDefault(); event.returnValue = ''; }
  });
  setInterval(() => { if (opened && !document.hidden) syncPending(); }, 30000);
  render();

  return {async setCredential(key) {
    if ((key || null) === passcode) return;
    finishRename();
    notes.forEach(note => { persist(note); clearTimeout(note.timer); });
    const current = ++generation;
    passcode = key || null; token = '';
    notes = freshNotes();
    notes.forEach(note => { note.status = key ? 'loading' : 'locked'; });
    render();
    if (!key) return;
    const derived = await memoToken(key);
    if (current !== generation) return;
    // A second hash identifies the local cache without storing the bearer token.
    const cacheId = await memoToken(derived);
    if (current !== generation) return;
    token = derived;
    notes.forEach(note => {
      // Keep the original cache key for tab 1, including unsynced offline drafts.
      note.storageKey = 'gonta.memo.draft.' + cacheId + (note.id === 1 ? '' : `.${note.id}`);
      let draft;
      try { draft = JSON.parse(localStorage.getItem(note.storageKey) || 'null'); } catch {}
      note.cached = typeof draft?.content === 'string';
      note.state = new MemoState(draft);
    });
    render();
    notes.forEach(note => void sync(note));
  }};
}
