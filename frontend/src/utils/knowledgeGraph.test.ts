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

  it('forces the selected render label even when labels collide', () => {
    const selectedNode = makeRenderNode(1, {
      node_key: 'node:selected',
      label: 'Selected node',
      degree: 1,
      centrality: 0.01,
      x: 80,
      y: 80,
    });
    const dominantNode = makeRenderNode(2, {
      node_key: 'node:dominant',
      label: 'Dominant node',
      degree: 100,
      centrality: 10,
      x: 82,
      y: 80,
    });

    const labelKeys = selectRenderableKnowledgeGraphLabelKeys(
      [dominantNode, selectedNode],
      {
        selectedNodeKey: 'node:selected',
        focusNodeKeys: [],
        highlightedNodeKeys: [],
        selectedNeighborKeys: new Set<string>(),
        baseLabelKeys: new Set<string>(),
        viewport: {
          scale: 1,
          x: 0,
          y: 0,
          width: 320,
          height: 220,
        },
      }
    );

    expect(labelKeys.has('node:selected')).toBe(true);
  });

  it('prioritizes nearer selected-node hops over distant high-score nodes', () => {
    const nodes = [
      makeNode(1, { node_key: 'node:selected', degree: 1, centrality: 0.01 }),
      makeNode(2, { node_key: 'node:hop-1-a', degree: 1, centrality: 0.01 }),
      makeNode(3, { node_key: 'node:hop-1-b', degree: 1, centrality: 0.01 }),
      makeNode(4, { node_key: 'node:hop-2-a', degree: 1, centrality: 0.01 }),
      makeNode(5, { node_key: 'node:hop-2-b', degree: 1, centrality: 0.01 }),
      ...Array.from({ length: 8 }, (_, index) =>
        makeNode(index + 6, {
          node_key: `node:hop-3-${index}`,
          degree: 1000,
          centrality: 100,
        })
      ),
    ];
    const neighborHopMap = new Map<string, number>([
      ['node:selected', 0],
      ['node:hop-1-a', 1],
      ['node:hop-1-b', 1],
      ['node:hop-2-a', 2],
      ['node:hop-2-b', 2],
      ...Array.from({ length: 8 }, (_, index) => [`node:hop-3-${index}`, 3] as const),
    ]);

    const labelKeys = selectVisibleKnowledgeGraphLabelKeys(nodes, {
      selectedNodeKey: 'node:selected',
      focusNodeKeys: [],
      highlightedNodeKeys: [],
      selectedNeighborKeys: new Set(['node:selected', 'node:hop-1-a', 'node:hop-1-b']),
      neighborHopMap,
      viewportScale: 1,
    });

    expect(labelKeys.has('node:selected')).toBe(true);
    expect(labelKeys.has('node:hop-1-a')).toBe(true);
    expect(labelKeys.has('node:hop-1-b')).toBe(true);
    expect(labelKeys.has('node:hop-2-a')).toBe(true);
    expect(labelKeys.has('node:hop-2-b')).toBe(true);
  });

  it('reserves render label capacity for near selected-node hops when zoomed in', () => {
    const nearHopNodes = [
      makeRenderNode(1, { node_key: 'node:selected', x: 60, y: 80 }),
      makeRenderNode(2, { node_key: 'node:hop-1', x: 60, y: 130 }),
      makeRenderNode(3, { node_key: 'node:hop-2', x: 60, y: 180 }),
    ];
    const distantHighScoreNodes = Array.from({ length: 24 }, (_, index) =>
      makeRenderNode(index + 4, {
        node_key: `node:far-${index}`,
        degree: 1000,
        centrality: 100,
        x: 180 + (index % 6) * 80,
        y: 80 + Math.floor(index / 6) * 54,
      })
    );
    const neighborHopMap = new Map<string, number>([
      ['node:selected', 0],
      ['node:hop-1', 1],
      ['node:hop-2', 2],
      ...distantHighScoreNodes.map((node) => [node.node_key, 3] as const),
    ]);

    const labelKeys = selectRenderableKnowledgeGraphLabelKeys(
      [...nearHopNodes, ...distantHighScoreNodes],
      {
        selectedNodeKey: 'node:selected',
        focusNodeKeys: [],
        highlightedNodeKeys: [],
        selectedNeighborKeys: new Set(['node:selected', 'node:hop-1']),
        neighborHopMap,
        baseLabelKeys: new Set<string>(),
        viewport: {
          scale: 1.8,
          x: 0,
          y: 0,
          width: 700,
          height: 420,
        },
      }
    );

    expect(labelKeys.has('node:selected')).toBe(true);
    expect(labelKeys.has('node:hop-1')).toBe(true);
    expect(labelKeys.has('node:hop-2')).toBe(true);
  });
});
