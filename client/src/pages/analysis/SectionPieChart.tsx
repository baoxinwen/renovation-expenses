import { useMemo, useState } from 'react';
import { Segmented, Space } from 'antd';
import ReactECharts from 'echarts-for-react';
import type { Charts } from '../../api';
import { fmtMoney } from '../../format';
import { ChartCard, useChartTheme } from './shared';

// 板块分布环形图：预算/实际双口径切换，中心显示总额（spec 功能 A，数据源 by_section）
export default function SectionPieChart({ charts }: { charts: Charts | null }) {
  const { themeName } = useChartTheme();
  const [mode, setMode] = useState<'budget' | 'actual'>('budget');

  // 0 值板块不出扇区（spec A-2）
  const data = useMemo(
    () => (charts?.by_section ?? [])
      .filter((s) => s[mode] > 0)
      .map((s) => ({ name: s.name, value: s[mode] })),
    [charts, mode],
  );
  const total = data.reduce((n, d) => n + d.value, 0);

  const option = useMemo(() => ({
    tooltip: { trigger: 'item', valueFormatter: (v: number) => fmtMoney(v) },
    legend: { bottom: 0 },
    title: {
      text: fmtMoney(total),
      subtext: mode === 'budget' ? '预算' : '实际',
      left: 'center', top: '40%',
      textStyle: { fontSize: 15, fontWeight: 600 },
      subtextStyle: { fontSize: 12 },
    },
    series: [{
      type: 'pie',
      radius: ['45%', '68%'],
      center: ['50%', '46%'],
      data,
      label: { formatter: '{b}\n{d}%' },
    }],
  }), [data, total, mode]);

  return (
    <ChartCard
      title={(
        <Space size={12}>
          板块分布
          <Segmented
            size="small"
            value={mode}
            onChange={(v) => setMode(v as 'budget' | 'actual')}
            options={[
              { label: '预算', value: 'budget' },
              { label: '实际', value: 'actual' },
            ]}
          />
        </Space>
      )}
      isEmpty={data.length === 0}
      emptyText={mode === 'budget' ? '预算还没排上——先到清单页填项目' : '还没有实际支出'}
    >
      <ReactECharts option={option} theme={themeName} notMerge style={{ height: 320 }} />
    </ChartCard>
  );
}
