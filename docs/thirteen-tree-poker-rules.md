# 13 модны покер — дүрэм ба realtime гэрээ

## Дүрэм

- 4 тоглогч, 52 хөзөр (жокергүй), тус бүрдээ 13 карт.
- Рэнк (доороос дээш): `3 4 5 6 7 8 9 10 J Q K A 2`. Масть (доороос дээш): `D < C < H < S`.
- Хослол: дан, хос, гурвал, 5-карт (доор харах).
- **Зөвхөн ижил хэмжээний хослолоор л идэгддэг** — дан↔дан, хос↔хос, гурвал↔гурвал, 5-карт↔5-карт.
- 5-картын дэд төрлийн зэрэглэл (доороос дээш): `straight < flush < full_house < four_kind < straight_flush`.
  - `four_kind` = 4 ижил рэнк + дурын 1 карт (kicker хамаагүй, зөвхөн дөрвөлийн рэнкээр харьцуулна).
  - `straight`/`straight_flush` хамгийн өндөр картаараа, `full_house` гурвалынхаа рэнкээр, `flush` картуудыг өндрөөс нь дараалан харьцуулж ялгарна.
- Match-ийн эхний гарт **3D**-тэй хүн эхэлдэг, ямар ч хослолоор чөлөөтэй эхэлж болно.
- Pass хийж болно (лидэрлэж байгаа үед л боломжгүй), тухайн trick-д л дахин тоглохгүй. Бүгд pass хийвэл сүүлд тавьсан хүн чөлөөтэй эхэлнэ.
- Нэг тоглогч картаа дуусгамагц тэр **гар (hand)** шууд дуусна; үлдсэн 3 тоглогчийн гарт байгаа картын тоо оноон дээр нэмэгдэнэ (**1-9 карт → ×1, 10-12 → ×2, 13 → ×3**). Ялагч дараагийн гарыг эхэлнэ.
- Аль нэг тоглогчийн нийт оноо `targetScore`-д (default 30) хүрмэгц **match шууд дуусна** — тэр хүн хожигдоно. ⚠️ Энэ бол баг доторх шийдвэр: хэрэв өөр 3 тоглогч цааш "устгагдах хүртэл" тоглох ёстой бол хэлээрэй, өөрчилье.

## REST → Colyseus гүүр (өмнөх баримт бичигт байгаа)

`POST /rooms` / `POST /rooms/join` — `targetScore`-ийг room үүсгэхдээ тохируулж болно (`CreateRoomRequest.targetScore`, default 30). WS холбогдохдоо `{ joinToken, code, displayName }` дамжуулна ([README.md](../README.md)-ийн "Өрөөнд нэгдэх урсгал" хэсгээс дэлгэрэнгүй).

## Client → Server action (`room.send('action', {...})`)

Бүх action `party-shared-types`-ийн `ThirteenTreePokerAction` дагуу:

```ts
{ actionId: string, type: 'start_game', payload: {} }
{ actionId: string, type: 'play_cards', payload: { cards: string[] } } // жишээ: ["7D", "7H"]
{ actionId: string, type: 'pass', payload: {} }
```

- `start_game` — зөвхөн `isHost === true` тоглогч, яг 4 тоглогч байгаа үед л ажиллана. Match дууссаны (`status === 'match_end'`) дараа дахин дуудаж шинэ match эхлүүлж болно.
- `actionId` — client-generated (жишээ UUID), давхар илгээвэл сервер `DUPLICATE_ACTION` алдаа буцаана.

## Server → Client

**Синхрон state** (`room.state`, `ThirteenTreePokerRoomState`):
- `status`: `waiting | playing | hand_end | match_end`
- `players`: map — `userId, displayName, seatIndex, connected, isHost, cardCount, matchScore, hasPassed, eliminated`
- `currentTurnUserId`, `leaderUserId`
- `lastComboCards` (хоосон бол одоогийн ээлжтэй хүн чөлөөтэй эхэлнэ), `lastComboSize`, `lastComboFiveKind`, `lastComboPlayedBy`
- `targetScore`, `handNumber`

**Хувийн зурвас** (`room.onMessage('hand', ...)`)  — зөвхөн эзэнд нь, тараах болон карт тавих бүрд шинэчлэгдэж дахин илгээгдэнэ:
```ts
{ hand: string[] } // жишээ: ["3D", "7H", "KS", ...]
```

**One-off broadcast** (`room.onMessage('hand_result' | 'match_result', ...)`):
```ts
// hand_result — гар бүр дууссан даруйд
{ handNumber: number, winnerUserId: string, penalties: { userId, cardsLeft, pointsAdded }[] }

// match_result — match дууссан даруйд
{ loserUserId: string, finalScores: { userId, matchScore }[] } // matchScore багаараа эрэмбэлэгдсэн
```

**Алдаа** (`room.onMessage('error', ...)`):
```ts
{ code: string, message: string } // RealtimeErrorCode: INVALID_ACTION, NOT_YOUR_TURN, DUPLICATE_ACTION, ...
```

## Хэрэгжилтийн байршил

- `src/games/thirteenTreePoker/deck.ts` — хөзрийн бүтэц, CSPRNG холилт, тараалт.
- `src/games/thirteenTreePoker/combos.ts` — хослол таних (`classifyCombo`) ба харьцуулах (`compareCombos`).
- `src/rooms/ThirteenTreePokerRoom.ts` — тоглолтын бүхэл урсгал (start/play/pass, гар/match дуусах, оноо, Supabase-д түүх бичих).

## TODO (дараа ярилцах)

- Match дууссаны дараа `profiles.total_score`/`level`-ийг хэрхэн шинэчлэх вэ (яг ямар томьёогоор) — шийдвэрлээгүй.
- Match дундуур нэг тоглогч бүрмөсөн гарвал (reconnect цонх дуусвал) яах вэ — одоогоор тодорхойгүй, гар дундаа царцах эрсдэлтэй.
