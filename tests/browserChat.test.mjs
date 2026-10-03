import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
const script = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
function browser(shared = new Map(), backend = { sessions: new Map() }, browserOptions = {}) {
  const elements = new Map(), created = [];
  const ids = new Set([...fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8').matchAll(/id="([^"]+)"/g)].map(match => match[1]));
  class Element {
    constructor() { this.children = []; this.value = ''; this.hidden = false; this.disabled = false; this.className = ''; this.textContent = ''; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    setAttribute(name, value) { this[name] = value; }
    focus() {} scrollIntoView(options) { this.scrolled = options; }
    get lastElementChild() { return this.children.at(-1); }
  }
  const storage = map => ({ getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, String(value)), removeItem: key => map.delete(key) });
  const document = { getElementById: id => { if (!ids.has(id)) throw new Error("Unknown element " + id); if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); },
    createElement: () => { const el = new Element(); created.push(el); return el; },
    querySelectorAll: () => created.filter(el => el.className.startsWith('chat-link')), addEventListener() {} };
  const calls = [];
  const fetch = async (path, options = {}) => {
    calls.push({ path, options }); const input = options.body ? JSON.parse(options.body) : null;
    let body;
    if (path === '/api/sessions') {
      if (backend.beforeCreate) await backend.beforeCreate();
      const session = { id: randomUUID(), circuitId: input.circuitId, boardDescription: input.boardDescription || null };
      body = { session, token: 'a'.repeat(64) }; backend.sessions.set(session.id, { session, inputs: [], turns: [], items: [] });
    } else {
      const data = backend.sessions.get(path.split('/')[3]);
      if (options.method === 'POST') {
        if (backend.beforeTurn) await backend.beforeTurn(input);
        if (backend.failTurns) { if (!data.inputs.some(entry => entry.turnId === input.turnId)) data.inputs.push({ ...input }); return { ok: false, json: async () => ({ error: 'AI service unavailable' }) }; }
        if (!data.turns.some(turn => turn.id === input.turnId)) {
          data.inputs.push({ ...input }); data.turns.push({ id: input.turnId, reasoningResult: { kind: 'context_required', message: 'What changed?', why: 'That helps narrow the problem.', recommendation: null } });
        }
        body = { status: 'completed' };
      } else body = data;
    }
    return { ok: true, json: async () => body };
  };
  const context = vm.createContext({ document, localStorage: storage(shared), sessionStorage: storage(new Map()),
    fetch, crypto: { randomUUID }, AbortController, setTimeout, clearTimeout,
    window: { scrollTo() {}, ...browserOptions }, console });
  vm.runInContext(script, context);
  const $ = id => document.getElementById(id);
  const text = el => el.textContent + el.children.map(text).join(' ');
  const settle = () => new Promise(resolve => setTimeout(resolve, 10));
  return { $, calls, shared, backend, text, settle };
}
describe('persistent browser chat', () => {
  it('makes a board description the first message, restores messages after reload, and switches chats', async () => {
    const b = browser(); b.$('start-custom').onclick();
    expect(b.$('welcome').hidden).toBe(true);
    expect(b.calls).toHaveLength(0);
    b.$('report').value = 'My battery-powered lamp stays dark.';
    await b.$('report-form').onsubmit({ preventDefault() {} }); await b.settle();
    expect(b.calls.filter(call => call.options.method === 'POST')).toHaveLength(2);
    expect(b.text(b.$('history'))).toContain('My battery-powered lamp stays dark.');
    expect(b.text(b.$('history'))).toContain('What changed?');
    b.$('report').value = 'It stopped after a drop.';
    await b.$('report-form').onsubmit({ preventDefault() {} });
    const firstId = JSON.parse(b.shared.get('freely-chats'))[0].session.id;
    b.$('drawer-home').onclick(); await b.$('start').onclick();
    b.$('menu').onclick();
    const firstChat = b.$('session-list').children.find(el => el.textContent.includes('battery-powered'));
    expect(firstChat.disabled).toBe(false); await firstChat.onclick();
    expect(b.shared.get('freely-active')).toBe(firstId);
    const reloaded = browser(b.shared, b.backend); await reloaded.settle();
    expect(reloaded.text(reloaded.$('history'))).toContain('It stopped after a drop.');
    expect(reloaded.$('report').disabled).toBe(false);
    expect(reloaded.calls.every(call => call.options.method !== 'POST')).toBe(true);
  });
});

it('opens a blank new chat with an editable composer and a separate Home action', async () => {
  const b = browser(); b.$('new-chat').onclick();
  expect(b.$('welcome').hidden).toBe(true); expect(b.$('workbench').hidden).toBe(false);
  expect(b.$('report').value).toBe(''); expect(b.$('report').disabled).toBe(false);
  expect(b.calls).toHaveLength(0);
  b.$('drawer-home').onclick(); expect(b.$('welcome').hidden).toBe(false);
  expect(b.$('workbench').hidden).toBe(true);
});
it('clears Send immediately, shows thinking in the reply area, and preserves a draft typed during processing', async () => {
  let entered, release; const started = new Promise(resolve => { entered = resolve; });
  const held = new Promise(resolve => { release = resolve; });
  const backend = { sessions: new Map(), beforeTurn: async () => { entered(); await held; } };
  const b = browser(new Map(), backend); await b.$('start').onclick();
  b.$('report').value = 'LED dark.'; const sending = b.$('report-form').onsubmit({ preventDefault() {} });
  expect(b.$('report').value).toBe(''); await started;
  expect(b.text(b.$('status'))).toContain('Freely is thinking');
  expect(b.$('report').disabled).toBe(false); b.$('report').value = 'My next message';
  release(); await sending;
  expect(b.$('report').value).toBe('My next message');
  expect(b.text(b.$('status'))).toBe('');
});
it('keeps the composer usable after failure, retries the same ID, and permits a deliberate edited message', async () => {
  const backend = { sessions: new Map(), failTurns: true }; const b = browser(new Map(), backend);
  b.$('new-chat').onclick(); b.$('report').value = 'My battery lamp stays dark.';
  await b.$('report-form').onsubmit({ preventDefault() {} });
  const original = JSON.parse(b.calls.find(call => call.path.endsWith('/turns')).options.body);
  expect(b.$('report').disabled).toBe(false); expect(b.$('submit').disabled).toBe(false);
  expect(b.$('retry').hidden).toBe(false);
  await b.$('retry').onclick();
  const requests = b.calls.filter(call => call.path.endsWith('/turns')).map(call => JSON.parse(call.options.body));
  expect(requests[1].turnId).toBe(original.turnId);
  b.$('edit-message').onclick(); expect(b.$('report').value).toBe(original.userMessage);
  b.$('report').value = 'It is a lamp powered by AA batteries.'; backend.failTurns = false;
  await b.$('report-form').onsubmit({ preventDefault() {} });
  const latest = JSON.parse(b.calls.filter(call => call.path.endsWith('/turns')).at(-1).options.body);
  expect(latest.turnId).not.toBe(original.turnId);
  expect(b.text(b.$('history'))).toContain(original.userMessage);
  expect(b.text(b.$('history'))).toContain('AA batteries');
});


it('scrolls the actual latest answer into view, rather than an empty status container', async () => {
  const b = browser(); b.$('new-chat').onclick(); b.$('report').value = 'My lamp stays dark';
  await b.$('report-form').onsubmit({ preventDefault() {} });
  expect(b.$('history').lastElementChild.scrolled).toMatchObject({ block: 'start' });
  expect(b.$('status').children).toHaveLength(0);
});
it('keeps dictation editable, reports permission errors, and ignores callbacks after Send', async () => {
  let current;
  class Speech { constructor() { current = this; } start() {} stop() {} }
  const b = browser(new Map(), { sessions: new Map() }, { SpeechRecognition: Speech, isSecureContext: true });
  b.$('new-chat').onclick(); b.$('voice').onclick();
  expect(current.continuous).toBe(false);
  expect(current.interimResults).toBe(false);
  current.onresult({ results: [Object.assign([{ transcript: 'My lamp stays dark' }], { isFinal: true })] });
  expect(b.$('report').value).toBe('My lamp stays dark');
  expect(b.calls).toHaveLength(0);
  const lateResult = current.onresult;
  await b.$('report-form').onsubmit({ preventDefault() {} });
  expect(b.calls).toHaveLength(0);
  expect(b.$('report').value).toBe('My lamp stays dark');
  b.$('voice-confirm').checked = true;
  await b.$('report-form').onsubmit({ preventDefault() {} });
  lateResult({ results: [[{ transcript: 'late words' }]] });
  expect(b.$('report').value).toBe('');
  b.$('voice').onclick(); current.onerror({ error: 'not-allowed' });
  expect(b.$('dictation-status').textContent).toContain('permission was denied');
});

const finalSpeech = text => Object.assign([{ transcript: text, confidence: .9 }], { isFinal: true });
it('replaces repeated final event snapshots, ignores interim revisions and continues after Android ends a phrase', async () => {
  const instances = [];
  class Speech { constructor() { instances.push(this); } start() {} stop() {} }
  const b = browser(new Map(), { sessions: new Map() }, { SpeechRecognition: Speech });
  b.$('new-chat').onclick(); b.$('report').value = 'My lamp.'; b.$('voice').onclick();
  const first = instances[0];
  first.onresult({ results: [Object.assign([{ transcript: 'five five five' }], { isFinal: false })] });
  expect(b.$('report').value).toBe('My lamp.');
  const result = { results: [finalSpeech('It reads five volts.')] };
  first.onresult(result); first.onresult(result);
  expect(b.$('report').value).toBe('My lamp. It reads five volts.');
  const late = first.onresult; first.onend();
  await new Promise(resolve => setTimeout(resolve, 180));
  expect(instances).toHaveLength(2);
  late({ results: [finalSpeech('old callback')] });
  instances[1].onresult({ results: [finalSpeech('Five volts on both points.')] });
  expect(b.$('report').value).toBe('My lamp. It reads five volts. Five volts on both points.');
  b.$('voice').onclick(); expect(b.calls).toHaveLength(0);
});
it('cancels pending microphone restart when navigating and preserves manual edits', async () => {
  const instances = [];
  class Speech { constructor() { instances.push(this); } start() {} stop() {} }
  const b = browser(new Map(), { sessions: new Map() }, { SpeechRecognition: Speech });
  b.$('new-chat').onclick(); b.$('voice').onclick();
  instances[0].onresult({ results: [finalSpeech('five volts')] }); instances[0].onend();
  b.$('drawer-home').onclick();
  await new Promise(resolve => setTimeout(resolve, 180));
  expect(instances).toHaveLength(1);
  b.$('new-chat').onclick(); b.$('voice').onclick();
  const late = instances[1].onresult;
  instances[1].onresult({ results: [finalSpeech('five volts')] });
  b.$('report').value = 'Actually four volts'; b.$('report').oninput();
  late({ results: [finalSpeech('five volts again')] });
  expect(b.$('report').value).toBe('Actually four volts');
  expect(b.$('voice-confirm').checked).toBe(false);
});
it('does not restart after silence or a speech network error', async () => {
  const instances = [];
  class Speech { constructor() { instances.push(this); } start() {} stop() {} }
  const b = browser(new Map(), { sessions: new Map() }, { SpeechRecognition: Speech });
  b.$('new-chat').onclick(); b.$('voice').onclick(); instances[0].onend();
  await new Promise(resolve => setTimeout(resolve, 180)); expect(instances).toHaveLength(1);
  b.$('voice').onclick(); const end = instances[1].onend;
  instances[1].onerror({ error: 'network' }); end();
  await new Promise(resolve => setTimeout(resolve, 180)); expect(instances).toHaveLength(2);
  expect(b.$('dictation-status').textContent).toContain('connection lost');
});

function navigationBrowser(backend = { sessions: new Map() }) {
  const entries = [], location = { hash: '' };
  let index = -1, onPop;
  const history = {
    get state() { return entries[index]?.state; },
    replaceState(state, unused, url) { if (index < 0) index = 0; entries[index] = { state, url }; location.hash = url; },
    pushState(state, unused, url) { entries.splice(index + 1); entries.push({ state, url }); index++; location.hash = url; },
    back() { if (index > 0) { index--; location.hash = entries[index].url; onPop({ state: entries[index].state }); } },
    forward() { if (index + 1 < entries.length) { index++; location.hash = entries[index].url; onPop({ state: entries[index].state }); } },
  };
  return { ...browser(new Map(), backend, { history, location, addEventListener(name, handler) { if (name === 'popstate') onPop = handler; } }), history, location, entries };
}
it('uses phone Back and Forward for Home and a saved chat without creating duplicate sessions', async () => {
  const b = navigationBrowser();
  expect(b.location.hash).toBe('#home');
  b.$('new-chat').onclick(); expect(b.location.hash).toBe('#new');
  b.$('report').value = 'The LED stays dark'; await b.$('report-form').onsubmit({ preventDefault() {} });
  expect(b.location.hash).toMatch(/^#chat\//); expect(b.entries).toHaveLength(2);
  const chatHash = b.location.hash;
  b.history.back(); expect(b.$('welcome').hidden).toBe(false); expect(b.location.hash).toBe('#home');
  b.history.forward(); await b.settle(); expect(b.location.hash).toBe(chatHash);
  expect(b.text(b.$('history'))).toContain('The LED stays dark');
  expect(b.calls.filter(call => call.path === '/api/sessions')).toHaveLength(1);
});
it('defers Back until an in-flight answer is saved without abandoning the session', async () => {
  let release, entered;
  const started = new Promise(resolve => { entered = resolve; });
  const held = new Promise(resolve => { release = resolve; });
  const b = navigationBrowser({ sessions: new Map(), beforeTurn: async () => { entered(); await held; } });
  b.$('new-chat').onclick(); b.$('report').value = 'My lamp stays dark';
  const sending = b.$('report-form').onsubmit({ preventDefault() {} }); await started;
  b.history.back(); release(); await sending; await b.settle();
  expect(b.$('welcome').hidden).toBe(false); expect(b.location.hash).toBe('#home');
  b.history.forward(); await b.settle(); expect(b.text(b.$('history'))).toContain('What changed?');
});

it('preserves the Back destination when session creation is still pending', async () => {
  let release, entered;
  const started = new Promise(resolve => { entered = resolve; });
  const held = new Promise(resolve => { release = resolve; });
  const b = navigationBrowser({ sessions: new Map(), beforeCreate: async () => { entered(); await held; } });
  b.$('new-chat').onclick(); b.$('report').value = 'The lamp is dark';
  const sending = b.$('report-form').onsubmit({ preventDefault() {} }); await started;
  b.history.back(); release(); await sending; await b.settle();
  expect(b.location.hash).toBe('#home'); expect(b.$('welcome').hidden).toBe(false);
  expect(b.backend.sessions.size).toBe(1);
});
