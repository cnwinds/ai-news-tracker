import type { AIQueryEngine, KnowledgeGraphNodeSummary } from '@/types';

export function buildKnowledgeGraphEdgeKey(source: string, target: string) {
  return [source, target].sort().join('::');
}

export function buildKnowledgeGraphArticleNodeKey(articleId: number) {
  return `article:${articleId}`;
}

export function buildCommunityQuestion(label: string, mode: AIQueryEngine, customPrompt?: string) {
  const prompt = customPrompt?.trim();
  if (prompt) {
    return prompt;
  }

  if (mode === 'hybrid') {
    return `请结合知识图谱与相关文章，总结社区「${label}」的核心主题、关键实体关系和最新变化。`;
  }

  return `请基于知识图谱，总结社区「${label}」的核心主题、关键实体关系和最新变化。`;
}

export function buildNodeQuestion(
  node: Pick<KnowledgeGraphNodeSummary, 'label' | 'node_type'>,
  mode: AIQueryEngine
) {
  if (mode === 'hybrid') {
    return `请结合知识图谱与相关文章，分析节点「${node.label}」（${node.node_type}）的关键关系、上下游实体和近期动态。`;
  }

  return `请基于知识图谱，分析节点「${node.label}」（${node.node_type}）的关键关系、上下游实体和近期动态。`;
}
