/**
 * ZK driver — sahifa kontekstida (MAIN world) ishlaydi, chunki `zk`/`zAu`
 * content script'ning isolated world'ida ko'rinmaydi.
 *
 * Vazifasi:
 *   - MUNIS formasini aniqlash va holat o'zgarsa xabar berish;
 *   - bridge.js buyrug'i bilan maydonlarni ZK API orqali to'ldirish;
 *   - "Оплатить" (btn_pay) bosilganini va server xabarlarini kuzatish.
 *
 * Driver HECH QACHON to'lov tugmasini bosmaydi — bunday buyruq yo'q.
 * Mexanizm tafsiloti: docs/01-munis-forma-tadqiqoti.md §4.
 */
(function () {
  'use strict';

  if (window.__ipakMunisDriver) return;
  window.__ipakMunisDriver = true;

  const TO_PAGE = 'ipak-munis:cs';
  const FROM_PAGE = 'ipak-munis:page';

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function emit(event, data) {
    window.postMessage({ source: FROM_PAGE, event, data }, window.location.origin);
  }

  // ── ZK yordamchilari ────────────────────────────────────────────────

  /** `zk.$('$id')` bu ZK versiyasida yo'q — DOM orqali qidiriladi. */
  function widget(id) {
    for (const el of document.querySelectorAll('[id]')) {
      const w = window.zk.Widget.$(el);
      if (w && w.id === id) return w;
    }
    return null;
  }

  function isVisible(w) {
    const node = w && w.$n && w.$n();
    return !!node && node.offsetParent !== null;
  }

  function options(w) {
    const list = [];
    for (let c = w.firstChild; c; c = c.nextSibling) list.push(c);
    return list;
  }

  function value(id) {
    const w = widget(id);
    return w && w.getValue ? String(w.getValue() ?? '') : null;
  }

  /** Server so'rovi tugaguncha kutadi (ikki ketma-ket bo'sh tekshiruv). */
  async function waitIdle(timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    let idleTicks = 0;
    await sleep(150);
    while (Date.now() < deadline) {
      idleTicks = window.zAu.processing() ? 0 : idleTicks + 1;
      if (idleTicks >= 2) return;
      await sleep(100);
    }
    throw new Error('Сервер банка не ответил вовремя');
  }

  async function waitFor(check, timeoutMs, message) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const result = check();
      if (result) return result;
      await sleep(150);
    }
    throw new Error(message);
  }

  /**
   * Combobox tanlash. `updateChange_()` serverga avval onChange, keyin onSelect
   * yuboradi — haqiqiy click bilan bir xil tartib. Teskari tartibda server
   * bog'liq ro'yxatlarni tozalab yuboradi (tadqiqot §4).
   */
  async function select(id, match, label, timeouts) {
    const w = await waitFor(
      () => {
        const found = widget(id);
        return found && isVisible(found) && found.nChildren > 0 ? found : null;
      },
      timeouts.widgetMs,
      `Список «${label}» не загрузился`
    );

    if (match(String(w.getValue() ?? ''))) return { id, skipped: true };

    const item = options(w).find((c) => match(c.getLabel()));
    if (!item) {
      const available = options(w).map((c) => c.getLabel());
      throw Object.assign(new Error(`В списке «${label}» нет нужного значения`), { available });
    }

    w._select(item, {});
    w.updateChange_();
    await waitIdle(timeouts.serverMs);
    return { id, selected: item.getLabel() };
  }

  async function type(id, text, label, timeouts) {
    const w = await waitFor(
      () => {
        const found = widget(id);
        return found && isVisible(found) ? found : null;
      },
      timeouts.widgetMs,
      `Поле «${label}» не появилось`
    );

    if (String(w.getValue() ?? '') === text) return { id, skipped: true };

    const input = w.getInputNode();
    input.value = text;
    w.updateChange_();
    await waitIdle(timeouts.serverMs);
    return { id, typed: text };
  }

  // ── Forma ───────────────────────────────────────────────────────────

  function formState(fields) {
    const caption = widget(fields.caption);
    const supplier = widget(fields.supplier);
    const isForm = !!caption && !!caption.getValue && caption.getValue() === 'Оплата MUNIS' && isVisible(supplier);
    return {
      isForm,
      values: isForm ? readValues(fields) : null
    };
  }

  function readValues(fields) {
    return {
      category: value(fields.category),
      region: value(fields.region),
      district: value(fields.district),
      supplier: value(fields.supplier),
      account: value(fields.account),
      service: value(fields.service),
      payerName: value(fields.payerName),
      personalAccount: value(fields.personalAccount),
      paymentType: value(fields.paymentType),
      amount: value(fields.amount)
    };
  }

  const eq = (expected) => (label) => label === expected;

  /**
   * Maydonlar tartibi muhim: har tanlov keyingi ro'yxatni serverdan yuklaydi.
   * Qiymati allaqachon to'g'ri bo'lgan combobox o'tkazib yuboriladi — ikkinchi
   * va keyingi qatorlarda faqat Лицевой счёт va Сумма yoziladi.
   */
  async function fill({ fields, timeouts, payment }) {
    const steps = [];
    const run = async (promise) => steps.push(await promise);

    await run(select(fields.category, eq(payment.category), 'Категория', timeouts));
    await run(select(fields.region, eq(payment.region), 'Область', timeouts));
    await run(select(fields.district, eq(payment.district), 'Район', timeouts));
    await run(select(fields.supplier, (l) => l.endsWith(` - ${payment.supplier_code}`), 'Поставщик', timeouts));
    await run(select(fields.account, (l) => l.startsWith(payment.account), 'Счет клиента', timeouts));
    await run(select(fields.service, eq(payment.service), 'Сервис', timeouts));
    await run(type(fields.payerName, payment.payer_name, 'Имя плательщика', timeouts));
    await run(type(fields.personalAccount, payment.personal_account, 'Лицевой счёт', timeouts));
    await run(select(fields.paymentType, eq(payment.payment_type), 'Способ оплаты', timeouts));
    await run(type(fields.amount, payment.amount, 'Сумма', timeouts));

    const values = readValues(fields);
    return { steps, values, mismatches: verify(values, payment) };
  }

  /** To'ldirilgandan keyin widget'lardan qayta o'qib solishtirish. */
  function verify(values, payment) {
    const checks = [
      ['Категория', values.category === payment.category],
      ['Область', values.region === payment.region],
      ['Район', values.district === payment.district],
      ['Поставщик', (values.supplier || '').endsWith(` - ${payment.supplier_code}`)],
      ['Счет клиента', (values.account || '').startsWith(payment.account)],
      ['Сервис', values.service === payment.service],
      ['Имя плательщика', values.payerName === payment.payer_name],
      ['Лицевой счёт', values.personalAccount === payment.personal_account],
      ['Способ оплаты', values.paymentType === payment.payment_type],
      ['Сумма', Number(values.amount) === Number(payment.amount)]
    ];
    return checks.filter(([, ok]) => !ok).map(([label]) => label);
  }

  // ── Kuzatuv ─────────────────────────────────────────────────────────

  let fieldsForWatch = null;

  /**
   * Serverga ketayotgan event'larni kuzatish. btn_pay onClick — operator
   * "Оплатить"ni bosdi; shu paytdagi forma qiymatlari bilan xabar beriladi.
   */
  function hookSend() {
    const original = window.zAu.send;
    window.zAu.send = function (evt) {
      try {
        const target = evt && evt.target && evt.target.id;
        if (fieldsForWatch && evt.name === 'onClick') {
          if (target === fieldsForWatch.payButton) {
            emit('pay-click', { values: readValues(fieldsForWatch), at: new Date().toISOString() });
          } else if (target === fieldsForWatch.cancelButton) {
            emit('cancel-click', { at: new Date().toISOString() });
          }
        }
      } catch (e) {
        // kuzatuv xatosi bank ishiga ta'sir qilmasligi kerak
      }
      return original.apply(this, arguments);
    };
  }

  /** Server `alert`/`wrongValue` buyruqlari — xato va ogohlantirishlar. */
  function hookServerMessages() {
    const cmd0 = window.zAu.cmd0;
    for (const name of ['alert', 'wrongValue']) {
      const original = cmd0[name];
      if (typeof original !== 'function') continue;
      cmd0[name] = function () {
        try {
          const text = Array.from(arguments).filter((a) => typeof a === 'string').join(' ');
          emit('server-message', { kind: name, text, at: new Date().toISOString() });
        } catch (e) {
          // e'tiborsiz
        }
        return original.apply(this, arguments);
      };
    }
  }

  /**
   * ZK Messagebox (modal oyna, masalan "Client bank ... OK") DOM'da paydo
   * bo'lganda matnini yuboradi. btn_pay'dan keyingi javob shu yo'l bilan
   * ushlanadi (tadqiqot §10, 2-bosqich).
   */
  function watchDialogs() {
    const seen = new WeakSet();
    let timer = null;

    const scan = () => {
      for (const node of document.querySelectorAll('.z-window-modal, .z-window-highlighted, .z-messagebox-window')) {
        if (seen.has(node) || node.offsetParent === null) continue;
        seen.add(node);
        const text = node.innerText.trim().replace(/\s+/g, ' ');
        if (text) emit('dialog', { text, at: new Date().toISOString() });
      }
    };

    // Debounce: observer bizning panel har qayta chizilganda ham uyg'onadi,
    // har mutatsiyada querySelectorAll yugurtirish sahifani sekinlashtiradi.
    new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(scan, 120);
    }).observe(document.body, { childList: true, subtree: true });
  }

  let lastStateJson = '';
  let stateTimer = null;

  function watchForm() {
    new MutationObserver(() => {
      clearTimeout(stateTimer);
      stateTimer = setTimeout(pushState, 300);
    }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class', 'value'] });
    pushState();
  }

  function pushState() {
    if (!fieldsForWatch) return;
    const state = formState(fieldsForWatch);
    const json = JSON.stringify(state);
    if (json === lastStateJson) return;
    lastStateJson = json;
    emit('form-state', state);
  }

  // ── RPC ─────────────────────────────────────────────────────────────

  let initPromise = null;

  /**
   * Kuzatuvni o'rnatadi. Tartib muhim: `zk`/`zAu` kutiladi, keyin hook'lar, va
   * faqat ular o'rnatilgandan KEYIN `fieldsForWatch` yoziladi.
   *
   * Aks holda birinchi init xato bersa (sahifa hali yuklanmagan) maydonlar
   * yozilib qolib, keyingi urinishlar "qayta init" deb hisoblanadi va hook'lar
   * umuman o'rnatilmaydi — natijada "Оплатить" bosilgani hech qachon
   * aniqlanmaydi va panel "Заполнить"ni doim o'chirib qo'yadi.
   */
  async function setup(fields) {
    if (fieldsForWatch) {
      // Content script qayta ulandi — joriy holatni yana yuboramiz.
      fieldsForWatch = fields;
      lastStateJson = '';
      pushState();

      return { ok: true, reinit: true };
    }

    await waitFor(
      () => window.zk && window.zk.Widget && window.zAu && window.zAu.send && window.zAu.cmd0,
      30000,
      'ZK не загрузился'
    );

    hookSend();
    hookServerMessages();

    fieldsForWatch = fields;
    lastStateJson = '';
    watchDialogs();
    watchForm();

    return { ok: true };
  }

  const commands = {
    /**
     * Content script init'ni qayta-qayta so'raydi (uning RPC timeout'i qisqa,
     * biz esa ZK'ni uzoq kutamiz). Bir vaqtda ikki setup ketsa hook'lar IKKI
     * marta o'rnatiladi va "Оплатить" ikki marta xabar qiladi — shuning uchun
     * bitta ishlayotgan urinish hammaga qaytariladi.
     */
    init({ fields }) {
      // Faqat KETAYOTGAN setup keshlanadi. Tugagandan keyin kesh tozalanadi,
      // shunda keyingi init `setup()`ning "qayta ulanish" tarmog'iga tushib,
      // forma holatini yana yuboradi (busiz panel `isForm`ni bilmay qoladi va
      // "Заполнить" o'chib turadi).
      if (!initPromise) {
        initPromise = setup(fields).finally(() => {
          initPromise = null;
        });
      }

      return initPromise;
    },
    state: ({ fields }) => formState(fields),
    fill
  };

  window.addEventListener('message', async (event) => {
    const msg = event.data;
    if (event.source !== window || !msg || msg.source !== TO_PAGE) return;

    const reply = (payload) => window.postMessage({ source: FROM_PAGE, id: msg.id, ...payload }, window.location.origin);
    const handler = commands[msg.cmd];
    if (!handler) return reply({ ok: false, error: `Неизвестная команда: ${msg.cmd}` });

    try {
      reply({ ok: true, result: await handler(msg.args || {}) });
    } catch (error) {
      reply({ ok: false, error: error.message, available: error.available });
    }
  });

  // zk/zAu tayyor bo'lishini kutib, tayyorligini bildiramiz.
  (async function ready() {
    await waitFor(() => window.zk && window.zk.Widget && window.zAu && window.zAu.send, 30000, 'ZK не загрузился').catch(() => null);
    emit('ready', { zk: !!window.zk });
  })();
})();
