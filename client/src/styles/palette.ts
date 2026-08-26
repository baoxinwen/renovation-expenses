/** 居家暖木 · 调色板（唯一出处：theme.ts / echartsTheme.ts / ErrorBoundary 兜底页共用） */
export const PALETTE = {
  linen: '#faf7f2',
  darkBg: '#201c19',
  darkSurface: '#2a2521',
  ink: '#2b2622',
  darkInk: '#ede7df',
  ink2: '#6b6259',
  darkInk2: '#a79c90',
  wood: '#8c5e3c',
  woodDark: '#c89b72',
  woodHover: '#744a2e',
  woodLight: '#c9ad93',
  woodDarkDeep: '#6e523a',
  clay: '#b5542d',
  clayDark: '#d97b55',
  sage: '#7a8b6f',
  sageDark: '#9bac8e',
  amber: '#c08a3e',
  amberDark: '#d9a55c',
  line: '#e8e1d8',
  darkLine: '#3a342e',
} as const;

export function paletteFor(dark: boolean) {
  return {
    ink: dark ? PALETTE.darkInk : PALETTE.ink,
    ink2: dark ? PALETTE.darkInk2 : PALETTE.ink2,
    line: dark ? PALETTE.darkLine : PALETTE.line,
    surface: dark ? PALETTE.darkSurface : '#ffffff',
    chart: [
      dark ? PALETTE.woodDark : PALETTE.wood,
      dark ? PALETTE.sageDark : PALETTE.sage,
      dark ? PALETTE.amberDark : PALETTE.amber,
      dark ? PALETTE.clayDark : PALETTE.clay,
      dark ? PALETTE.woodDarkDeep : PALETTE.woodLight,
      dark ? PALETTE.darkInk2 : PALETTE.ink2,
    ],
  };
}
