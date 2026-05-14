import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { apiService } from '@/services/api';
import { buildKnowledgeGraphEdgeKey } from '@/utils/knowledgeGraph';

type KnowledgeGraphCommandReason = 'node' | 'path' | 'article' | 'custom';

export interface KnowledgeGraphNavigationCommand {
  id: number;
  reason: KnowledgeGraphCommandReason;
  searchTerm?: string;
  nodeType?: string;
  selectedNodeKey?: string;
  focusNodeKeys: string[];
  expandDepth: number;
  highlightedNodeKeys: string[];
  highlightedEdgeKeys: string[];
}

interface KnowledgeGraphCommandOptions {
  searchTerm?: string;
  nodeType?: string;
  selectedNodeKey?: string;
  focusNodeKeys?: string[];
  expandDepth?: number;
  highlightedNodeKeys?: string[];
  highlightedEdgeKeys?: string[];
}

interface KnowledgeGraphViewContextValue {
  graphCommand: KnowledgeGraphNavigationCommand | null;
  focusNode: (nodeKey: string, options?: KnowledgeGraphCommandOptions) => void;
  focusPath: (
    nodeKeys: string[],
    edges: Array<{ source: string; target: string }>,
    options?: KnowledgeGraphCommandOptions
  ) => void;
  focusArticle: (articleId: number, options?: KnowledgeGraphCommandOptions) => void;
  issueCustomCommand: (command: Omit<KnowledgeGraphNavigationCommand, 'id'>) => void;
  clearGraphCommand: () => void;
}

const KnowledgeGraphViewContext = createContext<KnowledgeGraphViewContextValue | undefined>(undefined);

function normalizeCommand(
  id: number,
  reason: KnowledgeGraphCommandReason,
  options: KnowledgeGraphCommandOptions
): KnowledgeGraphNavigationCommand {
  return {
    id,
    reason,
    searchTerm: options.searchTerm,
    nodeType: options.nodeType,
    selectedNodeKey: options.selectedNodeKey,
    focusNodeKeys: options.focusNodeKeys || [],
    expandDepth: options.expandDepth ?? 0,
    highlightedNodeKeys: options.highlightedNodeKeys || [],
    highlightedEdgeKeys: options.highlightedEdgeKeys || [],
  };
}

export function KnowledgeGraphViewProvider({ children }: { children: ReactNode }) {
  const [graphCommand, setGraphCommand] = useState<KnowledgeGraphNavigationCommand | null>(null);
  const nextCommandIdRef = useRef(1);

  const createCommandId = useCallback(() => {
    const commandId = nextCommandIdRef.current;
    nextCommandIdRef.current += 1;
    return commandId;
  }, []);

  const issueCustomCommand = useCallback(
    (command: Omit<KnowledgeGraphNavigationCommand, 'id'>) => {
      setGraphCommand({
        ...command,
        id: createCommandId(),
      });
    },
    [createCommandId]
  );

  const focusNode = useCallback(
    (nodeKey: string, options: KnowledgeGraphCommandOptions = {}) => {
      setGraphCommand(
        normalizeCommand(createCommandId(), 'node', {
          searchTerm: options.searchTerm ?? nodeKey,
          selectedNodeKey: options.selectedNodeKey ?? nodeKey,
          focusNodeKeys: options.focusNodeKeys ?? [nodeKey],
          expandDepth: options.expandDepth ?? 1,
          highlightedNodeKeys: options.highlightedNodeKeys,
          highlightedEdgeKeys: options.highlightedEdgeKeys,
          nodeType: options.nodeType,
        })
      );
    },
    [createCommandId]
  );

  const focusPath = useCallback(
    (
      nodeKeys: string[],
      edges: Array<{ source: string; target: string }>,
      options: KnowledgeGraphCommandOptions = {}
    ) => {
      const uniqueNodeKeys = Array.from(new Set(nodeKeys));
      setGraphCommand(
        normalizeCommand(createCommandId(), 'path', {
          searchTerm: options.searchTerm,
          selectedNodeKey: options.selectedNodeKey ?? uniqueNodeKeys[0],
          focusNodeKeys: options.focusNodeKeys ?? uniqueNodeKeys,
          expandDepth: options.expandDepth ?? 0,
          highlightedNodeKeys: options.highlightedNodeKeys ?? uniqueNodeKeys,
          highlightedEdgeKeys:
            options.highlightedEdgeKeys ||
            edges.map((edge) => buildKnowledgeGraphEdgeKey(edge.source, edge.target)),
          nodeType: options.nodeType,
        })
      );
    },
    [createCommandId]
  );

  const focusArticle = useCallback(
    async (articleId: number, options: KnowledgeGraphCommandOptions = {}) => {
      const context = await apiService.getKnowledgeGraphArticleContext(articleId);
      const focusNodeKeys = options.focusNodeKeys ?? context.nodes.map((node) => node.node_key);
      const highlightedEdgeKeys = options.highlightedEdgeKeys ?? context.edges.map((edge) =>
        buildKnowledgeGraphEdgeKey(edge.source_node_key, edge.target_node_key)
      );
      setGraphCommand(
        normalizeCommand(createCommandId(), 'article', {
          searchTerm: options.searchTerm ?? (context.article?.title_zh || context.article?.title || ''),
          selectedNodeKey: options.selectedNodeKey ?? focusNodeKeys[0],
          focusNodeKeys,
          expandDepth: options.expandDepth ?? 1,
          highlightedNodeKeys: options.highlightedNodeKeys ?? focusNodeKeys,
          highlightedEdgeKeys,
          nodeType: options.nodeType,
        })
      );
    },
    [createCommandId]
  );

  const clearGraphCommand = useCallback(() => {
    setGraphCommand(null);
  }, []);

  const value = useMemo(
    () => ({
      graphCommand,
      focusNode,
      focusPath,
      focusArticle,
      issueCustomCommand,
      clearGraphCommand,
    }),
    [
      clearGraphCommand,
      focusArticle,
      focusNode,
      focusPath,
      graphCommand,
      issueCustomCommand,
    ]
  );

  return (
    <KnowledgeGraphViewContext.Provider value={value}>
      {children}
    </KnowledgeGraphViewContext.Provider>
  );
}

export function useKnowledgeGraphView() {
  const context = useContext(KnowledgeGraphViewContext);
  if (!context) {
    throw new Error('useKnowledgeGraphView must be used within a KnowledgeGraphViewProvider');
  }
  return context;
}
