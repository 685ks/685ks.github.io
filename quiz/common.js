// Shared helpers for the host and player pages.
'use strict';

const SHAPES = [
  // star
  '<svg class="shape" viewBox="0 0 24 24"><path d="M12 1.8l3.1 6.6 7.2.9-5.3 5 1.4 7.1L12 17.9l-6.4 3.5L7 14.3l-5.3-5 7.2-.9z"/></svg>',
  // hexagon
  '<svg class="shape" viewBox="0 0 24 24"><path d="M6.5 2.5h11L23 12l-5.5 9.5h-11L1 12z"/></svg>',
  // heart
  '<svg class="shape" viewBox="0 0 24 24"><path d="M12 21.6S1.5 15 1.5 8.1A5.4 5.4 0 0 1 12 5.6a5.4 5.4 0 0 1 10.5 2.5C22.5 15 12 21.6 12 21.6z"/></svg>',
  // bolt
  '<svg class="shape" viewBox="0 0 24 24"><path d="M14.5 1 3.5 13.6h7L8.8 23 20.5 9.8h-7.1z"/></svg>',
];

const LOGO = '<svg class="mark" viewBox="0 0 48 48"><circle cx="24" cy="24" r="22" fill="#c6f24e"/><path d="M8 27c4-6 8-6 12 0s8 6 12 0 6-5 8-3" fill="none" stroke="#1f2a05" stroke-width="4.5" stroke-linecap="round"/><circle cx="24" cy="15" r="3.5" fill="#1f2a05"/></svg>';

function $(sel, root = document) { return root.querySelector(sel); }
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
function show(id) {
  document.querySelectorAll('[data-screen]').forEach((el) => el.classList.toggle('hidden', el.id !== id));
}
function fmt(n) { return Number(n || 0).toLocaleString(); }

// Count a number up inside an element, easing out.
function countUp(el, from, to, ms) {
  const t0 = performance.now();
  (function frame(now) {
    const k = Math.min(1, (now - t0) / ms);
    el.textContent = fmt(Math.round(from + (to - from) * (1 - (1 - k) ** 3)));
    if (k < 1) requestAnimationFrame(frame);
  })(t0);
}

// Reconnecting WebSocket with a message handler and a queue for messages
// sent while the socket is still connecting.
function connect(onMessage, onOpen) {
  if (window.QW && QW.static) return QW.relayConnect(onMessage, onOpen);
  let ws, queue = [], retry = 0, closedByUs = false;
  const api = {
    send(msg) {
      if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
      else queue.push(msg);
    },
    close() { closedByUs = true; if (ws) ws.close(); },
    status: 'connecting',
  };
  function open() {
    ws = new WebSocket(new URL('ws', location.href).href.replace(/^http/, 'ws'));
    ws.onopen = () => {
      retry = 0; api.status = 'open';
      if (onOpen) onOpen();
      const q = queue; queue = [];
      q.forEach((m) => api.send(m));
    };
    ws.onmessage = (e) => { try { onMessage(JSON.parse(e.data)); } catch (err) { console.error(err); } };
    ws.onclose = () => {
      api.status = 'closed';
      if (closedByUs) return;
      setTimeout(open, Math.min(5000, 400 * 2 ** retry++));
    };
  }
  open();
  return api;
}

// Countdown driven by the server's "time left" so all screens stay in step.
function countdown(ms, onTick, onDone) {
  const end = performance.now() + ms;
  let stopped = false, lastSec = null;
  function frame() {
    if (stopped) return;
    const left = Math.max(0, end - performance.now());
    const sec = Math.ceil(left / 1000);
    onTick(left, sec, sec !== lastSec);
    lastSec = sec;
    if (left <= 0) { if (onDone) onDone(); return; }
    requestAnimationFrame(frame);
  }
  frame();
  return () => { stopped = true; };
}

// Tiny synthesized sound effects (no audio files needed).
const Sound = {
  ctx: null,
  muted: false,
  init() { if (!this.ctx) try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch {} },
  tone(freq, dur = 0.12, type = 'sine', gain = 0.12, delay = 0) {
    if (this.muted || !this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.ctx.destination); o.start(t); o.stop(t + dur + 0.02);
  },
  tick() { this.tone(880, 0.05, 'square', 0.05); },
  join() { this.tone(660, 0.08); this.tone(990, 0.12, 'sine', 0.12, 0.08); },
  reveal() { [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.18, 'triangle', 0.12, i * 0.09)); },
  good() { [660, 880, 1320].forEach((f, i) => this.tone(f, 0.15, 'triangle', 0.14, i * 0.08)); },
  bad() { this.tone(220, 0.3, 'sawtooth', 0.08); this.tone(180, 0.35, 'sawtooth', 0.08, 0.12); },
  countUp() { for (let i = 0; i < 10; i++) this.tone(600 + i * 60, 0.05, 'square', 0.03, i * 0.1); },
  thud() { this.tone(110, 0.35, 'sine', 0.25); this.tone(220, 0.2, 'triangle', 0.08); },
  // Fast snare-like taps that speed up and get louder.
  drumroll(ms) {
    if (this.muted || !this.ctx) return;
    let t = 0, gap = 0.09;
    while (t < ms / 1000) {
      this.tone(140 + Math.random() * 40, 0.05, 'square', 0.03 + 0.06 * (t / (ms / 1000)), t);
      t += gap; gap = Math.max(0.04, gap * 0.985);
    }
  },
  // Looping background music made of simple synth notes.
  // mode: 'lobby' (relaxed), 'question' (driving), or null to stop.
  musicMode: null,
  musicTimer: null,
  music(mode) {
    if (mode === this.musicMode) return;
    this.musicMode = mode;
    clearInterval(this.musicTimer);
    if (!mode) return;
    const lobby = mode === 'lobby';
    const chords = lobby
      ? [[262, 330, 392, 494], [220, 262, 330, 392], [175, 220, 262, 330], [196, 247, 294, 349]]
      : [[220, 262, 330, 440], [220, 262, 330, 440], [175, 220, 262, 349], [196, 247, 294, 392]];
    const stepMs = lobby ? 230 : 150;
    let step = 0;
    this.musicTimer = setInterval(() => {
      if (this.muted || !this.ctx || this.ctx.state !== 'running') { step++; return; }
      const chord = chords[Math.floor(step / 8) % chords.length];
      const i = step % 8;
      this.tone(chord[[0, 1, 2, 3, 2, 1, 2, 3][i]] * 2, lobby ? 0.22 : 0.12, 'triangle', 0.035);
      if (i % 4 === 0) this.tone(chord[0] / 2, lobby ? 0.6 : 0.3, 'sine', 0.07);
      if (!lobby && i % 2 === 1) this.tone(4000, 0.02, 'square', 0.008);
      step++;
    }, stepMs);
  },
  fanfare() { [523, 659, 784, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.25, 'triangle', 0.14, i * 0.16)); },
};
['pointerdown', 'keydown'].forEach((ev) => addEventListener(ev, () => {
  Sound.init();
  if (Sound.ctx && Sound.ctx.state === 'suspended') Sound.ctx.resume();
}, { once: false, passive: true }));

function confetti(n = 120) {
  const colors = ['#ff6a4d', '#1fb6d6', '#ecb11a', '#c057e0', '#c6f24e', '#fff'];
  for (let i = 0; i < n; i++) {
    const c = document.createElement('div');
    c.className = 'confetti';
    c.style.left = Math.random() * 100 + 'vw';
    c.style.background = colors[i % colors.length];
    c.style.animationDuration = 2.5 + Math.random() * 2.5 + 's';
    c.style.animationDelay = Math.random() * 1.5 + 's';
    document.body.appendChild(c);
    setTimeout(() => c.remove(), 7000);
  }
}

// Slowly drifting answer shapes behind every page.
(function shapes() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const box = document.createElement('div');
  box.className = 'bg-shapes';
  const n = innerWidth < 700 ? 6 : 12;
  for (let i = 0; i < n; i++) {
    box.insertAdjacentHTML('beforeend', SHAPES[i % 4]);
    const el = box.lastElementChild;
    const size = 30 + Math.random() * 60;
    Object.assign(el.style, {
      left: Math.random() * 100 + 'vw', width: size + 'px', height: size + 'px',
      animationDuration: 18 + Math.random() * 22 + 's', animationDelay: -Math.random() * 40 + 's',
    });
  }
  document.body.appendChild(box);
})();

document.querySelectorAll('[data-logo]').forEach((el) => { el.insertAdjacentHTML('afterbegin', LOGO); });
