/**
 * Service worker — extension'ning backend bilan gaplashadigan yagona joyi.
 *
 * Sabab: token bank sahifasiga tushmasligi kerak, so'rovlar extension
 * origin'idan ketsa CORS kerak emas (kontrakt §0), va MV3'da service worker
 * o'lib qayta tirilsa ham holat diskda qoladi.
 *
 * Panel/popup bu yerga faqat `chrome.runtime.sendMessage({type, ...})` orqali
 * murojaat qiladi — RPC nomlari MunisConfig.RPC'da.
 */
importScripts('/src/lib/config.js', '/src/bg/api.js', '/src/bg/outbox.js');

(function (root) {
  'use strict';

  const { RPC, API, OUTBOX_ALARM } = root.MunisConfig;
  const api = root.MunisApi;
  const outbox = root.MunisOutbox;

  /** Popup/panel uchun umumiy holat: nima sozlangan, kim kirgan, nima yuborilmagan. */
  async function state({ verify = false } = {}) {
    const { apiBase } = await api.getSettings();
    const { token, operator } = await api.getAuth();
    const hasPermission = await api.hasHostPermission(apiBase);

    const result = {
      apiBase,
      hasPermission,
      loggedIn: !!token,
      operator: operator || null,
      outbox: await outbox.summary()
    };

    // Popup ochilganda tokenni haqiqatda tekshirish (kontrakt §1).
    if (verify && token && apiBase && hasPermission) {
      const me = await api.me();
      if (me.ok) {
        result.operator = me.data.operator;
        await api.setAuth(token, me.data.operator);
      } else {
        result.loggedIn = me.status !== 401 && me.error !== 'unauthenticated';
        result.error = me.message;
        if (!result.loggedIn) result.operator = null;
      }
    }

    return { ok: true, data: result };
  }

  async function setApiBase({ apiBase }) {
    try {
      const saved = await api.setApiBase(apiBase);

      return { ok: true, data: { apiBase: saved, hasPermission: await api.hasHostPermission(saved) } };
    } catch (error) {
      return { ok: false, error: 'invalid_api_base', message: error.message };
    }
  }

  /**
   * Sozlama sahifasi uchun aloqa tekshiruvi: tokensiz `GET /auth/me`.
   * Server va yo'l joyida bo'lsa 401 qaytadi — bizga shuning o'zi kifoya.
   */
  async function ping() {
    const result = await api.request(API.me, { auth: false });

    if (result.ok || result.status === 401) return { ok: true, data: { reachable: true } };

    return result;
  }

  /**
   * Ro'yxatni ochish: backend javobi panelga o'zi shaklda qaytariladi —
   * navbatga aylantirish queue.js'ning ishi (bitta joyda bitta mas'uliyat).
   */
  async function openBatch({ batch_id: batchId }) {
    const result = await api.showBatch(batchId);
    if (!result.ok) return result;

    const { operator } = await api.getAuth();

    return { ok: true, data: { ...result.data, operator } };
  }

  /** Hisobot: diskka yozilib, fon rejimida yuboriladi (outbox.js). */
  async function report({ id, batch_id: batchId, payload }) {
    const queued = await outbox.enqueue(id, batchId, payload);

    return { ok: true, data: queued };
  }

  const handlers = {
    [RPC.state]: state,
    [RPC.setApiBase]: setApiBase,
    [RPC.login]: ({ login, password }) => api.login({ login, password }),
    [RPC.logout]: () => api.logout(),
    [RPC.listBatches]: () => api.listBatches(),
    [RPC.openBatch]: openBatch,
    [RPC.claim]: ({ id }) => api.claim(id),
    [RPC.release]: ({ id }) => api.release(id),
    [RPC.report]: report,
    [RPC.flushOutbox]: async () => ({ ok: true, data: await outbox.drain() }),
    [RPC.clearFailedReports]: async () => {
      await outbox.clearFailed();

      return { ok: true, data: await outbox.summary() };
    },
    // Content script chrome.runtime.openOptionsPage()ni chaqira olmaydi.
    [RPC.ping]: ping,
    [RPC.openOptions]: async () => {
      await chrome.runtime.openOptionsPage();

      return { ok: true, data: {} };
    }
  };

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const handler = message && handlers[message.type];

    if (!handler) {
      sendResponse({ ok: false, error: 'unknown_command', message: `Неизвестная команда: ${message && message.type}` });

      return false;
    }

    // Har doim {ok, data} yoki {ok:false, error, message} qaytadi — chaqiruvchi
    // tomonda try/catch shart emas.
    Promise.resolve(handler(message))
      .then((result) => sendResponse(result))
      .catch((error) => {
        console.error('[munis]', message.type, error);
        sendResponse({ ok: false, error: 'extension_error', message: error.message });
      });

    return true; // javob asinxron
  });

  // Tarmoq qaytganda / brauzer qayta ochilganda yuborilmagan hisobotlar ketadi.
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === OUTBOX_ALARM.name) outbox.drain();
  });

  chrome.runtime.onStartup.addListener(() => {
    chrome.alarms.create(OUTBOX_ALARM.name, OUTBOX_ALARM.info);
    outbox.drain();
  });

  chrome.runtime.onInstalled.addListener(() => {
    chrome.alarms.create(OUTBOX_ALARM.name, OUTBOX_ALARM.info);
    outbox.drain();
  });
})(globalThis);
