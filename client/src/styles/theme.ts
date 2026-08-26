import { theme as antdTheme } from 'antd';
import { PALETTE } from './palette';
import type { ThemeConfig } from 'antd';

// 居家暖木 · AntD 令牌配置（亮/暗共用色相，暗色由 darkAlgorithm 自动推导再微调）
export const woodTheme = (dark: boolean): ThemeConfig => ({
  algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
  token: {
    colorPrimary: dark ? PALETTE.woodDark : PALETTE.wood,
    colorInfo: dark ? PALETTE.woodDark : PALETTE.wood,
    colorSuccess: dark ? PALETTE.sageDark : PALETTE.sage,
    colorError: dark ? PALETTE.clayDark : PALETTE.clay,
    colorWarning: dark ? PALETTE.amberDark : PALETTE.amber,
    colorBgLayout: dark ? PALETTE.darkBg : PALETTE.linen,
    colorBgContainer: dark ? PALETTE.darkSurface : '#ffffff',
    colorBgElevated: dark ? '#332d28' : '#ffffff',
    colorBorder: dark ? PALETTE.darkLine : PALETTE.line,
    colorBorderSecondary: dark ? '#332d28' : '#f0eae1',
    colorText: dark ? PALETTE.darkInk : PALETTE.ink,
    colorTextSecondary: dark ? PALETTE.darkInk2 : PALETTE.ink2,
    borderRadius: 8,
    fontFamily: '-apple-system, "Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif',
    controlHeight: 32,
  },
  components: {
    Table: {
      headerBg: dark ? '#332d28' : '#f5f0e9',
      headerColor: dark ? '#a79c90' : '#6b6259',
      rowHoverBg: dark ? '#322b25' : '#f7f1ea',
      cellPaddingBlockSM: 6,
      cellPaddingInlineSM: 10,
    },
    Menu: {
      itemBg: 'transparent',
      itemSelectedBg: dark ? '#3a3129' : '#f0e7dd',
      itemSelectedColor: dark ? '#d8b28c' : '#744a2e',
      itemColor: dark ? '#a79c90' : '#6b6259',
      itemHoverBg: dark ? '#332d28' : '#f5f0e9',
      activeBarBorderWidth: 0,
      itemMarginInline: 8,
      itemBorderRadius: 8,
    },
    Card: {
      paddingLG: 20,
    },
    Statistic: {
      contentFontSize: 26,
    },
    Modal: {
      titleFontSize: 16,
    },
    Button: {
      controlHeight: 32,
      fontWeight: 500,
    },
  },
});
