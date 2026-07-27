import { randomInt } from 'crypto';
import { Card, CardRank, CardSuit, CARD_RANKS_LOW_TO_HIGH, CARD_SUITS_LOW_TO_HIGH } from 'party-shared-types';

export function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const rank of CARD_RANKS_LOW_TO_HIGH) {
    for (const suit of CARD_SUITS_LOW_TO_HIGH) {
      deck.push(`${rank}${suit}`);
    }
  }
  return deck;
}

// Fisher-Yates using a CSPRNG (crypto.randomInt) rather than Math.random(), so
// hands can't be predicted or replayed by guessing the RNG's internal state.
export function shuffleDeck(deck: Card[]): Card[] {
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

// Round-robin deal (one card at a time per player), matching how a real deck is dealt.
export function dealHands(playerCount: number, cardsPerPlayer = 13): Card[][] {
  const deck = shuffleDeck(createDeck());
  const hands: Card[][] = Array.from({ length: playerCount }, () => []);
  for (let i = 0; i < playerCount * cardsPerPlayer; i++) {
    hands[i % playerCount].push(deck[i]);
  }
  return hands;
}

export function parseCard(card: Card): { rank: CardRank; suit: CardSuit } {
  return {
    rank: card.slice(0, -1) as CardRank,
    suit: card.slice(-1) as CardSuit,
  };
}

export function rankIndex(rank: CardRank): number {
  return CARD_RANKS_LOW_TO_HIGH.indexOf(rank);
}

export function suitIndex(suit: CardSuit): number {
  return CARD_SUITS_LOW_TO_HIGH.indexOf(suit);
}
