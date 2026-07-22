# Auth + backend урсгалыг гараар турших заавар

Frontend бэлэн болоогүй үед Supabase Auth болон манай backend-ийг шууд HTTP хүсэлтээр турших заавар. VS Code-ийн **REST Client** extension-д зориулж бичсэн (`.http` файлд paste хийгээд "Send Request" дарна), гэхдээ ямар ч REST tester (Thunder Client, Postman, curl, PowerShell) дээр адилхан ажиллана — Method/URL/Headers/Body-г л тухайн tool-даа тохируулж бич.

## Хэрэгтэй утгууд

```
SUPABASE_URL   = https://faktpbhepfrftyckgotn.supabase.co
ANON_KEY       = Project Settings -> API -> anon/public key
```

Эдгээр 2 утга **нийтэд зориулагдсан, аюулгүй** — frontend хамтрагчид өгч болно.

⚠️ `service_role` key үүнд хэрэггүй, зөвхөн backend-ийн `.env`-д байна, хэнд ч бүү дамжуул.

---

## 1. Бүртгүүлэх (signUp)

```http
POST {{SUPABASE_URL}}/auth/v1/signup
apikey: {{ANON_KEY}}
Content-Type: application/json

{
  "email": "test2@example.com",
  "password": "Password123!"
}
```

**Хүлээгдэж буй хариу:** `access_token`, `refresh_token`, `user` object. `user.email_confirmed_at`-д утга шууд орсон бол Dashboard-ийн "Confirm email" тохиргоо унтраалттай гэсэн үг (dev тестлэхэд тохиромжтой).

## 2. Нэвтрэх (signInWithPassword)

```http
POST {{SUPABASE_URL}}/auth/v1/token?grant_type=password
apikey: {{ANON_KEY}}
Content-Type: application/json

{
  "email": "test2@example.com",
  "password": "Password123!"
}
```

**Хүлээгдэж буй хариу:** дахин `access_token` (шинэ, 1 цагийн хугацаатай — `expires_in: 3600`).

## 3. Гарах (signOut)

```http
POST {{SUPABASE_URL}}/auth/v1/logout
apikey: {{ANON_KEY}}
Authorization: Bearer <access_token>
```

**Хүлээгдэж буй хариу:** хоосон (204) — тухайн session хүчингүй болно.

---

## 4. Манай backend-ийг турших (`access_token`-оо ашиглан)

Эхлээд сервер асаалттай эсэхийг шалга: `npm run dev` (эсвэл аль хэдийн ажиллаж байгаа).

### Профайл авах

```http
GET http://localhost:2567/profile/me
Authorization: Bearer <access_token>
```

Хүлээгдэж буй хариу: `{"data":{"id":"...","displayName":"Player","level":1,"totalScore":0,...}}` — trigger-ээр `profiles` мөр автоматаар үүссэнийг батална.

### Өрөө үүсгэх

```http
POST http://localhost:2567/rooms
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "gameType": "thirteen_tree_poker",
  "maxPlayers": 4
}
```

Хариунаас `data.room.code` (6 тэмдэгт) болон `data.joinToken`-ыг ав.

### Өрөөнд нэгдэх (дээрх код ашиглан)

```http
POST http://localhost:2567/rooms/join
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "code": "<дээрх room code>"
}
```

---

## Бүх endpoint-ыг browser дээр харах

`npm run dev` асаагаад **http://localhost:2567/api-docs** — Swagger UI, бүх REST endpoint жагсаагдаж, "Authorize" товчоор `access_token`-оо оруулаад шууд "Try it out" хийж болно.

## Type contract

REST/realtime type-ууд [`party-shared-types`](../../party-shared-types) сангаас.
