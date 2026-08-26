import { Modal } from 'antd';

/** 异步确认框：resolve true=确认 / false=取消（替代散落各页的 Modal.confirm+Promise 样板） */
export function confirmAsync(opts: { title: string; content?: string; okText?: string }): Promise<boolean> {
  return new Promise((resolve) => {
    Modal.confirm({
      title: opts.title,
      content: opts.content,
      okText: opts.okText ?? '确定',
      onOk: () => resolve(true),
      onCancel: () => resolve(false),
    });
  });
}
