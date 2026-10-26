# Ipak Yo'li e-bank — "Оплата MUNIS" formasi tadqiqoti

> Sana: 2026-09-21 · Manba: https://e-bank.ipakyulibank.uz/ (jonli sessiya, Chrome)
> Maqsad: MUNIS to'lov formasini API'dan olingan ma'lumotlar bilan avtomatik to'ldiruvchi Chrome/Edge extension.

## 1. Asosiy xulosa

- Sayt **ZK Framework** (Java, `zkau/web/_zv2012010610`, ya'ni ZK 5/6, 2012) da yozilgan. SPA: sahifalar o'zgarganda URL o'zgarmaydi.
- Formani URL bo'yicha emas, **DOM bo'yicha** aniqlaymiz: `module_caption` label matni `Оплата MUNIS`.
- Har bir maydon ZK widget. Ularning **`id`'lari barqaror** (`fregion`, `ap_number`...), `uuid`'lari esa har sessiyada o'zgaradi (`nKCPjh`...). Selector faqat `id` bo'yicha yoziladi.
- Qiymatni DOM'ga yozishning o'zi yetmaydi: server `onChange`/`onSelect` event'larini kutadi. Buning uchun ZK widget API'si chaqiriladi (4-bo'lim). Bu faqat **MAIN world**'da ishlaydi, chunki `zk` obyekti content script'ning isolated world'ida ko'rinmaydi.
- Barcha to'ldirish qadamlari jonli sessiyada sinaldi va server hammasini qabul qildi. **To'lov yuborilmadi.**
- Yakuniy "Оплатить" (`btn_pay`) uchun E-IMZO kaliti kerak. Uni **xodim bosadi**, extension tegmaydi.

## 2. Formani aniqlash

```js
// MAIN world
function isMunisForm() {
  const cap = findWidgetById('module_caption');           // span.z-label
  return !!cap && cap.getValue?.() === 'Оплата MUNIS'
      && !!findWidgetById('customer_id');
}
```

- `MutationObserver(document.body, {childList:true, subtree:true})` + debounce (300ms).
- Forma topilganda "Avto to'ldirish" paneli ko'rsatiladi, forma yo'qolganda panel yashiriladi.
- Sahifada `iframe` bor (1 ta), lekin forma **asosiy document**'da joylashgan.

## 3. Maydonlar (tartib muhim)

| # | Label | ZK `id` | Turi | Tanlanganda nima yuklanadi | Kuzatilgan qiymat |
|---|-------|---------|------|-----------------------------|-------------------|
| 1 | Категория | `fcategory_id` | combobox (readonly) | Область, Район, Поставщик, Счет клиента (hammasi birga) | `Бюджетные Платежи` |
| 2 | Область | `fregion` | combobox (readonly) | Район (ro'yxat qayta yuklanadi) | `TOSHKENT SHAHRI` |
| 3 | Район | `fdistr` | combobox (readonly) | — | `MIRZO ULUGBEK TUMANI` |
| 4 | Поставщик | `customer_id` | combobox (readonly) | Сервис | `MUNIS: Услуги Министерства юстиции (Адлия Вазирлиги хизматлари) - 0208` |
| 5 | Счет клиента | `acc_id` | combobox (readonly) | — | `20208000305242696001 OOO "VARIANT RETAIL FINANCE"` (1 ta) |
| 6 | Сервис | `aservices_list_id` | combobox (readonly) | `ap_name`, `ap_number` maydonlari **paydo bo'ladi**, Способ оплаты to'ladi | `Услуги нотариуса (MUNIS)` |
| 7 | Имя Плательщика | `ap_name` | textbox | — | `OOO "VARIANT RETAIL FINANCE"` |
| 8 | Лицевой счёт | `ap_number` | textbox | — | masalan `23267890411028` |
| 9 | Способ оплаты | `apayment_type_id` | combobox (readonly) | — | `Перечислением: ДБО` (1 ta) |
| 10 | Сумма | `aamount` | textbox | — | `103000.00` (nuqta bilan, 2 xona) |

`ap_name`/`ap_number` maydonlari Сервис tanlanmaguncha DOM'da **yo'q**. Сервис tanlangach ularni kutish kerak.

### Kuzatilgan ro'yxatlar

- **Категория (16):** Коммунальные услуги, **Бюджетные Платежи**, Сотовая связь, Стационарная связь, Оплта за автомобиль, Интернет, Телевидение, Банковские операции, Электронные деньги, Другие платежи, Оплта за лизинг, Услуги государственных организаций, Оплата за контракт (ВУЗ), Пополнение Paynet кошельков…, Услуги от ИПАК ЙУЛИ БАНКА, Перевод средств.
- **Область (14):** ANDIJON, BUXORO, JIZZAX, KASHKADARYO, NAVOIY, NAMANGAN, SAMARKAND, SURXONDARYO, SIRDARYO VILOYATI, TOSHKENT SHAHRI, TOSHKENT VILOYATI, FARGONA, XORAZM, KORAKALPOGISTON RESPUBLIKASI.
- **Район — TOSHKENT SHAHRI (13):** TOSHKENT SHAHRI, UCHTEPA, BEKTEMIR, YUNUSOBOD, MIRZO ULUGBEK, MIROBOD, SHAYXONTOXUR, OLMAZOR, SIRGALI, YAKKASAROY, YASHNOBOD, CHILONZOR, YANGIXAYOT TUMANI.
- **Поставщик (24, "Бюджетные Платежи" uchun):** oxirida kod bor (`- 0202` … `- 0227`). Ular orasida: 0202 Казначейство, 0203 ГТК, 0204 Единое Окно, 0205 eSUD, 0206 ГУБДД штрафы, **0208 Минюст**, **0209 МИБ**, 0210 МВД штрафы, 0223 Налоги ИП… **Matn bo'yicha emas, kod (`- 0208`) bo'yicha moslash kerak.**
- **Сервис (0208 Минюст uchun, 6 ta):** **Услуги нотариуса (MUNIS)**, Услуги ЗАГСа (MUNIS), Оплата услуг нотариуса через спец.кассы Халк банка, Оплата услуг ЗАГСа через спец.кассы…, Оплата за услуги ННО, Оплата патентной гос.пошлины.

## 4. Qiymat yozish mexanizmi (sinalgan)

### Combobox

```js
async function zkSelect(id, match, waitMs = 2500) {
  const w = findWidgetById(id);
  let item;
  for (let c = w.firstChild; c; c = c.nextSibling) {
    const l = c.getLabel();
    if (typeof match === 'function' ? match(l) : l === match) { item = c; break; }
  }
  if (!item) throw new Error(`${id}: variant topilmadi`);
  w._select(item, {});   // client holat (input matni, tanlangan item)
  w.updateChange_();     // serverga: onChange, keyin onSelect
  await waitForServer(waitMs);
}
```

Serverga ketgan event'lar (`zAu.send` hook orqali ko'rildi):

```
onChange  fregion  {"value":"TOSHKENT SHAHRI","start":0}
onSelect  fregion  {"items":["<item uuid>"],"reference":"<item uuid>"}
```

**Muhim — tartib:** haqiqiy click'da avval `onChange`, keyin `onSelect` ketadi. Teskari tartibda yuborilsa (`_select(item,{sendOnSelect:true})` keyin `updateChange_()`), server **Район ro'yxatini tozalab yuboradi**. `updateChange_()` ikkala event'ni o'zi to'g'ri tartibda yuboradi, shuning uchun qo'shimcha `fire('onSelect')` chaqirilmaydi, aks holda event ikki marta ketadi.

### Textbox

```js
async function zkType(id, value, waitMs = 800) {
  const w = findWidgetById(id);
  w.getInputNode().value = value;
  w.updateChange_();     // serverga: onChange {"value": "...", "start": n}
  await waitForServer(waitMs);
}
```

### Widget'ni id bo'yicha topish

`zk.$('$id')` bu versiyada **yo'q**. Shu usul ishlaydi:

```js
function findWidgetById(id) {
  for (const el of document.querySelectorAll('[id]')) {
    const w = zk.Widget.$(el);
    if (w && w.id === id) return w;
  }
  return null;
}
```

### Serverni kutish

`setTimeout` bilan qat'iy kutish sinovda ishladi (combobox uchun 2–3 s). Extension'da ishonchliroq yo'l tanlanadi:
- `zAu.processing()` / `zAu.ajaxReq` (javob kelguncha true), **yoki**
- keyingi combobox'da `nChildren > 0` bo'lishini polling qilish (timeout 10 s).

## 5. Ketma-ket to'ldirish (ko'p qator)

Sinov: 1-qatordan keyin faqat `ap_number` va `aamount` o'zgartirildi. Qolgan 8 ta maydon **saqlanib qoldi**. Demak bir xil Поставщик/Сервис bo'lgan qatorlar uchun:

1. Birinchi qatorda to'liq zanjir: 1 → 10.
2. Keyingi qatorlarda: agar `customer_id`/`aservices_list_id` o'zgarmagan bo'lsa, faqat `ap_number` + `aamount` (+ kerak bo'lsa `ap_name`) yoziladi.
3. `btn_pay` bosilgandan keyin forma tozalanadimi yoki yo'qmi, hali **tekshirilmagan** (kalit yo'q). Buni xodim birinchi real to'lovda ko'rsatadi. Extension har qatordan oldin maydonlar holatini tekshirib, kerak bo'lsa zanjirni boshidan boshlaydi.

## 6. Tugmalar (faqat ma'lumot uchun, extension bosmaydi)

| id | Matn | Joyi |
|----|------|------|
| `btn_add` | Оплатить | yuqori toolbar |
| `btn_refresh` / `btn_back` / `btn_search` | Обновить / Список / Фильтр | yuqori toolbar |
| `btn_check_payment` | Проверить платеж | yuqori toolbar (hali o'rganilmagan, oldindan tekshirish uchun foydali bo'lishi mumkin) |
| `btn_find` | Фильтр | forma ostida |
| **`btn_pay`** | **Оплатить** | forma ostida. E-IMZO kaliti kerak, **xodim bosadi** |
| `btn_cancel_pay` | Отмена | forma ostida |

## 7. Extension arxitekturasi (taklif)

```
manifest.json (MV3, Chrome + Edge)
├─ content/bridge.js      ISOLATED world: panel UI, chrome.storage, API bilan aloqa
├─ content/zk-driver.js   MAIN world ("world": "MAIN"): zk widget'lar bilan ishlash
│     ↕ window.postMessage (yoki CustomEvent) protokoli
├─ background.js          API'dan ro'yxat olish (CORS muammosiz), token saqlash
└─ popup/                 sozlamalar, navbat holati
```

- `host_permissions`: `https://e-bank.ipakyulibank.uz/*` va bizning API domeni.
- Navbat holati (`qator N / jami`, qaysilari to'ldirildi) `chrome.storage.local`'da saqlanadi. Sahifa yangilansa ham ish davom etadi.
- Har qatorda: to'ldirish → xodimga yashil "tayyor" ko'rsatish → xodim `btn_pay` bosadi va kalit bilan imzolaydi → xodim panelda "Keyingisi"ni bosadi (yoki extension `btn_pay` natijasini aniqlaydi, bu hali o'rganilmagan).
- To'ldirilgandan keyin tekshiruv: har bir widget'dan `getValue()` o'qiladi va kutilgan qiymat bilan solishtiriladi. Mos kelmasa qizil ogohlantirish chiqadi.
- Edge'da ham shu build ishlaydi (Chromium, MV3).

## 8. API'dan kerak bo'ladigan maydonlar

| Maydon | Misol | Izoh |
|--------|-------|------|
| `category` | `Бюджетные Платежи` | ko'pincha doimiy |
| `region` | `TOSHKENT SHAHRI` | ZK'dagi label bilan aynan mos bo'lishi kerak |
| `district` | `MIRZO ULUGBEK TUMANI` | |
| `supplier_code` | `0208` | label oxiridagi kod bo'yicha moslanadi |
| `account` | `20208000305242696001` | label boshidagi raqam bo'yicha |
| `service` | `Услуги нотариуса (MUNIS)` | |
| `payer_name` | `OOO "VARIANT RETAIL FINANCE"` | |
| `personal_account` | `23267890411028` | Лицевой счёт |
| `payment_type` | `Перечислением: ДБО` | hozircha yagona variant |
| `amount` | `103000.00` | `.` ajratgich, 2 xona |
| `external_id` | `VRF-00907350` | bizning tizimdagi ID, hisobot uchun |

## 9. Ochiq savollar

1. `btn_pay` va imzodan keyin forma holati qanday bo'ladi (tozalanadimi, xabar chiqadimi)? Bu real to'lovda kuzatiladi.
2. `btn_check_payment` ("Проверить платеж") nima qiladi? Лицевой счёт'ni oldindan tekshirish uchun ishlatsa bo'ladimi?
3. API formati va autentifikatsiyasi qanday? Qaysi endpoint, token.
4. Boshqa Поставщик'lar (masalan 0209 МИБ) uchun Сервис'dan keyin qo'shimcha maydonlar chiqadimi? Hozircha faqat 0208 → нотариус sinaldi.
5. Sessiya timeout: uzoq navbatda ZK sessiyasi tugasa, qayta login kerak bo'ladi. Extension buni aniqlashi kerak.
6. Oldingi extensionlar (`../mib_result`, `../edudoc_hemis_sync`, `../docbox_extention`) tuzilmasini qayta ishlatish mumkin.

## 10. To'lov bo'lganini aniqlash

"Список" (`btn_back`) bo'limida to'lovlar grid'i bor: `dataGrid` (listbox), paging `comjpaymentPaging` (har sahifada 15 ta).
Ustunlar: `№ | Филиал | Сервис | Имя Плательщика | Лицевой счёт | Сумма, UZS | Дата проведения | Статус | Поставщик`.
Kuzatilgan statuslar: `Проведено в БС`, `Отменен`.

Uch bosqichli yondashuv:

1. **Niyat:** `zAu.send` hook `btn_pay` uchun `onClick`'ni ushlaydi. Qator holati `submitting` bo'ladi.
2. **Server javobi:** imzodan keyin ZK javobi keladi (messagebox yoki forma tozalanadi). `MutationObserver` va `zAu` javob hook'i orqali matn o'qiladi. Qator holati `submitted` yoki `error` bo'ladi. *Kalit yo'qligi sababli hali kuzatilmagan, birinchi real to'lovda aniqlanadi.*
3. **Tasdiq (ishonchli yo'l):** extension "Список"ni o'qiydi va `Лицевой счёт` + `Сумма` bo'yicha qatorni topadi. `Статус = Проведено в БС` bo'lsa, qator holati `paid` bo'ladi. Topilgan `№` (bank ID) va `Дата проведения` API'ga yuboriladi.

Ochiq: Список sahifasida 2021-yilgi yozuvlar birinchi chiqyapti. Saralash yoki sana filtri (`btn_search`) o'rganilishi kerak.

## 11. Backend API shartnomasi (taklif)

> **Eskirgan:** yakuniy kontrakt — `docs/02-api-contract.md` (claim, idempotentlik, statuslar). Bu bo'lim tarix uchun qoldirildi.

Test ma'lumoti: `test-data/notarius-inv-10.json` (`НАТАРИУС ИНВ 10.xlsx`'dan, 12 qator, jami 1 208 177.39).

### `GET /api/munis/batches/{batch_id}` — navbat

```json
{
  "batch_id": "notarius-inv-10",
  "defaults": {
    "category": "Бюджетные Платежи",
    "region": "TOSHKENT SHAHRI",
    "district": "MIRZO ULUGBEK TUMANI",
    "supplier_code": "0208",
    "account": "20208000305242696001",
    "service": "Услуги нотариуса (MUNIS)",
    "payer_name": "OOO \"VARIANT RETAIL FINANCE\"",
    "payment_type": "Перечислением: ДБО"
  },
  "items": [
    {
      "id": 1,
      "contract_id": "VRF-00989935",
      "debtor_name": "MUKUMOV SHUXRAT SHAYDILOVICH",
      "personal_account": "25996253449002",
      "amount": "94377.26",
      "status": "pending"
    }
  ]
}
```

- `amount` string, 2 xona, `.` ajratgich (float xatosining oldini oladi).
- `personal_account` string (14 xonali raqam JS number'da xavfsiz, lekin boshida `0` bo'lishi mumkin).
- Har item `defaults`'ni ustidan yozishi mumkin (masalan boshqa `district`).

### `POST /api/munis/items/{id}/status` — natija

```json
{
  "status": "paid",
  "bank_payment_id": "2447578",
  "bank_status": "Проведено в БС",
  "paid_at": "2026-09-21T13:06:26+05:00",
  "error": null
}
```

`status`: `pending → filled → submitting → paid | error | cancelled`. Endpoint idempotent bo'lishi kerak: bir xil `id` + `paid` qayta kelsa, xato qaytarmaydi.

Excel'dagi ma'lumot: har shartnomada 2 ta to'lov bor (asosiy summa + 110 000.00). Имя Плательщика = kompaniya (tarixdagi to'lovlarda ham `"VARIANT RETAIL FINANCE" МЧЖ`), qarzdor emas.
