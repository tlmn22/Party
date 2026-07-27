# 13 модны покер — дүрэм ба realtime гэрээ

## Нэршил

```
room   (тогтмол, code-той)
  └─ match (start_game дуудахаас 1 идэвхтэй тоглогч үлдэх хүртэл)
       └─ round (1 тараалт → олон turn → 1 хүн картаа дуусгах хүртэл)
            └─ turn (нэг тоглогчийн 1 удаагийн play_cards/pass үйлдэл)
```

`hand` гэдэг үг зөвхөн **тоглогчийн гарт байгаа хөзөр** (`Card[]`) гэсэн утгаар үлдсэн — round-ыг "hand" гэж дахиж нэрлэхгүй.

## Дүрэм

- Match 4 тоглогчоор эхэлнэ, 52 хөзөр (жокергүй).
- Рэнк (доороос дээш): `3 4 5 6 7 8 9 10 J Q K A 2`. Масть (доороос дээш): `D < C < H < S`.
- Хослол: дан, хос, гурвал, 5-карт. **Зөвхөн ижил хэмжээгээр л идэгддэг** — дан↔дан, хос↔хос, гурвал↔гурвал, 5-карт↔5-карт.
- 5-картын дэд төрлийн зэрэглэл (доороос дээш): `straight < flush < full_house < four_kind < straight_flush`.
  - `four_kind` = 4 ижил рэнк + дурын 1 карт (kicker хамаагүй, зөвхөн дөрвөлийн рэнкээр харьцуулна).
  - `straight`/`straight_flush` хамгийн өндөр картаараа, `full_house` гурвалынхаа рэнкээр, `flush` картуудыг өндрөөс нь дараалан харьцуулж ялгарна.
- Match-ийн эхний round-д **3D**-тэй хүн эхэлдэг, ямар ч хослолоор чөлөөтэй эхэлж болно.
- Pass хийж болно (лидэрлэж байгаа үед л боломжгүй), тухайн trick-д л дахин тоглохгүй. Бүгд pass хийвэл сүүлд тавьсан хүн чөлөөтэй эхэлнэ.
- Нэг тоглогч картаа дуусгамагц тэр **round** шууд дуусна; бусад идэвхтэй тоглогчдын гарт байгаа картын тоо оноон дээр нэмэгдэнэ (**1-9 карт → ×1, 10-12 → ×2, 13 → ×3**). Round-ийн ялагч дараагийн round-ыг эхэлнэ.
- Идэвхтэй тоглогчийн нийт оноо `targetScore`-д (default 30) хүрмэгц **тэр даруй хасагдана** (elimination) — match-аас гарна, дараагийн round-уудад оролцохгүй.
  - **Дараагийн round**-ыг үлдсэн идэвхтэй тоглогчдод шинээр тараана — тус бүрдээ **13 карт** (жишээ 3 идэвхтэйтэй бол 13×3=39 хэрэглэж, үлдсэн 13-ыг тухайн round-д хэрэглэхгүй).
  - **Зөвхөн 1 идэвхтэй тоглогч үлдэхэд match дуусна** — тэр ялагч.
- **Placement (эцсийн байр) хасагдсан дарааллаараа тодорхойлогдоно** — эрт хасагдсан нь муу байрлалтай. Нэг round дээр хэд хэдэн хүн зэрэг хасагдвал, **өндөр оноотой нь муу байранд** (арагшаа) орно.

## REST → Colyseus гүүр

`POST /rooms` / `POST /rooms/join` — `targetScore`-ийг room үүсгэхдээ тохируулж болно (`CreateRoomRequest.targetScore`, default 30). WS холбогдохдоо `{ joinToken, code, displayName }` дамжуулна ([README.md](../README.md)-ийн "Өрөөнд нэгдэх урсгал" хэсгээс дэлгэрэнгүй).

## Client → Server action (`room.send('action', {...})`)

```ts
{ actionId: string, type: 'start_game', payload: {} }
{ actionId: string, type: 'play_cards', payload: { cards: string[] } } // жишээ: ["7D", "7H"]
{ actionId: string, type: 'pass', payload: {} }
```

- `start_game` — зөвхөн `isHost === true` тоглогч, яг 4 тоглогч room-д байгаа үед л ажиллана. Match дууссаны (`status === 'match_end'`) дараа дахин дуудаж шинэ match эхлүүлж болно (бүх тоглогч дахин идэвхтэй болно).
- `actionId` — client-generated (жишээ UUID), давхар илгээвэл сервер `DUPLICATE_ACTION` алдаа буцаана.

## Server → Client

**Синхрон state** (`room.state`, `ThirteenTreePokerRoomState`):
- `status`: `waiting | playing | round_end | match_end`
- `players`: map — `userId, displayName, seatIndex, connected, isHost, cardCount, matchScore, hasPassed, eliminated, placement` (`placement` 0 = тодорхойгүй, 1 = ялагч, 2-4 = хасагдсан дараалал)
- `currentTurnUserId`, `leaderUserId`
- `lastComboCards` (хоосон бол одоогийн ээлжтэй хүн чөлөөтэй эхэлнэ), `lastComboSize`, `lastComboFiveKind`, `lastComboPlayedBy`
- `targetScore`, `roundNumber`

**Хувийн зурвас** (`room.onMessage('hand', ...)`) — зөвхөн эзэнд нь, тараах болон карт тавих бүрд шинэчлэгдэж дахин илгээгдэнэ (хасагдахад хоосон `[]` илгээгдэнэ):
```ts
{ hand: string[] } // жишээ: ["3D", "7H", "KS", ...]
```

**One-off broadcast** (`room.onMessage('round_result' | 'match_result', ...)`):
```ts
// round_result — round бүр дууссан даруйд
{
  roundNumber: number,
  winnerUserId: string,
  penalties: { userId, cardsLeft, pointsAdded }[],
  eliminated: { userId, placement }[], // ихэвчлэн хоосон, 1+ тоглогч зэрэг хасагдаж болно
}

// match_result — match дууссан даруйд (1 идэвхтэй тоглогч үлдэхэд)
{
  winnerUserId: string,
  finalScores: { userId, matchScore, placement }[], // placement-аар эрэмбэлэгдсэн, 1 эхэнд
}
```

**Алдаа** (`room.onMessage('error', ...)`):
```ts
{ code: string, message: string } // RealtimeErrorCode: INVALID_ACTION, NOT_YOUR_TURN, DUPLICATE_ACTION, ...
```

## Хэрэгжилтийн байршил

- `src/games/thirteenTreePoker/deck.ts` — хөзрийн бүтэц, CSPRNG холилт, тараалт (идэвхтэй тоглогчийн тоогоор уян хатан, жишээ 3 тоглогчтой бол 39 карт хэрэглэнэ).
- `src/games/thirteenTreePoker/combos.ts` — хослол таних (`classifyCombo`) ба харьцуулах (`compareCombos`).
- `src/rooms/ThirteenTreePokerRoom.ts` — бүхэл урсгал: round дуусах → оноо → elimination шалгах → 1 үлдвэл match дуусах, эсвэл дараагийн round-ыг үлдсэн идэвхтэй тоглогчдод тараах.

## Турших

`@colyseus/testing`-ээр бот тоглогчидтой (зөвхөн дан хөзөр тоглодог энгийн стратеги) бодит 14 round-той match ажиллуулж баталгаажуулсан — 4→3→2→1 идэвхтэй тоглогчоор шилжиж, placement зөв (хасагдсан дараалал, оноогоор биш) оноогдож байгааг шалгасан.

## TODO (дараа ярилцах)

- Match дууссаны дараа `profiles.total_score`/`level`-ийг хэрхэн шинэчлэх вэ (яг ямар томьёогоор) — шийдвэрлээгүй.
- Match дундуур нэг тоглогч бүрмөсөн гарвал (reconnect цонх дуусвал) яах вэ — одоогоор тодорхойгүй, round дундаа царцах эрсдэлтэй.
