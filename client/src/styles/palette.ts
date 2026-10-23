/** 居家暖木 · 调色板（唯一出处：theme.ts / echartsTheme.ts / ErrorBoundary 兜底页共用）
 *  底面分层色遵循大厂质感铁律 1：微明度分层、禁纯黑（与 tokens.css 同步） */
export const PALETTE = {
  linen: '#f5f5f3',
  darkBg: '#0b0b0a',
  darkSurface: '#151515',
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
  line: '#e8e8e6',
  darkLine: '#262624',
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
