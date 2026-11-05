import { useState } from 'react';
import { Button, Drawer, Empty, Input, Modal, Space } from 'antd';
import { toast } from 'sonner';
import { api } from '../../api';
import type { Section } from '../../api';
import { undoableDelete } from '../../utils/domain';

/** 移动端板块管理：新增 / 改名 / 删除（软删 + 8 秒撤销，与桌面同语义）。
 *  删除确认文案抄桌面 Plan.tsx（含连带项目数与口径说明）。 */
export default function MobileSectionManager({ open, sections, onClose, onChanged }: {
  open: boolean;
  sections: Section[];
  onClose: () => void;
  onChanged: () => void;
}) {
  // 正在改名的板块 id（该行切换为输入框）；新建板块输入框
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [newName, setNewName] = useState('');

  const submitRename = async (sec: Section) => {
    const name = renameValue.trim();
    if (!name || name === sec.name) { setRenamingId(null); return; }
    try {
      await api.updateSection(sec.id, { name });
      toast.success('已改名');
      setRenamingId(null);
      onChanged();
    } catch (e) {
      toast.error((e as Error).message); // 重名 400 等服务端校验，保留输入让用户改
    }
  };

  const deleteSection = (sec: Section) =>
    Modal.confirm({
      title: `删除板块「${sec.name}」？`,
      content: `板块下 ${(sec.items ?? []).length} 个项目会一并移出清单（订单与付款保留但不再计入统计）。删除后 8 秒内可撤销。`,
      okType: 'danger',
      okText: '删除',
      onOk: () => undoableDelete({
        label: sec.name,
        del: () => api.deleteSection(sec.id),
        restore: () => api.restoreSection(sec.id),
        onChanged,
      }),
    });

  const addSection = async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      await api.addSection(name);
      toast.success('板块已添加');
      setNewName('');
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <Drawer
      placement="bottom" open={open} onClose={onClose} height="auto" title="管理板块"
      styles={{ body: { paddingTop: 8, maxHeight: '60vh', overflowY: 'auto' } }}
    >
      {sections.length === 0 ? (
        <Empty description="还没有板块" style={{ padding: 16 }} />
      ) : (
        <div>
          {sections.map((sec) => (
            <div key={sec.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 0', borderBottom: '1px solid var(--line)', minHeight: 48 }}>
              {renamingId === sec.id ? (
                <>
                  <Input
                    autoFocus
                    defaultValue={sec.name}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onPressEnter={() => submitRename(sec)}
                    maxLength={60}
                    style={{ flex: 1 }}
                  />
                  <Button type="primary" size="small" onClick={() => submitRename(sec)}>保存</Button>
                  <Button size="small" onClick={() => setRenamingId(null)}>取消</Button>
                </>
              ) : (
                <>
                  <span style={{ flex: 1, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {sec.name}
                    <span className="tabular" style={{ color: 'var(--ink-2)', fontSize: 12, fontWeight: 400, marginLeft: 8 }}>
                      {(sec.items ?? []).length} 项
                    </span>
                  </span>
                  <Button type="text" size="small" onClick={() => { setRenamingId(sec.id); setRenameValue(sec.name); }}>改名</Button>
                  <Button type="text" size="small" danger onClick={() => deleteSection(sec)}>删除</Button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
      <Space.Compact block style={{ marginTop: 16 }}>
        <Input
          placeholder="新板块名称"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onPressEnter={addSection}
          maxLength={60}
        />
        <Button type="primary" onClick={addSection}>新增板块</Button>
      </Space.Compact>
    </Drawer>
  );
}
