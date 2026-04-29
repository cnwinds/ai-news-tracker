import { describe, expect, it } from 'vitest';

import {
  getKnowledgeGraphLabelBudget,
  selectRenderableKnowledgeGraphLabelKeys,
  selectVisibleKnowledgeGraphLabelKeys,
  type KnowledgeGraphRenderableLabelNode,
} from '@/utils/knowledgeGraph';
import type { KnowledgeGraphNodeSummary } from '@/types';

function makeNode(
  index: number,
  overrides: Partial<KnowledgeGraphNodeSummary> = {}
): KnowledgeGraphNodeSummary {
  return {
    node_key: `node:${index}`,
    label: `Node ${index}`,
    node_type: 'entity',
    aliases: [],
    metadata: {},
    degree: index,
    article_count: Math.max(1, index % 5),
    community_id: 1,
    centrality: index / 100,
    ...overrides,
  };
}

function makeRenderNode(
  index: number,
  overrides: Partial<KnowledgeGraphRenderableLabelNode> = {}
): KnowledgeGraphRenderableLabelNode {
  return {
    ...makeNode(index),
    x: 80 + index * 24,
    y: 80,
    radius: 8,
    ...overrides,
  };
}

describe('knowledge graph label selection', () => {
  it('uses zoom-aware budgets for default labels', () => {
    const zoomedOut = getKnowledgeGraphLabelBudget({
      nodeCount: 100,
      viewportScale: 0.45,
    });
    const normal = getKnowledgeGraphLabelBudget({
      nodeCount: 100,
      viewportScale: 1,
    });
    const zoomedIn = getKnowledgeGraphLabelBudget({
      nodeCount: 100,
      viewportScale: 3.2,
    });

    expect(zoomedOut).toBeLessThan(normal);
    expect(normal).toBe(12);
    expect(zoomedIn).toBeGreaterThan(normal);
  });

  it('reselects more base labels as the viewport zooms in', () => {
    const nodes = Array.from({ length: 50 }, (_, index) => makeNode(index + 1));
    const baseOptions = {
      focusNodeKeys: [],
      highlightedNodeKeys: [],
      selectedNeighborKeys: new Set<string>(),
    };

    const zoomedOut = selectVisibleKnowledgeGraphLabelKeys(nodes, {
      ...baseOptions,
      viewportScale: 0.45,
    });
    const normal = selectVisibleKnowledgeGraphLabelKeys(nodes, {
      ...baseOptions,
      viewportScale: 1,
    });
    const zoomedIn = selectVisibleKnowledgeGraphLabelKeys(nodes, {
      ...baseOptions,
      viewportScale: 2.4,
    });

    expect(zoomedOut.size).toBeLessThan(normal.size);
    expect(normal.size).toBe(12);
    expect(zoomedIn.size).toBeGreaterThan(normal.size);
  });

  it('keeps pinned active labels while active label budgets scale', () => {
    const nodes = Array.from({ length: 40 }, (_, index) => makeNode(index + 1));
    const selectedNeighborKeys = new Set(nodes.slice(0, 24).map((node) => node.node_key));

    const normal = selectVisibleKnowledgeGraphLabelKeys(nodes, {
      selectedNodeKey: 'node:10',
      focusNodeKeys: ['node:3', 'node:20'],
      highlightedNodeKeys: [],
      selectedNeighborKeys,
      viewportScale: 1,
    });
    const zoomedIn = selectVisibleKnowledgeGraphLabelKeys(nodes, {
      selectedNodeKey: 'node:10',
      focusNodeKeys: ['node:3', 'node:20'],
      highlightedNodeKeys: [],
      selectedNeighborKeys,
      viewportScale: 3.2,
    });

    expect(normal.has('node:10')).toBe(true);
    expect(normal.has('node:3')).toBe(true);
    expect(normal.has('node:20')).toBe(true);
    expect(zoomedIn.size).toBeGreaterThan(normal.size);
  });

  it('filters render labels by the current screen viewport', () => {
    const visibleNode = makeRenderNode(1, {
      node_key: 'node:visible',
      label: 'Visible node',
      x: 80,
      y: 80,
    });
    const offscreenNode = makeRenderNode(2, {
      node_key: 'node:offscreen',
      label: 'Offscreen node',
      centrality: 10,
      degree: 100,
      x: 1200,
      y: 1200,
    });

    const labelKeys = selectRenderableKnowledgeGraphLabelKeys(
      [offscreenNode, visibleNode],
      {
        focusNodeKeys: [],
        highlightedNodeKeys: [],
        selectedNeighborKeys: new Set<string>(),
        baseLabelKeys: new Set(['node:offscreen', 'node:visible']),
        viewport: {
          scale: 1,
          x: 0,
          y: 0,
          width: 320,
          height: 220,
        },
      }
    );

    expect(labelKeys.has('node:visible')).toBe(true);
    expect(labelKeys.has('node:offscreen')).toBe(false);
  });
});
