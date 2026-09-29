export const MAX_MEMO_LENGTH = 100000;
export const MAX_MEMOS = 5;
export const MAX_MEMO_TITLE_LENGTH = 60;
export async function memoToken(passcode) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('gonta.memo.v1:' + passcode));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
}

// Keep the last acknowledged content as well as the draft. A failed request may
// have reached D1: comparing content on reconnect also handles a lost response.
export class MemoState {
  constructor(draft) {
    this.content = typeof draft?.content === 'string' ? draft.content : '';
    this.base = typeof draft?.base === 'string' ? draft.base : '';
    this.title = typeof draft?.title === 'string' ? draft.title : '';
    this.baseTitle = typeof draft?.baseTitle === 'string' ? draft.baseTitle : '';
    this.version = Number.isSafeInteger(draft?.version) ? draft.version : 0;
    this.loaded = false;
    this.conflict = null;
  }
  get dirty() { return this.content !== this.base || this.title !== this.baseTitle; }
  snapshot() { return {content:this.content, base:this.base, title:this.title, baseTitle:this.baseTitle, version:this.version}; }
  accept(remote) {
    const title = typeof remote.title === 'string' ? remote.title : '';
    const conflicts = (local, base, saved) => local !== base && local !== saved && base !== saved;
    if (conflicts(this.content, this.base, remote.content) || conflicts(this.title, this.baseTitle, title)) {
      this.conflict = {...remote, title};
    } else {
      // A rename on one device can merge with a body edit on another.
      if (this.content === this.base) this.content = remote.content;
      if (this.title === this.baseTitle) this.title = title;
      this.base = remote.content;
      this.baseTitle = title;
      this.version = remote.version;
      this.conflict = null;
    }
    this.loaded = true;
  }
  acknowledge(remote, sent, sentTitle = this.baseTitle) {
    // Never replace characters entered while this save was in flight.
    this.base = sent;
    this.baseTitle = sentTitle;
    this.version = remote.version;
    this.conflict = null;
  }
  resolve(useDraft) {
    if (!this.conflict) return;
    if (!useDraft) {
      this.content = this.conflict.content;
      this.title = this.conflict.title;
    }
    this.base = this.conflict.content;
    this.baseTitle = this.conflict.title;
    this.version = this.conflict.version;
    this.conflict = null;
  }
}
