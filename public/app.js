/* All message text is rendered with textContent. No HTML from the user or model. */
const $ = id => document.getElementById(id);
function read(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch { return fallback; } }
let sessions = read('freely-chats', []);
let activeId = localStorage.getItem('freely-active');
let state = sessions.find(entry => entry.session.id === activeId) || null;
let pending = null, reply = null, busy = false, selectedImage = null, recognition = null, imageCount = 0, lastData = { turns: [], inputs: [], items: [] };
// Carry over the previous single-tab session without losing access to it.
try { const old = JSON.parse(sessionStorage.getItem('freely-session'));
  if (old && !sessions.some(entry => entry.session.id === old.session.id)) {
    sessions.push({ ...old, title: old.session.circuitId === 'user-board' ? 'Your board' : 'LED timer demo' });
    localStorage.setItem('freely-chats', JSON.stringify(sessions)); state = old;
    localStorage.setItem('freely-active', old.session.id);
    const oldPending = sessionStorage.getItem('freely-pending');
    if (oldPending) localStorage.setItem('freely-pending-' + old.session.id, oldPending);
    sessionStorage.removeItem('freely-session'); sessionStorage.removeItem('freely-pending');
  }
} catch {}
function node(tag, value, cls) { const el = document.createElement(tag); el.textContent = value; if (cls) el.className = cls; return el; }
function scrollConversation() {
  const target = $('status').lastElementChild || $('history').lastElementChild || $('guidance').lastElementChild;
  target?.scrollIntoView({ block: 'start', behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}
function status(message) { $('status').replaceChildren(); if (message) { $('status').append(bubble('assistant', message)); scrollConversation(); } }
function persistSessions() { localStorage.setItem('freely-chats', JSON.stringify(sessions)); }
function pendingKey() { return 'freely-pending-' + state.session.id; }
let deferredNavigation = null;
function currentRoute() {
  return state ? { view: 'chat', sessionId: state.session.id } : { view: $('welcome').hidden ? 'new' : 'home' };
}
function saveNavigation(replace = false) {
  if (!window.history || deferredNavigation) return;
  const route = currentRoute();
  const url = route.view === 'chat' ? '#chat/' + route.sessionId : '#' + route.view;
  const method = replace || window.location?.hash === url ? 'replaceState' : 'pushState';
  window.history[method]({ freely: true, ...route }, '', url);
}
function restoreNavigation(route) {
  if (busy) { deferredNavigation = route; return; }
  if (route.view === 'chat') {
    const entry = sessions.find(chat => chat.session.id === route.sessionId);
    if (entry) { selectSession(entry, { fromHistory: true }); return; }
  }
  if (route.view === 'new') newChat({ fromHistory: true });
  else home({ fromHistory: true });
}
window.addEventListener?.('popstate', event => {
  restoreNavigation(event.state?.freely ? event.state : { view: 'home' });
});
function setBusy(value) { busy = value;
  if (!value && deferredNavigation) setTimeout(() => {
    if (busy || !deferredNavigation) return;
    const route = deferredNavigation; deferredNavigation = null; restoreNavigation(route);
  }, 0);
  for (const id of ['start', 'start-custom', 'new-chat', 'drawer-new', 'drawer-home', 'voice', 'attach']) $(id).disabled = value;
  $('submit').disabled = value; $('report').disabled = false; $('retry').disabled = value; $('edit-message').disabled = value;
  $('remove-image').disabled = value;
  for (const link of document.querySelectorAll('.chat-link')) link.disabled = value;
}
async function api(path, options = {}) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 80000);
  try { const response = await fetch(path, { ...options, signal: controller.signal,
    headers: { 'Content-Type': 'application/json', ...(state ? { Authorization: `Bearer ${state.token}` } : {}) } });
    const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Freely is temporarily unavailable'); return body;
  } finally { clearTimeout(timer); }
}
function drawer(open) { $('drawer').hidden = !open; $('drawer-shade').hidden = !open; $('menu').setAttribute('aria-expanded', String(open)); if (open) $('close-menu').focus(); else $('menu').focus(); }
function renderSessions() {
  $('session-list').replaceChildren();
  for (const entry of [...sessions].reverse()) {
    const button = node('button', entry.title || 'Your board', 'chat-link' + (state?.session.id === entry.session.id ? ' active' : ''));
    button.disabled = busy; button.onclick = () => selectSession(entry); $('session-list').append(button);
  }
  if (!sessions.length) $('session-list').append(node('p', 'Your conversations will appear here.', 'small'));
}
function bubble(role, message, images = []) {
  const el = node('article', '', 'message ' + role); el.append(node('div', role === 'user' ? 'YOU' : 'FREELY', 'speaker'));
  if (message) el.append(node('p', message));
  for (const image of images) { const img = document.createElement('img'); img.src = `data:${image.mimeType};base64,${image.data}`; img.alt = 'Image you shared'; el.append(img); }
  return el;
}
function answer(result) {
  const el = bubble('assistant', result.message);
  if (result.recommendation) { const r = result.recommendation, step = node('div', '', 'test-step');
    step.append(node('strong', 'Next step'), node('p', r.procedure), node('span', `${r.tool} · ${r.powerState.replaceAll('_', ' ')}`, 'small')); el.append(step); }
  if (result.kind !== 'context_required') el.append(node('p', result.why, 'small')); return el;
}
function render(data) {
  lastData = data;
  $('welcome').hidden = true; $('workbench').hidden = false;
  const custom = state?.session.circuitId !== 'circuit-one';
  $('session-label').textContent = !state ? 'NEW CHAT' : custom ? 'YOUR BOARD' : 'LED TIMER DEMO';
  $('board-limits').textContent = custom ? 'Your description and photos help Freely ask questions and select external observation steps. They do not prove component identity or a fault. Internet research is not connected yet.'
    : 'The demo supplies circuit connections and ratings. The chip identity is unspecified, and a steady meter display does not prove a steady waveform.';
  $('history').replaceChildren(); $('guidance').replaceChildren(); $('record').replaceChildren();
  const turns = data.turns || [], inputs = data.inputs || [], turnMap = new Map(turns.map(turn => [turn.id, turn]));
  imageCount = inputs.filter(input => turnMap.has(input.turnId)).reduce((count, input) => count + input.images.length, 0);
  if (custom && state?.session.boardDescription && !pending?.userMessage?.startsWith(state.session.boardDescription) && !inputs.some(input => input.userMessage.startsWith(state.session.boardDescription)))
    $('history').append(bubble('user', state.session.boardDescription));
  const shown = new Set();
  for (const input of inputs) {
    $('history').append(bubble('user', input.userMessage, input.images));
    const turn = turnMap.get(input.turnId);
    if (turn?.reasoningResult) $('history').append(answer(turn.reasoningResult));
    shown.add(input.turnId);
  }
  // Do not fabricate missing original messages on historical turns.
  for (const turn of turns) if (!shown.has(turn.id) && turn.reasoningResult) $('history').append(answer(turn.reasoningResult));
  reply = turns.filter(turn => turn.reasoningResult?.recommendation).at(-1)?.id || null;
  if (pending && !shown.has(pending.turnId) && !turnMap.has(pending.turnId)) $('history').append(bubble('user', pending.userMessage, pending.images || []));
  if (!turns.length && !inputs.length && !pending && !state?.session.boardDescription)
    $('guidance').append(bubble('assistant', custom ? 'What are you working on? Tell me about the device and what went wrong.' : 'What is happening with the LED board?'));
  const corrected = new Set((data.items || []).filter(item => item.supersedesId).map(item => item.supersedesId));
  for (const item of data.items || []) { const el = node('div', '', 'record-item' + (corrected.has(item.id) ? ' superseded' : ''));
    const label = item.kind === 'trusted_fact' ? 'SUPPLIED CIRCUIT INFORMATION' : item.category === 'hypothesis' ? 'POSSIBLE EXPLANATION' : item.category === 'evidence' ? 'YOUR REPORTED RESULT' : 'YOUR OBSERVATION';
    el.append(node('span', label, 'badge'), node('p', item.content)); $('record').append(el); }
  renderSessions();
}
async function load() { const data = await api(`/api/sessions/${state.session.id}`); state.session = data.session; render(data); return data; }
async function selectSession(entry, { fromHistory = false } = {}) {
  if (busy) return; stopDictation(); state = entry; localStorage.setItem('freely-active', entry.session.id);
  if (!fromHistory) saveNavigation();
  pending = read(pendingKey(), null); selectedImage = null; $('image-preview').hidden = true; $('report').value = ''; drawer(false);
  $('retry').hidden = !pending; $('edit-message').hidden = !pending; setBusy(true);
  try { await load(); status(pending ? 'This message needs a retry. Your previous conversation is saved.' : ''); }
  catch(error) { $('welcome').hidden = true; $('workbench').hidden = false; status(error.message); }
  finally { setBusy(false); scrollConversation(); }
}
function clearView() {
  stopDictation(); state = null; pending = null; reply = null; selectedImage = null; imageCount = 0;
  $('voice-review').hidden = true; $('voice-confirm').checked = false;
  localStorage.removeItem('freely-active'); $('report').value = ''; $('report').required = true;
  $('image-preview').hidden = true; $('retry').hidden = true; $('edit-message').hidden = true; status(''); drawer(false);
}
function home({ fromHistory = false } = {}) {
  if (busy) return; clearView(); localStorage.removeItem('freely-new-chat');
  $('welcome').hidden = false; $('workbench').hidden = true; renderSessions(); window.scrollTo(0, 0); if (!fromHistory) saveNavigation();
}
function newChat({ fromHistory = false } = {}) {
  if (busy) return; clearView(); localStorage.setItem('freely-new-chat', 'true');
  render({ turns: [], items: [], inputs: [] }); setBusy(false); $('report').focus(); window.scrollTo(0, 0); if (!fromHistory) saveNavigation();
}
async function startSession(input, firstMessage = null, firstImages = []) {
  if (busy) return; setBusy(true); $('setup-status').textContent = 'Starting your chat…'; status('Starting your chat…');
  try { state = await api('/api/sessions', { method: 'POST', body: JSON.stringify(input) });
    state.title = input.boardDescription ? input.boardDescription.slice(0, 55) : 'LED timer demo';
    sessions.push(state); persistSessions(); localStorage.setItem('freely-active', state.session.id); localStorage.removeItem('freely-new-chat'); pending = null; reply = null;
    render({ turns: [], items: [], inputs: [] }); status(''); window.scrollTo(0, 0);
    saveNavigation(input.circuitId === 'user-board');
    if (firstMessage || input.boardDescription) { pending = { turnId: crypto.randomUUID(), userMessage: firstMessage || input.boardDescription, replyToTurnId: null, images: firstImages };
      localStorage.setItem(pendingKey(), JSON.stringify(pending)); render(lastData); }
  } catch(error) { $('setup-status').textContent = error.message; status(error.message); if (firstMessage && !$('report').value) $('report').value = firstMessage; }
  finally { setBusy(false); }
  if (pending) await sendPending();
}
async function sendPending() {
  if (!pending || busy) return; setBusy(true); $('retry').hidden = true; $('edit-message').hidden = true; $('guidance').replaceChildren(); status('Freely is thinking…');
  try { const result = await api(`/api/sessions/${state.session.id}/turns`, { method: 'POST', body: JSON.stringify(pending) });
    if (result.status !== 'completed') throw new Error('Your message is still processing. Wait, then retry to retrieve it.');
    await load(); localStorage.removeItem(pendingKey()); pending = null; status('');
    scrollConversation();
  } catch(error) { status(error.name === 'AbortError' ? 'The connection timed out. Retry to retrieve the same answer.' : error.message); $('retry').hidden = false; $('edit-message').hidden = false; }
  finally { setBusy(false); }
}
$('report-form').onsubmit = async event => {
  event.preventDefault(); if (busy) return;
  stopDictation();
  if (!$('voice-review').hidden && !$('voice-confirm').checked) { status('Please check the spoken words and confirm them, or edit and confirm before sending.'); $('report').focus(); return; }
  $('voice-review').hidden = true; $('voice-confirm').checked = false;
  let userMessage = $('report').value.trim();
  if (!userMessage && selectedImage) userMessage = 'Please examine this board image and help me identify what information is needed next.';
  if (!userMessage) return;
  const images = selectedImage ? [selectedImage] : [];
  if (!state) {
    $('report').value = ''; selectedImage = null; $('image-preview').hidden = true; $('report').required = true;
    await startSession({ circuitId: 'user-board', boardDescription: userMessage.slice(0, 2000) }, userMessage, images);
    return;
  }
  // Retry the same content with its original ID. Editing and pressing Send is
  // a deliberate new request, never an automatic retry with a manufactured ID.
  const same = pending && pending.userMessage === userMessage && JSON.stringify(pending.images || []) === JSON.stringify(images);
  const next = same ? pending : { turnId: crypto.randomUUID(), userMessage, replyToTurnId: reply, images };
  try { localStorage.setItem(pendingKey(), JSON.stringify(next)); }
  catch { status('Browser storage is full. Remove the image or free browser storage before sending.'); return; }
  pending = next; $('report').value = ''; selectedImage = null; $('image-preview').hidden = true; $('report').required = true;
  render(lastData); await sendPending();
};
$('report').oninput = () => { stopDictation(); $('report').required = !selectedImage; if (!$('voice-review').hidden) $('voice-confirm').checked = false; };
$('start').onclick = () => startSession({ circuitId: 'circuit-one' });
$('start-custom').onclick = newChat;
$('edit-message').onclick = () => {
  if (busy || !pending) return; $('report').value = pending.userMessage; selectedImage = pending.images?.[0] || null;
  if (selectedImage) { $('selected-image').src = `data:${selectedImage.mimeType};base64,${selectedImage.data}`; $('image-preview').hidden = false; }
  $('report').required = !selectedImage; $('report').focus();
};
$('retry').onclick = sendPending;
$('menu').onclick = () => { renderSessions(); drawer(true); }; $('close-menu').onclick = () => drawer(false);
$('drawer-shade').onclick = () => drawer(false); $('new-chat').onclick = newChat; $('drawer-new').onclick = newChat; $('drawer-home').onclick = home;
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') drawer(false);
  if (event.key === 'Tab' && !$('drawer').hidden) {
    const buttons = [$('close-menu'), $('drawer-home'), $('drawer-new'), ...$('session-list').children].filter(el => !el.disabled);
    const first = buttons[0], last = buttons.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
});
$('attach').onclick = () => { if (imageCount >= 3) { status('This chat has three images already. Start a new chat to share more.'); return; } if (!busy) $('image-file').click(); };
$('remove-image').onclick = () => { selectedImage = null; $('image-preview').hidden = true; $('image-file').value = ''; $('report').required = true; };
$('image-file').onchange = async () => {
  const file = $('image-file').files[0]; if (!file) return;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 10000000) { status('Choose a JPG, PNG or WebP photo smaller than 10 MB.'); return; }
  setBusy(true);
  try { const bitmap = await createImageBitmap(file); const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
    const url = canvas.toDataURL('image/jpeg', .75), data = url.split(',')[1];
    if (data.length > 680000) throw new Error('This photo is too detailed. Crop to the relevant part and try again.');
    selectedImage = { mimeType: 'image/jpeg', data }; $('selected-image').src = url; $('image-preview').hidden = false; $('report').required = false; status('Image attached. Add your question, then send.');
  } catch(error) { status(error.message || 'Could not open the image.'); }
  finally { setBusy(false); $('image-file').value = ''; }
};
let dictationSession = null, dictationRestart = null;
function showMicrophone(listening) {
  $('voice').setAttribute('aria-label', listening ? 'Stop dictation' : 'Dictate a message');
  $('voice').setAttribute('aria-pressed', String(listening));
  $('voice-icon').hidden = listening; $('voice-stop').hidden = !listening;
}
function stopDictation() {
  dictationSession = null;
  if (dictationRestart !== null) { clearTimeout(dictationRestart); dictationRestart = null; }
  if (recognition) {
    const previous = recognition; recognition = null;
    previous.onresult = null; previous.onend = null; previous.onerror = null;
    try { previous.stop(); } catch {}
  }
  showMicrophone(false); $('dictation-status').textContent = '';
}
$('voice').onclick = () => {
  if (busy) return;
  if (dictationSession) { stopDictation(); return; }
  const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (window.isSecureContext === false) { $('dictation-status').textContent = 'Open the HTTPS site or localhost to use the microphone.'; return; }
  if (!Speech) { $('dictation-status').textContent = 'Use your keyboard microphone in this browser.'; return; }
  const session = { base: $('report').value.trim(), cycles: 0 }; dictationSession = session;
  function listen() {
    if (dictationSession !== session) return;
    dictationRestart = null;
    const current = new Speech(); recognition = current;
    let received = false;
    // Short recognition sessions avoid Android's repeated interim phrases.
    // Only final results enter the editable draft; each event replaces its snapshot.
    current.lang = 'en-NG'; current.interimResults = false; current.continuous = false;
    current.onresult = event => {
      if (dictationSession !== session || recognition !== current) return;
      const words = Array.from(event.results).filter(result => result.isFinal === true)
        .map(result => result[0].transcript.trim()).filter(Boolean).join(' ');
      if (!words) return;
      received = true;
      $('report').value = [session.base, words].filter(Boolean).join(' ').slice(0, 4000);
      $('voice-review').hidden = false; $('voice-confirm').checked = false;
      if ($('report').value.length >= 4000) { stopDictation(); $('dictation-status').textContent = 'Message limit reached. Check the words before sending.'; }
    };
    current.onerror = event => {
      if (dictationSession !== session || recognition !== current) return;
      stopDictation();
      const errors = { 'not-allowed': 'Microphone permission was denied. Allow it in Chrome’s site settings.',
        'service-not-allowed': 'Speech recognition is unavailable. Use your keyboard microphone.',
        'audio-capture': 'Microphone unavailable. Close other recording apps and try again.',
        'network': 'Speech connection lost. Your text is kept. Try your keyboard microphone.',
        'no-speech': 'No words heard. Tap the microphone to try again.',
        'language-not-supported': 'Speech recognition does not support this language. Try your keyboard microphone.' };
      $('dictation-status').textContent = errors[event.error] || 'Dictation stopped. Your text is kept.';
    };
    current.onend = () => {
      if (dictationSession !== session || recognition !== current) return;
      recognition = null;
      if (!received || ++session.cycles >= 30) {
        stopDictation();
        $('dictation-status').textContent = received ? 'Dictation stopped. Check the words before sending.' : 'No words heard. Tap the microphone to try again.';
        return;
      }
      session.base = $('report').value.trim();
      // Android may finish after one phrase. Continue only this explicit recording,
      // bounded to 30 phrases; errors, editing, navigation and Send cancel it.
      dictationRestart = setTimeout(listen, 150);
    };
    try { current.start(); showMicrophone(true); $('dictation-status').textContent = 'Listening… tap ■ to stop'; }
    catch { stopDictation(); $('dictation-status').textContent = 'Could not start dictation. Try your keyboard microphone.'; }
  }
  listen();
};
$('voice-review').hidden = true; $('voice-confirm').checked = false;
renderSessions();
const initialRoute = window.history?.state;
if (initialRoute?.freely) restoreNavigation(initialRoute);
else if (state) selectSession(state, { fromHistory: true });
else if (localStorage.getItem('freely-new-chat')) newChat({ fromHistory: true });
saveNavigation(true);
