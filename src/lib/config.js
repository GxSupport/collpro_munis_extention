/**
 * Sozlamalar: ZK widget id'lari, kutish chegaralari va backend kontrakti.
 *
 * Bu fayl hamma joyda ishlaydi — content script, service worker (importScripts),
 * popup va sozlama sahifasi. Shu sababli faqat konstantalar, hech qanday DOM
 * yoki chrome.* chaqiruvi yo'q (Single Responsibility).
 *
 * Widget id'lari docs/01-munis-forma-tadqiqoti.md §3 dan. Bank DOM'ni
 * o'zgartirsa, shu fayl tahrirlanadi — driver id'larni har chaqiruvda shu
 * yerdan oladi.
 */
(function (root) {
  'use strict';

  const FIELDS = {
    category: 'fcategory_id',
    region: 'fregion',
    district: 'fdistr',
    supplier: 'customer_id',
    account: 'acc_id',
    service: 'aservices_list_id',
    payerName: 'ap_name',
    personalAccount: 'ap_number',
    paymentType: 'apayment_type_id',
    amount: 'aamount',

    caption: 'module_caption',
    payButton: 'btn_pay',
    cancelButton: 'btn_cancel_pay'
  };

  const TIMEOUTS = {
    /** Server javobini kutish (combobox ro'yxati yuklanishi). */
    serverMs: 10000,
    /** Widget paydo bo'lishini kutish (ap_name/ap_number Сервис'dan keyin chiqadi). */
    widgetMs: 10000,
    /** Driver javobini kutish (bridge RPC). */
    rpcMs: 60000,
    /** Backend so'rovi (service worker → CollPro API). */
    apiMs: 20000
  };

  const MSG = {
    toPage: 'ipak-munis:cs',
    fromPage: 'ipak-munis:page'
  };

  /** chrome.storage.local kalitlari. */
  const STORAGE = {
    /** Joriy navbat (ro'yxat + statuslar + tanlangan qator). */
    queue: 'ipakMunisQueue',
    /** Backend manzili: `{ apiBase: 'https://api.trackcoll.uz' }`. */
    settings: 'ipakMunisSettings',
    /** Token va operator: `{ token, operator }`. Faqat service worker o'qiydi. */
    auth: 'ipakMunisAuth',
    /** Yuborilmagan status hisobotlari (kontrakt §4). */
    outbox: 'ipakMunisOutbox'
  };

  /** `normalizeApiBase` shu bo'lak ikki marta yozilib ketmasligini tekshiradi. */
  const PREFIX_HINT = '/api/munis';

  /** CollPro API: yo'llar `apiBase` ustiga qo'shiladi (kontrakt §0). */
  const API = {
    prefix: PREFIX_HINT,
    login: '/auth/login',
    me: '/auth/me',
    batches: '/batches',
    batch: (batchId) => `/batches/${encodeURIComponent(batchId)}`,
    claim: (id) => `/items/${id}/claim`,
    release: (id) => `/items/${id}/release`,
    status: (id) => `/items/${id}/status`
  };

  /**
   * 5xx va tarmoq xatosida qayta urinish oraliqlari, ms (kontrakt §0: 1, 2, 4,
   * 8, 16 s). Outbox shu jadval bo'yicha kechiktiradi.
   */
  const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 16000];

  /**
   * Outbox'ni tarmoq uzilib qolgan holat uchun ham suradigan alarm.
   * `info` ALOHIDA turadi: `chrome.alarms.create(name, info)` ikkinchi
   * argumentda faqat when/delayInMinutes/periodInMinutes'ni qabul qiladi,
   * ortiqcha maydon bo'lsa butun chaqiruv xato bilan uziladi.
   */
  const OUTBOX_ALARM = { name: 'munis-outbox', info: { periodInMinutes: 1 } };

  /**
   * Service worker ↔ content script / popup / options aloqasi
   * (chrome.runtime.sendMessage `type`lari).
   */
  const RPC = {
    state: 'state',
    setApiBase: 'settings:set-api-base',
    login: 'auth:login',
    logout: 'auth:logout',
    listBatches: 'batches:list',
    openBatch: 'batches:open',
    claim: 'items:claim',
    release: 'items:release',
    report: 'items:report',
    flushOutbox: 'outbox:flush',
    clearFailedReports: 'outbox:clear-failed',
    openOptions: 'ui:open-options',
    ping: 'settings:ping'
  };

  /**
   * Server manzilini tekshirib normal holatga keltiradi (oxiridagi `/` olinadi).
   * Faqat HTTPS: token va shaxsiy ma'lumot ochiq kanaldan ketmasligi kerak.
   * Bitta joyda turadi, chunki uni sozlama sahifasi ham, service worker ham
   * ishlatadi (DRY).
   *
   * @throws {Error} operatorga ko'rsatiladigan xabar bilan
   */
  function normalizeApiBase(raw) {
    const base = String(raw || '').trim().replace(/\/+$/, '');

    if (!base) throw new Error('Адрес сервера не указан');

    let url;
    try {
      url = new URL(base);
    } catch (e) {
      throw new Error('Неверный адрес. Пример: https://api.trackcoll.uz');
    }

    if (url.protocol !== 'https:') throw new Error('Адрес должен начинаться с https://');
    if (url.search || url.hash) throw new Error('Адрес не должен содержать ? и #');
    if (url.pathname !== '/' && base.endsWith(PREFIX_HINT)) {
      // `/api/munis` yo'lni o'zimiz qo'shamiz — ikki marta bo'lib ketmasligi uchun.
      throw new Error(`Укажите только адрес сервера, без ${PREFIX_HINT}`);
    }

    return base;
  }

  root.MunisConfig = {
    FIELDS, TIMEOUTS, MSG, STORAGE, API, RETRY_DELAYS_MS, OUTBOX_ALARM, RPC, normalizeApiBase
  };
})(globalThis);
