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
    // 分层底色遵循大厂质感铁律 1（与 tokens.css 同步）：底/面/浮层靠微明度差分层
    colorBgLayout: dark ? PALETTE.darkBg : PALETTE.linen,
    colorBgContainer: dark ? PALETTE.darkSurface : '#fcfcfb',
    colorBgElevated: dark ? '#20201e' : '#ffffff',
    colorBorder: dark ? PALETTE.darkLine : PALETTE.line,
    colorBorderSecondary: dark ? '#20201e' : '#f0f0ee',
    colorText: dark ? PALETTE.darkInk : PALETTE.ink,
    colorTextSecondary: dark ? PALETTE.darkInk2 : PALETTE.ink2,
    borderRadius: 8,
    fontFamily: '-apple-system, "Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif',
    controlHeight: 32,
  },
  components: {
    Table: {
      headerBg: dark ? '#1a1a19' : '#f0f0ed',
      headerColor: dark ? '#a79c90' : '#6b6259',
      rowHoverBg: dark ? '#20201e' : '#f7f1ea',
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
      // 铁律 3：暗色白字发胖补偿，字重降 40
      fontWeight: dark ? 460 : 500,
    },
  },
});
