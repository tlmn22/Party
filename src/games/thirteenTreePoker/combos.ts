import { Card, CardRank, FiveCardComboKind, PlayedCombo } from 'party-shared-types';
import { parseCard, rankIndex, suitIndex } from './deck';

const FIVE_KIND_TIER: Record<FiveCardComboKind, number> = {
  straight: 0,
  flush: 1,
  full_house: 2,
  four_kind: 3,
  straight_flush: 4,
};

/** Returns null when `cards` don't form any legal play (single/pair/triple/five-card hand). */
export function classifyCombo(cards: Card[]): PlayedCombo | null {
  if (new Set(cards).size !== cards.length) return null; // no duplicate card in one play

  if (cards.length === 1) return { cards, size: 'single' };

  if (cards.length === 2) {
    const [a, b] = cards.map(parseCard);
    return a.rank === b.rank ? { cards, size: 'pair' } : null;
  }

  if (cards.length === 3) {
    const parsed = cards.map(parseCard);
    return parsed.every((c) => c.rank === parsed[0].rank) ? { cards, size: 'triple' } : null;
  }

  if (cards.length === 5) {
    const fiveKind = classifyFiveCardKind(cards);
    return fiveKind ? { cards, size: 'five', fiveKind } : null;
  }

  return null; // no other play sizes are legal
}

function classifyFiveCardKind(cards: Card[]): FiveCardComboKind | null {
  const parsed = cards.map(parseCard);
  const countByRank = new Map<CardRank, number>();
  for (const { rank } of parsed) countByRank.set(rank, (countByRank.get(rank) ?? 0) + 1);
  const counts = [...countByRank.values()].sort((a, b) => b - a);
  const isFlush = new Set(parsed.map((c) => c.suit)).size === 1;

  if (counts[0] === 4) return 'four_kind';
  if (counts[0] === 3 && counts[1] === 2) return 'full_house';

  if (counts.every((c) => c === 1)) {
    const indices = parsed.map((c) => rankIndex(c.rank)).sort((a, b) => a - b);
    const isConsecutive = indices.every((v, i) => i === 0 || v === indices[i - 1] + 1);
    if (isConsecutive && isFlush) return 'straight_flush';
    if (isConsecutive) return 'straight';
    if (isFlush) return 'flush';
  }

  return null; // e.g. two-pair+single, triple+two-singles — not a legal 5-card play here
}

function singleValue(card: Card): number {
  const { rank, suit } = parseCard(card);
  return rankIndex(rank) * 4 + suitIndex(suit);
}

function highestCardValue(cards: Card[]): number {
  return Math.max(...cards.map((c) => rankIndex(parseCard(c).rank)));
}

function rankAppearingNTimes(cards: Card[], n: number): number {
  const counts = new Map<CardRank, number>();
  for (const card of cards) {
    const { rank } = parseCard(card);
    counts.set(rank, (counts.get(rank) ?? 0) + 1);
  }
  const found = [...counts.entries()].find(([, count]) => count === n);
  return rankIndex(found![0]);
}

function flushSortedValues(cards: Card[]): number[] {
  return cards.map((c) => rankIndex(parseCard(c).rank)).sort((a, b) => b - a);
}

/**
 * Positive if `a` beats `b`, negative if `b` beats `a`, 0 if equal.
 * Only meaningful when `a.size === b.size` — the room must check the size
 * category matches before calling this (a triple never beats a pair, etc.).
 */
export function compareCombos(a: PlayedCombo, b: PlayedCombo): number {
  if (a.size === 'single') return singleValue(a.cards[0]) - singleValue(b.cards[0]);

  if (a.size === 'pair' || a.size === 'triple') {
    return rankIndex(parseCard(a.cards[0]).rank) - rankIndex(parseCard(b.cards[0]).rank);
  }

  // five-card hand: compare by kind tier first, then by the kind's own tiebreak rule
  const tierDiff = FIVE_KIND_TIER[a.fiveKind as FiveCardComboKind] - FIVE_KIND_TIER[b.fiveKind as FiveCardComboKind];
  if (tierDiff !== 0) return tierDiff;

  switch (a.fiveKind) {
    case 'straight':
    case 'straight_flush':
      return highestCardValue(a.cards) - highestCardValue(b.cards);
    case 'four_kind':
      return rankAppearingNTimes(a.cards, 4) - rankAppearingNTimes(b.cards, 4);
    case 'full_house':
      return rankAppearingNTimes(a.cards, 3) - rankAppearingNTimes(b.cards, 3);
    case 'flush':
    default: {
      const av = flushSortedValues(a.cards);
      const bv = flushSortedValues(b.cards);
      for (let i = 0; i < av.length; i++) {
        if (av[i] !== bv[i]) return av[i] - bv[i];
      }
      return 0;
    }
  }
}
