import { theme as antdTheme } from 'antd';
import type { ThemeConfig } from 'antd';

// 居家暖木 · AntD 令牌配置（亮/暗共用色相，暗色由 darkAlgorithm 自动推导再微调）
export const woodTheme = (dark: boolean): ThemeConfig => ({
  algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
  token: {
    colorPrimary: dark ? '#c89b72' : '#8c5e3c',
    colorInfo: dark ? '#c89b72' : '#8c5e3c',
    colorSuccess: dark ? '#9bac8e' : '#7a8b6f',
    colorError: dark ? '#d97b55' : '#b5542d',
    colorWarning: dark ? '#d9a55c' : '#c08a3e',
    colorBgLayout: dark ? '#201c19' : '#faf7f2',
    colorBgContainer: dark ? '#2a2521' : '#ffffff',
    colorBgElevated: dark ? '#332d28' : '#ffffff',
    colorBorder: dark ? '#3a342e' : '#e8e1d8',
    colorBorderSecondary: dark ? '#332d28' : '#f0eae1',
    colorText: dark ? '#ede7df' : '#2b2622',
    colorTextSecondary: dark ? '#a79c90' : '#6b6259',
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
