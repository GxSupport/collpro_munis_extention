/**
 * To'lovlar navbati — chrome.storage.local'da saqlanadi, sahifa yangilansa
 * ham ish to'xtagan joyidan davom etadi.
 *
 * Ikki manba bor, ikkalasi ham bir xil shaklga keltiriladi (Adapter):
 *   `fromApi()`  — CollPro `GET /api/munis/batches/{id}` javobi (asosiy oqim);
 *   `fromJson()` — fayl (zaxira: backend ishlamasa yoki sinov uchun).
 *
 * Fayldan olingan navbatda `source: 'file'` — unda statuslar backendga
 * yuborilmaydi, chunki backendda bunday qatorlar yo'q.
 */
(function (root) {
  'use strict';

  const { STORAGE } = root.MunisConfig;

  const REQUIRED = [
    'category', 'region', 'district', 'supplier_code', 'account',
    'service', 'payer_name', 'payment_type', 'personal_account', 'amount'
  ];

  /**
   * pending    — hali to'ldirilmagan
   * filled     — forma to'ldirildi, operator imzolashi kutilmoqda
   * submitting — operator "Оплатить"ni bosdi, natija kutilmoqda
   * paid       — to'landi (yakuniy holat)
   * error      — xato (bank xabari `bank_message`da)
   * skipped    — operator o'tkazib yubordi
   * locked     — boshqa operator ishlayapti (faqat API navbatida, ko'rsatish uchun)
   */
  const STATUSES = ['pending', 'filled', 'submitting', 'paid', 'error', 'skipped', 'locked'];

  /** Backend faqat shu statuslarni qabul qiladi (kontrakt §4). */
  const REPORTABLE = ['submitting', 'paid', 'error', 'skipped'];

  /** Backend statusi → mahalliy status (kontrakt §3 status jadvali). */
  function fromRemoteStatus(remote, claimedById, operatorId) {
    if (remote === 'claimed') {
      // O'zimiz band qilgan bo'lsak — qaytadan to'ldirish mumkin (claim uzayadi).
      return claimedById && claimedById === operatorId ? 'pending' : 'locked';
    }
    return STATUSES.includes(remote) ? remote : 'pending';
  }

  /**
   * "94377.26" / 94377.26 / "94 377,26" / "1 234,56" / "1,234.56" → "94377.26".
   *
   * Ajratgichlarni hammasini olib tashlaydi: bu funksiya bank widget'idan
   * O'QILGAN qiymatni ham normallashtiradi (`findByValues`), va agar bank
   * mingliklarni ajratib chiqarsa, bitta vergulni almashtirish `1.234.56`
   * hosil qilib, qator topilmay qoladi — pul ketib, hisobot yozilmaydi.
   */
  function normalizeAmount(raw) {
    let text = String(raw ?? '').replace(/[\s\u00a0\u202f']/g, '');

    if (text.includes(',') && text.includes('.')) {
      // Oxirgi ajratgich — kasr, qolganlari mingliklar.
      const decimal = Math.max(text.lastIndexOf(','), text.lastIndexOf('.'));
      text = text.slice(0, decimal).replace(/[,.]/g, '') + '.' + text.slice(decimal + 1);
    } else if ((text.match(/,/g) || []).length > 1) {
      text = text.replace(/,/g, '');
    } else {
      text = text.replace(',', '.');
    }

    if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;

    const [whole, fraction = ''] = text.split('.');

    return `${whole}.${fraction.padEnd(2, '0')}`;
  }

  function payment(state, item) {
    return { ...state.defaults, ...item };
  }

  /** Navbat backend bilan sinxronlanadimi (fayl navbatida — yo'q). */
  function isRemote(state) {
    return !!state && state.source === 'api';
  }

  /**
   * Umumiy qism: ikkala manba uchun ham bir xil tekshiruv.
   *
   * `strict = true` (fayl) — bitta xato butun faylni rad etadi, operator faylni
   * tuzatib qayta yuklaydi.
   * `strict = false` (API) — yaroqsiz qator CHETGA surib qo'yiladi (`error`),
   * qolganlari ishlanadi: 1000 qatorlik ro'yxat bitta buzuq satr uchun butunlay
   * bloklanmasligi kerak.
   *
   * @return {{items: Array, invalid: Array<string>}}
   */
  function buildItems(rawItems, defaults, mapItem, strict) {
    const errors = [];
    const seen = new Set();

    const items = rawItems.map((raw, index) => {
      const item = { ...raw, personal_account: String(raw.personal_account ?? '').trim() };
      const amount = normalizeAmount(raw.amount);
      const merged = { ...defaults, ...item };
      const row = `Строка ${index + 1}`;
      const problems = [];

      if (!amount) problems.push(`неверная сумма «${raw.amount}»`);
      for (const key of REQUIRED) {
        if (key !== 'amount' && !String(merged[key] ?? '').trim()) problems.push(`нет поля ${key}`);
      }

      const key = `${item.personal_account}|${amount}`;
      if (seen.has(key)) problems.push('дубликат (лицевой счёт + сумма)');
      seen.add(key);

      for (const problem of problems) errors.push(`${row}: ${problem}`);

      const mapped = mapItem(item, amount ?? String(raw.amount ?? ''), index);

      if (!problems.length) return mapped;

      // Yaroqsiz qator: to'ldirib bo'lmaydi, sababi panelda ko'rinadi.
      return { ...mapped, status: 'error', unusable: true, bank_message: problems.join('; ') };
    });

    if (strict && errors.length) throw new Error(errors.slice(0, 10).join('\n'));

    return { items, invalid: errors };
  }

  /** Faylni tekshirib navbatga aylantiradi. Xato bo'lsa hammasi rad etiladi. */
  function fromJson(data) {
    if (!data || !Array.isArray(data.items) || !data.items.length) {
      throw new Error('В файле нет списка items');
    }

    const defaults = data.defaults || {};
    const { items } = buildItems(data.items, defaults, (item, amount, index) => ({
      ...item,
      id: item.id ?? index + 1,
      amount,
      status: 'pending',
      bank_message: null,
      updated_at: null
    }), true);

    return {
      source: 'file',
      batch_id: data.batch_id || `batch-${Date.now()}`,
      title: data.title || null,
      defaults,
      items,
      current: 0,
      imported_at: new Date().toISOString()
    };
  }

  /**
   * `GET /batches/{batch_id}` javobini navbatga aylantiradi.
   * `id` — backend item id'si, keyingi hamma so'rov shu id bilan ketadi.
   */
  function fromApi(data, operatorId) {
    if (!data || !Array.isArray(data.items) || !data.items.length) {
      throw new Error('В списке нет платежей');
    }

    const defaults = data.defaults || {};
    const { items, invalid } = buildItems(data.items, defaults, (item, amount) => ({
      ...item,
      id: item.id,
      amount,
      status: fromRemoteStatus(item.status, item.claimed_by && item.claimed_by.id, operatorId),
      remote_status: item.status,
      claimed_by_name: item.claimed_by ? item.claimed_by.name : null,
      bank_message: item.bank_message || null,
      updated_at: item.updated_at || null
    }), false);

    const state = {
      source: 'api',
      invalid,
      batch_id: data.batch_id,
      title: data.title || null,
      defaults,
      items,
      current: 0,
      imported_at: new Date().toISOString()
    };

    const firstPending = items.findIndex((item) => item.status === 'pending');
    state.current = firstPending === -1 ? 0 : firstPending;

    return state;
  }

  /**
   * Backenddan kelgan yangi holatni mavjud navbatga singdiradi ("Обновить").
   *
   * Backend — haqiqat manbai, biroq hisoboti hali yuborilmagan qatorlar
   * (`unsentIds`) tegilmaydi: aks holda operator ko'z o'ngida to'langan qator
   * yana "в очереди" bo'lib ko'rinadi.
   */
  function mergeRemote(state, data, operatorId, unsentIds = []) {
    const unsent = new Set(unsentIds.map(Number));
    const byId = new Map(state.items.map((item) => [item.id, item]));

    const items = data.items.map((raw) => {
      const local = byId.get(raw.id);
      const amount = normalizeAmount(raw.amount) || String(raw.amount);

      if (local && unsent.has(raw.id)) return local;

      const unusable = normalizeAmount(raw.amount) === null;

      return {
        ...(local || {}),
        ...raw,
        amount,
        unusable,
        status: unusable
          ? 'error'
          : fromRemoteStatus(raw.status, raw.claimed_by && raw.claimed_by.id, operatorId),
        remote_status: raw.status,
        claimed_by_name: raw.claimed_by ? raw.claimed_by.name : null,
        bank_message: unusable
          ? `неверная сумма «${raw.amount}»`
          : raw.bank_message || (local ? local.bank_message : null),
        updated_at: raw.updated_at || null
      };
    });

    const currentId = state.items[state.current] && state.items[state.current].id;
    const current = items.findIndex((item) => item.id === currentId);

    return {
      ...state,
      defaults: data.defaults || state.defaults,
      title: data.title || state.title,
      items,
      current: current === -1 ? 0 : current,
      refreshed_at: new Date().toISOString()
    };
  }

  async function load() {
    const stored = await chrome.storage.local.get(STORAGE.queue);
    return stored[STORAGE.queue] || null;
  }

  async function save(state) {
    await chrome.storage.local.set({ [STORAGE.queue]: state });
    return state;
  }

  async function clear() {
    await chrome.storage.local.remove(STORAGE.queue);
  }

  function setStatus(state, index, status, extra = {}) {
    if (!STATUSES.includes(status)) throw new Error(`Неизвестный статус ${status}`);
    const item = state.items[index];
    Object.assign(item, extra, { status, updated_at: new Date().toISOString() });
    return state;
  }

  /** Joriydan keyingi `pending` qator; topilmasa — boshidan qidiradi. */
  function nextPending(state, from = state.current) {
    const n = state.items.length;
    for (let step = 1; step <= n; step++) {
      const index = (from + step) % n;
      if (state.items[index].status === 'pending') return index;
    }
    return -1;
  }

  /** Forma qiymatlari bo'yicha qatorni topish (btn_pay bosilganda). */
  function findByValues(state, values) {
    if (!values) return -1;
    const amount = normalizeAmount(values.amount);
    return state.items.findIndex(
      (item) => item.personal_account === values.personalAccount && item.amount === amount
    );
  }

  function stats(state) {
    const result = Object.fromEntries(STATUSES.map((s) => [s, 0]));
    for (const item of state.items) result[item.status]++;
    return result;
  }

  /** Fayl navbati uchun natijani fayl sifatida olish (API navbatida kerak emas). */
  function exportResults(state) {
    return {
      batch_id: state.batch_id,
      exported_at: new Date().toISOString(),
      items: state.items.map((item) => ({
        id: item.id,
        contract_id: item.contract_id ?? null,
        personal_account: item.personal_account,
        amount: item.amount,
        status: item.status,
        bank_message: item.bank_message,
        updated_at: item.updated_at
      }))
    };
  }

  root.MunisQueue = {
    STATUSES, REPORTABLE, normalizeAmount, payment, isRemote, fromJson, fromApi, mergeRemote,
    load, save, clear, setStatus, nextPending, findByValues, stats, exportResults
  };
})(globalThis);
