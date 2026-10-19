'use strict';
// Player phone screen.
const params = new URLSearchParams(location.search);
let pin = (params.get('pin') || '').replace(/\D/g, '');
let me = null;          // { id, token, name }
let state = null;
let stopTimer = null;
let lastPhaseKey = '';

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

if (pin && store.get('qw:' + pin)) show('s-game'), body('<div class="screen center"><div class="spinner"></div></div>');
else if (pin) { $('#pin').value = pin; sock.send({ t: 'pin:check', pin }); }
else show('s-pin');

$('#f-pin').onsubmit = (e) => {
  e.preventDefault();
  pin = $('#pin').value.replace(/\D/g, '');
  if (pin.length !== 6) { $('#pin-err').textContent = 'A game PIN has 6 digits.'; return; }
  $('#pin-err').textContent = '';
  sock.send({ t: 'pin:check', pin });
};

$('#f-name').onsubmit = (e) => {
  e.preventDefault();
  const name = $('#name').value.trim();
  if (!name) { $('#name-err').textContent = 'Pick a nickname first.'; return; }
  $('#name-err').textContent = '';
  sock.send({ t: 'player:join', pin, name });
};

function onMessage(m) {
  switch (m.t) {
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

function render() {
  const s = state;
  if (stopTimer) { stopTimer(); stopTimer = null; }
  document.body.classList.remove('good', 'bad');
  $('#g-score').textContent = fmt(s.score);
  $('#g-q').textContent = s.question ? `${s.question.index + 1} of ${s.question.total}` : `PIN ${pin}`;
  const key = s.phase + ':' + (s.question ? s.question.index : '') + ':' + (s.answered != null);
  const fresh = key !== lastPhaseKey;
  lastPhaseKey = key;

  switch (s.phase) {
    case 'lobby':
      return body(`<div class="screen center" style="min-height:calc(100vh - 110px)">
        <h1>You're in!</h1><p class="dim" style="font-size:20px">Look for your nickname on the big screen.</p>
        <div class="spinner" style="margin-top:20px"></div></div>`);

    case 'intro':
      return body(`<div class="screen center" style="min-height:calc(100vh - 110px)">
        <p class="dim" style="font-size:20px">Question ${s.question.index + 1}</p>
        <h1 style="font-size:30px">Get ready...</h1>
        ${s.question.points === 2 ? '<div class="result-box">Double points!</div>' : ''}
        ${s.question.points === 0 ? '<div class="result-box">No points, just for fun</div>' : ''}
        <div class="spinner" style="margin-top:20px"></div></div>`);

    case 'question': {
      if (s.answered != null) {
        return body(`<div class="screen center" style="min-height:calc(100vh - 110px)">
          <div class="answer opt opt${s.answered}" style="width:120px;height:120px;justify-content:center;font-size:0">${SHAPES[s.answered]}</div>
          <h1 style="margin-top:20px">Answer locked in</h1><p class="dim">Waiting for everyone else...</p></div>`);
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
      if (fresh && s.phase === 'reveal') (r.correct ? Sound.good() : Sound.bad());
      const title = r.correct ? 'Correct' : r.answered ? 'Incorrect' : "Time's up";
      const gained = r.points + r.bonus;
      const where = s.rank === 1 ? "You're in 1st place!"
        : `You're in ${ordinal(s.rank)} place` + (s.ahead ? `, ${fmt(s.ahead.gap)} points behind ${esc(s.ahead.name)}` : '');
      return body(`<div class="screen center" style="min-height:calc(100vh - 110px)">
        <div class="big-emoji">${r.correct ? '&#10004;' : '&#10008;'}</div>
        <h1 style="font-size:40px;margin-top:10px">${title}</h1>
        ${r.correct && s.streak >= 2 ? `<p style="font-size:20px;font-weight:800">Answer streak ${s.streak} &#128293;</p>` : ''}
        <div class="result-box">${r.correct ? '+ ' + fmt(gained) : r.answered ? 'Streak lost. Next one!' : 'No answer this time'}</div>
        <p style="font-size:20px;font-weight:800;margin-top:20px">${where}</p></div>`);
    }

    case 'podium': {
      const medal = ['', '&#129351;', '&#129352;', '&#129353;'][s.rank] || '';
      if (fresh) { if (s.rank <= 3) { Sound.fanfare(); setTimeout(() => confetti(80), 300); } }
      return body(`<div class="screen center" style="min-height:calc(100vh - 110px)">
        ${medal ? `<div class="big-emoji">${medal}</div>` : ''}
        <h1 style="font-size:40px;margin-top:10px">${ordinal(s.rank)} place</h1>
        <div class="result-box">${fmt(s.score)} points</div>
        <p class="dim" style="font-size:20px">${s.correctCount} of ${s.question ? s.question.total : 0} correct · ${s.playerCount} players</p>
        <a class="btn primary" href="play.html" style="margin-top:12px">Play again</a></div>`);
    }
  }
}
