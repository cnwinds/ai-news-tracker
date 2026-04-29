import type { AIQueryEngine, KnowledgeGraphNodeSummary } from '@/types';

type LabelKeyCollection = ReadonlySet<string> | readonly string[];

type LabelScoredNode = Pick<
  KnowledgeGraphNodeSummary,
  'node_key' | 'label' | 'degree' | 'article_count' | 'centrality'
>;

export type KnowledgeGraphRenderableLabelNode = LabelScoredNode & {
  x?: number;
  y?: number;
  radius: number;
};

export type KnowledgeGraphLabelViewport = {
  scale: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

type LabelSelectionOptions = {
  selectedNodeKey?: string;
  focusNodeKeys: LabelKeyCollection;
  highlightedNodeKeys: LabelKeyCollection;
  selectedNeighborKeys: ReadonlySet<string>;
  neighborHopMap?: ReadonlyMap<string, number>;
};

type BaseLabelSelectionOptions = LabelSelectionOptions & {
  viewportScale?: number;
};

type RenderableLabelSelectionOptions = LabelSelectionOptions & {
  baseLabelKeys: ReadonlySet<string>;
  hoveredNodeKey?: string;
  viewport: KnowledgeGraphLabelViewport;
  neighborHopMap?: ReadonlyMap<string, number>;
};

type LabelScoreContext = {
  selectedNodeKey?: string;
  hoveredNodeKey?: string;
  highlightedSet: ReadonlySet<string>;
  focusSet: ReadonlySet<string>;
  selectedNeighborKeys: ReadonlySet<string>;
  pinnedKeys: ReadonlySet<string>;
  baseLabelKeys?: ReadonlySet<string>;
  neighborHopMap?: ReadonlyMap<string, number>;
};

type LabelRect = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

const LABEL_MIN_SCALE = 0.45;
const LABEL_MAX_SCALE = 3.2;
const DEFAULT_LABEL_LIMIT = 12;
const MIN_DEFAULT_LABEL_LIMIT = 5;
const ZOOMED_DEFAULT_LABEL_LIMIT = 36;
const ACTIVE_LABEL_LIMIT = 10;
const MIN_ACTIVE_LABEL_LIMIT = 4;
const ZOOMED_ACTIVE_LABEL_LIMIT = 24;
const BASE_CANVAS_AREA = 980 * 680;
const LABEL_VIEWPORT_PADDING = 140;
const LABEL_COLLISION_PADDING = 5;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function toKeySet(keys: LabelKeyCollection) {
  return keys instanceof Set ? keys : new Set(keys);
}

function createPinnedLabelKeys(selectedNodeKey: string | undefined, focusNodeKeys: LabelKeyCollection) {
  const pinnedKeys = new Set<string>();
  const focusKeys = Array.from(focusNodeKeys);

  if (selectedNodeKey) {
    pinnedKeys.add(selectedNodeKey);
  }
  if (focusKeys.length > 0) {
    pinnedKeys.add(focusKeys[0]);
    pinnedKeys.add(focusKeys[focusKeys.length - 1]);
  }

  return pinnedKeys;
}

function createActiveLabelKeys({
  selectedNodeKey,
  focusNodeKeys,
  highlightedNodeKeys,
  selectedNeighborKeys,
  neighborHopMap,
}: LabelSelectionOptions) {
  const keys = new Set<string>([
    ...Array.from(focusNodeKeys),
    ...Array.from(highlightedNodeKeys),
    ...Array.from(selectedNeighborKeys),
    ...(selectedNodeKey ? [selectedNodeKey] : []),
  ]);
  if (neighborHopMap) {
    for (const [nodeKey] of neighborHopMap) {
      keys.add(nodeKey);
    }
  }
  return keys;
}

function getScaleAwareLimit(scale: number | undefined, min: number, base: number, max: number) {
  const normalizedScale = clamp(scale ?? 1, LABEL_MIN_SCALE, LABEL_MAX_SCALE);
  if (normalizedScale <= 1) {
    const progress = (normalizedScale - LABEL_MIN_SCALE) / (1 - LABEL_MIN_SCALE);
    return Math.round(min + progress * (base - min));
  }

  const progress = (normalizedScale - 1) / (LABEL_MAX_SCALE - 1);
  return Math.round(base + progress * (max - base));
}

export function getKnowledgeGraphLabelBudget({
  nodeCount,
  activeNodeCount = 0,
  viewportScale,
}: {
  nodeCount: number;
  activeNodeCount?: number;
  viewportScale?: number;
}) {
  if (activeNodeCount > 0) {
    if (activeNodeCount <= 6) {
      return activeNodeCount;
    }

    const baseActiveLimit = Math.min(
      ACTIVE_LABEL_LIMIT,
      Math.max(5, Math.ceil(Math.sqrt(activeNodeCount) * 2))
    );
    const scaledActiveLimit = getScaleAwareLimit(
      viewportScale,
      MIN_ACTIVE_LABEL_LIMIT,
      baseActiveLimit,
      ZOOMED_ACTIVE_LABEL_LIMIT
    );
    return Math.min(activeNodeCount, scaledActiveLimit);
  }

  const scaledDefaultLimit = getScaleAwareLimit(
    viewportScale,
    MIN_DEFAULT_LABEL_LIMIT,
    DEFAULT_LABEL_LIMIT,
    ZOOMED_DEFAULT_LABEL_LIMIT
  );
  return Math.min(nodeCount, scaledDefaultLimit);
}

// Hop-distance score: 1-hop → +750, 2-hop → +400, 3-hop → +180, 4-hop → +80
const HOP_SCORES = [0, 750, 400, 180, 80];

function getHopScore(neighborHopMap: ReadonlyMap<string, number> | undefined, nodeKey: string): number {
  if (!neighborHopMap) return 0;
  const hop = neighborHopMap.get(nodeKey);
  if (hop === undefined || hop === 0) return 0;
  return HOP_SCORES[hop] ?? 40;
}

function getLabelPriorityRank(node: LabelScoredNode, context: LabelScoreContext) {
  if (node.node_key === context.selectedNodeKey) return 0;
  if (node.node_key === context.hoveredNodeKey) return 1;
  if (context.pinnedKeys.has(node.node_key)) return 2;
  if (context.highlightedSet.has(node.node_key)) return 3;
  if (context.focusSet.has(node.node_key)) return 4;

  const hop = context.neighborHopMap?.get(node.node_key);
  if (hop === 1) return 5;
  if (hop === 2) return 6;
  if (hop === 3) return 7;
  if (context.selectedNeighborKeys.has(node.node_key)) return 8;
  if (context.baseLabelKeys?.has(node.node_key)) return 9;
  return 10;
}

function scoreLabelNode(node: LabelScoredNode, context: LabelScoreContext) {
  let score = node.centrality * 100 + node.degree * 6 + node.article_count * 4;
  if (node.node_key === context.selectedNodeKey) score += 2000;
  if (node.node_key === context.hoveredNodeKey) score += 1800;
  if (context.pinnedKeys.has(node.node_key)) score += 1600;
  if (context.highlightedSet.has(node.node_key)) score += 1200;
  if (context.focusSet.has(node.node_key)) score += 900;
  if (context.baseLabelKeys?.has(node.node_key)) score += 520;
  if (context.neighborHopMap) {
    score += getHopScore(context.neighborHopMap, node.node_key);
  } else if (context.selectedNeighborKeys.has(node.node_key)) {
    score += 280;
  }
  return score;
}

function compareLabelNodes(
  left: LabelScoredNode,
  right: LabelScoredNode,
  context: LabelScoreContext
) {
  return getLabelPriorityRank(left, context) - getLabelPriorityRank(right, context)
    || scoreLabelNode(right, context) - scoreLabelNode(left, context)
    || right.degree - left.degree
    || right.centrality - left.centrality
    || left.label.localeCompare(right.label);
}

export function selectVisibleKnowledgeGraphLabelKeys(
  nodes: KnowledgeGraphNodeSummary[],
  {
    selectedNodeKey,
    focusNodeKeys,
    highlightedNodeKeys,
    selectedNeighborKeys,
    neighborHopMap,
    viewportScale,
  }: BaseLabelSelectionOptions
) {
  if (nodes.length === 0) {
    return new Set<string>();
  }

  const highlightedSet = toKeySet(highlightedNodeKeys);
  const focusSet = toKeySet(focusNodeKeys);
  const pinnedKeys = createPinnedLabelKeys(selectedNodeKey, focusNodeKeys);
  const scoreContext: LabelScoreContext = {
    selectedNodeKey,
    highlightedSet,
    focusSet,
    selectedNeighborKeys,
    pinnedKeys,
    neighborHopMap,
  };
  const activeNodeKeys = createActiveLabelKeys({
    selectedNodeKey,
    focusNodeKeys,
    highlightedNodeKeys,
    selectedNeighborKeys,
    neighborHopMap,
  });

  if (activeNodeKeys.size > 0) {
    const activeNodes = nodes.filter((node) => activeNodeKeys.has(node.node_key));
    const labelBudget = getKnowledgeGraphLabelBudget({
      nodeCount: nodes.length,
      activeNodeCount: activeNodes.length,
      viewportScale,
    });
    const labelKeys = new Set<string>(pinnedKeys);

    [...activeNodes]
      .sort((left, right) => compareLabelNodes(left, right, scoreContext))
      .some((node) => {
        if (labelKeys.size >= labelBudget) {
          return true;
        }
        labelKeys.add(node.node_key);
        return false;
      });

    return labelKeys;
  }

  const labelBudget = getKnowledgeGraphLabelBudget({
    nodeCount: nodes.length,
    viewportScale,
  });

  return new Set(
    [...nodes]
      .sort((left, right) => compareLabelNodes(left, right, scoreContext))
      .slice(0, labelBudget)
      .map((node) => node.node_key)
  );
}

function getNodeScreenPoint(node: KnowledgeGraphRenderableLabelNode, viewport: KnowledgeGraphLabelViewport) {
  return {
    x: (node.x || 0) * viewport.scale + viewport.x,
    y: (node.y || 0) * viewport.scale + viewport.y,
  };
}

function isNodeNearViewport(
  node: KnowledgeGraphRenderableLabelNode,
  viewport: KnowledgeGraphLabelViewport
) {
  const point = getNodeScreenPoint(node, viewport);
  return point.x >= -LABEL_VIEWPORT_PADDING
    && point.x <= viewport.width + LABEL_VIEWPORT_PADDING
    && point.y >= -LABEL_VIEWPORT_PADDING
    && point.y <= viewport.height + LABEL_VIEWPORT_PADDING;
}

function estimateLabelWidth(label: string, fontSize: number) {
  const units = Array.from(label).reduce((total, character) => {
    return total + (character.charCodeAt(0) > 255 ? 1 : 0.58);
  }, 0);
  return units * fontSize + 10;
}

function getLabelRect(
  node: KnowledgeGraphRenderableLabelNode,
  viewport: KnowledgeGraphLabelViewport,
  emphasized: boolean
): LabelRect {
  const point = getNodeScreenPoint(node, viewport);
  const fontSize = emphasized ? 13 : 11.5;
  const labelLimit = emphasized ? 36 : 24;
  const label = node.label.length > labelLimit
    ? `${node.label.slice(0, labelLimit)}...`
    : node.label;
  const left = point.x + node.radius * viewport.scale + 7 - 4;
  const baseline = point.y + 4;
  const top = baseline - fontSize - 5;
  const width = estimateLabelWidth(label, fontSize);

  return {
    left,
    right: left + width,
    top,
    bottom: baseline + 5,
  };
}

function hasCollision(rect: LabelRect, occupiedRects: LabelRect[]) {
  return occupiedRects.some((occupied) =>
    rect.left < occupied.right + LABEL_COLLISION_PADDING
    && rect.right + LABEL_COLLISION_PADDING > occupied.left
    && rect.top < occupied.bottom + LABEL_COLLISION_PADDING
    && rect.bottom + LABEL_COLLISION_PADDING > occupied.top
  );
}

function getViewportAreaFactor(viewport: KnowledgeGraphLabelViewport) {
  const area = Math.max(1, viewport.width * viewport.height);
  return clamp(Math.sqrt(area / BASE_CANVAS_AREA), 0.72, 1.35);
}

export function selectRenderableKnowledgeGraphLabelKeys(
  nodes: KnowledgeGraphRenderableLabelNode[],
  {
    selectedNodeKey,
    focusNodeKeys,
    highlightedNodeKeys,
    selectedNeighborKeys,
    neighborHopMap,
    baseLabelKeys,
    hoveredNodeKey,
    viewport,
  }: RenderableLabelSelectionOptions
) {
  if (nodes.length === 0) {
    return new Set<string>();
  }

  const highlightedSet = toKeySet(highlightedNodeKeys);
  const focusSet = toKeySet(focusNodeKeys);
  const pinnedKeys = createPinnedLabelKeys(selectedNodeKey, focusNodeKeys);
  const activeNodeKeys = createActiveLabelKeys({
    selectedNodeKey,
    focusNodeKeys,
    highlightedNodeKeys,
    selectedNeighborKeys,
    neighborHopMap,
  });
  const visibleNodes = nodes.filter((node) => isNodeNearViewport(node, viewport));
  const activeVisibleCount = visibleNodes.filter((node) => activeNodeKeys.has(node.node_key)).length;
  const baseBudget = getKnowledgeGraphLabelBudget({
    nodeCount: visibleNodes.length,
    activeNodeCount: activeNodeKeys.size > 0 ? Math.max(1, activeVisibleCount) : 0,
    viewportScale: viewport.scale,
  });
  const renderBudget = Math.max(1, Math.round(baseBudget * getViewportAreaFactor(viewport)));
  const forceLabelKeys = new Set<string>([
    ...(selectedNodeKey ? [selectedNodeKey] : []),
    ...(hoveredNodeKey ? [hoveredNodeKey] : []),
    ...Array.from(highlightedSet),
    ...(viewport.scale >= 1.55 ? Array.from(focusSet) : []),
  ]);
  const scoreContext: LabelScoreContext = {
    selectedNodeKey,
    hoveredNodeKey,
    highlightedSet,
    focusSet,
    selectedNeighborKeys,
    pinnedKeys,
    baseLabelKeys,
    neighborHopMap,
  };
  const sortedNodes = [...visibleNodes].sort(
    (left, right) => compareLabelNodes(left, right, scoreContext)
  );
  const labelKeys = new Set<string>();
  const occupiedRects: LabelRect[] = [];

  const tryAddLabel = (node: KnowledgeGraphRenderableLabelNode, force: boolean) => {
    if (labelKeys.has(node.node_key)) {
      return;
    }

    const emphasized = force
      || node.node_key === selectedNodeKey
      || node.node_key === hoveredNodeKey
      || highlightedSet.has(node.node_key);
    const rect = getLabelRect(node, viewport, emphasized);
    if (!force && hasCollision(rect, occupiedRects)) {
      return;
    }

    labelKeys.add(node.node_key);
    occupiedRects.push(rect);
  };

  sortedNodes
    .filter((node) => forceLabelKeys.has(node.node_key))
    .forEach((node) => tryAddLabel(node, true));

  sortedNodes.some((node) => {
    if (labelKeys.size >= renderBudget) {
      return true;
    }
    tryAddLabel(node, false);
    return false;
  });

  return labelKeys;
}

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
