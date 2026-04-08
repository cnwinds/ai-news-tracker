import { useEffect, useState } from 'react';
import {
  Button,
  Card,
  Drawer,
  Empty,
  Input,
  List,
  Space,
  Spin,
  Tag,
  Typography,
} from 'antd';
import { ApartmentOutlined, AimOutlined, CommentOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';

import { apiService } from '@/services/api';
import { useAIConversation } from '@/contexts/AIConversationContext';
import { useKnowledgeGraphView } from '@/contexts/KnowledgeGraphViewContext';
import type { AIQueryEngine } from '@/types';
import { buildCommunityQuestion } from '@/utils/knowledgeGraph';

const { Paragraph, Text, Title } = Typography;
const { TextArea } = Input;

interface KnowledgeGraphCommunityDrawerProps {
  open: boolean;
  communityId?: number;
  onClose: () => void;
}

export default function KnowledgeGraphCommunityDrawer({
  open,
  communityId,
  onClose,
}: KnowledgeGraphCommunityDrawerProps) {
  const [customQuestion, setCustomQuestion] = useState('');
  const { openModal, setSelectedEngine } = useAIConversation();
  const { focusArticle, focusCommunity, focusNode } = useKnowledgeGraphView();

  const { data: detail, isLoading } = useQuery({
    queryKey: ['knowledge-graph-community-detail', communityId],
    queryFn: () => apiService.getKnowledgeGraphCommunity(communityId!),
    enabled: open && communityId !== undefined,
  });

  useEffect(() => {
    if (!open) {
      setCustomQuestion('');
    }
  }, [open]);

  const handleAsk = (mode: AIQueryEngine) => {
    if (!detail) {
      return;
    }
    const question = buildCommunityQuestion(detail.community.label, mode, customQuestion);
    setSelectedEngine(mode);
    openModal(question);
  };

  return (
    <Drawer
      title="社区钻取"
      placement="right"
      width={440}
      open={open}
      onClose={onClose}
      destroyOnClose={false}
    >
      {isLoading ? (
        <div style={{ padding: '48px 0', textAlign: 'center' }}>
          <Spin />
        </div>
      ) : !detail ? (
        <Empty description="当前社区详情不可用" />
      ) : (
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <Card size="small">
            <Space direction="vertical" size="middle" style={{ width: '100%' }}>
              <div>
                <Title level={4} style={{ margin: 0 }}>
                  {detail.community.label}
                </Title>
                <Text type="secondary">社区 ID: {detail.community.community_id}</Text>
              </div>
              <Space wrap size={[8, 8]}>
                <Tag color="blue">节点 {detail.community.node_count}</Tag>
                <Tag>边 {detail.community.edge_count}</Tag>
                <Tag>文章 {detail.community.article_count}</Tag>
              </Space>
              <Paragraph style={{ marginBottom: 0 }}>{detail.summary_text}</Paragraph>
              {detail.relation_types.length > 0 && (
                <div>
                  <Text strong>主导关系</Text>
                  <div style={{ marginTop: 8 }}>
                    {detail.relation_types.map((relationType) => (
                      <Tag key={relationType}>{relationType}</Tag>
                    ))}
                  </div>
                </div>
              )}
              <Space wrap>
                <Button
                  icon={<AimOutlined />}
                  onClick={() =>
                    focusCommunity(detail.community.community_id, {
                      selectedNodeKey: detail.community.top_nodes[0]?.node_key,
                    })
                  }
                >
                  聚焦社区
                </Button>
                <Button
                  type="primary"
                  icon={<CommentOutlined />}
                  onClick={() => handleAsk('graph')}
                >
                  Graph 问答
                </Button>
                <Button onClick={() => handleAsk('hybrid')}>Hybrid 问答</Button>
              </Space>
            </Space>
          </Card>

          <Card size="small" title="社区问答">
            <Space direction="vertical" size="middle" style={{ width: '100%' }}>
              <TextArea
                value={customQuestion}
                onChange={(event) => setCustomQuestion(event.target.value)}
                autoSize={{ minRows: 3, maxRows: 6 }}
                placeholder={`例如：请总结社区「${detail.community.label}」中最重要的实体关系变化`}
              />
              <Space wrap>
                <Button type="primary" onClick={() => handleAsk('graph')}>
                  发送到 Graph
                </Button>
                <Button onClick={() => handleAsk('hybrid')}>发送到 Hybrid</Button>
              </Space>
            </Space>
          </Card>

          <Card
            size="small"
            title={
              <Space size={8}>
                <ApartmentOutlined />
                <span>代表节点</span>
              </Space>
            }
          >
            <List
              size="small"
              dataSource={detail.nodes.slice(0, 12)}
              locale={{ emptyText: '暂无节点' }}
              renderItem={(node) => (
                <List.Item
                  actions={[
                    <Button
                      key="focus-node"
                      type="link"
                      size="small"
                      onClick={() => focusNode(node.node_key, { communityId: detail.community.community_id })}
                    >
                      在画布中查看
                    </Button>,
                  ]}
                >
                  <Space direction="vertical" size={0} style={{ width: '100%' }}>
                    <Text strong>{node.label}</Text>
                    <Text type="secondary">
                      {node.node_type} · 度数 {node.degree} · 文章 {node.article_count}
                    </Text>
                  </Space>
                </List.Item>
              )}
            />
          </Card>

          <Card size="small" title="代表文章">
            <List
              size="small"
              dataSource={detail.articles}
              locale={{ emptyText: '暂无文章' }}
              renderItem={(article) => (
                <List.Item
                  actions={[
                    <Button
                      key="focus-article"
                      type="link"
                      size="small"
                      onClick={() => focusArticle(article.id, { communityId: detail.community.community_id })}
                    >
                      图谱定位
                    </Button>,
                  ]}
                >
                  <Space direction="vertical" size={0} style={{ width: '100%' }}>
                    <a href={article.url} target="_blank" rel="noreferrer">
                      {article.title_zh || article.title}
                    </a>
                    <Text type="secondary">{article.source}</Text>
                  </Space>
                </List.Item>
              )}
            />
          </Card>
        </Space>
      )}
    </Drawer>
  );
}
