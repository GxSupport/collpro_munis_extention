/**
 * Sozlama sahifasi: CollPro server manzili + Chrome host ruxsati.
 *
 * MV3'da extension faqat ruxsat berilgan manzilga so'rov yubora oladi.
 * Manzil har o'rnatishda boshqa bo'lishi mumkin, shuning uchun manifest'da
 * `optional_host_permissions` turadi va ruxsat shu yerda, tugma bosilganda
 * so'raladi — `chrome.permissions.request()` faqat foydalanuvchi harakatidan
 * chaqirilishi mumkin, shu sababli so'rov birinchi, saqlash keyin.
 */
(function () {
  'use strict';

  const { RPC, normalizeApiBase } = globalThis.MunisConfig;

  const el = (id) => document.getElementById(id);
  const send = (type, payload = {}) => chrome.runtime.sendMessage({ type, ...payload });

  function message(kind, text) {
    el('error').hidden = kind !== 'error';
    el('done').hidden = kind !== 'done';
    if (kind === 'error') el('error').textContent = text;
    if (kind === 'done') el('done').textContent = text;
  }

  async function renderState() {
    const result = await send(RPC.state);
    if (!result || !result.ok) return message('error', (result && result.message) || 'Расширение не ответило');

    const state = result.data;

    el('api-base').value = state.apiBase || '';
    el('state-base').textContent = state.apiBase || '—';
    el('state-permission').textContent = state.apiBase
      ? (state.hasPermission ? 'выдано' : 'НЕ выдано — нажмите «Сохранить и разрешить доступ»')
      : '—';
    el('state-operator').textContent = state.operator ? state.operator.name : 'не вошёл';
  }

  el('save').addEventListener('click', async () => {
    let base;
    try {
      base = normalizeApiBase(el('api-base').value);
    } catch (error) {
      return message('error', error.message);
    }

    message(null);
    el('save').disabled = true;

    try {
      // Foydalanuvchi harakati hali "issiq" — avval ruxsat so'raladi.
      const granted = await chrome.permissions.request({ origins: [`${base}/*`] });

      if (!granted) {
        return message('error', 'Разрешение не выдано — расширение не сможет обращаться к серверу.');
      }

      const saved = await send(RPC.setApiBase, { apiBase: base });
      if (!saved || !saved.ok) return message('error', (saved && saved.message) || 'Не удалось сохранить адрес');

      const ping = await send(RPC.ping);
      await renderState();

      message('done', ping && ping.ok
        ? 'Адрес сохранён, связь с сервером есть. Теперь войдите через значок расширения.'
        : `Адрес сохранён, но сервер не ответил: ${(ping && ping.message) || 'нет связи'}`);
    } finally {
      el('save').disabled = false;
    }
  });

  el('check').addEventListener('click', async () => {
    message(null);
    el('check').disabled = true;

    try {
      const ping = await send(RPC.ping);

      message(ping && ping.ok ? 'done' : 'error', ping && ping.ok
        ? 'Связь с сервером CollPro есть.'
        : (ping && ping.message) || 'Нет связи с сервером');
    } finally {
      el('check').disabled = false;
      await renderState();
    }
  });

  renderState();
})();
