/**
 * Popup: login/logout, navbat holati va bank sahifasini ochish.
 * Asosiy ish sahifadagi panelda — bu yerda faqat kirish va nazorat.
 *
 * Parol shu yerdan service worker'ga uzatiladi va hech qayerda saqlanmaydi;
 * token ham faqat service worker tomonida (bank sahifasida emas).
 */
(function () {
  'use strict';

  const { STORAGE, RPC } = globalThis.MunisConfig;
  const BANK_URL = 'https://e-bank.ipakyulibank.uz/';

  const LABELS = {
    pending: 'Ожидает',
    filled: 'Заполнено',
    submitting: 'Отправлено',
    paid: 'Оплачено',
    error: 'Ошибка',
    skipped: 'Пропущено',
    locked: 'У другого'
  };

  const el = (id) => document.getElementById(id);
  /**
   * Service worker'ga so'rov. Extension yangilangan yoki worker ro'yxatdan
   * o'tmagan bo'lsa `sendMessage` reject qiladi — usha holda popup bo'm-bo'sh
   * ochilib qolmasligi uchun xatoni javob shaklida qaytaramiz.
   */
  async function send(type, payload = {}) {
    try {
      return await chrome.runtime.sendMessage({ type, ...payload });
    } catch (error) {
      return { ok: false, error: 'extension_unavailable', message: 'Расширение перезагружено — закройте и откройте это окно' };
    }
  }

  function show(view) {
    for (const name of ['setup', 'login', 'status']) {
      el(`view-${name}`).hidden = name !== view;
    }
  }

  function notify(message, kind = 'bad') {
    const box = el('alert');
    box.textContent = message || '';
    box.className = `box ${kind}`;
    box.hidden = !message;
  }

  async function renderQueue() {
    const stored = await chrome.storage.local.get(STORAGE.queue);
    const queue = stored[STORAGE.queue];
    const stats = el('stats');
    stats.innerHTML = '';

    if (!queue) {
      el('batch').textContent = 'Список не выбран';

      return;
    }

    el('batch').textContent = `${queue.title || queue.batch_id} · ${queue.items.length} платежей`
      + (queue.source === 'file' ? ' (офлайн-файл)' : '');

    for (const [status, label] of Object.entries(LABELS)) {
      const count = queue.items.filter((item) => item.status === status).length;
      if (!count) continue;
      const dt = document.createElement('dt');
      const dd = document.createElement('dd');
      dt.textContent = label;
      dd.textContent = count;
      stats.append(dt, dd);
    }
  }

  function renderOutbox(outbox) {
    const box = el('outbox');

    if (!outbox || (!outbox.pending && !outbox.failed)) {
      box.hidden = true;

      return;
    }

    const parts = [];
    if (outbox.pending) parts.push(`не отправлено в CollPro: ${outbox.pending}`);
    if (outbox.failed) parts.push(`не принято: ${outbox.failed}`);
    if (outbox.blocked) parts.push(`причина: ${outbox.blocked}`);

    box.textContent = parts.join(' · ');
    box.className = `box ${outbox.blocked || outbox.failed ? 'bad' : 'info'}`;
    box.hidden = false;
  }

  async function render() {
    const result = await send(RPC.state, { verify: true });

    if (!result || !result.ok) {
      notify((result && result.message) || 'Расширение не ответило');

      return;
    }

    const state = result.data;

    el('who').textContent = state.operator ? state.operator.name : '';
    el('logout').hidden = !state.loggedIn;
    renderOutbox(state.outbox);

    if (!state.apiBase || !state.hasPermission) {
      notify(null);
      show('setup');

      return;
    }

    if (!state.loggedIn) {
      el('server-note').textContent = state.apiBase;
      notify(state.error || null);
      show('login');
      el('login').focus();

      return;
    }

    notify(null);
    show('status');
    await renderQueue();
  }

  el('login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = el('login-submit');
    button.disabled = true;
    button.textContent = 'Вхожу…';
    notify(null);

    const result = await send(RPC.login, {
      login: el('login').value.trim(),
      password: el('password').value
    });

    button.disabled = false;
    button.textContent = 'Войти';

    if (!result || !result.ok) {
      notify((result && result.message) || 'Не удалось войти');

      return;
    }

    el('password').value = '';
    // Kirgandan keyin yuborilmagan hisobotlar bo'lsa — darhol ketadi.
    await send(RPC.flushOutbox);
    await render();
  });

  el('logout').addEventListener('click', async () => {
    await send(RPC.logout);
    await render();
  });

  el('options').addEventListener('click', () => chrome.runtime.openOptionsPage());

  el('open').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ url: `${BANK_URL}*` });
    if (tab) {
      await chrome.tabs.update(tab.id, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
    } else {
      await chrome.tabs.create({ url: BANK_URL });
    }
    window.close();
  });

  render();
})();
