import { Button, Upload } from 'antd';
import { PaperClipOutlined } from '@ant-design/icons';
import type { Dispatch, SetStateAction } from 'react';

/**
 * 票据照片选择器（三个弹窗共用）。
 * 受控 files + 函数式 setFiles：antd 多选在同 tick 逐个回调，必须函数式更新才不丢文件。
 */
export default function ReceiptUploader({ files, setFiles, compact }: {
  files: File[];
  setFiles: Dispatch<SetStateAction<File[]>>;
  /** compact=true 时用于表单内的轻量按钮样式 */
  compact?: boolean;
}) {
  return (
    <Upload
      accept=".jpg,.jpeg,.png,.webp"
      multiple
      fileList={files.map((f, i) => ({ uid: `k${i}`, name: f.name, status: 'done' } as never))}
      beforeUpload={(file) => {
        setFiles((prev) => [...prev, file as unknown as File]);
        return false;
      }}
      onRemove={(file) => {
        const idx = Number(String(file.uid).slice(1));
        setFiles((prev) => prev.filter((_, i) => i !== idx));
      }}
    >
      {compact ? (
        <Button icon={<PaperClipOutlined />}>拍照 / 相册</Button>
      ) : (
        <div style={{ fontSize: 12, color: 'var(--ink-2)' }}>
          <PaperClipOutlined /> 添加票据
        </div>
      )}
    </Upload>
  );
}
