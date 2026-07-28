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

### State-ийг сонсох (бүгдэд харагдах мэдээлэл)

```ts
room.onStateChange((state) => {
  console.log(state.status);            // waiting | playing | round_end | match_end
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
  // winnerUserId нь дараагийн round-ыг мөн эхэлнэ — round автоматаар үргэлжилнэ, "next round" товч хэрэггүй
});

room.onMessage('match_result', (msg) => {
  // { winnerUserId, finalScores: [{userId, matchScore, placement}] } -- placement 1 = ялагч
});

room.onMessage('error', (msg) => {
  // { code: 'NOT_YOUR_TURN' | 'INVALID_ACTION' | 'DUPLICATE_ACTION' | ..., message: string }
});
```

### ⚠️ Round автоматаар үргэлждэг — UI зөвхөн state-ийг "дагаж" харуулах ёстой

Энэ бол хамгийн их төөрөгдөл гаргадаг цэг тул тодорхой тайлбарлая.

**Round-д зориулсан "эхлүүлэх"/"дуусгах" action байхгүй.** Нэг тоглогч картаа дуусгамагц сервер **шууд, автоматаар**:
1. Оноо бодоод хуваарилна
2. Шинэ карт тараана (бүх идэвхтэй тоглогчид шинэ `hand` мессеж очно)
3. `state.roundNumber`-ийг нэмэгдүүлнэ, `state.lastComboCards`-ыг хоослоно (шинэ round чөлөөтэй эхэлнэ)
4. Ялсан хүнийг дараагийн round-ын ээлжинд тавина (`state.currentTurnUserId`)

Энэ бүгд **нэг мөчид, host эсвэл ямар нэг тоглогчийн үйлдэлгүйгээр** болдог. Тиймээс frontend талд **"дараагийн round" гэсэн товч, эсвэл "round дуусахыг хүлээх" гэсэн алхам байх ёсгүй** — зөвхөн доорх 2 мессежийг сонсоод дэлгэцээ шинэчлээрэй:

```ts
room.onMessage('hand', (msg) => {
  myHand = msg.hand;      // шинэ round эхлэхэд энэ автоматаар шинэ 13 картаар ирнэ
  renderHand(myHand);     // дэлгэцээ шууд дахин зурна
});

room.onStateChange((state) => {
  renderTable(state);     // roundNumber, lastComboCards, currentTurnUserId, players бүгд шинэчлэгдсэн эсэхийг шалгах шаардлагагүй — ЯГ ИРСЭН state-ээрээ дахин зур
});
```

**Түгээмэл алдаа (яг үүнээс болж "round дуусаагүй юм шиг санагдсан" тохиолдол гарсан)**: хуучин `lastComboCards`/`hand`-ийг local state/variable-д хадгалаад, зөвхөн ХЭСЭГЧИЛЖ шинэчилдэг код бичих — жишээ нь зөвхөн `play_cards` дараа өөрийн хэсгээ manual-аар шинэчлээд, `room.onStateChange`-ээс ирсэн шинэ `state`-ийг бүрэн дахин зурахгүй байх. Ингэвэл round бодитоор шинээр эхэлсэн ч, дэлгэц дээр хуучин combo хэвээр харагдаж, тоглогчид "яагаад л би энэ комбог дийлэх гэж оролдоод байгаа юм" гэсэн буруу мэдрэмж төрүүлдэг — **сервер талд алдаа байхгүй, зөвхөн UI хуучин state-ээ цэвэрлэдэггүй байсан хэрэг**.

**Зөв загвар**: `room.onStateChange`/`room.onMessage('hand', ...)`-аас ирсэн бүрд, **бүхэл дэлгэцээ (ширээ, гар, ээлж) шинэ өгөгдлөөр бүрэн дахин зурна** — өмнөх render-ийн үлдэгдэл (stale closure, хуучин useState) ашиглахгүй. React ашиглаж байгаа бол `state`/`hand`-ийг шууд `useState`-д оноож, тэрхүү state-ээр л бүх дэд component-уудаа зурах нь энгийн бөгөөд найдвартай арга.

---

## 4. Action илгээх (тоглох)

Action бүр `actionId` (client-generated, жишээ `crypto.randomUUID()`) дагуулах ёстой — давхар илгээвэл сервер `DUPLICATE_ACTION` алдаа буцаана.

```ts
// Host л дуудна, яг 4 тоглогч room-д байх ёстой
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
