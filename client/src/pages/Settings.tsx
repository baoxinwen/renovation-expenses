import { useEffect, useState } from 'react';
import { Alert, Button, Card, InputNumber, Modal, Radio, Space, Typography, Upload } from 'antd';
import { CloudDownloadOutlined, QuestionCircleOutlined, UploadOutlined } from '@ant-design/icons';
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
  const [downloading, setDownloading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [itemCount, setItemCount] = useState(0);

  useEffect(() => {
    Promise.all([api.getSettings(), api.getSummary()])
      .then(([s, sum]) => {
        setTotalBudget(s.total_budget);
        setBudgetInput(s.total_budget);
        setPlanTotal(sum.plan_total);
        setActualTotal(sum.actual_total);
        setItemCount(sum.sections.reduce((n, sec) => n + (sec.item_count ?? 0), 0));
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

  // 一键备份：流式下载（数据库 + 票据 zip），loading 防重复点击
  const downloadBackup = async () => {
    setDownloading(true);
    try {
      const res = await fetch('/api/export/backup');
      if (!res.ok) throw new Error(`备份失败（${res.status}）`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'renovation-backup.zip';
      a.click();
      URL.revokeObjectURL(url);
      toast.success('备份已下载');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setDownloading(false);
    }
  };

  // 恢复：上传备份 zip 全量替换当前数据（不可逆），前端红色确认列出当前规模
  const restoreBackup = async (file: File) => {
    Modal.confirm({
      title: '确认恢复备份？',
      icon: <QuestionCircleOutlined style={{ color: 'var(--clay)' }} />,
      content: (
        <Typography.Paragraph type="danger" style={{ marginBottom: 0 }}>
          将覆盖当前全部数据（{itemCount} 个项目），此操作不可撤销。恢复成功后页面会自动刷新。
        </Typography.Paragraph>
      ),
      okText: '恢复并覆盖',
      okButtonProps: { danger: true, loading: restoring },
      onOk: async () => {
        setRestoring(true);
        try {
          const fd = new FormData();
          fd.append('file', file);
          const res = await fetch('/api/restore/backup', { method: 'POST', body: fd });
          const json = await res.json().catch(() => null);
          if (!res.ok) throw new Error(json?.message ?? `恢复失败（${res.status}）`);
          toast.success('恢复成功，正在刷新页面');
          setTimeout(() => window.location.reload(), 600);
        } catch (e) {
          setRestoring(false);
          toast.error((e as Error).message);
        }
      },
    });
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
            inputMode="decimal"
          />
          <Button type="primary" loading={saving} onClick={save}>保存</Button>
          <Typography.Text type="secondary" className="tabular">
            当前目标：{fmtMoney(totalBudget)}　清单总计：{fmtMoney(planTotal)}　实际已花：{fmtMoney(actualTotal)}
          </Typography.Text>
        </Space>
      </Card>

      <Card title="数据备份">
        <Space wrap>
          <Button icon={<CloudDownloadOutlined />} loading={downloading} onClick={downloadBackup}>
            立即备份
          </Button>
          <Upload accept=".zip" showUploadList={false} beforeUpload={(file) => { restoreBackup(file); return false; }}>
            <Button icon={<UploadOutlined />} loading={restoring}>恢复备份</Button>
          </Upload>
        </Space>
        <Alert
          type="warning"
          showIcon
          style={{ marginTop: 12 }}
          message="恢复会用备份覆盖当前全部数据（含票据），不可撤销。"
        />
      </Card>
    </Space>
  );
}
