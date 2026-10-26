/**
 * Content script orkestratori: navbat (queue.js) + driver (bridge.js) +
 * backend (backend.js) + panel.
 *
 * Oqim (bitta qator, CollPro ro'yxati):
 *   pending → [Заполнить] → POST /claim → forma to'ldiriladi → filled
 *   → operator "Оплатить" + kalit → POST /status submitting
 *   → operator tasdiqlaydi → POST /status paid → keyingi qator to'ldiriladi.
 *
 * Statuslar avval mahalliy saqlanadi, keyin backendga yuboriladi (outbox) —
 * tarmoq uzilsa ham operator ishlashda davom etadi va hisobot yo'qolmaydi.
 */
(function (root) {
  'use strict';

  const { FIELDS, TIMEOUTS, STORAGE } = root.MunisConfig;
  const Queue = root.MunisQueue;
  const bridge = root.MunisBridge;
  const backend = root.MunisBackend;

  const view = {
    queue: null,
    form: { isForm: false, values: null },
    busy: false,
    message: null,
    listOpen: false,
    /** Service worker holati: sozlama, login, yuborilmagan hisobotlar. */
    backend: { apiBase: '', hasPermission: false, loggedIn: false, operator: null, outbox: null },
    /** Ochiq ro'yxatlar (faqat navbat tanlanmaganda kerak). */
    batches: null,
    loadingBatches: false
  };

  /** "Оплатить" bosilgan qator indeksi — bank javobi shu qatorga yoziladi. */
  let submittingIndex = null;

  const panel = root.MunisPanel.createPanel({ onAction: handle });
  const render = () => panel.render(view);

  function say(text, kind = 'info') {
    view.message = text ? { text, kind } : null;
    render();
  }

  async function persist() {
    await Queue.save(view.queue);
    render();
  }

  function current() {
    return view.queue.items[view.queue.current];
  }

  const isRemote = () => Queue.isRemote(view.queue);

  /** Service worker holatini yangilaydi (login, sozlama, outbox hisoblagichi). */
  async function syncBackend() {
    const result = await backend.state();
    if (result.ok) view.backend = result.data;

    return view.backend;
  }

  // ── Backend: ro'yxatlar ─────────────────────────────────────────────

  async function loadBatches() {
    view.loadingBatches = true;
    render();

    const result = await backend.listBatches();
    view.loadingBatches = false;

    if (!result.ok) {
      view.batches = null;

      return say(result.message, 'error');
    }

    view.batches = result.data.data || [];
    say(view.batches.length ? null : 'Открытых списков нет — импортируйте файл нотариуса в CollPro.', 'info');
  }

  async function openBatch(batchId) {
    view.busy = true;
    say(null);

    const result = await backend.openBatch(batchId);
    view.busy = false;

    if (!result.ok) return say(result.message, 'error');

    try {
      view.queue = Queue.fromApi(result.data, result.data.operator && result.data.operator.id);
    } catch (error) {
      return say(`Список ${batchId} не принят:\n${error.message}`, 'error');
    }

    view.batches = null;
    await persist();
    say(`Загружено ${view.queue.items.length} платежей`, 'ok');
  }

  /** "Обновить" — backenddagi haqiqiy holatni tortib oladi. */
  async function refreshBatch() {
    if (!isRemote()) return;

    view.busy = true;
    render();

    const result = await backend.openBatch(view.queue.batch_id);
    view.busy = false;

    if (!result.ok) return say(result.message, 'error');

    const state = await syncBackend();
    const unsentIds = (state.outbox && state.outbox.pending_ids) || [];

    try {
      view.queue = Queue.mergeRemote(
        view.queue,
        result.data,
        result.data.operator && result.data.operator.id,
        unsentIds
      );
    } catch (error) {
      return say(error.message, 'error');
    }

    await persist();
    say('Список обновлён', 'ok');
  }

  // ── Backend: hisobot ────────────────────────────────────────────────

  /**
   * Statusni backendga yuborish uchun navbatga qo'yadi (kontrakt §4).
   * Fayl navbatida hech narsa yubormaydi — backendda bunday qatorlar yo'q.
   */
  async function report(index, status, extra = {}) {
    if (!isRemote()) return;

    const item = view.queue.items[index];
    const result = await backend.report(item.id, view.queue.batch_id, {
      status,
      occurred_at: new Date().toISOString(),
      ...extra
    });

    if (!result.ok) say(result.message, 'error');

    await syncBackend();
    render();
  }

  /** Audit uchun forma qiymatlari (kontrakt §4 `form_values`). */
  function formValues() {
    const values = view.form.values;
    if (!values) return undefined;

    return {
      personal_account: values.personalAccount || null,
      amount: values.amount ? String(values.amount) : null,
      supplier: values.supplier || null,
      service: values.service || null
    };
  }

  // ── Amallar ─────────────────────────────────────────────────────────

  /**
   * Qatorni band qilish. Ikki operator bitta to'lovni to'lab qo'ymasligi uchun
   * forma to'ldirilishidan OLDIN chaqiriladi (kontrakt §3).
   *
   * @return {Promise<boolean>} davom etish mumkinmi
   */
  async function claimRow(index) {
    if (!isRemote()) return true;

    const result = await backend.claim(view.queue.items[index].id);

    if (result.ok) return true;

    if (result.status === 409) {
      // Boshqa operator ishlayapti yoki allaqachon to'langan — tegmaymiz.
      Queue.setStatus(view.queue, index, result.error === 'item_already_paid' ? 'paid' : 'locked', {
        bank_message: result.message
      });
      say(result.message, 'error');
      moveToNextPending();
      await persist();

      return false;
    }

    say(result.message, 'error');

    return false;
  }

  /**
   * Boshqa qatorni to'ldirishga o'tganda avvalgi `filled` qatorning band
   * qilinishini bo'shatadi (kontrakt §3).
   *
   * Bank formasida bir vaqtda bitta to'lov turadi: yangi qator to'ldirilsa,
   * avvalgisi haqiqatan tashlab ketilgan — uni 10 daqiqa TTL kutib turmasin,
   * boshqa operator darhol olsin.
   */
  async function releaseAbandoned(exceptIndex) {
    if (!isRemote()) return;

    for (let index = 0; index < view.queue.items.length; index++) {
      if (index === exceptIndex || view.queue.items[index].status !== 'filled') continue;

      const result = await backend.release(view.queue.items[index].id);
      if (result.ok) Queue.setStatus(view.queue, index, 'pending', { bank_message: null });
    }
  }

  async function fill() {
    // To'ldirish ~2 sekund. Shu orada operator "Оплатить" bosib, `pay-click`
    // `current`ni ko'chirib yuborishi mumkin — shuning uchun qator indeksi
    // boshida qotiriladi, aks holda natija boshqa qatorga yozilib, haqiqiy
    // `submitting` holati o'chib ketadi.
    const index = view.queue.current;

    view.busy = true;
    say(null);
    render();

    try {
      if (view.queue.items[index].status === 'locked') {
        return say('Платёж занят другим оператором.', 'error');
      }

      if (view.queue.items[index].unusable) {
        return say(`Строка не принята: ${view.queue.items[index].bank_message}`, 'error');
      }

      if (!(await claimRow(index))) return;

      await releaseAbandoned(index);

      const result = await bridge.call('fill', {
        fields: FIELDS,
        timeouts: TIMEOUTS,
        payment: Queue.payment(view.queue, view.queue.items[index])
      });

      // Operator shu orada "Оплатить"ni bosib yuborgan bo'lsa, uning holati
      // ustidan yozmaymiz — pul allaqachon yo'lda.
      if (view.queue.items[index].status === 'submitting') {
        return say('Платёж уже отправлен в банк — дождитесь ответа.', 'info');
      }

      if (result.mismatches.length) {
        const message = `Не совпало после заполнения: ${result.mismatches.join(', ')}`;
        Queue.setStatus(view.queue, index, 'error', { bank_message: message });
        say(`Проверьте поля: ${result.mismatches.join(', ')}`, 'error');
        await report(index, 'error', { error: message });
      } else {
        Queue.setStatus(view.queue, index, 'filled', { bank_message: null });
        say(null);
      }
    } catch (error) {
      // Driver xatosi (timeout, ro'yxatda qiymat yo'q) — backendga `error`
      // YOZMAYMIZ: claim o'zi 10 daqiqada bo'shaydi, qator esa qayta urinish
      // uchun `pending` holatida qoladi.
      const hint = error.available ? `\nДоступно:\n• ${error.available.slice(0, 15).join('\n• ')}` : '';
      say(`${error.message}${hint}`, 'error');
    } finally {
      view.busy = false;
      await persist();
    }
  }

  function moveToNextPending() {
    const next = Queue.nextPending(view.queue);
    if (next === -1) {
      say(
        isRemote()
          ? 'Все доступные платежи обработаны. Нажмите «Обновить», чтобы проверить список.'
          : 'Все платежи обработаны. Нажмите «Экспорт», чтобы сохранить результат.',
        'ok'
      );

      return false;
    }
    view.queue.current = next;

    return true;
  }

  async function importFile({ text, name }) {
    let queue;
    try {
      queue = Queue.fromJson(JSON.parse(text));
    } catch (error) {
      return say(`Файл ${name} не принят:\n${error.message}`, 'error');
    }

    const started = view.queue && view.queue.items.some((i) => i.status !== 'pending');
    if (started && !window.confirm('Текущий список уже в работе. Заменить его новым файлом?')) return;

    view.queue = queue;
    view.batches = null;
    await persist();
    say(`Загружено ${queue.items.length} платежей из ${name}. Офлайн-режим: статусы в CollPro не уйдут.`, 'ok');
  }

  function exportFile() {
    const data = JSON.stringify(Queue.exportResults(view.queue), null, 2);
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
    link.download = `${view.queue.batch_id}-result-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  async function handle(action, data = {}) {
    if (action === 'toggle-collapse') { panel.toggleCollapsed(); return render(); }
    if (action === 'toggle-list') { view.listOpen = !view.listOpen; return render(); }
    if (action === 'import') return importFile(data);
    if (action === 'open-options') return backend.openOptions();
    if (action === 'load-batches') return loadBatches();
    if (action === 'open-batch') return openBatch(data.batchId);
    if (action === 'retry-backend') { await syncBackend(); return loadBatches(); }
    if (action === 'clear-failed') {
      await backend.clearFailedReports();
      await syncBackend();

      return render();
    }
    if (action === 'flush-outbox') {
      await backend.flushOutbox();
      await syncBackend();

      return render();
    }
    if (!view.queue || view.busy) return;

    const q = view.queue;
    const last = q.items.length - 1;

    switch (action) {
      case 'fill':
        return fill();
      case 'refresh':
        return refreshBatch();
      case 'skip': {
        const index = q.current;
        const wasError = q.items[index].status === 'error';

        Queue.setStatus(q, index, 'skipped');
        await persist();

        // Backendda `error` — yakuniy holat: undan to'g'ridan-to'g'ri
        // `skipped`ga o'tish 409 beradi. Avval qayta band qilinadi (claim
        // `error`dan ruxsat etilgan), shundan keyin hisobot yuboriladi.
        if (!wasError || await claimRow(index)) await report(index, 'skipped');

        moveToNextPending();

        return persist();
      }
      case 'prev':
        q.current = q.current > 0 ? q.current - 1 : last;
        say(null);

        return persist();
      case 'next':
        q.current = q.current < last ? q.current + 1 : 0;
        say(null);

        return persist();
      case 'goto':
        q.current = data.index;
        say(null);

        return persist();
      case 'next-pending':
        moveToNextPending();

        return persist();
      case 'reset-item':
        Queue.setStatus(q, q.current, 'pending', { bank_message: null });

        return persist();
      case 'mark-paid': {
        const index = q.current;
        submittingIndex = null;
        Queue.setStatus(q, index, 'paid');
        await persist();
        await report(index, 'paid', {
          bank_message: q.items[index].bank_message || undefined,
          form_values: formValues()
        });
        if (moveToNextPending()) {
          await persist();
          if (view.form.isForm) return fill();
        }

        return;
      }
      case 'mark-error': {
        const index = q.current;
        submittingIndex = null;
        Queue.setStatus(q, index, 'error');
        await persist();

        return report(index, 'error', {
          error: q.items[index].bank_message || 'Оператор отметил платёж как неуспешный',
          bank_message: q.items[index].bank_message || undefined
        });
      }
      case 'export':
        return exportFile();
      case 'clear':
        if (!window.confirm(isRemote()
          ? 'Закрыть список? Статусы уже сохранены в CollPro, список можно открыть заново.'
          : 'Удалить список и все статусы? Сначала сделайте «Экспорт».')) return;
        // Band qilingan qatorlarni ushlab ketmaymiz — boshqa operator olsin.
        await releaseAbandoned(-1);
        await Queue.clear();
        view.queue = null;
        say(null);

        return loadBatches();
    }
  }

  // ── Driver event'lari ───────────────────────────────────────────────

  bridge.on('form-state', (state) => {
    view.form = state;
    render();
  });

  /**
   * Operator "Оплатить"ni bosdi. Qator forma qiymatlari bo'yicha topiladi —
   * operator panelda boshqa qatorni tanlab qo'ygan bo'lsa ham to'g'ri belgilanadi.
   */
  bridge.on('pay-click', async ({ values }) => {
    if (!view.queue) return;
    const index = Queue.findByValues(view.queue, values);
    if (index === -1) {
      return say(`Оплата с данными не из списка: ${values.personalAccount} / ${values.amount}`, 'error');
    }
    // Bank rad etib, operator "Оплатить"ni yana bossa — qator allaqachon
    // `submitting`. Takroriy hisobot backendda 409 bo'ladi, shuning uchun
    // bir marta yuboramiz.
    const alreadySubmitting = view.queue.items[index].status === 'submitting';

    view.queue.current = index;
    Queue.setStatus(view.queue, index, 'submitting', { bank_message: null });
    say(null);
    await persist();

    submittingIndex = index;

    if (alreadySubmitting) return;

    await report(index, 'submitting', {
      form_values: {
        personal_account: values.personalAccount || null,
        amount: values.amount ? String(values.amount) : null,
        supplier: values.supplier || null,
        service: values.service || null
      }
    });
  });

  /**
   * Bank oynalari va xabarlari — imzodan keyingi javobni saqlash uchun.
   *
   * Xabar `pay-click` qotirib qo'ygan qatorga yoziladi, "joriy" qatorga emas:
   * operator "Оплатить"dan keyin ▶ bosib ketsa ham bank javobi to'g'ri
   * to'lovga tegishli bo'lib qolishi kerak.
   */
  async function onBankText({ text }) {
    if (!view.queue) return say(text, 'info');

    const index = submittingIndex !== null ? submittingIndex : view.queue.current;
    const item = view.queue.items[index];

    if (item && item.status === 'submitting') {
      item.bank_message = item.bank_message ? `${item.bank_message}\n${text}` : text;
      await persist();
    } else {
      say(`Банк: ${text}`, 'info');
    }
  }

  bridge.on('dialog', onBankText);
  bridge.on('server-message', onBankText);

  // Popup navbatni tozalasa, boshqa tab o'zgartirsa yoki outbox surilsa.
  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== 'local') return;

    if (changes[STORAGE.queue] && !view.busy) {
      view.queue = changes[STORAGE.queue].newValue || null;
      render();
    }

    if (changes[STORAGE.outbox] || changes[STORAGE.auth] || changes[STORAGE.settings]) {
      await syncBackend();
      render();
    }
  });

  // ── Ishga tushirish ─────────────────────────────────────────────────

  /** Driver bilan yuklanish tartibi kafolatlanmagan — init qayta urinib ko'riladi. */
  async function connect() {
    for (let attempt = 0; attempt < 30; attempt++) {
      try {
        await bridge.call('init', { fields: FIELDS }, 2000);

        return true;
      } catch (error) {
        // Driver hali tayyor emas (ZK yuklanmagan) yoki javob bermadi.
        // Kutish MAJBURIY: driver darhol xato qaytarsa, kutmasdan 30 urinish
        // bir necha millisekundda tugab, operator bekorga xato ko'radi.
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
    say('Не удалось подключиться к странице банка. Обновите страницу.', 'error');

    return false;
  }

  (async function start() {
    view.queue = await Queue.load();
    render();

    const state = await syncBackend();
    render();

    if (!view.queue && state.loggedIn && state.hasPermission) await loadBatches();

    await connect();

    // Sahifa ochilganda yuborilmagan hisobotlar bo'lsa — surib yuboramiz.
    if (state.outbox && state.outbox.pending) {
      await backend.flushOutbox();
      await syncBackend();
      render();
    }
  })();
})(globalThis);
