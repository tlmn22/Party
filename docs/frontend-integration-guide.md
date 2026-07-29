# Frontend Integration Guide

Энэ баримт бичиг нь frontend хөгжүүлэгчид зориулсан — эхнээс дуустал (нэвтрэх → өрөө үүсгэх → тоглоом холбогдох → action илгээх) бодит код жишээтэйгээр тайлбарласан. Дэлгэрэнгүй лавлагаа хэрэгтэй бол доор өгсөн бусад баримт бичгүүд рүү зааж өгсөн.

## 0. Хэрэгтэй утгууд

```
SUPABASE_URL      = https://faktpbhepfrftyckgotn.supabase.co
SUPABASE_ANON_KEY = <Project Settings -> API -> anon/public key>
BACKEND_URL       = http://localhost:2567   (dev үед; deploy хийсний дараа солигдоно)
```

⚠️ `service_role` key энэ бүгдэд огт хэрэггүй, зөвхөн backend-д байдаг, chat/код дотор хэзээ ч бүү хэрэглэ.

---

## 1. Бүртгүүлэх / Нэвтрэх (Supabase Auth шууд, манай backend оролцохгүй)

```bash
npm install @supabase/supabase-js
```

```ts
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Бүртгүүлэх
const { data, error } = await supabase.auth.signUp({ email, password });

// Нэвтрэх
const { data, error } = await supabase.auth.signInWithPassword({ email, password });
const accessToken = data.session.access_token; // <-- үүнийг доор бүх REST дуудлагад ашиглана

// Гарах
await supabase.auth.signOut();
```

`accessToken`-оо хадгалж ав (session хугацаа ~1 цаг, дараа нь Supabase client-ийн `onAuthStateChange`/`refreshSession`-аар шинэчилнэ).

---

## 2. Манай REST API (profile / friends / rooms)

Бүх дуудлагад header: `Authorization: Bearer <accessToken>`.

Бүх endpoint-ыг browser дээрээ интерактив харах/турших бол: **`${BACKEND_URL}/api-docs`** (Swagger UI).

### Өрөө үүсгэх

```ts
const res = await fetch(`${BACKEND_URL}/rooms`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ gameType: 'thirteen_tree_poker', targetScore: 30 }),
});
const { data } = await res.json();
// data.room.code       -> бусад тоглогчид өгөх код (QR-т ч энэ л кодыг оруулна)
// data.room.roomId     -> Supabase доторх room UUID
// data.joinToken       -> доор Colyseus холбогдоход хэрэгтэй (30 секундийн дотор ашиглах ёстой)
```

### Кодоор нэгдэх

```ts
const res = await fetch(`${BACKEND_URL}/rooms/join`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ code: 'A7K9QX' }), // хэрэглэгчийн бичсэн эсвэл QR-с уншсан код
});
const { data } = await res.json();
// data.room, data.joinToken -- дээрхтэй адилхан
```

### Профайл / найзууд

`GET /profile/me`, `PATCH /profile/me`, `GET /friends`, `POST /friends/request`, `POST /friends/respond` — бүгдийг Swagger UI дээрээс жишээтэй нь харна уу.

---

## 3. Тоглоом руу холбогдох (Colyseus)

⚠️ **Чухал**: манай backend Colyseus **0.18.x** дээр ажилладаг тул client тал **`@colyseus/sdk`** (0.18.x) ашиглах ёстой — хуучин **`colyseus.js`** (0.16.x зогссон) биш! Хоёр өөр package, хуучныг нь суулгавал холбогдохгүй.

```bash
npm install @colyseus/sdk
```

```ts
import { Client } from '@colyseus/sdk';

const client = new Client('ws://localhost:2567'); // deploy хийсний дараа wss://...

const room = await client.joinOrCreate('thirteen_tree_poker', {
  joinToken: data.joinToken,      // дээрх /rooms эсвэл /rooms/join-ийн хариунаас
  code: data.room.code,           // яг ижил код — үгүй бол өөр өрөөнд холбогдож магадгүй
  displayName: 'Bat',             // харагдах нэр
});
```

### ⚠️ Interner тасрах / refresh хийхэд буцаж орох (маш чухал, анхандаа мартагдсан)

Хэрэглэгчийн интернет тасрах эсвэл хуудсаа refresh хийхэд **тэр л өрөөндөө, тэр л суудалдаа буцаж орж, өмнөх хөзөр/байрлалаа сэргээх** боломжтой байх ёстой гэдэг анхны шаардлагыг санаж байгаа биз. Сервер тал (`onDrop`/`allowReconnection`/`onReconnect`) энэ логикийг аль хэдийн дэмждэг, гэхдээ **client тал өөрөө тодорхой алхам хийх ёстой** — эс тэгвэл `joinOrCreate`-ийг дахин дуудаад **шинэ** суудал/session үүсгэчихдэг (хуучин руугаа биш).

**Гол зарчим**: холбогдмогц Colyseus `room.reconnectionToken`-ийг өгдөг (богино хугацаанд хүчинтэй, ойролцоогоор 60 сек, сервер restart болоогүй л бол). Үүнийг `localStorage`-д хадгалж, дараа нь (refresh/тасрах дараа) `client.reconnect(token)`-ыг `joinOrCreate`-ийн оронд дуудвал **яг тэр л session, sessionId, гар руу нь буцаж орно**.

```ts
async function connectToGame(code: string, joinToken: string, displayName: string) {
  const client = new Client(WS_URL);
  const savedToken = localStorage.getItem(`reconnect:${code}`);

  let room;
  if (savedToken) {
    try {
      room = await client.reconnect(savedToken); // яг тэр session рүү буцна (шинэ suudал биш)
    } catch {
      // Token хугацаа дууссан эсвэл сервер restart хийсэн — ердийн шинэ холболт хий
      room = await client.joinOrCreate('thirteen_tree_poker', { joinToken, code, displayName });
    }
  } else {
    room = await client.joinOrCreate('thirteen_tree_poker', { joinToken, code, displayName });
  }

  // Дараагийн refresh/тасралтад ашиглахын тулд шинэ token-оо ЯГ ХОЛБОГДОХ БҮРД дахин хадгал
  localStorage.setItem(`reconnect:${code}`, room.reconnectionToken);

  return room;
}
```

Хэрэглэгч зориудаар "гарах" (leave/quit) товч дарвал `localStorage.removeItem(...)`-оор тэр token-оо цэвэрлэ — эс тэгвэл дараа нэвтрэхэд хуучин (аль хэдийн хаагдсан) session рүү орохыг оролдоно.

Энэ механизмыг [`test-client/play.ts`](../test-client/play.ts)-д `--reconnect <token>` параметрээр турьж, sessionId яг хадгалагдаж байгааг баталгаажуулсан.

### State-ийг сонсох (бүгдэд харагдах мэдээлэл)

```ts
room.onStateChange((state) => {
  console.log(state.status);            // waiting | dealt | playing | round_end | match_end
  console.log(state.currentTurnUserId);  // хэний ээлж
  console.log(state.lastComboCards);     // сүүлд тавьсан хослол (хоосон бол чөлөөтэй эхэлнэ)
  for (const p of state.players.values()) {
    console.log(p.displayName, p.cardCount, p.matchScore, p.eliminated, p.placement);
  }
});
```

### Өөрийн нууц хөзрийг сонсох (зөвхөн танай клиентэд ирнэ)

```ts
room.onMessage('hand', (msg) => {
  console.log('Миний карт:', msg.hand); // ["3D", "10H", "KS", ...]
});
```

### Round / match дууссаныг сонсох

```ts
room.onMessage('round_result', (msg) => {
  // { roundNumber, winnerUserId, penalties: [{userId, cardsLeft, pointsAdded, matchScore}], eliminated: [{userId, placement}] }
  // matchScore = тухайн тоглогчийн round-ийн дараах ХУРИМТЛАГДСАН нийт оноо (state-ээс тусад нь харах шаардлагагүй)
  // Ирсний дараа status='round_end' болно — match дуусаагүй бол host дараагийн round-ыг
  // эхлүүлэхийн тулд ДАХИН deal_cards → start_game илгээх ёстой (доор тайлбарласан).
});

room.onMessage('match_result', (msg) => {
  // { winnerUserId, finalScores: [{userId, matchScore, placement}] } -- placement 1 = ялагч
});

room.onMessage('error', (msg) => {
  // { code: 'NOT_YOUR_TURN' | 'INVALID_ACTION' | 'DUPLICATE_ACTION' | ..., message: string }
});
```

### ⚠️ Round бүр 2 алхамт (`deal_cards` → `start_game`) — host заавал дуудна

Энэ бол round бүрт (match-ийн эхнийхэд ч, дараагийн бүхэнд ч) давтагддаг зан үйл. **UI-д зориулсан гол дүрэм: `deal_cards` → тоглогчид гараа хардаг → (frontend-ийн шийдвэрээр хэзээ ч, жишээ 3 секундын countdown-ийн дараа) `start_game` → одоо л тоглож эхэлнэ.**

```ts
// Match-ийн эхэнд, эсвэл өмнөх round дуусаад дараагийнхыг эхлүүлэхэд (HOST Л дуудна):
room.send('action', { actionId: crypto.randomUUID(), type: 'deal_cards', payload: {} });
// -> status 'dealt' болно, бүх тоглогч 'hand' мессежээр шинэ 13 картаа авна
// -> ЭНЭ мөчид play_cards/pass илгээвэл INVALID_ACTION ("Round has not started yet") ирнэ

// Frontend өөрийн логикоор (countdown, "Бэлэн боллоо" товч гэх мэт) шийдээд:
room.send('action', { actionId: crypto.randomUUID(), type: 'start_game', payload: {} });
// -> status 'playing' болно, одооноос play_cards/pass ажиллана
```

**Сервер `deal_cards` болон `start_game`-ийн хооронд ямар ч timer/countdown барьдаггүй** — энэ хугацааг (0 секунд ч байж болно, эсвэл 5 секундын "гараа хараарай" countdown ч байж болно) **бүхэлдээ frontend шийднэ**. Хүсвэл `deal_cards`-ийн дараа шууд `start_game`-ийг ч дараад илгээж болно (countdown огт хэрэггүй бол).

⚠️ **Round автоматаар үргэлждэггүй** — round бүрийн (`round_result` ирсний) дараа **host заавал дахин `deal_cards` → `start_game`-ийг дуудах ёстой**, эс тэгвэл дараагийн round эхлэхгүй, room `round_end` төлөвт зогсоод үлдэнэ.

**UI зурах зарчим хэвээрээ**: `onStateChange`/`onMessage('hand', ...)`-аас ирсэн бүрд бүхэл дэлгэцээ (ширээ, гар, ээлж) шинэ өгөгдлөөр бүрэн дахин зур — өмнөх render-ийн үлдэгдэл (stale closure, хуучин useState) бүү ашигла. React ашиглаж байгаа бол `state`/`hand`-ийг шууд `useState`-д оноож, тэрхүү state-ээр л бүх дэд component-уудаа зурах нь энгийн бөгөөд найдвартай арга.

---

## 4. Action илгээх (тоглох)

Action бүр `actionId` (client-generated, жишээ `crypto.randomUUID()`) дагуулах ёстой — давхар илгээвэл сервер `DUPLICATE_ACTION` алдаа буцаана.

```ts
// Host л дуудна — round бүрийн эхэнд 2-уулаа дараалан (3-р хэсгээс дэлгэрэнгүй харах)
room.send('action', { actionId: crypto.randomUUID(), type: 'deal_cards', payload: {} });
room.send('action', { actionId: crypto.randomUUID(), type: 'start_game', payload: {} });

// Хослол тавих
room.send('action', {
  actionId: crypto.randomUUID(),
  type: 'play_cards',
  payload: { cards: ['7D', '7H'] }, // өөрийн `hand`-с сонгосон картууд
});

// Алгасах
room.send('action', { actionId: crypto.randomUUID(), type: 'pass', payload: {} });
```

Зөвхөн `state.currentTurnUserId === (өөрийн userId)` үед л action илгээх ёстой — эс тэгвэл `NOT_YOUR_TURN` алдаа ирнэ.

---

## 5. Type contract (TypeScript ашигладаг бол)

```bash
npm install git+https://github.com/<user>/party-shared-types.git
```

Дотор нь: `UserProfile`, `RoomSummary`, `CreateRoomRequest`, `JoinRoomResponse`, `ThirteenTreePokerRoomState`, `ThirteenTreePokerAction`, `ThirteenTreePokerRoundResult`, `ThirteenTreePokerMatchResult` гэх мэт бүх дээрх жишээнүүдийн бодит TS type.

---

## 6. Дэлгэрэнгүй лавлагаа

- **Бүх REST endpoint интерактив**: `${BACKEND_URL}/api-docs`
- **13 модны покерын бүрэн дүрэм** (хослол, эрэмбэ, оноо тооцоолол, elimination): [`thirteen-tree-poker-rules.md`](thirteen-tree-poker-rules.md)
- **Supabase Auth-ыг гараар (REST) турших жишээ**: [`auth-testing-guide.md`](auth-testing-guide.md)
- **Терминалаас жинхэнэ тоглоом турших жишээ клиент**: [`../test-client/play.ts`](../test-client/play.ts) — бодит `@colyseus/sdk` ашиглалтын жишээ код болгож ч ашиглаж болно.
