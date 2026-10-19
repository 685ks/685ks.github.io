'use strict';
// GitHub Pages transport. There is no server: the host's browser runs the game
// (the same hub/game code the Node server uses, from game-bundle.js) and each
// phone opens a WebRTC data channel straight to it. PeerJS's free public
// broker only introduces the two browsers; game traffic goes between them.
(function () {
  const PREFIX = 'quizwave-v1-';
  const NOT_FOUND = "We couldn't find a game with that PIN.";

  // ?peerhost=host:port points at a self-hosted PeerJS server (used in tests).
  function peerOptions() {
    let h = new URLSearchParams(location.search).get('peerhost');
    try { if (h) sessionStorage.setItem('qw:peerhost', h); else h = sessionStorage.getItem('qw:peerhost'); } catch {}
    if (!h) return { debug: 0 };
    const [host, port] = h.split(':');
    return { host, port: Number(port) || 443, path: '/', secure: Number(port) === 443, debug: 0 };
  }

  function hostTransport(onMessage, onOpen) {
    const { createHub, randomPin } = QWModules.hub;
    let peer = null, pin = null, conn = null;
    const queue = [];
    const hub = createHub({ newPin: () => pin });
    const deliver = (m) => setTimeout(() => onMessage(m), 0);

    function startPeer(ready) {
      pin = randomPin();
      peer = new Peer(PREFIX + pin, peerOptions());
      let opened = false;
      peer.on('open', () => { if (!opened) { opened = true; ready(); } });
      peer.on('error', (e) => {
        if (!opened && e.type === 'unavailable-id') { peer.destroy(); startPeer(ready); return; }
        if (!opened) deliver({ t: 'error', message: "Couldn't reach the connection service. Check your internet and try again." });
        console.warn('peer', e.type, e);
      });
      peer.on('disconnected', () => { if (!peer.destroyed) setTimeout(() => { if (!peer.destroyed) peer.reconnect(); }, 1000); });
      peer.on('connection', (c) => {
        c.on('open', () => {
          const ws = { close: () => setTimeout(() => c.close(), 100) };
          const h = hub.connect(ws, (m) => { if (c.open) c.send(JSON.stringify(m)); });
          let gone = false;
          const bye = () => { if (!gone) { gone = true; h.close(); } };
          c.on('data', (d) => h.message(String(d)));
          c.on('close', bye);
          c.on('error', bye);
        });
      });
    }

    const self = { close() {} };
    const api = {
      send(msg) {
        if (msg.t === 'host:resume') return deliver({ t: 'error', message: 'That game has ended.' });
        if (msg.t === 'host:create' && !peer) {
          startPeer(() => {
            conn = hub.connect(self, deliver);
            conn.message(JSON.stringify(msg));
            queue.splice(0).forEach((m) => conn.message(JSON.stringify(m)));
          });
          return;
        }
        if (conn) conn.message(JSON.stringify(msg)); else queue.push(msg);
      },
      close() { if (peer) { const p = peer; setTimeout(() => p.destroy(), 1000); } },
    };
    setTimeout(() => onOpen && onOpen(), 0);
    return api;
  }

  function playerTransport(onMessage, onOpen) {
    let peer = null, conn = null, closed = false, everOpen = false, fails = 0;
    let pin = (new URLSearchParams(location.search).get('pin') || '').replace(/\D/g, '') || null;
    const queue = [];

    function ensurePeer(cb) {
      if (peer && !peer.destroyed && peer.open) return cb();
      if (!peer || peer.destroyed) {
        peer = new Peer(peerOptions());
        peer.on('error', onPeerError);
        peer.on('disconnected', () => { if (!closed && !peer.destroyed) setTimeout(() => peer.reconnect(), 1000); });
      }
      peer.once('open', cb);
    }

    function onPeerError(e) {
      if (e.type === 'peer-unavailable') {
        conn = null;
        if (everOpen) {
          // The host may be briefly re-registering; give up after a while.
          if (++fails < 10) return void setTimeout(dial, 2000);
          return onMessage({ t: 'game:ended', reason: 'Lost connection to the host.' });
        }
        const pending = queue.splice(0);
        if (pending.some((m) => m.t === 'player:join')) onMessage({ t: 'join:error', message: NOT_FOUND });
        else onMessage({ t: 'pin:result', ok: false, message: NOT_FOUND });
        return;
      }
      console.warn('peer', e.type, e);
      if (!closed && !conn) setTimeout(dial, 2000);
    }

    function dial() {
      if (closed || !pin || conn) return;
      ensurePeer(() => {
        if (closed || conn) return;
        const c = peer.connect(PREFIX + pin, { reliable: true });
        conn = c;
        c.on('open', () => {
          fails = 0;
          everOpen = true;
          if (onOpen) onOpen();
          queue.splice(0).forEach((m) => c.send(JSON.stringify(m)));
        });
        c.on('data', (d) => { let m; try { m = JSON.parse(String(d)); } catch { return; } onMessage(m); });
        c.on('close', () => { if (conn === c) { conn = null; if (!closed) setTimeout(dial, 1000); } });
      });
    }

    const api = {
      send(msg) {
        const p = msg.pin ? String(msg.pin).replace(/\D/g, '') : null;
        if (p && p !== pin) {
          pin = p;
          everOpen = false;
          if (conn) { const old = conn; conn = null; old.close(); }
        }
        if (conn && conn.open) return conn.send(JSON.stringify(msg));
        queue.push(msg);
        dial();
      },
      close() { closed = true; if (conn) conn.close(); if (peer) setTimeout(() => peer.destroy(), 500); },
    };
    if (pin) dial();
    return api;
  }

  QW.p2pConnect = (onMessage, onOpen) =>
    (document.getElementById('s-lib') ? hostTransport : playerTransport)(onMessage, onOpen);

  QW.qrDataUrl = (text) => {
    const qr = QWModules.qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    return qr.createDataURL(6, 2);
  };
})();
