import { Drawer, Modal } from 'antd';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import ArticleReader from '@/components/article/ArticleReader';

interface ArticleDetailModalProps {
  articleId: number | null;
  open: boolean;
  onClose: () => void;
}

export default function ArticleDetailModal({ articleId, open, onClose }: ArticleDetailModalProps) {
  const { isMobile } = useBreakpoint();

  if (isMobile) {
    return (
      <Drawer
        open={open}
        onClose={onClose}
        placement="right"
        width="100%"
        closable={false}
        className="m-reader"
        styles={{ header: { display: 'none' }, body: { padding: 0 } }}
        destroyOnHidden
      >
        {articleId !== null && (
          <ArticleReader articleId={articleId} dismiss="back" onDismiss={onClose} onDeleted={onClose} />
        )}
      </Drawer>
    );
  }

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      closable={false}
      width={880}
      centered
      destroyOnHidden
      className="reader-modal"
      styles={{
        content: { padding: 0, overflow: 'hidden' },
        body: { maxHeight: '86vh', overflowY: 'auto', background: 'var(--c-surface)' },
      }}
    >
      {articleId !== null && (
        <ArticleReader articleId={articleId} dismiss="close" onDismiss={onClose} onDeleted={onClose} />
      )}
    </Modal>
  );
}
