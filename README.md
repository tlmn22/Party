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

```bash
npm run dev      # ts-node-dev, амьд ажиллана, өөрчлөлт орох бүрт restart хийнэ
npm run build && npm start   # production build
```

`GET /health` → `{ ok: true }` ажиллаж байгааг шалгах эндпойнт.

## Архитектур

```
src/
  index.ts              # Express + Colyseus нэг http server дээр
  db/supabase.ts         # Supabase service-role client
  middleware/auth.ts      # Supabase JWT баталгаажуулалт (Bearer token)
  realtime/joinToken.ts   # Богино хугацаат join token (REST -> WS гүүр)
  routes/                # profile, friends, rooms REST endpoint-ууд
  rooms/                  # тоглоом бүрийн Colyseus Room class
    ThirteenTreePokerRoom.ts
```

**Frontend Supabase Auth-аар шууд нэвтэрч JWT авна** (backend нэвтрэлт өөрөө хийхгүй). Тэр JWT-г `Authorization: Bearer <token>` header-ээр core REST API-д (profile/friends/rooms) дамжуулна, backend зөвхөн баталгаажуулна.

### Өрөөнд нэгдэх урсгал (join token гүүр)

1. Client `POST /rooms` эсвэл `POST /rooms/join { code }` дуудна (Bearer JWT-тэй).
2. Backend Supabase-д room мөр үүсгэх/олох, богино хугацаат (**30 сек**) `joinToken` (userId+roomId-г холбосон JWT, `JOIN_TOKEN_SECRET`-ээр гарын үсэг зурсан) буцаана.
3. Client Colyseus WS холболт нээхдээ `{ joinToken, displayName }`-ийг room options болгож дамжуулна.
4. `ThirteenTreePokerRoom.onAuth` тухайн token-ийг шалгаад `userId`-ийг баталгаажуулна — өөр тоглогчийн нэрээр нэвтрэх боломжгүй.

Энэ хоёр алхамт гүүр нь: (а) REST API дээр Supabase JWT-г дахин дахин шалгуулахгүйгээр Colyseus рүү хурдан шилжих, (б) client-ээс ирэх `userId`-д итгэхгүй, зөвхөн серверийн гарын үсэгтэй token-д итгэх зарчмыг хангана.

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
