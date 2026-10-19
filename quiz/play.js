'use strict';
// Player phone screen.
const params = new URLSearchParams(location.search);
let pin = (params.get('pin') || '').replace(/\D/g, '');
let me = null;          // { id, token, name }
let state = null;
let stopTimer = null;
let lastPhaseKey = '';
let podiumRevealed = false;

const store = {
  get(k) { try { return JSON.parse(sessionStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { sessionStorage.removeItem(k); } catch {} },
};

const sock = connect(onMessage, () => {
  // Rejoin automatically after a dropped connection or a page reload.
  const saved = pin && store.get('qw:' + pin);
  if (saved) sock.send({ t: 'player:join', pin, token: saved.token, name: saved.name });
});

// While waiting for the game to answer, the button says so instead of looking idle.
function busy(form, on) {
  const b = $(form + ' button');
  if (!b.dataset.label) b.dataset.label = b.textContent;
  b.disabled = on;
  b.textContent = on ? 'Connecting...' : b.dataset.label;
}

if (pin && store.get('qw:' + pin)) show('s-game'), body('<div class="screen center"><div class="spinner"></div></div>');
else if (pin) { $('#pin').value = pin; busy('#f-pin', true); sock.send({ t: 'pin:check', pin }); }
else show('s-pin');

$('#f-pin').onsubmit = (e) => {
  e.preventDefault();
  pin = $('#pin').value.replace(/\D/g, '');
  if (pin.length !== 6) { $('#pin-err').textContent = 'A game PIN has 6 digits.'; return; }
  $('#pin-err').textContent = '';
  busy('#f-pin', true);
  sock.send({ t: 'pin:check', pin });
};

$('#f-name').onsubmit = (e) => {
  e.preventDefault();
  const name = $('#name').value.trim();
  if (!name) { $('#name-err').textContent = 'Pick a nickname first.'; return; }
  $('#name-err').textContent = '';
  busy('#f-name', true);
  sock.send({ t: 'player:join', pin, name });
};

function onMessage(m) {
  if (m.t !== 'state') { busy('#f-pin', false); busy('#f-name', false); }
  switch (m.t) {
    case 'net:error':
      // Couldn't reach the game at all (only on the GitHub Pages version).
      if (!$('#s-name').classList.contains('hidden')) $('#name-err').textContent = m.message;
      else { show('s-pin'); $('#pin-err').textContent = m.message; }
      return;
    case 'pin:result':
      if (m.ok) { show('s-name'); history.replaceState(null, '', 'play.html?pin=' + pin); setTimeout(() => $('#name').focus(), 50); }
      else { show('s-pin'); $('#pin-err').textContent = m.message; }
      return;
    case 'join:error':
      if (store.get('qw:' + pin)) { store.del('qw:' + pin); show('s-name'); }
      else if (!$('#s-name').classList.contains('hidden')) $('#name-err').textContent = m.message;
      else { show('s-pin'); $('#pin-err').textContent = m.message; }
      return;
    case 'joined':
      me = m;
      store.set('qw:' + pin, { token: m.token, name: m.name });
      $('#g-name').textContent = m.name;
      show('s-game');
      return;
    case 'state':
      state = m;
      render();
      return;
    case 'answer:ack':
      if (state) { state.answered = m.choice; render(); }
      return;
    case 'kicked':
      store.del('qw:' + pin);
      sock.close();
      return message('The host removed you from this game.');
    case 'game:ended':
      store.del('qw:' + pin);
      sock.close();
      if (state && state.phase === 'podium') return;
      return message(m.reason || 'The game has ended.');
  }
}

function message(text) { $('#msg-text').textContent = text; show('s-msg'); }
function body(html) { $('#g-body').innerHTML = html; }

function render(force) {
  const s = state;
  // Reveal and scoreboard show the same phone screen, so they share a key.
  const phaseKey = s.phase === 'scoreboard' ? 'reveal' : s.phase;
  const key = phaseKey + ':' + (s.question ? s.question.index : '') + ':' + (s.answered != null);
  const fresh = key !== lastPhaseKey;
  lastPhaseKey = key;
  if (!fresh && !force) { $('#g-score').textContent = fmt(s.score); return; }
  if (stopTimer) { stopTimer(); stopTimer = null; }
  document.body.classList.remove('good', 'bad');
  $('#g-score').textContent = fmt(s.score);
  $('#g-q').textContent = s.question ? `${s.question.index + 1} of ${s.question.total}` : `PIN ${pin}`;

  switch (s.phase) {
    case 'lobby':
      return body(`<div class="screen center" style="min-height:calc(100vh - 110px)">
        <h1 class="pop">You're in!</h1>
        <div class="name-tag bounce">${esc(s.name)}</div>
        <p class="dim" style="font-size:20px;margin-top:18px">See your nickname on the big screen?</p></div>`);

    case 'intro':
      body(`<div class="screen center" style="min-height:calc(100vh - 110px)">
        <p class="dim" style="font-size:20px">Question ${s.question.index + 1}</p>
        <h1 style="font-size:30px" class="zoom">Get ready...</h1>
        ${s.question.points === 2 ? '<div class="result-box pop">Double points!</div>' : ''}
        ${s.question.points === 0 ? '<div class="result-box pop">No points, just for fun</div>' : ''}
        <div class="intro-count" id="intro-count"></div></div>`);
      stopTimer = countdown(s.introMs, (left, sec, changed) => {
        const c = $('#intro-count');
        if (c && changed && sec > 0) { c.textContent = sec; c.style.animation = 'none'; void c.offsetWidth; c.style.animation = ''; }
      });
      return;

    case 'question': {
      if (s.answered != null) {
        return body(`<div class="screen center" style="min-height:calc(100vh - 110px)">
          <div class="answer opt opt${s.answered} pop" style="width:120px;height:120px;justify-content:center;font-size:0">${SHAPES[s.answered]}</div>
          <h1 style="margin-top:20px" class="zoom">Answer locked in</h1><p class="dim">Waiting for everyone else...</p></div>`);
      }
      const n = s.question.optionCount;
      body(`<div class="pad ${n === 2 ? 'two' : ''}" style="height:calc(100vh - 110px)">
        ${Array.from({ length: n }, (_, i) => `<button class="opt opt${i}" data-c="${i}" aria-label="Answer ${i + 1}">${SHAPES[i]}</button>`).join('')}
        </div>`);
      document.querySelectorAll('.pad button').forEach((b) => {
        b.onclick = () => {
          if (navigator.vibrate) navigator.vibrate(30);
          document.querySelectorAll('.pad button').forEach((x) => { x.disabled = true; });
          sock.send({ t: 'player:answer', choice: Number(b.dataset.c) });
        };
      });
      stopTimer = countdown(s.timeLeftMs, (left, sec) => { $('#g-q').textContent = `${s.question.index + 1} of ${s.question.total} · ${sec}s`; });
      return;
    }

    case 'reveal':
    case 'scoreboard': {
      const r = s.result || { answered: false, correct: false, points: 0, bonus: 0 };
      document.body.classList.add(r.correct ? 'good' : 'bad');
      if (fresh) {
        if (r.correct) { Sound.good(); confetti(40); if (navigator.vibrate) navigator.vibrate([40, 40, 40]); }
        else { Sound.bad(); if (navigator.vibrate) navigator.vibrate(200); }
      }
      const title = r.correct ? 'Correct' : r.answered ? 'Incorrect' : "Time's up";
      const gained = r.points + r.bonus;
      const where = s.rank === 1 ? "You're in 1st place!"
        : `You're in ${ordinal(s.rank)} place` + (s.ahead ? `, ${fmt(s.ahead.gap)} points behind ${esc(s.ahead.name)}` : '');
      body(`<div class="screen center" style="min-height:calc(100vh - 110px)">
        <div class="big-emoji ${r.correct ? 'pop' : 'shake'}">${r.correct ? '&#10004;' : '&#10008;'}</div>
        <h1 style="font-size:40px;margin-top:10px" class="zoom">${title}</h1>
        ${r.correct && s.streak >= 2 ? `<div class="streak-badge">&#128293; Answer streak ${s.streak}</div>` : ''}
        <div class="result-box pop" style="margin-top:14px;animation-delay:.2s">${r.correct ? '+ <span id="gain">0</span>' : r.answered ? 'Streak lost. Next one!' : 'No answer this time'}</div>
        <p style="font-size:20px;font-weight:800;margin-top:20px;animation-delay:.5s" class="pop">${where}</p></div>`);
      if (r.correct) { const g = $('#gain'); if (fresh) countUp(g, 0, gained, 900); else g.textContent = fmt(gained); }
      return;
    }

    case 'podium': {
      const medal = ['', '&#129351;', '&#129352;', '&#129353;'][s.rank] || '';
      // Keep phones in suspense until the big screen has revealed the podium.
      if (!podiumRevealed) {
        if (fresh) setTimeout(() => { podiumRevealed = true; render(true); if (state.rank <= 3) { Sound.fanfare(); confetti(80); } }, 7000);
        return body(`<div class="screen center" style="min-height:calc(100vh - 110px)"><h1>Drumroll...</h1><div class="spinner" style="margin-top:20px"></div></div>`);
      }
      return body(`<div class="screen center" style="min-height:calc(100vh - 110px)">
        ${medal ? `<div class="big-emoji pop bounce">${medal}</div>` : ''}
        <h1 style="font-size:40px;margin-top:10px" class="zoom">${ordinal(s.rank)} place</h1>
        <div class="result-box">${fmt(s.score)} points</div>
        <p class="dim" style="font-size:20px">${s.correctCount} of ${s.question ? s.question.total : 0} correct · ${s.playerCount} players</p>
        <a class="btn primary" href="play.html" style="margin-top:12px">Play again</a></div>`);
    }
  }
}
