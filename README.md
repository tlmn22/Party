# party-backend

"Party" платформын backend: Colyseus (real-time тоглоомын өрөө) + Express (core REST API) нэг серверт хамт ажилладаг. Эхний тоглоом: **13 модны покер** (`thirteen_tree_poker`).

## Урьдчилсан шаардлага

- Node.js 20+
- Supabase project (үнэгүй tier хангалттай) — Postgres + Auth

## Суулгах

```bash
npm install
cp .env.example .env
# .env дотор SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (Project Settings -> API),
# JOIN_TOKEN_SECRET (дурын урт random string) бөглөнө
```

Supabase project дээрээ **SQL Editor**-руу орж [`supabase/schema.sql`](supabase/schema.sql)-ийг ажиллуулна (profiles, friends, rooms, game_history хүснэгтүүд + шинэ хэрэглэгч бүртгүүлэхэд автоматаар profile үүсгэдэг trigger).

⚠️ Хэрэв `rooms` хүснэгтээ өмнө нь үүсгэсэн бол **дахин ажиллуулах хэрэгтэй** — `target_score` баганыг idempotent `alter table` мөрөөр нэмдэг (аюулгүй, дахин ажиллуулахад алдаа өгөхгүй).

```bash
npm run dev      # ts-node-dev, амьд ажиллана, өөрчлөлт орох бүрт restart хийнэ
npm run build && npm start   # production build
```

`GET /health` → `{ ok: true }` ажиллаж байгааг шалгах эндпойнт.

## API баримтжуулалт (Swagger)

Сервэр асаасны дараа **http://localhost:2567/api-docs** дээр interactive Swagger UI нээгдэнэ — бүх REST endpoint (profile/friends/rooms) харагдаж, browser дээрээс шууд "Try it out" дараад турших боломжтой (баруун дээд буланд "Authorize" дараад Supabase-с авсан `access_token`-оо бичвэл, Bearer token шаардсан endpoint-уудыг турьж болно).

Swagger зөвхөн REST-ийг баримтжуулдаг (WebSocket/Colyseus-ийг хамардаггүй) — realtime гэрээ хэвээрээ [`party-shared-types`](../party-shared-types)-ээр дамждаг. Шинэ route нэмэх бүрдээ дээр нь `@swagger` JSDoc коммент (жишээг [routes/profile.ts](src/routes/profile.ts)-с харах) нэмбэл л Swagger UI автоматаар шинэчлэгдэнэ — тусдаа файл гараар засах шаардлагагүй.

Supabase Auth (signup/signin/signout) болон манай REST API-г гараар, HTTP хүсэлтээр турших алхам алхмаар зааврыг [`docs/auth-testing-guide.md`](docs/auth-testing-guide.md)-с үзнэ үү.

"13 модны покер"-ын бүрэн дүрэм, Colyseus WS action/state гэрээг [`docs/thirteen-tree-poker-rules.md`](docs/thirteen-tree-poker-rules.md)-с үзнэ үү.

**Frontend хамтрагчид өгөх баримт бичиг**: [`docs/frontend-integration-guide.md`](docs/frontend-integration-guide.md) — нэвтрэх, REST API, Colyseus холболт, action илгээх бүгдийг эхнээс нь бодит код жишээтэйгээр нэг дор.

## Идэвхтэй room-уудыг хянах

Хоёр түвшинд:

- **Түүхэн бүртгэл** — Supabase Dashboard → Table Editor → `rooms` (эсвэл SQL Editor-т `select code, status, created_at from rooms order by created_at desc`). Room бүрийн `status` (`waiting`/`in_progress`/`finished`) энд автоматаар шинэчлэгддэг.
- **Яг одоо санах ойд идэвхтэй Colyseus room-ууд (live)** — `GET /rooms/live` (Bearer token шаардлагатай) — `matchMaker.query()`-ээр шууд дуудаж `{ roomId, code, clients, maxClients, locked, createdAt }` буцаадаг. `@colyseus/monitor`-ийг оролдоод, ESM/CJS dual-package зөрчлөөс болж ажиллуулж чадаагүй тул үүнийг оронд нь ашиглаж байгаа (Swagger UI-аас "Try it out" хийж болно).

## Тоглолтыг терминалаас гараар турших

Frontend бэлэн болоогүй үед бодит Colyseus холболтоор (жинхэнэ WebSocket, REST client extension WS протокол ойлгодоггүй) тоглож үзэх [`test-client/play.ts`](test-client/play.ts) CLI хэрэгсэл бий. 4 тусдаа терминалд (нэг тоглогч тус бүрд):

```bash
export SUPABASE_ANON_KEY=<anon key>

# Host (өрөө үүсгэнэ):
npx ts-node test-client/play.ts --email host@example.com --password Password123! --host --target-score 30

# Бусад 3 (host-ийн хэвлэсэн кодыг ашиглана):
npx ts-node test-client/play.ts --email p2@example.com --password Password123! --code <ROOM CODE>
```

Холбогдсоны дараа `deal`, `start`, `play 7D 7H`, `pass`, `hand`, `state`, `quit` командуудыг бичиж болно. Имэйл бүртгэлгүй бол автоматаар signUp хийж дараа нь нэвтэрнэ.

Холбогдох бүрд `RECONNECT TOKEN` хэвлэгдэнэ — тухайн client-ийг санаатайгаар "унагаагаад" (Ctrl+C), дараа нь `--reconnect <token>`-оор дахин ажиллуулбал **яг ижил суудал руугаа** буцаж орно (интернет тасрах/refresh хийхтэй адилхан симуляц). Дэлгэрэнгүйг [`docs/frontend-integration-guide.md`](docs/frontend-integration-guide.md)-ийн "Interner тасрах / refresh хийхэд буцаж орох" хэсгээс үзнэ үү.

⚠️ **`index.ts`-д анхаарах зүйл**: серверийг `gameServer.listen(port)`-ээр асаана, raw `httpServer.listen(port)`-ээр биш. Colyseus 0.18-д `gameServer.listen()` нь matchmaking (`/matchmake/*`) route-уудыг Express app-тай холбож, дотоод transport reference-ийг тохируулдаг чухал алхам хийдэг — үүнийг алгасвал client холбогдох үед matchmaking хүсэлт мөнхөд hang хийх эсвэл "Cannot read properties of undefined (reading 'protocol')" алдаа өгдөг (бодит network client-аар турьж олсон).

## Архитектур

```
src/
  index.ts              # Express + Colyseus нэг http server дээр
  swagger.ts              # swagger-jsdoc config (route-уудын @swagger коммент цуглуулна)
  db/supabase.ts         # Supabase service-role client
  middleware/auth.ts      # Supabase JWT баталгаажуулалт (Bearer token)
  realtime/joinToken.ts   # Богино хугацаат join token (REST -> WS гүүр)
  routes/                # profile, friends, rooms REST endpoint-ууд (@swagger коммент-той)
  games/thirteenTreePoker/ # хөзөр (deck.ts) ба хослол таних/харьцуулах (combos.ts) — цэвэр логик, Colyseus-с үл хамааралтай
  rooms/                  # тоглоом бүрийн Colyseus Room class
    ThirteenTreePokerRoom.ts
```

**Frontend Supabase Auth-аар шууд нэвтэрч JWT авна** (backend нэвтрэлт өөрөө хийхгүй). Тэр JWT-г `Authorization: Bearer <token>` header-ээр core REST API-д (profile/friends/rooms) дамжуулна, backend зөвхөн баталгаажуулна.

### Өрөөнд нэгдэх урсгал (join token гүүр)

1. Client `POST /rooms` эсвэл `POST /rooms/join { code }` дуудна (Bearer JWT-тэй).
2. Backend Supabase-д room мөр үүсгэх/олох, богино хугацаат (**30 сек**) `joinToken` (userId+roomId-г холбосон JWT, `JOIN_TOKEN_SECRET`-ээр гарын үсэг зурсан) буцаана.
3. Client Colyseus WS холболт нээхдээ `{ joinToken, code, displayName }`-ийг room options болгож дамжуулна:
   ```js
   const room = await client.joinOrCreate('thirteen_tree_poker', { joinToken, code, displayName });
   ```
4. `ThirteenTreePokerRoom.onAuth` тухайн token-ийг шалгаад `userId`-ийг баталгаажуулна — өөр тоглогчийн нэрээр нэвтрэх боломжгүй.

Энэ хоёр алхамт гүүр нь: (а) REST API дээр Supabase JWT-г дахин дахин шалгуулахгүйгээр Colyseus рүү хурдан шилжих, (б) client-ээс ирэх `userId`-д итгэхгүй, зөвхөн серверийн гарын үсэгтэй token-д итгэх зарчмыг хангана.

⚠️ **`code`-г бүү мартаарай** — `index.ts`-д `gameServer.define(...).filterBy(['code'])` тохируулсан тул Colyseus яг тэр `code`-той идэвхтэй room байгаа эсэхийг шалгаад, байвал түүнд нь, байхгүй бол шинэ room үүсгэж холбоно. Хэрэв `code`-гүйгээр холбогдвол, өөр тоглогчдын өрөөнд санамсаргүй холбогдох эрсдэлтэй (олон лоби зэрэг нээлттэй үед).

### Reconnect / disconnect (Colyseus 0.18 lifecycle)

- `onDrop` — холболт санамсаргүй тасрахад (refresh, сүлжээ тасрах) дуудагдана; 60 секундийн дотор reconnect хийх боломж нээнэ (`allowReconnection`), суудлыг устгахгүй.
- `onReconnect` — амжилттай буцаж холбогдоход `connected = true`.
- `onLeave` — эцсийн гарц (зөвшөөрөлтэй leave, эсвэл 60 сек reconnect цонх хугацаа дууссан) — суудлыг устгана.

### Давхар үйлдэл / хамгаалалт

- Тоглогчийн action бүр `actionId` (client generated) дагуулна; сервер давхар ирсэн `actionId`-г үл тоомсорлоно (`ThirteenTreePokerRoom.handleAction`).
- Ээлж бус тоглогчийн action-ийг сервер шууд `NOT_YOUR_TURN` алдаагаар буцаана.
- Тоглоомын бодит логик (холих, тараах, дараагийн ээлж, оноо) **зөвхөн серверт** — client зөвхөн "хүсэлт" илгээнэ.

## Хамтын ажиллагааны гэрээ (frontend хамтрагчид)

Backend, frontend хоёр тусдаа repo-д ажиллаж байгаа тул тодорхой гэрээг [`party-shared-types`](../party-shared-types) сангаас авна (REST DTO, WS action envelope, error code, 13 модны покерын state skeleton). Frontend талдаа:

```bash
npm install git+https://github.com/<user>/party-shared-types.git
```

(Локал дээр хамт хөгжүүлж байгаа бол `file:../party-shared-types` замаар түр ашиглаж болно.)

## TODO

- "13 модны покер"-ын бодит дүрэм (холих/тараах, combo шалгах, оноо тооцоолол) — хамтдаа тодорхойлж `ThirteenTreePokerRoom`-д нэмнэ.
- Тоглогчийн нууц хөзрийг зөвхөн эзэнд нь илгээх механизм: одоогоор `party-shared-types`-ийн `ThirteenTreePokerPrivateState`-ийг тухайн `client.send()`-ээр цэгээр илгээхээр төлөвлөж байгаа (synced state-д биш). Хэрэв ирээдүйд синхрон state дотор шууд оруулах бол `@colyseus/schema`-ийн `@view()` / `StateView` (per-client visibility) ашиглаж болно.
- `friends` route-уудын жинхэнэ join query (одоогоор `[]` буцаадаг stub).
- Deploy: Oracle Cloud Always Free VM дээр Docker-оор байршуулах (Redis шаардлагагүй нэг instance-д).
