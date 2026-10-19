'use strict';
// GitHub Pages transport. There is no game server: the host's browser runs the
// game (the same hub/game code the Node server uses, from game-bundle.js) and
// phones talk to it through a free public MQTT broker over secure WebSockets.
// The broker only relays messages; it works on networks that block direct
// phone-to-laptop connections.
//
// Topics:  qw1/<pin>/up/<clientId>    phone -> host
//          qw1/<pin>/down/<clientId>  host  -> phone
// Envelope: { k: 'hello' | 'welcome' | 'msg' | 'ping' | 'pong' | 'bye', d?: message }
(function () {
  const BROKERS = [
    'wss://broker.hivemq.com:8884/mqtt',
    'wss://broker.emqx.io:8084/mqtt',
  ];
  const NOT_FOUND = "We couldn't find a game with that PIN.";
  const NET_ERROR = "This device can't reach the Quizwave relay. Check its internet connection and try again.";
  const ROOT = 'qw1';
  const PING_MS = 4000;
  const TIMEOUT_MS = 13000;   // silence after which the other side counts as gone
  const FIND_MS = 7000;       // how long a phone waits for the host to answer a PIN

  // ?broker=ws://host:port points at a self-hosted broker (used in tests).
  function brokerUrls() {
    let b = new URLSearchParams(location.search).get('broker');
    try { if (b) sessionStorage.setItem('qw:broker', b); else b = sessionStorage.getItem('qw:broker'); } catch {}
    return b ? [b] : BROKERS;
  }

  function randomId() {
    const a = new Uint8Array(8);
    crypto.getRandomValues(a);
    return Array.from(a, (x) => x.toString(16).padStart(2, '0')).join('');
  }

  // Connect to the first broker that answers. onReady fires on every
  // (re)connect, onFail once if none can be reached.
  function openClient(clientId, onMsg, onReady, onFail) {
    const urls = brokerUrls();
    let i = 0, client = null, ever = false;
    function attempt() {
      client = mqtt.connect(urls[i], {
        clientId: 'qw-' + clientId, clean: true, keepalive: 20,
        connectTimeout: 8000, reconnectPeriod: 2000,
      });
      client.on('message', onMsg);
      const failover = () => {
        if (ever) return;                       // once connected, mqtt.js reconnects by itself
        client.end(true);
        if (++i < urls.length) attempt(); else onFail();
      };
      client.on('connect', () => { ever = true; onReady(client); });
      client.on('error', failover);
      client.on('offline', failover);
    }
    attempt();
    return { get client() { return client; } };
  }

  const pub = (client, topic, obj) => client.publish(topic, JSON.stringify(obj), { qos: 1 });

  function hostTransport(onMessage, onOpen) {
    const { createHub, randomPin } = QWModules.hub;
    let pin = null, hostConn = null, conn = null;
    const queue = [];
    const phones = new Map(); // clientId -> { h, seen }
    const hub = createHub({ newPin: () => pin });
    const deliver = (m) => setTimeout(() => onMessage(m), 0);

    function start(ready) {
      pin = randomPin();
      const upTopic = `${ROOT}/${pin}/up/+`;
      const onUp = (topic, payload) => {
        const parts = topic.split('/');
        if (parts[1] !== pin || parts[2] !== 'up') return;
        const id = parts[3];
        let env;
        try { env = JSON.parse(String(payload)); } catch { return; }
        const client = hostConn.client;
        const down = `${ROOT}/${pin}/down/${id}`;
        let ph = phones.get(id);
        if (env.k === 'bye') { if (ph) { phones.delete(id); ph.h.close(); } return; }
        if (!ph) {
          if (env.k !== 'hello' && env.k !== 'ping' && env.k !== 'msg') return;
          const ws = { close: () => { pub(client, down, { k: 'bye' }); drop(id); } };
          ph = { seen: Date.now(), h: hub.connect(ws, (m) => pub(hostConn.client, down, { k: 'msg', d: m })) };
          phones.set(id, ph);
          pub(client, down, { k: 'welcome' });
        }
        ph.seen = Date.now();
        if (env.k === 'hello') pub(client, down, { k: 'welcome' });
        else if (env.k === 'ping') pub(client, down, { k: 'pong' });
        else if (env.k === 'msg') ph.h.message(JSON.stringify(env.d));
      };
      hostConn = openClient('h' + randomId(), onUp, (client) => {
        client.subscribe(upTopic, { qos: 1 }, () => { if (!conn) ready(); });
      }, () => deliver({ t: 'error', message: NET_ERROR }));
    }

    function drop(id) {
      const ph = phones.get(id);
      if (!ph) return;
      phones.delete(id);
      ph.h.close();
    }

    // Phones that stop pinging are treated as disconnected.
    setInterval(() => {
      const now = Date.now();
      for (const [id, ph] of phones) if (now - ph.seen > TIMEOUT_MS) drop(id);
    }, 2000);

    const self = { close() {} };
    const api = {
      send(msg) {
        if (msg.t === 'host:resume') return deliver({ t: 'error', message: 'That game has ended.' });
        if (msg.t === 'host:create' && !hostConn) {
          start(() => {
            conn = hub.connect(self, deliver);
            conn.message(JSON.stringify(msg));
            queue.splice(0).forEach((m) => conn.message(JSON.stringify(m)));
          });
          return;
        }
        if (conn) conn.message(JSON.stringify(msg)); else queue.push(msg);
      },
      close() { const c = hostConn && hostConn.client; if (c) setTimeout(() => c.end(), 1500); },
    };
    setTimeout(() => onOpen && onOpen(), 0);
    return api;
  }

  function playerTransport(onMessage, onOpen) {
    const id = randomId();
    let pin = (new URLSearchParams(location.search).get('pin') || '').replace(/\D/g, '') || null;
    let mq = null, linked = false, everLinked = false, closed = false;
    let lastHeard = 0, findTimer = null, brokerTimer = null;
    const queue = [];
    const up = () => `${ROOT}/${pin}/up/${id}`;
    const down = () => `${ROOT}/${pin}/down/${id}`;
    const client = () => mq && mq.client;

    function notFound() {
      const pending = queue.splice(0);
      if (pending.some((m) => m.t === 'player:join')) onMessage({ t: 'join:error', message: NOT_FOUND });
      else onMessage({ t: 'pin:result', ok: false, message: NOT_FOUND });
    }

    function hello() {
      if (!pin || !client() || !client().connected) return;
      client().subscribe(down(), { qos: 1 }, () => {
        pub(client(), up(), { k: 'hello' });
        clearTimeout(findTimer);
        if (!linked && !everLinked) findTimer = setTimeout(() => { if (!linked) notFound(); }, FIND_MS);
      });
    }

    function onDown(topic, payload) {
      if (topic !== down()) return;
      let env;
      try { env = JSON.parse(String(payload)); } catch { return; }
      lastHeard = Date.now();
      if (env.k === 'welcome' && linked) {
        // The host had dropped us and re-created our seat: rejoin with our token.
        if (onOpen) onOpen();
      } else if (env.k === 'welcome') {
        linked = true; everLinked = true;
        clearTimeout(findTimer);
        if (onOpen) onOpen();
        queue.splice(0).forEach((m) => pub(client(), up(), { k: 'msg', d: m }));
      } else if (env.k === 'msg') {
        onMessage(env.d);
      } else if (env.k === 'bye') {
        linked = false;
      }
    }

    function ensureBroker() {
      if (mq) return hello();
      clearTimeout(brokerTimer);
      brokerTimer = setTimeout(() => { if (!client() || !client().connected) fail(); }, 15000);
      mq = openClient('p' + id, onDown, () => {
        clearTimeout(brokerTimer);
        // After a network blip, say hello again so the host knows we're back.
        linked = false;
        hello();
      }, fail);
    }

    function fail() {
      clearTimeout(brokerTimer);
      if (everLinked) return; // mid-game: mqtt.js keeps retrying
      queue.length = 0;
      if (mq && mq.client) mq.client.end(true);
      mq = null;
      onMessage({ t: 'net:error', message: NET_ERROR });
    }

    // Keep-alive both ways: lets the host notice a phone that vanished, and the
    // phone notice a host that closed its tab.
    setInterval(() => {
      if (closed || !linked || !client() || !client().connected) return;
      pub(client(), up(), { k: 'ping' });
      if (Date.now() - lastHeard > TIMEOUT_MS) {
        linked = false;
        hello();
        setTimeout(() => {
          if (!linked && !closed && Date.now() - lastHeard > TIMEOUT_MS * 3) {
            onMessage({ t: 'game:ended', reason: 'Lost connection to the host.' });
          }
        }, TIMEOUT_MS * 2);
      }
    }, PING_MS);

    const api = {
      send(msg) {
        const p = msg.pin ? String(msg.pin).replace(/\D/g, '') : null;
        if (p && p !== pin) {
          if (client() && pin) client().unsubscribe(down());
          pin = p; linked = false; everLinked = false;
        }
        if (linked && client() && client().connected) return pub(client(), up(), { k: 'msg', d: msg });
        queue.push(msg);
        ensureBroker();
      },
      close() {
        closed = true;
        const c = client();
        if (c && pin) { pub(c, up(), { k: 'bye' }); setTimeout(() => c.end(), 500); }
      },
    };
    addEventListener('pagehide', () => { const c = client(); if (c && pin && linked) pub(c, up(), { k: 'bye' }); });
    if (pin) ensureBroker();
    return api;
  }

  QW.relayConnect = QW.p2pConnect = (onMessage, onOpen) =>
    (document.getElementById('s-lib') ? hostTransport : playerTransport)(onMessage, onOpen);

  QW.qrDataUrl = (text) => {
    const qr = QWModules.qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    return qr.createDataURL(6, 2);
  };
})();
