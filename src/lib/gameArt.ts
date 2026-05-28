import type { CatalogGame } from '../types/repository.ts';

const PALETTES = [
  ['#101512', '#3f5f48', '#d6b36a'],
  ['#141118', '#7c3aed', '#d8d3c8'],
  ['#11171a', '#2f7b73', '#c9a65c'],
  ['#181211', '#9d3d36', '#d6c8a8'],
  ['#12131a', '#46516a', '#b59f72'],
  ['#101519', '#1f7a8c', '#d2b17b']
] as const;

export interface GeneratedGameArt {
  palette: readonly [string, string, string];
  posterStyle: Record<string, string>;
  heroStyle: Record<string, string>;
  initials: string;
}

export function createGameArt(game: Pick<CatalogGame, 'id' | 'title' | 'platform'>): GeneratedGameArt {
  const seed = hashString(`${game.id}:${game.platform}:${game.title}`);
  const palette = PALETTES[seed % PALETTES.length];
  const angle = 120 + (seed % 80);
  const offset = 18 + (seed % 46);
  const initials = game.title
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((word) => word[0]?.toUpperCase())
    .join('') || game.platform.slice(0, 3).toUpperCase();

  const posterPattern = [
    `linear-gradient(${angle}deg, ${palette[1]}cc 0%, transparent 38%)`,
    `linear-gradient(${angle + 62}deg, transparent 12%, ${palette[2]}88 48%, transparent 76%)`,
    `linear-gradient(180deg, ${palette[0]}, #050609 88%)`
  ].join(', ');

  const heroPattern = [
    `linear-gradient(96deg, #050609 0%, ${palette[0]} 39%, transparent 66%)`,
    `linear-gradient(24deg, transparent 30%, ${palette[1]}66 58%, ${palette[2]}33 86%)`,
    `linear-gradient(180deg, #141712 0%, #070806 100%)`
  ].join(', ');

  return {
    palette,
    initials,
    posterStyle: {
      backgroundImage: posterPattern
    },
    heroStyle: {
      backgroundImage: heroPattern
    }
  };
}

export function hashString(input: string): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
