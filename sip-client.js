/**
 * KES CRM — Browser SIP client (WebRTC)
 *
 * Подключается к нашему Asterisk через WSS, делает click-to-call
 * через SIP-trunk провайдера (Binotel). Голос идёт в браузере.
 *
 * Адаптировано под KES CRM: токен из localStorage['kes_jwt'] (или window.__API__.getToken()),
 * API — тот же origin, эндпоинты /api/sip/token и /api/sip/log.
 *
 * Публичный API:
 *   window.SipClient.init()             — pre-warm UA + регистрация
 *   window.SipClient.call(phone, opts)  — позвонить (opts: {customerId, dealId, contactName})
 *   window.SipClient.hangup()           — завершить активный звонок
 *   window.SipClient.dtmf(digit)        — отправить DTMF тон
 *   window.SipClient.toggleMute()       — мут/анмут микрофона
 *   window.SipClient.state              — getter текущего состояния
 */

(function () {
  'use strict';

  const SIPJS_ESM = 'https://cdn.jsdelivr.net/npm/sip.js@0.21.2/+esm';

  const state = {
    sipjs: null,
    ua: null,
    registerer: null,
    session: null,
    creds: null,
    state: 'idle',
    muted: false,
    callMeta: null,
    audioEl: null,
  };

  function authToken() {
    try {
      if (window.__API__ && typeof window.__API__.getToken === 'function') {
        const t = window.__API__.getToken();
        if (t) return t;
      }
    } catch (_) {}
    try { return localStorage.getItem('kes_jwt'); } catch (_) { return null; }
  }

  // ──────────────────────────────────────────────────────────────
  // INIT
  // ──────────────────────────────────────────────────────────────

  async function loadSipJs() {
    if (state.sipjs) return state.sipjs;
    if (typeof window.SIP !== 'undefined') {
      state.sipjs = window.SIP;
      return state.sipjs;
    }
    try {
      const mod = await import(SIPJS_ESM);
      state.sipjs = mod;
      window.SIP = mod;
      return state.sipjs;
    } catch (e) {
      console.error('[sip] ESM import failed:', e);
      throw new Error('failed_to_load_sipjs');
    }
  }

  async function fetchCreds() {
    const token = authToken();
    if (!token) throw new Error('not_authenticated');
    const resp = await fetch('/api/sip/token', {
      headers: { 'Authorization': 'Bearer ' + token },
    });
    if (!resp.ok) {
      const j = await resp.json().catch(() => ({}));
      throw new Error(j.error || ('http_' + resp.status));
    }
    return await resp.json();
  }

  async function init() {
    if (state.state !== 'idle' && state.state !== 'error') return;

    // Сначала проверяем, что SIP настроен на сервере. Если 503/401 — тихо выходим.
    let creds;
    try {
      creds = await fetchCreds();
    } catch (e) {
      return; // state остаётся 'idle' — UI не показываем
    }

    setState('connecting');

    try {
      const SIP = await loadSipJs();
      state.creds = creds;

      if (!state.audioEl) {
        state.audioEl = document.createElement('audio');
        state.audioEl.autoplay = true;
        state.audioEl.style.display = 'none';
        document.body.appendChild(state.audioEl);
      }

      const uri = SIP.UserAgent.makeURI(`sip:${creds.user}@${creds.domain}`);
      if (!uri) throw new Error('invalid_uri');

      state.ua = new SIP.UserAgent({
        uri,
        authorizationUsername: creds.user,
        authorizationPassword: creds.password,
        displayName: creds.display_name || creds.user,
        transportOptions: {
          server: creds.wss,
          reconnectionAttempts: 100,
          reconnectionDelay: 4,
          keepAliveInterval: 30,
        },
        sessionDescriptionHandlerFactoryOptions: {
          peerConnectionConfiguration: {
            iceServers: creds.iceServers || [],
            iceTransportPolicy: 'all',
          },
        },
        logBuiltinEnabled: false,
        delegate: {
          onInvite: (invitation) => onIncomingCall(invitation),
        },
      });

      state.ua.transport.stateChange.addListener((newState) => {
        if (newState === SIP.TransportState.Connected) {
          if (state.registerer && state.registerer.state !== SIP.RegistererState.Registered) {
            state.registerer.register().catch(() => {});
          }
        }
      });

      await state.ua.start();

      state.registerer = new SIP.Registerer(state.ua);
      state.registerer.stateChange.addListener((s) => {
        if (s === SIP.RegistererState.Registered) {
          setState('registered');
        } else if (s === SIP.RegistererState.Unregistered) {
          if (state.state === 'registered') setState('reconnecting');
        }
      });
      await state.registerer.register();

      installResilienceHandlers();
    } catch (e) {
      console.error('[sip] init failed:', e);
      setState('error', e.message);
      throw e;
    }
  }

  // ──────────────────────────────────────────────────────────────
  // Auto-reconnect (sleep/смена сети/health-check)
  // ──────────────────────────────────────────────────────────────
  function installResilienceHandlers() {
    if (state._resilienceInstalled) return;
    state._resilienceInstalled = true;

    const tryReconnect = (source) => {
      if (!state.ua || !state.registerer || !state.sipjs) return;
      const SIP = state.sipjs;
      const transportConnected = state.ua.transport.state === SIP.TransportState.Connected;
      const registered = state.registerer.state === SIP.RegistererState.Registered;
      if (transportConnected && registered) return;
      const now = Date.now();
      if (state._lastReconnect && (now - state._lastReconnect) < 10000) return;
      state._lastReconnect = now;
      (async () => {
        try {
          if (!transportConnected) await state.ua.reconnect();
          if (!registered) await state.registerer.register();
        } catch (e) {
          try { await state.ua.stop().catch(() => {}); } catch (_) {}
          state.ua = null;
          state.registerer = null;
          state.state = 'idle';
          init().catch(err => console.error('[sip] hard reinit failed:', err));
        }
      })();
    };

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') tryReconnect('visibilitychange');
    });
    window.addEventListener('online', () => tryReconnect('online'));
    if (state._healthCheckInterval) clearInterval(state._healthCheckInterval);
    state._healthCheckInterval = setInterval(() => {
      if (state.state === 'in_call' || state.state === 'calling' || state.state === 'ringing') return;
      tryReconnect('healthcheck');
    }, 60000);
  }

  // ──────────────────────────────────────────────────────────────
  // OUTGOING CALL
  // ──────────────────────────────────────────────────────────────

  async function call(phone, opts) {
    if (!phone) throw new Error('phone_required');
    if (state.state === 'in_call' || state.state === 'calling') throw new Error('already_in_call');

    if (state.state === 'idle' || state.state === 'error') await init();

    const isReady = () => state.state === 'registered' || state.state === 'reconnecting';
    if (!isReady()) {
      for (let i = 0; i < 50; i++) { await new Promise(r => setTimeout(r, 100)); if (isReady()) break; }
    }
    if (!isReady() && state.registerer && state.sipjs) {
      try {
        await state.registerer.register();
        for (let i = 0; i < 30; i++) { await new Promise(r => setTimeout(r, 100)); if (isReady()) break; }
      } catch (e) {}
    }
    if (!isReady()) {
      try { if (state.ua) await state.ua.stop(); } catch (_) {}
      state.ua = null; state.registerer = null; state.state = 'idle';
      await init();
      for (let i = 0; i < 50; i++) { await new Promise(r => setTimeout(r, 100)); if (isReady()) break; }
    }
    if (!isReady()) throw new Error('not_registered');

    const SIP = state.sipjs;
    const digits = String(phone).replace(/[^\d]/g, '');
    const target = SIP.UserAgent.makeURI(`sip:${digits}@${state.creds.domain}`);
    if (!target) throw new Error('invalid_target');

    const callId = (crypto.randomUUID ? crypto.randomUUID() : 'c' + Date.now() + Math.random().toString(16).slice(2));

    state.callMeta = {
      phone: digits,
      customerId: opts && opts.customerId || null,
      dealId: opts && opts.dealId || null,
      contactName: (opts && opts.contactName) || digits,
      startedAt: Date.now(),
      callId,
    };

    state.session = new SIP.Inviter(state.ua, target, {
      sessionDescriptionHandlerOptions: { constraints: { audio: true, video: false } },
      extraHeaders: ['X-KES-Call-Id: ' + callId],
    });

    setupSessionHandlers(state.session);
    setState('calling');

    try {
      await state.session.invite();
    } catch (e) {
      const msg = String((e && e.message) || e || '');
      const benign = /peer connection closed|request terminated|canceled|cancelled|dialog\b|terminated/i.test(msg);
      state.session = null;
      state.callMeta = null;
      if (benign) {
        setState(state.registerer && state.sipjs && state.registerer.state === state.sipjs.RegistererState.Registered ? 'registered' : 'connecting');
        return;
      }
      setState('error', msg);
      throw e;
    }
  }

  function onIncomingCall(invitation) {
    if (state.session) { invitation.reject().catch(() => {}); return; }
    state.session = invitation;
    state.callMeta = {
      phone: (invitation.remoteIdentity && invitation.remoteIdentity.uri && invitation.remoteIdentity.uri.user) || '?',
      contactName: (invitation.remoteIdentity && invitation.remoteIdentity.displayName) || (invitation.remoteIdentity && invitation.remoteIdentity.uri && invitation.remoteIdentity.uri.user) || 'Неизвестный',
      incoming: true,
      startedAt: Date.now(),
    };
    setupSessionHandlers(invitation);
    setState('ringing');
  }

  function setupSessionHandlers(session) {
    const SIP = state.sipjs;
    session.stateChange.addListener((s) => {
      if (s === SIP.SessionState.Established) {
        attachRemoteStream(session);
        state.callMeta.startedAt = Date.now();
        setState('in_call');
      } else if (s === SIP.SessionState.Terminated) {
        state.session = null;
        const meta = state.callMeta;
        state.callMeta = null;
        state.muted = false;
        setState(state.registerer && state.registerer.state === SIP.RegistererState.Registered ? 'registered' : 'connecting');
        if (meta && meta.phone) logCallEnded(meta).catch(() => {});
      }
    });
  }

  function attachRemoteStream(session) {
    try {
      const pc = session.sessionDescriptionHandler && session.sessionDescriptionHandler.peerConnection;
      if (!pc) return;
      const stream = new MediaStream();
      pc.getReceivers().forEach((r) => { if (r.track && r.track.kind === 'audio') stream.addTrack(r.track); });
      state.audioEl.srcObject = stream;
    } catch (e) {}
  }

  async function answer() {
    if (!state.session || state.state !== 'ringing') return;
    try {
      await state.session.accept({ sessionDescriptionHandlerOptions: { constraints: { audio: true, video: false } } });
    } catch (e) { console.error('[sip] answer failed:', e); }
  }

  async function hangup() {
    const s = state.session;
    if (s) {
      try {
        const SIP = state.sipjs;
        if (SIP && SIP.SessionState) {
          if (s.state === SIP.SessionState.Initial || s.state === SIP.SessionState.Establishing) {
            if (s.cancel) await s.cancel(); else if (s.reject) await s.reject();
          } else if (s.state === SIP.SessionState.Established) {
            await s.bye();
          }
        } else if (s.bye) { await s.bye(); }
      } catch (e) {}
    }
    state.session = null;
    state.callMeta = null;
    state.muted = false;
    state._autoMinScheduled = false;
    try {
      const SIP = state.sipjs;
      const isReg = state.registerer && SIP && SIP.RegistererState && state.registerer.state === SIP.RegistererState.Registered;
      setState(isReg ? 'registered' : 'connecting');
    } catch (_) { setState('idle'); }
  }

  function toggleMute() {
    if (!state.session) return;
    try {
      const pc = state.session.sessionDescriptionHandler && state.session.sessionDescriptionHandler.peerConnection;
      if (!pc) return;
      pc.getSenders().forEach((s) => { if (s.track && s.track.kind === 'audio') s.track.enabled = state.muted; });
      state.muted = !state.muted;
      renderUi();
    } catch (e) {}
  }

  function dtmf(digit) {
    if (!state.session) return;
    try { state.session.sessionDescriptionHandler && state.session.sessionDescriptionHandler.sendDtmf(String(digit)); } catch (e) {}
  }

  // ──────────────────────────────────────────────────────────────
  // STATE
  // ──────────────────────────────────────────────────────────────
  function setState(s, errMsg) {
    state.state = s;
    if (errMsg) state.errMsg = errMsg;
    renderUi();
    if (typeof state.onStateChange === 'function') state.onStateChange(s);
  }

  // ──────────────────────────────────────────────────────────────
  // LOG CALL → CRM
  // ──────────────────────────────────────────────────────────────
  async function logCallEnded(meta) {
    try {
      const token = authToken();
      const durationSec = Math.round((Date.now() - meta.startedAt) / 1000);
      await fetch('/api/sip/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({
          call_id: meta.callId || null,
          phone: meta.phone,
          customer_id: meta.customerId,
          deal_id: meta.dealId,
          incoming: !!meta.incoming,
          duration_sec: durationSec,
          contact_name: meta.contactName,
        }),
      });
    } catch (_) {}
  }

  // ──────────────────────────────────────────────────────────────
  // UI — floating bottom-bar + dialer overlay
  // ──────────────────────────────────────────────────────────────
  let uiEl;
  function ensureUi() {
    if (uiEl) return uiEl;
    uiEl = document.createElement('div');
    uiEl.id = 'sip-ui';
    uiEl.innerHTML = `
      <div class="sip-bar" id="sip-bar" style="display:none">
        <span class="sip-bar-dot"></span>
        <span class="sip-bar-text">—</span>
        <span class="sip-bar-timer" id="sip-bar-timer" style="display:none">0:00</span>
        <button class="sip-bar-hangup" id="sip-bar-hangup" style="display:none" title="Завершить">✕</button>
      </div>
      <div class="sip-overlay" id="sip-overlay" style="display:none">
        <div class="sip-overlay-card">
          <div class="sip-overlay-state" id="sip-overlay-state">—</div>
          <div class="sip-overlay-name" id="sip-overlay-name">—</div>
          <div class="sip-overlay-phone" id="sip-overlay-phone">—</div>
          <div class="sip-overlay-timer" id="sip-overlay-timer" style="display:none">0:00</div>
          <div class="sip-dtmf-pad" id="sip-dtmf-pad" style="display:none">
            <div class="sip-dtmf-display-row">
              <div class="sip-dtmf-display" id="sip-dtmf-display"></div>
              <button class="sip-dtmf-clear" id="sip-dtmf-clear" title="Очистить дисплей">×</button>
            </div>
            <div class="sip-dtmf-grid">
              ${['1','2','3','4','5','6','7','8','9','*','0','#'].map(d => `<button class="sip-dtmf-key" data-digit="${d}">${d}</button>`).join('')}
            </div>
          </div>
          <div class="sip-overlay-actions">
            <button class="sip-btn sip-btn-mute" id="sip-btn-mute" title="Mute">🎙</button>
            <button class="sip-btn sip-btn-dtmf" id="sip-btn-dtmf" title="Набор цифр (DTMF)">🔢</button>
            <button class="sip-btn sip-btn-min" id="sip-btn-min" title="Свернуть">−</button>
            <button class="sip-btn sip-btn-hangup-overlay" id="sip-btn-hangup-overlay" title="Положить трубку">📵</button>
            <button class="sip-btn sip-btn-answer" id="sip-btn-answer" style="display:none" title="Ответить">📞</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(uiEl);

    document.getElementById('sip-bar-hangup').onclick = hangup;
    document.getElementById('sip-btn-hangup-overlay').onclick = hangup;
    document.getElementById('sip-btn-mute').onclick = toggleMute;
    document.getElementById('sip-btn-answer').onclick = answer;
    document.getElementById('sip-btn-min').onclick = () => { document.getElementById('sip-overlay').style.display = 'none'; };
    document.getElementById('sip-overlay').onclick = (e) => { if (e.target.id === 'sip-overlay') e.currentTarget.style.display = 'none'; };

    const dtmfBtn = document.getElementById('sip-btn-dtmf');
    const dtmfPad = document.getElementById('sip-dtmf-pad');
    const dtmfDisplay = document.getElementById('sip-dtmf-display');
    dtmfBtn.onclick = () => {
      const willShow = dtmfPad.style.display === 'none';
      dtmfPad.style.display = willShow ? 'block' : 'none';
      dtmfBtn.classList.toggle('sip-btn-active', willShow);
      if (willShow) dtmfDisplay.textContent = '';
    };
    dtmfPad.querySelectorAll('.sip-dtmf-key').forEach(key => {
      key.onclick = () => { const d = key.dataset.digit; dtmf(d); dtmfDisplay.textContent = (dtmfDisplay.textContent + d).slice(-12); };
    });
    document.getElementById('sip-dtmf-clear').onclick = () => { dtmfDisplay.textContent = ''; };
    document.getElementById('sip-bar').onclick = (e) => {
      if (e.target.id === 'sip-bar-hangup') return;
      document.getElementById('sip-overlay').style.display = 'flex';
    };
    return uiEl;
  }

  let timerInterval;
  function renderUi() {
    ensureUi();
    const bar = document.getElementById('sip-bar');
    const overlay = document.getElementById('sip-overlay');
    const barText = bar.querySelector('.sip-bar-text');
    const barTimer = document.getElementById('sip-bar-timer');
    const barHangup = document.getElementById('sip-bar-hangup');

    const labels = {
      idle: { txt: '—', cls: 'idle', show: false },
      connecting: { txt: 'Подключаемся…', cls: 'connecting', show: true },
      registered: { txt: 'Готов к звонкам', cls: 'ready', show: true },
      calling: { txt: 'Соединяемся…', cls: 'calling', show: true },
      ringing: { txt: 'Входящий звонок', cls: 'ringing', show: true },
      in_call: { txt: 'Разговор', cls: 'in-call', show: true },
      reconnecting: { txt: 'Переподключение…', cls: 'connecting', show: true },
      error: { txt: '', cls: 'error', show: false },
    };
    const l = labels[state.state] || labels.idle;
    bar.style.display = l.show ? 'flex' : 'none';
    bar.className = 'sip-bar sip-bar-' + l.cls;
    barText.textContent = l.txt;

    const showOverlay = state.state === 'ringing' || state.state === 'in_call' || state.state === 'calling';
    if (showOverlay && state.callMeta) {
      overlay.style.display = 'flex';
      document.getElementById('sip-overlay-state').textContent = l.txt;
      document.getElementById('sip-overlay-name').textContent = state.callMeta.contactName || '—';
      document.getElementById('sip-overlay-phone').textContent = '+' + (state.callMeta.phone || '');
      if (state.state === 'in_call' && !state._autoMinScheduled) {
        state._autoMinScheduled = true;
        setTimeout(() => { if (state.state === 'in_call') overlay.style.display = 'none'; }, 700);
      }
    } else {
      overlay.style.display = 'none';
      state._autoMinScheduled = false;
    }

    const muteBtn = document.getElementById('sip-btn-mute');
    if (muteBtn) muteBtn.classList.toggle('sip-btn-active', state.muted);
    document.getElementById('sip-btn-answer').style.display = state.state === 'ringing' ? 'inline-flex' : 'none';

    if (state.state === 'in_call') {
      barTimer.style.display = '';
      barHangup.style.display = '';
      if (!timerInterval) { timerInterval = setInterval(updateTimer, 1000); updateTimer(); }
    } else {
      barTimer.style.display = 'none';
      barHangup.style.display = state.state === 'calling' || state.state === 'ringing' ? '' : 'none';
      if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
    }
  }

  function updateTimer() {
    if (!state.callMeta) return;
    const sec = Math.floor((Date.now() - state.callMeta.startedAt) / 1000);
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    const text = m + ':' + String(s).padStart(2, '0');
    const el1 = document.getElementById('sip-bar-timer');
    const el2 = document.getElementById('sip-overlay-timer');
    if (el1) el1.textContent = text;
    if (el2) { el2.textContent = text; el2.style.display = ''; }
  }

  // ──────────────────────────────────────────────────────────────
  // PUBLIC API
  // ──────────────────────────────────────────────────────────────
  window.SipClient = {
    init,
    call,
    hangup,
    answer,
    toggleMute,
    dtmf,
    get state() { return state.state; },
    get isReady() { return state.state === 'registered' || state.state === 'in_call'; },
  };

  window.placeCall = async function (opts) {
    try { await window.SipClient.call(opts.phone, opts); }
    catch (e) { alert('Не удалось позвонить: ' + (e.message || e)); }
  };
})();
