import { useEffect, useState } from 'react';
import { Button, Card, InputNumber, Radio, Space, Typography } from 'antd';
import { toast } from 'sonner';
import { api } from '../api';
import { fmtMoney } from '../format';
import { useThemeModeCtx } from '../App';
import type { ThemeMode } from '../hooks/useThemeMode';

export default function Settings() {
  const { mode, setMode } = useThemeModeCtx();
  const [totalBudget, setTotalBudget] = useState(0);
  const [budgetInput, setBudgetInput] = useState<number | null>(0);
  const [saving, setSaving] = useState(false);
  const [planTotal, setPlanTotal] = useState(0);
  const [actualTotal, setActualTotal] = useState(0);

  useEffect(() => {
    Promise.all([api.getSettings(), api.getSummary()])
      .then(([s, sum]) => {
        setTotalBudget(s.total_budget);
        setBudgetInput(s.total_budget);
        setPlanTotal(sum.plan_total);
        setActualTotal(sum.actual_total);
      })
      .catch((e) => toast.error((e as Error).message));
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await api.saveSettings(budgetInput ?? 0);
      toast.success('预算目标已保存');
      const s = await api.getSettings();
      setTotalBudget(s.total_budget);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card title="外观">
        <Space direction="vertical" size={8}>
          <Radio.Group
            value={mode}
            onChange={(e) => setMode(e.target.value as ThemeMode)}
            optionType="button"
            buttonStyle="solid"
            options={[
              { value: 'system', label: '跟随系统' },
              { value: 'light', label: '浅色 · 亚麻日间' },
              { value: 'dark', label: '深色 · 暖木夜间' },
            ]}
          />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            跟随系统时会随操作系统的亮暗设置自动切换
          </Typography.Text>
        </Space>
      </Card>

      <Card title="预算目标">
        <Space wrap>
          <InputNumber
            min={0}
            precision={2}
            value={budgetInput}
            onChange={setBudgetInput}
            formatter={(v) => `¥ ${v ?? 0}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
            parser={(t) => Number(String(t).replace(/[^\d.]/g, ''))}
            style={{ width: 200 }}
            size="large"
          />
          <Button type="primary" loading={saving} onClick={save}>保存</Button>
          <Typography.Text type="secondary" className="tabular">
            当前目标：{fmtMoney(totalBudget)}　清单总计：{fmtMoney(planTotal)}　实际已花：{fmtMoney(actualTotal)}
          </Typography.Text>
        </Space>
      </Card>

      <Card title="数据备份">
        <Typography.Paragraph>
          全部数据（数据库 + 票据照片）保存在程序目录的 <Typography.Text code>data</Typography.Text> 文件夹中。
          备份方法：关闭账本后，把整个 <Typography.Text code>data</Typography.Text> 文件夹复制到移动硬盘或网盘；
          恢复时用备份覆盖回来即可。也可以在预算清单页导出 Excel 作为轻量备份（不含照片、付款）。
        </Typography.Paragraph>
      </Card>

      <Card title="记账口径说明">
        <Typography.Paragraph>
          <Typography.Text strong>预算</Typography.Text>：清单里每项 数量 × 单价，板块与全案自动小计、总计；与「预算目标」对比得出超支/结余。
        </Typography.Paragraph>
        <Typography.Paragraph>
          <Typography.Text strong>实际</Typography.Text>：小件买完把清单里的单价改成成交价并勾「已买」（总价计入实际）；
          定金/尾款等多次付款的大件用「订单」挂在项目下，付款计入项目实际。退货退款在付款里记负数自动冲抵。
        </Typography.Paragraph>
        <Typography.Paragraph type="secondary">
          注意：同一项目避免既勾「已买」又挂订单付款，否则会重复计入实际合计。
        </Typography.Paragraph>
      </Card>
    </Space>
  );
}
