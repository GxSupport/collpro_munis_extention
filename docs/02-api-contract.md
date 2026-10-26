# Ipak MUNIS — Backend API kontrakti (v1)

> **HOLAT (2026-09-28):** kontrakt to'liq bajarilgan. Backend — `routes/api.php`
> (`/api/munis/*`, `App\Http\Controllers\Munis\*`), extension — `v0.2.0`
> (`src/bg/api.js`). `migrations`: `2026_09_21_100000_create_munis_tables.php`.

> Iste'molchi: Chrome/Edge extension "Ipak MUNIS" (e-bank.ipakyulibank.uz'da MUNIS formasini to'ldiradi).
> To'lovni xodim E-IMZO kaliti bilan o'zi imzolaydi. Backend ro'yxatni beradi va natijalarni qabul qiladi.
> Sinov ma'lumoti: `test-data/notarius-inv-10.json` (12 qator) — `GET /batches/{id}` javobi aynan shu shaklda bo'lishi kerak.

## 0. Umumiy qoidalar

| Qoida | Qiymat |
|-------|--------|
| Base URL | `https://<domain>/api/munis` (HTTPS majburiy) |
| Format | JSON, `Content-Type: application/json; charset=utf-8` |
| Auth | `Authorization: Bearer <token>`: har xodimning o'z tokeni, kim to'laganini bilish uchun |
| Vaqt | ISO 8601, Toshkent vaqti: `2026-09-21T13:06:26+05:00` |
| Pul | **string**, `.` ajratgich, **aniq 2 xona**: `"94377.26"`, `"110000.00"`. Float emas, bo'shliq yoki vergul emas |
| Raqamli ID'lar | Лицевой счёт, hisob raqam, Поставщик kodi **string** (boshida `0` bo'lishi mumkin) |
| CORS | Kerak emas: so'rovlar extension'ning service worker'idan ketadi |
| Kodlash | UTF-8, kirill va lotin matnlari o'zgarishsiz |

### Xato javobi (hamma endpoint'lar uchun bir xil)

```json
{
  "ok": false,
  "error": "item_already_claimed",
  "message": "Платеж уже взят в работу оператором Aliyev A."
}
```

| HTTP | `error` misollari | Extension nima qiladi |
|------|-------------------|------------------------|
| 401 | `unauthenticated` | Ishni to'xtatadi, qayta login so'raydi |
| 403 | `operator_blocked`, `forbidden` | Ishni to'xtatadi, xabar ko'rsatadi |
| 404 | `batch_not_found`, `item_not_found` | Qatorni o'tkazib yuboradi |
| 409 | `item_already_claimed`, `item_already_paid`, `invalid_transition` | **To'ldirmaydi**, keyingi qatorga o'tadi |
| 422 | `validation_failed` (+ `fields: {name: [msg]}`) | Xatoni ko'rsatadi |
| 429 | `too_many_requests` + `Retry-After` header | Kutib, qayta urinadi |
| 5xx | — | 5 martagacha qayta urinadi (1, 2, 4, 8, 16 s) |

## 1. Auth

### `POST /auth/login`

```json
// request
{ "login": "operator1", "password": "••••" }

// 200
{
  "ok": true,
  "token": "1|abcdef...",
  "operator": { "id": 7, "name": "Aliyev A." }
}
```

### `GET /auth/me` → `200 { "ok": true, "operator": { "id": 7, "name": "Aliyev A." } }`

Token bilan tekshirish uchun (extension har ochilganda chaqiradi).

## 2. Ro'yxatlar (batch)

### `GET /batches?status=open`

Xodimga ko'rinadigan ochiq ro'yxatlar.

```json
{
  "ok": true,
  "data": [
    {
      "batch_id": "notarius-inv-10",
      "title": "НАТАРИУС ИНВ 10",
      "created_at": "2026-09-21T09:00:00+05:00",
      "items_total": 12,
      "amount_total": "1208177.39",
      "counts": { "pending": 12, "claimed": 0, "submitting": 0, "paid": 0, "error": 0, "skipped": 0 }
    }
  ]
}
```

### `GET /batches/{batch_id}`

Ro'yxatning to'liq tarkibi. Extension shu javob bilan ishlaydi.

```json
{
  "ok": true,
  "batch_id": "notarius-inv-10",
  "title": "НАТАРИУС ИНВ 10",
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
      "id": 1001,
      "contract_id": "VRF-00989935",
      "debtor_name": "MUKUMOV SHUXRAT SHAYDILOVICH",
      "personal_account": "25996253449002",
      "amount": "94377.26",
      "status": "pending",
      "claimed_by": null,
      "bank_payment_id": null,
      "bank_message": null,
      "updated_at": null
    }
  ]
}
```

#### Maydon talablari (eng muhim qism)

Qiymatlar bank formasidagi ro'yxatdan **aynan matn bo'yicha** tanlanadi. Bitta harf farq qilsa ham qator `error` bo'ladi.

| Maydon | Tur | Majburiy | Qoida | Misol |
|--------|-----|----------|-------|-------|
| `category` | string | ha | Bank ro'yxatidagi matn bilan aynan bir xil | `Бюджетные Платежи` |
| `region` | string | ha | Bankdagidek: **lotin, KATTA harf** | `TOSHKENT SHAHRI` |
| `district` | string | ha | Bankdagidek: lotin, KATTA harf | `MIRZO ULUGBEK TUMANI` |
| `supplier_code` | string | ha | Faqat 4 xonali kod, nom emas | `0208` |
| `account` | string | ha | 20 xonali hisob raqam (faqat raqam) | `20208000305242696001` |
| `service` | string | ha | Bankdagidek aynan | `Услуги нотариуса (MUNIS)` |
| `payer_name` | string | ha | Kompaniya nomi (qarzdor emas) | `OOO "VARIANT RETAIL FINANCE"` |
| `payment_type` | string | ha | Hozircha yagona qiymat | `Перечислением: ДБО` |
| `id` | integer | ha | Global unikal, o'zgarmas | `1001` |
| `personal_account` | string | ha | Лицевой счёт, faqat raqam, bo'shliqsiz | `25996253449002` |
| `amount` | string | ha | `^\d+\.\d{2}$`, > 0 | `94377.26` |
| `contract_id` | string | yo'q | Bizning ichki ID (panelda ko'rinadi) | `VRF-00989935` |
| `debtor_name` | string | yo'q | Panelda ko'rsatish uchun | `MUKUMOV SHUXRAT SHAYDILOVICH` |

- Har bir item `defaults`'dagi istalgan maydonni **o'zi ustidan yozishi mumkin** (masalan boshqa `district` yoki `service`). Extension `{...defaults, ...item}` qiladi.
- Bitta batch ichida `personal_account` + `amount` juftligi **unikal** bo'lishi kerak. "Оплатить" bosilganda extension qatorni shu juftlik bo'yicha topadi.
- Bir ro'yxatda 1000 tagacha item bo'lishi mumkin. Undan ko'p bo'lsa, ro'yxatni bo'ling (pagination kerak emas).

Bank qiymatlari (region, district, service) ro'yxati: `docs/01-munis-forma-tadqiqoti.md` §3. Qo'shimcha region yoki Поставщик kerak bo'lsa, extension orqali bankdan ro'yxat olib berish mumkin.

## 3. Qatorni band qilish (claim) — ikki marta to'lashdan himoya

### `POST /items/{id}/claim`

Extension formani to'ldirishdan **oldin** chaqiradi. Backend buni **atomik** bajaradi (`UPDATE … WHERE status IN ('pending','error') OR (status='claimed' AND claimed_by = me)`).

```json
// 200
{ "ok": true, "item": { "id": 1001, "status": "claimed", "claimed_by": { "id": 7, "name": "Aliyev A." }, "claim_expires_at": "2026-09-21T13:16:26+05:00" } }

// 409: boshqa xodim ishlayapti yoki allaqachon to'langan
{ "ok": false, "error": "item_already_claimed", "message": "..." }
{ "ok": false, "error": "item_already_paid", "message": "..." }
```

- Claim **10 daqiqa** amal qiladi. Muddat o'tsa, backend qatorni avtomatik `pending`'ga qaytaradi, **faqat `submitting` bo'lmagan bo'lsa**.
- Xuddi shu xodim qayta claim qilsa, 200 qaytadi (muddat uzayadi).
- `POST /items/{id}/release` claim'ni bekor qiladi (xodim "Пропустить" bosdi yoki boshqa qatorga o'tdi). Qator `pending` bo'ladi.

## 4. Natija yuborish

### `POST /items/{id}/status`

```json
// request
{
  "event_id": "5f0c9a3e-8a1b-4c1e-9d0b-2f7c1e0a9b11",
  "status": "paid",
  "occurred_at": "2026-09-21T13:06:26+05:00",
  "form_values": {
    "personal_account": "25996253449002",
    "amount": "94377.26",
    "supplier": "MUNIS: Услуги Министерства юстиции (Адлия Вазирлиги хизматлари) - 0208",
    "service": "Услуги нотариуса (MUNIS)"
  },
  "bank_message": "Платеж успешно отправлен",
  "bank_payment_id": "2447578",
  "bank_status": "Проведено в БС",
  "error": null
}

// 200
{ "ok": true, "item": { "id": 1001, "status": "paid", "updated_at": "2026-09-21T13:06:27+05:00" } }
```

| Maydon | Qachon keladi |
|--------|---------------|
| `event_id` | Har doim (UUID v4). **Idempotentlik:** bir xil `event_id` qayta kelsa, backend birinchi javobni qaytaradi va hech narsani o'zgartirmaydi |
| `form_values` | `submitting` va `paid` holatlarida: bank formasida haqiqatda nima turgani (audit uchun) |
| `bank_message` | Bank oynasidagi matn (bo'lsa) |
| `bank_payment_id`, `bank_status` | Keyinchalik: "Список"dan tasdiqlanganda (`№`, `Статус`) |
| `error` | `status = error` bo'lganda: sabab matni |

### Statuslar va ruxsat etilgan o'tishlar

```
pending ──claim──▶ claimed ──▶ submitting ──▶ paid
   ▲                 │  │           │
   └──release/expire─┘  │           └──▶ error ──claim──▶ claimed (qayta urinish)
                        ├──▶ error
                        └──▶ skipped
```

| Status | Ma'nosi | Kim qo'yadi |
|--------|---------|-------------|
| `pending` | Hali ishlanmagan | backend (yaratilganda / release / expire) |
| `claimed` | Xodim formani to'ldiryapti | `POST /claim` |
| `submitting` | Xodim "Оплатить"ni bosdi, bank javobi kutilmoqda | extension |
| `paid` | To'landi (xodim yoki "Список" tasdiqladi) | extension |
| `error` | Bank rad etdi yoki forma to'ldirilmadi | extension |
| `skipped` | Xodim o'tkazib yubordi | extension |

Qat'iy qoidalar (buzilsa `409 invalid_transition`):
- **`paid` — yakuniy holat.** Undan hech qaysi holatga o'tib bo'lmaydi (faqat admin panel orqali).
- `submitting` qatorni claim muddati o'tsa ham avtomatik `pending`'ga **qaytarmang**. To'lov o'tgan bo'lishi mumkin, uni odam tekshiradi.
- Qatorni faqat uni claim qilgan xodim o'zgartira oladi (403 `forbidden`).

## 5. Backend saqlashi kerak (audit)

Har bir status o'zgarishini alohida log qilish kerak: `item_id, operator_id, from_status, to_status, event_id, form_values, bank_message, occurred_at, received_at, ip`. Bank pulida xato bo'lsa, kim, qachon va qaysi qiymatlar bilan to'laganini aniqlash uchun bu shart.

## 6. Bosqichlar

| Bosqich | Endpoint'lar | Nima beradi |
|---------|--------------|-------------|
| **MVP** | `auth/login`, `auth/me`, `GET batches`, `GET batches/{id}`, `POST items/{id}/status` | JSON faylsiz ishlash |
| **Keyingi** | `claim` / `release` + expire job | Bir nechta xodim parallel ishlay oladi |
| **Keyingi** | `bank_payment_id`, `bank_status` | "Список" orqali avtomatik tasdiqlash |

Agar ro'yxat ustida bir vaqtda faqat bitta xodim ishlasa, claim'ni keyinga qoldirish mumkin. Ikki xodim bo'lsa, claim **birinchi kundan** kerak.
