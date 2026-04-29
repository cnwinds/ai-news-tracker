import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { Space, Tag, Typography } from 'antd';
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force';

import {
  buildKnowledgeGraphEdgeKey,
  selectRenderableKnowledgeGraphLabelKeys,
} from '@/utils/knowledgeGraph';
import { getThemeColor } from '@/utils/theme';
import type {
  KnowledgeGraphCommunitySummary,
  KnowledgeGraphLinkSummary,
  KnowledgeGraphNodeSummary,
} from '@/types';

const { Text, Title } = Typography;

export type KnowledgeGraphViewportState = {
  scale: number;
  x: number;
  y: number;
};

type CanvasNode = KnowledgeGraphNodeSummary & SimulationNodeDatum & {
  color: string;
  radius: number;
};

type CanvasLink = Omit<KnowledgeGraphLinkSummary, 'source' | 'target'> &
  SimulationLinkDatum<CanvasNode> & {
    key: string;
    sourceKey: string;
    targetKey: string;
    source: string | CanvasNode;
    target: string | CanvasNode;
  };

type CanvasDimensions = {
  width: number;
  height: number;
};

type HoverPreviewState = {
  node: CanvasNode;
  x: number;
  y: number;
};

type NodeAnchor = {
  nodeKey: string;
  label: string;
  x: number;
  y: number;
  size: number;
};

type DragState =
  | {
      mode: 'pan';
      startX: number;
      startY: number;
      originX: number;
      originY: number;
      moved: boolean;
    }
  | {
      mode: 'node';
      nodeKey: string;
      startX: number;
      startY: number;
      moved: boolean;
    }
  | null;

const DEFAULT_CANVAS_WIDTH = 980;
const DEFAULT_CANVAS_HEIGHT = 680;
const MIN_SCALE = 0.45;
const MAX_SCALE = 3.2;
const HOVER_CARD_WIDTH = 300;
export const COMMUNITY_PALETTE = [
  '#2dd4bf',
  '#60a5fa',
  '#f59e0b',
  '#a78bfa',
  '#fb7185',
  '#34d399',
  '#22d3ee',
  '#f97316',
  '#818cf8',
  '#84cc16',
  '#f472b6',
  '#38bdf8',
];

export function getCommunityColorByIndex(communityId: number | null | undefined, nodeType?: string): string {
  if (communityId !== null && communityId !== undefined) {
    return COMMUNITY_PALETTE[Math.abs(communityId) % COMMUNITY_PALETTE.length];
  }
  if (nodeType) {
    return COMMUNITY_PALETTE[hashString(nodeType) % COMMUNITY_PALETTE.length];
  }
  return COMMUNITY_PALETTE[0];
}

const graphCanvasMarkerLayerStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  pointerEvents: 'none',
};

const graphCanvasMarkerStyle: CSSProperties = {
  position: 'absolute',
  border: 0,
  padding: 0,
  background: 'transparent',
  opacity: 0,
  pointerEvents: 'auto',
  transform: 'translate(-50%, -50%)',
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function hashString(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function getNodeRadius(node: KnowledgeGraphNodeSummary) {
  const signal = Math.max(node.degree, 0) + Math.max(node.article_count, 0) * 1.6 + 1;
  return 3.2 + Math.min(Math.log2(signal) * 1.9, 8.6);
}

function getCommunityColor(node: KnowledgeGraphNodeSummary) {
  if (node.community_id !== null && node.community_id !== undefined) {
    return COMMUNITY_PALETTE[Math.abs(node.community_id) % COMMUNITY_PALETTE.length];
  }
  return COMMUNITY_PALETTE[hashString(node.node_type || node.node_key) % COMMUNITY_PALETTE.length];
}

function hasLayoutCoordinates(node: KnowledgeGraphNodeSummary) {
  return Number.isFinite(node.layout_x) && Number.isFinite(node.layout_y);
}

function createInitialNode(
  node: KnowledgeGraphNodeSummary,
  dimensions: CanvasDimensions
): CanvasNode {
  const seed = hashString(node.node_key);
  const angle = ((seed % 360) / 180) * Math.PI;
  const distanceSeed = ((seed >>> 8) % 1000) / 1000;
  const cloudRadius = Math.min(dimensions.width, dimensions.height) * (0.16 + distanceSeed * 0.28);
  const centerX = dimensions.width / 2;
  const centerY = dimensions.height / 2;
  const coordinateScale = Math.min(dimensions.width, dimensions.height) * 0.84;
  const hasCoordinates = hasLayoutCoordinates(node);
  const initialX = hasCoordinates
    ? centerX + Number(node.layout_x) * coordinateScale
    : centerX + Math.cos(angle) * cloudRadius;
  const initialY = hasCoordinates
    ? centerY + Number(node.layout_y) * coordinateScale
    : centerY + Math.sin(angle) * cloudRadius * 0.78;

  return {
    ...node,
    color: getCommunityColor(node),
    radius: getNodeRadius(node),
    x: initialX,
    y: initialY,
  };
}

function resolveCanvasNode(value: string | number | CanvasNode | undefined) {
  if (!value || typeof value === 'string' || typeof value === 'number') {
    return undefined;
  }
  return value;
}

function formatCentrality(value: number) {
  return Number.isFinite(value) ? value.toFixed(2) : '-';
}

function truncateLabel(label: string, limit: number) {
  if (label.length <= limit) {
    return label;
  }
  return `${label.slice(0, limit)}...`;
}

function drawRoundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  const safeRadius = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + safeRadius, y);
  context.lineTo(x + width - safeRadius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  context.lineTo(x + width, y + height - safeRadius);
  context.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
  context.lineTo(x + safeRadius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
  context.lineTo(x, y + safeRadius);
  context.quadraticCurveTo(x, y, x + safeRadius, y);
  context.closePath();
}

function getNodeMetadataPreview(node: KnowledgeGraphNodeSummary) {
  const metadataEntries = Object.entries(node.metadata || {})
    .filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value))
    .filter(([, value]) => String(value).trim().length > 0);

  const preferredKeys = ['title', 'summary', 'description', 'source', 'published_at', 'author'];
  const preferredEntries = preferredKeys
    .map((key) => metadataEntries.find(([entryKey]) => entryKey === key))
    .filter((entry): entry is [string, string | number | boolean] => Boolean(entry));
  const remainingEntries = metadataEntries.filter(
    ([key]) => !preferredKeys.includes(key)
  );

  return [...preferredEntries, ...remainingEntries].slice(0, 3);
}

interface KnowledgeGraphCanvasProps {
  nodes: KnowledgeGraphNodeSummary[];
  links: KnowledgeGraphLinkSummary[];
  theme: 'light' | 'dark';
  selectedNodeKey?: string;
  selectedCommunity?: KnowledgeGraphCommunitySummary;
  focusNodeKeys: string[];
  highlightedNodeKeys: string[];
  highlightedEdgeKeys: Set<string>;
  selectedNeighborKeys: Set<string>;
  neighborHopMap?: Map<string, number>;
  labelKeys: Set<string>;
  viewport: KnowledgeGraphViewportState;
  onViewportChange: (updater: (previous: KnowledgeGraphViewportState) => KnowledgeGraphViewportState) => void;
  onNodeClick: (nodeKey: string) => void;
}

export default function KnowledgeGraphCanvas({
  nodes,
  links,
  theme,
  selectedNodeKey,
  selectedCommunity,
  focusNodeKeys,
  highlightedNodeKeys,
  highlightedEdgeKeys,
  selectedNeighborKeys,
  neighborHopMap,
  labelKeys,
  viewport,
  onViewportChange,
  onNodeClick,
}: KnowledgeGraphCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const simulationRef = useRef<Simulation<CanvasNode, CanvasLink> | null>(null);
  const nodesRef = useRef<CanvasNode[]>([]);
  const linksRef = useRef<CanvasLink[]>([]);
  const viewportRef = useRef(viewport);
  const dragStateRef = useRef<DragState>(null);
  const animationFrameRef = useRef<number>();
  const lastAnchorUpdateRef = useRef(0);
  const [dimensions, setDimensions] = useState<CanvasDimensions>({
    width: DEFAULT_CANVAS_WIDTH,
    height: DEFAULT_CANVAS_HEIGHT,
  });
  const [hoverPreview, setHoverPreview] = useState<HoverPreviewState | null>(null);
  const [hoveredNodeKey, setHoveredNodeKey] = useState<string>();
  const [nodeAnchors, setNodeAnchors] = useState<NodeAnchor[]>([]);

  const highlightedNodeKeySet = useMemo(
    () => new Set(highlightedNodeKeys),
    [highlightedNodeKeys]
  );

  const focusNodeKeySet = useMemo(
    () => new Set(focusNodeKeys),
    [focusNodeKeys]
  );

  const visualStateRef = useRef({
    theme,
    selectedNodeKey,
    highlightedNodeKeySet,
    highlightedEdgeKeys,
    selectedNeighborKeys,
    neighborHopMap,
    labelKeys,
    focusNodeKeySet,
    hoveredNodeKey,
  });

  const updateAnchors = useCallback(() => {
    const currentViewport = viewportRef.current;
    setNodeAnchors(
      nodesRef.current.map((node) => ({
        nodeKey: node.node_key,
        label: node.label,
        x: (node.x || 0) * currentViewport.scale + currentViewport.x,
        y: (node.y || 0) * currentViewport.scale + currentViewport.y,
        size: Math.max(16, (node.radius + 6) * currentViewport.scale),
      }))
    );
  }, []);

  const getCanvasContext = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return null;
    }
    try {
      return canvas.getContext('2d');
    } catch {
      return null;
    }
  }, []);

  const drawGraph = useCallback(() => {
    const context = getCanvasContext();
    const canvas = canvasRef.current;
    if (!context || !canvas) {
      return;
    }

    const devicePixelRatio = window.devicePixelRatio || 1;
    const canvasWidth = Math.max(1, Math.floor(dimensions.width * devicePixelRatio));
    const canvasHeight = Math.max(1, Math.floor(dimensions.height * devicePixelRatio));
    if (canvas.width !== canvasWidth || canvas.height !== canvasHeight) {
      canvas.width = canvasWidth;
      canvas.height = canvasHeight;
    }
    context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    context.clearRect(0, 0, dimensions.width, dimensions.height);

    const currentViewport = viewportRef.current;
    const visualState = visualStateRef.current;
    const isDark = visualState.theme === 'dark';
    const backgroundColor = isDark ? '#090b0f' : '#f6f8fb';
    const gridColor = isDark ? 'rgba(255, 255, 255, 0.035)' : 'rgba(15, 23, 42, 0.055)';

    context.fillStyle = backgroundColor;
    context.fillRect(0, 0, dimensions.width, dimensions.height);

    const gridStep = Math.max(28, 44 * currentViewport.scale);
    const gridOffsetX = ((currentViewport.x % gridStep) + gridStep) % gridStep;
    const gridOffsetY = ((currentViewport.y % gridStep) + gridStep) % gridStep;
    context.beginPath();
    for (let x = gridOffsetX; x < dimensions.width; x += gridStep) {
      context.moveTo(x, 0);
      context.lineTo(x, dimensions.height);
    }
    for (let y = gridOffsetY; y < dimensions.height; y += gridStep) {
      context.moveTo(0, y);
      context.lineTo(dimensions.width, y);
    }
    context.strokeStyle = gridColor;
    context.lineWidth = 1;
    context.stroke();

    context.save();
    context.translate(currentViewport.x, currentViewport.y);
    context.scale(currentViewport.scale, currentViewport.scale);

    const hoveredKey = visualState.hoveredNodeKey;
    const activePath = visualState.highlightedEdgeKeys.size > 0;
    const hasSelection = Boolean(visualState.selectedNodeKey || hoveredKey || activePath);
    const screenScale = Math.max(currentViewport.scale, 0.001);

    for (const link of linksRef.current) {
      const source = resolveCanvasNode(link.source);
      const target = resolveCanvasNode(link.target);
      if (!source || !target) {
        continue;
      }

      const edgeKey = link.key || buildKnowledgeGraphEdgeKey(link.sourceKey, link.targetKey);
      const isPathEdge = visualState.highlightedEdgeKeys.has(edgeKey);
      const touchesSelected = visualState.selectedNodeKey
        ? link.sourceKey === visualState.selectedNodeKey || link.targetKey === visualState.selectedNodeKey
        : false;
      const touchesHovered = hoveredKey
        ? link.sourceKey === hoveredKey || link.targetKey === hoveredKey
        : false;
      const isActive = isPathEdge || touchesSelected || touchesHovered;

      context.beginPath();
      context.moveTo(source.x || 0, source.y || 0);
      context.lineTo(target.x || 0, target.y || 0);
      context.strokeStyle = isPathEdge
        ? (isDark ? 'rgba(251, 146, 60, 0.95)' : 'rgba(234, 88, 12, 0.95)')
        : isActive
          ? (isDark ? 'rgba(203, 213, 225, 0.58)' : 'rgba(51, 65, 85, 0.42)')
          : (isDark ? 'rgba(148, 163, 184, 0.15)' : 'rgba(71, 85, 105, 0.16)');
      context.globalAlpha = activePath
        ? (isPathEdge ? 1 : 0.08)
        : hasSelection
          ? (isActive ? 1 : 0.26)
          : 1;
      context.lineWidth = (isPathEdge ? 2.4 : 0.72 + Math.min(Math.log1p(link.weight || 1) * 0.48, 1.4)) / screenScale;
      context.stroke();
    }
    context.globalAlpha = 1;

    const sortedNodes = [...nodesRef.current].sort((left, right) => {
      const leftScore = Number(left.node_key === visualState.selectedNodeKey) * 4
        + Number(left.node_key === hoveredKey) * 3
        + Number(visualState.highlightedNodeKeySet.has(left.node_key)) * 2
        + Number(visualState.selectedNeighborKeys.has(left.node_key));
      const rightScore = Number(right.node_key === visualState.selectedNodeKey) * 4
        + Number(right.node_key === hoveredKey) * 3
        + Number(visualState.highlightedNodeKeySet.has(right.node_key)) * 2
        + Number(visualState.selectedNeighborKeys.has(right.node_key));
      return leftScore - rightScore;
    });

    for (const node of sortedNodes) {
      const isSelected = node.node_key === visualState.selectedNodeKey;
      const isHovered = node.node_key === hoveredKey;
      const isPathNode = visualState.highlightedNodeKeySet.has(node.node_key);
      const isRelated = visualState.highlightedNodeKeySet.size
        ? isPathNode
        : visualState.selectedNodeKey
          ? visualState.selectedNeighborKeys.has(node.node_key)
          : true;
      const opacity = visualState.selectedNodeKey || visualState.highlightedNodeKeySet.size || hoveredKey
        ? (isRelated || isHovered ? 1 : 0.22)
        : 1;
      const x = node.x || 0;
      const y = node.y || 0;

      if (isSelected || isHovered || isPathNode) {
        context.beginPath();
        context.arc(x, y, node.radius + (isSelected ? 10 : 7) / screenScale, 0, Math.PI * 2);
        context.fillStyle = isPathNode
          ? 'rgba(251, 146, 60, 0.22)'
          : `${node.color}33`;
        context.globalAlpha = opacity;
        context.fill();
      }

      context.beginPath();
      context.arc(x, y, node.radius, 0, Math.PI * 2);
      context.fillStyle = node.color;
      context.globalAlpha = opacity;
      context.fill();
      context.lineWidth = (isSelected || isHovered || isPathNode ? 2.4 : 1.1) / screenScale;
      context.strokeStyle = isSelected || isHovered || isPathNode
        ? (isDark ? '#f8fafc' : '#0f172a')
        : (isDark ? '#05070b' : '#ffffff');
      context.stroke();
    }
    context.globalAlpha = 1;

    const renderLabelKeys = selectRenderableKnowledgeGraphLabelKeys(sortedNodes, {
      selectedNodeKey: visualState.selectedNodeKey,
      focusNodeKeys: visualState.focusNodeKeySet,
      highlightedNodeKeys: visualState.highlightedNodeKeySet,
      selectedNeighborKeys: visualState.selectedNeighborKeys,
      neighborHopMap: visualState.neighborHopMap,
      baseLabelKeys: visualState.labelKeys,
      hoveredNodeKey: hoveredKey,
      viewport: {
        scale: currentViewport.scale,
        x: currentViewport.x,
        y: currentViewport.y,
        width: dimensions.width,
        height: dimensions.height,
      },
    });

    for (const node of sortedNodes) {
      const isSelected = node.node_key === visualState.selectedNodeKey;
      const isHovered = node.node_key === hoveredKey;
      const isPathNode = visualState.highlightedNodeKeySet.has(node.node_key);
      const showLabel = renderLabelKeys.has(node.node_key);
      if (!showLabel) {
        continue;
      }

      const isEmphasizedLabel = isSelected || isHovered || isPathNode;
      const fontSize = (isEmphasizedLabel ? 13 : 11.5) / screenScale;
      const labelX = (node.x || 0) + node.radius + (isSelected ? 10 : 7) / screenScale;
      const labelY = (node.y || 0) + 4 / screenScale;
      const label = truncateLabel(node.label, isSelected || isHovered ? 36 : 24);

      context.font = `${isEmphasizedLabel ? 700 : 600} ${fontSize}px "Segoe UI", sans-serif`;
      context.lineJoin = 'round';
      if (isEmphasizedLabel) {
        const metrics = context.measureText(label);
        const paddingX = 7 / screenScale;
        const paddingY = 4 / screenScale;
        const pillX = labelX - paddingX;
        const pillY = labelY - fontSize - paddingY;
        const pillWidth = metrics.width + paddingX * 2;
        const pillHeight = fontSize + paddingY * 2 + 2 / screenScale;
        drawRoundedRect(context, pillX, pillY, pillWidth, pillHeight, 7 / screenScale);
        context.fillStyle = isSelected
          ? 'rgba(15, 23, 42, 0.92)'
          : isPathNode
            ? 'rgba(124, 45, 18, 0.86)'
            : 'rgba(30, 41, 59, 0.86)';
        context.fill();
        context.lineWidth = 1 / screenScale;
        context.strokeStyle = isSelected
          ? (isDark ? 'rgba(248, 250, 252, 0.72)' : 'rgba(15, 23, 42, 0.42)')
          : 'rgba(255, 255, 255, 0.26)';
        context.stroke();
        context.fillStyle = '#f8fafc';
      } else {
        context.lineWidth = 4 / screenScale;
        context.strokeStyle = isDark ? 'rgba(5, 7, 11, 0.88)' : 'rgba(255, 255, 255, 0.9)';
        context.strokeText(label, labelX, labelY);
        context.fillStyle = isDark ? '#f8fafc' : '#0f172a';
      }
      context.fillText(label, labelX, labelY);
    }

    context.restore();
  }, [dimensions.height, dimensions.width, getCanvasContext]);

  useEffect(() => {
    viewportRef.current = viewport;
    drawGraph();
    updateAnchors();
  }, [drawGraph, updateAnchors, viewport]);

  useEffect(() => {
    visualStateRef.current = {
      theme,
      selectedNodeKey,
      highlightedNodeKeySet,
      highlightedEdgeKeys,
      selectedNeighborKeys,
      neighborHopMap,
      labelKeys,
      focusNodeKeySet,
      hoveredNodeKey,
    };
    drawGraph();
  }, [
    drawGraph,
    focusNodeKeySet,
    highlightedEdgeKeys,
    highlightedNodeKeySet,
    hoveredNodeKey,
    labelKeys,
    neighborHopMap,
    selectedNeighborKeys,
    selectedNodeKey,
    theme,
  ]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const updateDimensions = () => {
      const rect = container.getBoundingClientRect();
      setDimensions({
        width: Math.max(360, rect.width || DEFAULT_CANVAS_WIDTH),
        height: Math.max(520, rect.height || DEFAULT_CANVAS_HEIGHT),
      });
    };

    updateDimensions();
    const observer = new ResizeObserver(updateDimensions);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    simulationRef.current?.stop();
    if (animationFrameRef.current !== undefined) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = undefined;
    }

    const nextNodes = nodes.map((node) => createInitialNode(node, dimensions));
    const nodeKeySet = new Set(nextNodes.map((node) => node.node_key));
    const nextLinks: CanvasLink[] = links
      .filter((link) => nodeKeySet.has(link.source) && nodeKeySet.has(link.target))
      .map((link) => ({
        ...link,
        key: buildKnowledgeGraphEdgeKey(link.source, link.target),
        sourceKey: link.source,
        targetKey: link.target,
        source: link.source,
        target: link.target,
      }));

    nodesRef.current = nextNodes;
    linksRef.current = nextLinks;
    updateAnchors();

    if (nextNodes.length === 0) {
      drawGraph();
      return undefined;
    }

    const simulation = forceSimulation<CanvasNode, CanvasLink>(nextNodes)
      .force(
        'link',
        forceLink<CanvasNode, CanvasLink>(nextLinks)
          .id((node) => node.node_key)
          .distance((link) => clamp(88 - Math.log1p(link.weight || 1) * 8, 40, 122))
          .strength((link) => clamp(0.08 + Math.log1p(link.weight || 1) * 0.06, 0.1, 0.34))
      )
      .force('charge', forceManyBody<CanvasNode>().strength((node) => -54 - node.radius * 10))
      .force('collide', forceCollide<CanvasNode>().radius((node) => node.radius + 7).strength(0.8))
      .force('center', forceCenter(dimensions.width / 2, dimensions.height / 2).strength(0.025))
      .force('x', forceX<CanvasNode>(dimensions.width / 2).strength(0.018))
      .force('y', forceY<CanvasNode>(dimensions.height / 2).strength(0.018))
      .alpha(0.95)
      .alphaDecay(0.045);

    simulationRef.current = simulation;

    const drawTick = () => {
      drawGraph();
      const now = performance.now();
      if (now - lastAnchorUpdateRef.current > 160) {
        lastAnchorUpdateRef.current = now;
        updateAnchors();
      }
      if (simulation.alpha() > 0.025) {
        animationFrameRef.current = window.requestAnimationFrame(drawTick);
      } else {
        updateAnchors();
        animationFrameRef.current = undefined;
      }
    };

    animationFrameRef.current = window.requestAnimationFrame(drawTick);
    return () => {
      simulation.stop();
      if (animationFrameRef.current !== undefined) {
        window.cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = undefined;
      }
    };
  }, [dimensions, drawGraph, links, nodes, updateAnchors]);

  const getRelativePoint = useCallback((event: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    return {
      x: event.clientX - (rect?.left || 0),
      y: event.clientY - (rect?.top || 0),
    };
  }, []);

  const screenToWorld = useCallback((point: { x: number; y: number }) => {
    const currentViewport = viewportRef.current;
    return {
      x: (point.x - currentViewport.x) / currentViewport.scale,
      y: (point.y - currentViewport.y) / currentViewport.scale,
    };
  }, []);

  const findNodeAtPoint = useCallback((point: { x: number; y: number }) => {
    const world = screenToWorld(point);
    let closestNode: CanvasNode | undefined;
    let closestDistance = Number.POSITIVE_INFINITY;
    for (const node of nodesRef.current) {
      const dx = (node.x || 0) - world.x;
      const dy = (node.y || 0) - world.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const hitRadius = Math.max(node.radius + 6 / viewportRef.current.scale, 10 / viewportRef.current.scale);
      if (distance <= hitRadius && distance < closestDistance) {
        closestNode = node;
        closestDistance = distance;
      }
    }
    return closestNode;
  }, [screenToWorld]);

  const showHoverPreview = useCallback((node: CanvasNode, point: { x: number; y: number }) => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const width = container.clientWidth || dimensions.width;
    const height = container.clientHeight || dimensions.height;
    setHoveredNodeKey(node.node_key);
    setHoverPreview({
      node,
      x: clamp(point.x + 18, 12, Math.max(12, width - HOVER_CARD_WIDTH - 12)),
      y: clamp(point.y + 18, 12, Math.max(12, height - 184)),
    });
  }, [dimensions.height, dimensions.width]);

  const clearHoverPreview = useCallback(() => {
    setHoveredNodeKey(undefined);
    setHoverPreview(null);
  }, []);

  const handleMouseDown = useCallback((event: React.MouseEvent<HTMLCanvasElement>) => {
    if (event.button !== 0) {
      return;
    }
    const point = getRelativePoint(event);
    const hitNode = findNodeAtPoint(point);
    if (hitNode) {
      dragStateRef.current = {
        mode: 'node',
        nodeKey: hitNode.node_key,
        startX: event.clientX,
        startY: event.clientY,
        moved: false,
      };
      return;
    }

    dragStateRef.current = {
      mode: 'pan',
      startX: event.clientX,
      startY: event.clientY,
      originX: viewportRef.current.x,
      originY: viewportRef.current.y,
      moved: false,
    };
    clearHoverPreview();
  }, [clearHoverPreview, findNodeAtPoint, getRelativePoint]);

  const handleMouseMove = useCallback((event: React.MouseEvent<HTMLCanvasElement>) => {
    const dragState = dragStateRef.current;
    if (dragState?.mode === 'pan') {
      const deltaX = event.clientX - dragState.startX;
      const deltaY = event.clientY - dragState.startY;
      if (Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2) {
        dragState.moved = true;
      }
      onViewportChange((previous) => ({
        ...previous,
        x: dragState.originX + deltaX,
        y: dragState.originY + deltaY,
      }));
      return;
    }

    if (dragState?.mode === 'node') {
      const deltaX = event.clientX - dragState.startX;
      const deltaY = event.clientY - dragState.startY;
      if (Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2) {
        dragState.moved = true;
      }
      return;
    }

    const point = getRelativePoint(event);
    const hitNode = findNodeAtPoint(point);
    if (hitNode) {
      showHoverPreview(hitNode, point);
    } else if (hoverPreview) {
      clearHoverPreview();
    }
  }, [clearHoverPreview, findNodeAtPoint, getRelativePoint, hoverPreview, onViewportChange, showHoverPreview]);

  const handleMouseUp = useCallback((event: React.MouseEvent<HTMLCanvasElement>) => {
    const dragState = dragStateRef.current;
    dragStateRef.current = null;
    if (!dragState || dragState.mode !== 'node' || dragState.moved) {
      return;
    }
    onNodeClick(dragState.nodeKey);
    const point = getRelativePoint(event);
    const clickedNode = nodesRef.current.find((node) => node.node_key === dragState.nodeKey);
    if (clickedNode) {
      showHoverPreview(clickedNode, point);
    }
  }, [getRelativePoint, onNodeClick, showHoverPreview]);

  const handleWheel = useCallback((event: React.WheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    const point = getRelativePoint(event);
    const worldPoint = screenToWorld(point);
    const nextScale = clamp(
      viewportRef.current.scale * (event.deltaY < 0 ? 1.12 : 0.88),
      MIN_SCALE,
      MAX_SCALE
    );
    onViewportChange(() => ({
      scale: nextScale,
      x: point.x - worldPoint.x * nextScale,
      y: point.y - worldPoint.y * nextScale,
    }));
  }, [getRelativePoint, onViewportChange, screenToWorld]);

  const handleMarkerHover = useCallback((anchor: NodeAnchor) => {
    const node = nodesRef.current.find((item) => item.node_key === anchor.nodeKey);
    if (node) {
      showHoverPreview(node, { x: anchor.x, y: anchor.y });
    }
  }, [showHoverPreview]);

  const handleMarkerClick = useCallback((nodeKey: string) => {
    onNodeClick(nodeKey);
  }, [onNodeClick]);

  const hoverMetadataPreview = hoverPreview ? getNodeMetadataPreview(hoverPreview.node) : [];
  const canvasBorderColor = theme === 'dark' ? 'rgba(148, 163, 184, 0.22)' : getThemeColor(theme, 'border');

  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        height: 'min(72vh, 740px)',
        minHeight: 560,
        border: `1px solid ${canvasBorderColor}`,
        borderRadius: 10,
        overflow: 'hidden',
        background: theme === 'dark' ? '#090b0f' : '#f6f8fb',
        overscrollBehavior: 'contain',
      }}
    >
      <canvas
        ref={canvasRef}
        data-testid="knowledge-graph-canvas"
        width={dimensions.width}
        height={dimensions.height}
        style={{
          display: 'block',
          width: '100%',
          height: '100%',
          cursor: dragStateRef.current?.mode === 'pan' ? 'grabbing' : 'grab',
          touchAction: 'none',
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => {
          dragStateRef.current = null;
          clearHoverPreview();
        }}
        onWheel={handleWheel}
      />

      <div style={graphCanvasMarkerLayerStyle} aria-hidden="true">
        {nodeAnchors.map((anchor) => (
          <button
            key={anchor.nodeKey}
            type="button"
            data-node-key={anchor.nodeKey}
            aria-label={anchor.label}
            style={{
              ...graphCanvasMarkerStyle,
              left: anchor.x,
              top: anchor.y,
              width: anchor.size,
              height: anchor.size,
              borderRadius: anchor.size / 2,
            }}
            onMouseEnter={() => handleMarkerHover(anchor)}
            onMouseLeave={clearHoverPreview}
            onClick={() => handleMarkerClick(anchor.nodeKey)}
          />
        ))}
      </div>

      <div
        style={{
          position: 'absolute',
          left: 16,
          top: 14,
          padding: '8px 10px',
          borderRadius: 8,
          border: theme === 'dark'
            ? '1px solid rgba(148, 163, 184, 0.18)'
            : '1px solid rgba(148, 163, 184, 0.28)',
          background: theme === 'dark' ? 'rgba(9, 11, 15, 0.72)' : 'rgba(255, 255, 255, 0.78)',
          backdropFilter: 'blur(12px)',
          pointerEvents: 'none',
        }}
      >
        <Space size={8} wrap>
          <Tag color="cyan">力导图</Tag>
          <Tag>节点 {nodes.length}</Tag>
          <Tag>边 {links.length}</Tag>
          {selectedCommunity && <Tag color="purple">社区 {selectedCommunity.community_id}</Tag>}
        </Space>
      </div>

      {hoverPreview && (
        <div
          style={{
            position: 'absolute',
            left: hoverPreview.x,
            top: hoverPreview.y,
            width: HOVER_CARD_WIDTH,
            padding: 14,
            borderRadius: 10,
            border: `1px solid ${getThemeColor(theme, 'border')}`,
            background: theme === 'dark' ? 'rgba(9, 11, 15, 0.96)' : 'rgba(255, 255, 255, 0.96)',
            boxShadow: theme === 'dark'
              ? '0 18px 46px rgba(0, 0, 0, 0.44)'
              : '0 18px 42px rgba(15, 23, 42, 0.16)',
            pointerEvents: 'none',
            zIndex: 3,
          }}
        >
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            <div>
              <Text strong style={{ color: getThemeColor(theme, 'text') }}>
                节点预览
              </Text>
              <Title level={5} style={{ margin: '6px 0 0', color: getThemeColor(theme, 'text') }}>
                {hoverPreview.node.label}
              </Title>
            </div>

            <Space wrap size={[8, 8]}>
              <Tag color="blue">{hoverPreview.node.node_type}</Tag>
              <Tag>度数 {hoverPreview.node.degree}</Tag>
              <Tag>文章 {hoverPreview.node.article_count}</Tag>
              {hoverPreview.node.community_id !== null && hoverPreview.node.community_id !== undefined && (
                <Tag>社区 {hoverPreview.node.community_id}</Tag>
              )}
            </Space>

            <Text type="secondary">{hoverPreview.node.node_key}</Text>
            <Text type="secondary">中心性 {formatCentrality(hoverPreview.node.centrality)}</Text>

            {hoverPreview.node.aliases.length > 0 && (
              <div>
                <Text strong>别名</Text>
                <div style={{ marginTop: 6 }}>
                  {hoverPreview.node.aliases.slice(0, 4).map((alias) => (
                    <Tag key={alias}>{alias}</Tag>
                  ))}
                </div>
              </div>
            )}

            {hoverMetadataPreview.length > 0 && (
              <div>
                <Text strong>内容摘要</Text>
                <Space direction="vertical" size={4} style={{ width: '100%', marginTop: 6 }}>
                  {hoverMetadataPreview.map(([key, value]) => (
                    <Text key={key} type="secondary">
                      {key}: {String(value)}
                    </Text>
                  ))}
                </Space>
              </div>
            )}
          </Space>
        </div>
      )}
    </div>
  );
}
