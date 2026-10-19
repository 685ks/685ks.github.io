'use strict';
// Host screen: quiz library, editor, and the big-screen game view.

const SAMPLE = {
  title: 'Quizwave warm-up',
  questions: [
    { text: 'Which planet is known as the Red Planet?', options: ['Venus', 'Mars', 'Jupiter', 'Mercury'], correct: [1], time: 20, points: 1 },
    { text: 'Water boils at 100 °C at sea level.', options: ['True', 'False'], correct: [0], time: 10, points: 1 },
    { text: 'How many sides does a hexagon have?', options: ['5', '6', '7', '8'], correct: [1], time: 15, points: 1 },
    { text: 'Which of these are mammals?', options: ['Dolphin', 'Shark', 'Bat', 'Penguin'], correct: [0, 2], time: 20, points: 1 },
    { text: 'What is the largest ocean on Earth?', options: ['Atlantic', 'Indian', 'Arctic', 'Pacific'], correct: [3], time: 20, points: 2 },
  ],
};
const TIMES = [5, 10, 15, 20, 30, 45, 60, 90, 120, 240];
const LIB_KEY = 'qw:library';
const HOST_KEY = 'qw:host';

const store = {
  get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const session = {
  get() { try { return JSON.parse(sessionStorage.getItem(HOST_KEY)); } catch { return null; } },
  set(v) { try { sessionStorage.setItem(HOST_KEY, JSON.stringify(v)); } catch {} },
  del() { try { sessionStorage.removeItem(HOST_KEY); } catch {} },
};

let library = store.get(LIB_KEY, null);
if (!Array.isArray(library) || !library.length) { library = [{ id: uid(), ...structuredClone(SAMPLE) }]; saveLib(); }
function uid() { return Math.random().toString(36).slice(2, 10); }
function saveLib() { store.set(LIB_KEY, library); }

// ---------- library ----------

function renderLib() {
  show('s-lib');
  $('#lib').innerHTML = library.map((q) => `
    <div class="card lib-item" data-id="${q.id}">
      <div><div class="t">${esc(q.title)}</div><div class="muted">${q.questions.length} question${q.questions.length === 1 ? '' : 's'}</div></div>
      <span class="spacer"></span>
      <button class="sm" data-act="del" title="Delete" style="background:#e5e5ee;color:#333">Delete</button>
      <button class="sm" data-act="dup" style="background:#e5e5ee;color:#333">Duplicate</button>
      <button class="sm" data-act="edit" style="background:#e5e5ee;color:#333">Edit</button>
      <button class="primary sm" data-act="host">Host live</button>
    </div>`).join('') || '<p class="dim">No quizzes yet. Make one with "New quiz".</p>';
  $('#lib').querySelectorAll('button').forEach((b) => {
    b.onclick = () => {
      const id = b.closest('[data-id]').dataset.id;
      const quiz = library.find((q) => q.id === id);
      if (b.dataset.act === 'edit') openEditor(quiz);
      if (b.dataset.act === 'host') {
        // Starting can take a few seconds on Pages while the relay connects.
        $('#lib').querySelectorAll('[data-act=host]').forEach((x) => { x.disabled = true; });
        b.textContent = 'Starting...';
        hostQuiz(quiz);
      }
      if (b.dataset.act === 'dup') { library.push({ ...structuredClone(quiz), id: uid(), title: quiz.title + ' (copy)' }); saveLib(); renderLib(); }
      if (b.dataset.act === 'del' && confirm(`Delete "${quiz.title}"?`)) { library = library.filter((q) => q.id !== id); saveLib(); renderLib(); }
    };
  });
}

$('#new').onclick = () => openEditor({ id: uid(), title: '', questions: [blankQ()] }, true);
$('#import').onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const list = Array.isArray(data) ? data : [data];
    for (const q of list) {
      if (!q || !Array.isArray(q.questions)) throw new Error('This file is not a Quizwave quiz.');
      library.push({ id: uid(), title: String(q.title || 'Imported quiz'), questions: q.questions });
    }
    saveLib(); renderLib();
  } catch (err) { alert(err.message); }
};

// ---------- editor ----------

let editing = null;
let editingIsNew = false;

function blankQ(tf) {
  return tf ? { text: '', options: ['True', 'False'], correct: [0], time: 20, points: 1 }
    : { text: '', options: ['', '', '', ''], correct: [0], time: 20, points: 1 };
}

function openEditor(quiz, isNew) {
  editing = structuredClone(quiz);
  editingIsNew = !!isNew;
  $('#ed-title').value = editing.title;
  $('#ed-err').textContent = '';
  renderQs();
  show('s-edit');
}

function renderQs() {
  $('#ed-qs').innerHTML = editing.questions.map((q, i) => {
    const opts = [0, 1, 2, 3].map((j) => `
      <div class="opt-in opt opt${j}">
        ${SHAPES[j]}
        <input type="text" data-f="opt" data-j="${j}" maxlength="90" placeholder="Answer ${j + 1}${j > 1 ? ' (optional)' : ''}" value="${esc(q.options[j] || '')}">
        <input type="checkbox" data-f="correct" data-j="${j}" title="Correct answer" ${q.correct.includes(j) ? 'checked' : ''}>
      </div>`).join('');
    return `<div class="card q-card stack" data-i="${i}">
      <div class="row"><b>Question ${i + 1}</b><span class="spacer"></span>
        <button class="sm" data-act="up" style="background:#e5e5ee;color:#333" ${i === 0 ? 'disabled' : ''}>&uarr;</button>
        <button class="sm" data-act="down" style="background:#e5e5ee;color:#333" ${i === editing.questions.length - 1 ? 'disabled' : ''}>&darr;</button>
        <button class="sm" data-act="dup" style="background:#e5e5ee;color:#333">Duplicate</button>
        <button class="sm danger" data-act="del" ${editing.questions.length === 1 ? 'disabled' : ''}>Delete</button></div>
      <input data-f="text" maxlength="300" placeholder="Type your question" value="${esc(q.text)}">
      <div class="opts">${opts}</div>
      <div class="meta">
        <div><label>Time limit</label><select data-f="time">${TIMES.map((t) => `<option value="${t}" ${t === q.time ? 'selected' : ''}>${t} seconds</option>`).join('')}</select></div>
        <div><label>Points</label><select data-f="points">
          <option value="1" ${q.points === 1 ? 'selected' : ''}>Standard</option>
          <option value="2" ${q.points === 2 ? 'selected' : ''}>Double</option>
          <option value="0" ${q.points === 0 ? 'selected' : ''}>No points</option></select></div>
        <div><label>Image URL (optional)</label><input data-f="image" placeholder="https://..." value="${esc(q.image || '')}"></div>
      </div>
      <div class="muted" style="font-size:13px">Tick the box on every correct answer. Leave answers 3 and 4 empty for a two-choice question.</div>
    </div>`;
  }).join('');

  $('#ed-qs').querySelectorAll('.q-card').forEach((card) => {
    const i = Number(card.dataset.i);
    const q = editing.questions[i];
    card.querySelectorAll('[data-f]').forEach((el) => {
      el.oninput = el.onchange = () => {
        const f = el.dataset.f, j = Number(el.dataset.j);
        if (f === 'text') q.text = el.value;
        if (f === 'image') q.image = el.value;
        if (f === 'time') q.time = Number(el.value);
        if (f === 'points') q.points = Number(el.value);
        if (f === 'opt') { while (q.options.length <= j) q.options.push(''); q.options[j] = el.value; }
        if (f === 'correct') {
          q.correct = q.correct.filter((c) => c !== j);
          if (el.checked) q.correct.push(j);
          q.correct.sort();
        }
      };
    });
    card.querySelectorAll('[data-act]').forEach((b) => {
      b.onclick = () => {
        const qs = editing.questions;
        if (b.dataset.act === 'del') qs.splice(i, 1);
        if (b.dataset.act === 'dup') qs.splice(i + 1, 0, structuredClone(q));
        if (b.dataset.act === 'up') [qs[i - 1], qs[i]] = [qs[i], qs[i - 1]];
        if (b.dataset.act === 'down') [qs[i + 1], qs[i]] = [qs[i], qs[i + 1]];
        renderQs();
      };
    });
  });
}

function cleanedQuiz() {
  const quiz = { title: $('#ed-title').value.trim(), questions: [] };
  editing.title = quiz.title;
  editing.questions.forEach((q, i) => {
    const n = i + 1;
    const opts = q.options.map((o) => o.trim());
    while (opts.length && !opts[opts.length - 1]) opts.pop();
    if (!q.text.trim()) throw new Error(`Question ${n} needs some text.`);
    if (opts.length < 2) throw new Error(`Question ${n} needs at least 2 answers.`);
    if (opts.some((o) => !o)) throw new Error(`Question ${n} has a gap between answers. Fill answers in order.`);
    const correct = q.correct.filter((c) => c < opts.length);
    if (!correct.length) throw new Error(`Question ${n}: tick at least one correct answer.`);
    quiz.questions.push({ text: q.text.trim(), options: opts, correct, time: q.time, points: q.points, image: (q.image || '').trim() });
  });
  if (!quiz.title) throw new Error('Give your quiz a title.');
  return quiz;
}

$('#ed-add').onclick = () => { editing.questions.push(blankQ()); renderQs(); window.scrollTo(0, document.body.scrollHeight); };
$('#ed-addtf').onclick = () => { editing.questions.push(blankQ(true)); renderQs(); window.scrollTo(0, document.body.scrollHeight); };
$('#ed-back').onclick = () => renderLib();
$('#ed-save').onclick = () => {
  try {
    const quiz = cleanedQuiz();
    const idx = library.findIndex((q) => q.id === editing.id);
    const entry = { id: editing.id, ...quiz };
    if (idx >= 0) library[idx] = entry; else library.push(entry);
    saveLib();
    renderLib();
  } catch (err) { $('#ed-err').textContent = err.message; }
};
$('#ed-export').onclick = () => {
  try {
    const quiz = cleanedQuiz();
    const blob = new Blob([JSON.stringify(quiz, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (quiz.title.replace(/[^\w-]+/g, '_') || 'quiz') + '.json';
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (err) { $('#ed-err').textContent = err.message; }
};

// ---------- live game ----------

let sock = null;
let state = null;
let stopTimer = null;
let lastKey = '';
let knownPlayers = new Set();

function hostQuiz(quiz) {
  openSocket(() => sock.send({ t: 'host:create', quiz: { title: quiz.title, questions: quiz.questions } }));
}

function openSocket(first) {
  let sentFirst = false;
  sock = connect(onMessage, () => {
    const saved = session.get();
    if (sentFirst && saved) sock.send({ t: 'host:resume', pin: saved.pin, token: saved.token });
    else { sentFirst = true; first(); }
  });
}

function onMessage(m) {
  if (m.t === 'host:created') {
    // A Pages game lives in this tab, so there's nothing to resume after a reload.
    if (!QW.static) session.set({ pin: m.pin, token: m.token });
    return;
  }
  if (m.t === 'error') {
    if (!state) { session.del(); alert(m.message); sock.close(); renderLib(); }
    return;
  }
  if (m.t === 'game:ended') { session.del(); sock.close(); if (state && state.phase === 'podium') return; $('#over-text').textContent = m.reason || 'The game has ended.'; show('s-over'); return; }
  if (m.t === 'host:replaced') { sock.close(); $('#over-text').textContent = 'This game is now being hosted in another tab.'; show('s-over'); return; }
  if (m.t === 'state') { state = m; render(); }
}

// On GitHub Pages (QW.static) the join link is next to this page and the QR
// code is drawn in the browser; with the Node server both come from the server,
// which knows this computer's Wi-Fi address.
const pagesBase = new URL('play.html', location.href).href;
let joinBase = pagesBase.replace(/^https?:\/\//, '');
if (!QW.static) {
  fetch('join-url').then((r) => r.text()).then((u) => {
    joinBase = u.replace(/^https?:\/\//, '');
    if (state && state.phase === 'lobby') renderLobby(state);
  }).catch(() => {});
}
function qrSrc(pin) { return QW.static ? QW.qrDataUrl(`${pagesBase}?pin=${pin}`) : `qr.svg?pin=${pin}`; }
function joinUrl() { return joinBase; }

function render() {
  const s = state;
  if (stopTimer) { stopTimer(); stopTimer = null; }
  const key = s.phase + ':' + (s.question ? s.question.index : '');
  const fresh = key !== lastKey;
  lastKey = key;

  if (s.phase === 'lobby') return renderLobby(s);
  show('s-game');
  $('#g-pin').textContent = `PIN ${s.pin}`;
  $('#g-num').textContent = s.question ? `${s.question.index + 1} of ${s.question.total}` : '';
  const next = $('#g-next');
  next.classList.remove('hidden');
  const body = (html) => { $('#g-body').innerHTML = html; };

  switch (s.phase) {
    case 'intro': {
      next.textContent = 'Skip';
      const q = s.question;
      body(`<div class="center" style="min-height:70vh">
        <p class="dim" style="font-size:22px">Question ${q.index + 1} of ${q.total}</p>
        <div class="qtext" style="font-size:44px;max-width:1100px">${esc(q.text)}</div>
        ${q.points === 2 ? '<div class="result-box" style="margin-top:20px">Double points!</div>' : ''}
        <div style="width:min(600px,80vw);height:10px;background:rgba(255,255,255,.2);border-radius:5px;margin-top:40px;overflow:hidden"><div id="intro-bar" style="height:100%;width:0;background:var(--accent)"></div></div>
      </div>`);
      stopTimer = countdown(s.introMs, (left) => { const b = $('#intro-bar'); if (b) b.style.width = (100 - left / s.introMs * 100) + '%'; });
      return;
    }

    case 'question': {
      next.textContent = 'Skip';
      const q = s.question;
      body(`<div class="qtext">${esc(q.text)}</div>
        <div class="row" style="justify-content:space-between;margin:20px 0;min-height:120px">
          <div class="timer" id="timer"><span>${q.time}</span></div>
          ${q.image ? `<img class="qimg" src="${esc(q.image)}" alt="" referrerpolicy="no-referrer">` : '<span></span>'}
          <div class="center"><div style="font-size:44px;font-weight:900" id="answered">${s.answered}</div><div class="dim" style="font-weight:800">Answers</div></div>
        </div>
        <div class="answers">${q.options.map((o, i) => `<div class="answer opt opt${i}">${SHAPES[i]}<span>${esc(o)}</span></div>`).join('')}</div>`);
      stopTimer = countdown(s.timeLeftMs, (left, sec, changed) => {
        const t = $('#timer');
        if (!t) return;
        t.style.setProperty('--p', left / (q.time * 1000));
        t.querySelector('span').textContent = sec;
        if (changed && sec <= 5 && sec > 0) Sound.tick();
      });
      return;
    }

    case 'reveal': {
      next.textContent = 'Next';
      if (fresh) Sound.reveal();
      const q = s.question, r = s.reveal;
      const max = Math.max(1, ...r.counts);
      body(`<div class="qtext">${esc(q.text)}</div>
        <div class="bars" style="margin:30px 0">${r.counts.map((c, i) => `
          <div class="bar-col opt${i} ${r.correct.includes(i) ? '' : 'wrong'}">
            <div style="font-weight:900;font-size:22px;margin-bottom:4px">${c}</div>
            <div class="fill" style="height:0" data-h="${(c / max) * 200}"></div>
            <div class="lbl">${SHAPES[i]}${r.correct.includes(i) ? '&#10004;' : ''}</div>
          </div>`).join('')}</div>
        <div class="answers">${q.options.map((o, i) => `<div class="answer opt opt${i} ${r.correct.includes(i) ? '' : 'wrong'}">${SHAPES[i]}<span>${esc(o)}</span>${r.correct.includes(i) ? '<span class="tick">&#10004;</span>' : ''}</div>`).join('')}</div>`);
      requestAnimationFrame(() => requestAnimationFrame(() => document.querySelectorAll('.fill').forEach((f) => { f.style.height = f.dataset.h + 'px'; })));
      return;
    }

    case 'scoreboard': {
      next.textContent = 'Next';
      body(`<div class="center"><h1 style="font-size:44px;margin:10px 0 24px">Scoreboard</h1>
        <div class="board">${s.leaderboard.map((p, i) => `
          <div class="entry" style="animation-delay:${i * 0.08}s">
            <span>${esc(p.name)}</span>
            ${p.streak >= 2 ? `<span class="streak">&#128293; ${p.streak}</span>` : ''}
            ${p.gained ? `<span class="gain">+${fmt(p.gained)}</span>` : ''}
            <span class="score">${fmt(p.score)}</span>
          </div>`).join('')}</div></div>`);
      return;
    }

    case 'podium': {
      next.classList.add('hidden');
      $('#g-end').textContent = 'Close game';
      if (fresh) { Sound.fanfare(); setTimeout(() => confetti(160), 2300); }
      const top = s.leaderboard;
      const step = (p, n) => p ? `<div class="step p${n}"><div class="who">${esc(p.name)}</div>
        <div class="block"><div class="medal">${['', '&#129351;', '&#129352;', '&#129353;'][n]}</div><div style="font-size:24px">${fmt(p.score)}</div>
        <div style="font-size:15px">${p.correctCount} of ${s.question.total} correct</div></div></div>` : '';
      body(`<div class="center"><h1 style="font-size:44px">${esc(s.title)}</h1>
        <div class="podium">${step(top[1], 2)}${step(top[0], 1)}${step(top[2], 3)}</div>
        ${top.length > 3 ? `<div class="board" style="margin-top:30px">${top.slice(3).map((p, i) => `<div class="entry" style="animation-delay:${3 + i * 0.1}s"><span>${i + 4}. ${esc(p.name)}</span><span class="score">${fmt(p.score)}</span></div>`).join('')}</div>` : ''}
        <button class="primary" style="margin-top:30px" onclick="downloadResults()">Download results (CSV)</button></div>`);
      return;
    }
  }
}

function renderLobby(s) {
  show('s-lobby');
  $('#lb-url').textContent = joinUrl();
  $('#lb-pin').textContent = s.pin;
  if ($('#lb-qr').dataset.pin !== s.pin) { $('#lb-qr').src = qrSrc(s.pin); $('#lb-qr').dataset.pin = s.pin; }
  $('#lb-title').textContent = s.title;
  $('#lb-count').textContent = `${s.players.length} player${s.players.length === 1 ? '' : 's'}`;
  $('#lb-start').disabled = s.players.length === 0;
  $('#lb-lock').textContent = s.locked ? 'Unlock' : 'Lock';
  $('#lb-wait').classList.toggle('hidden', s.players.length > 0);
  const ids = new Set(s.players.map((p) => p.id));
  const fresh = new Set([...ids].filter((id) => !knownPlayers.has(id)));
  if (fresh.size) Sound.join();
  knownPlayers = ids;
  // Only redraw when the list changes, so existing names don't re-animate on every update.
  const key = s.players.map((p) => p.id + (p.connected ? '' : '~')).join(',');
  if ($('#lb-players').dataset.key === key) return;
  $('#lb-players').dataset.key = key;
  $('#lb-players').innerHTML = s.players.map((p) => `<div class="chip ${p.connected ? '' : 'off'} ${fresh.has(p.id) ? 'new' : ''}" data-id="${p.id}" title="Click to remove">${esc(p.name)}</div>`).join('');
  $('#lb-players').querySelectorAll('.chip').forEach((c) => { c.onclick = () => sock.send({ t: 'host:kick', id: c.dataset.id }); });
}

function downloadResults() {
  const rows = [['Rank', 'Player', 'Score', 'Correct answers']];
  state.leaderboard.forEach((p, i) => rows.push([i + 1, p.name, p.score, p.correctCount]));
  const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = 'quizwave-results.csv';
  a.click();
}

addEventListener('beforeunload', (e) => {
  if (QW.static && state && !['podium'].includes(state.phase) && sock) { e.preventDefault(); e.returnValue = ''; }
});
$('#lb-start').onclick = () => sock.send({ t: 'host:start' });
$('#lb-lock').onclick = () => sock.send({ t: 'host:lock', locked: !state.locked });
$('#g-next').onclick = () => sock.send({ t: 'host:next' });
$('#g-end').onclick = () => {
  if (state && state.phase === 'podium') { sock.send({ t: 'host:end' }); session.del(); location.href = 'host.html'; return; }
  if (confirm('End this game for everyone?')) sock.send({ t: 'host:end' });
};
$('#g-mute').onclick = () => { Sound.muted = !Sound.muted; $('#g-mute').textContent = Sound.muted ? 'Sound off' : 'Sound on'; };
addEventListener('keydown', (e) => {
  if (!state || e.target.matches('input, textarea, select')) return;
  if (e.key === ' ' || e.key === 'Enter') {
    e.preventDefault();
    if (state.phase === 'lobby') { if (state.players.length) sock.send({ t: 'host:start' }); }
    else if (state.phase !== 'podium') sock.send({ t: 'host:next' });
  }
});

// Resume a running game after a page reload; otherwise show the library.
const saved = session.get();
if (saved) openSocket(() => sock.send({ t: 'host:resume', pin: saved.pin, token: saved.token }));
else renderLib();
