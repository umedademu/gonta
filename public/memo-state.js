export const MAX_MEMO_LENGTH = 100000;
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
    this.version = Number.isSafeInteger(draft?.version) ? draft.version : 0;
    this.loaded = false;
    this.conflict = null;
  }
  get dirty() { return this.content !== this.base; }
  snapshot() { return {content:this.content, base:this.base, version:this.version}; }
  accept(remote) {
    if (this.content === remote.content || !this.dirty) {
      this.content = remote.content;
      this.base = remote.content;
      this.version = remote.version;
      this.conflict = null;
    } else if (this.base === remote.content) {
      this.version = remote.version;
      this.conflict = null;
    } else {
      this.conflict = remote;
    }
    this.loaded = true;
  }
  acknowledge(remote, sent) {
    // Never replace characters entered while this save was in flight.
    this.base = sent;
    this.version = remote.version;
    this.conflict = null;
  }
  resolve(useDraft) {
    if (!this.conflict) return;
    if (!useDraft) this.content = this.conflict.content;
    this.base = this.conflict.content;
    this.version = this.conflict.version;
    this.conflict = null;
  }
}
