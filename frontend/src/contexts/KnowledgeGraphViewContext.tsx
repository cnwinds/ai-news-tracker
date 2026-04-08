import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import {
  buildKnowledgeGraphArticleNodeKey,
  buildKnowledgeGraphEdgeKey,
} from '@/utils/knowledgeGraph';

type KnowledgeGraphCommandReason = 'node' | 'community' | 'path' | 'article' | 'custom';

export interface KnowledgeGraphNavigationCommand {
  id: number;
  reason: KnowledgeGraphCommandReason;
  searchTerm?: string;
  nodeType?: string;
  communityId?: number;
  selectedNodeKey?: string;
  focusNodeKeys: string[];
  expandDepth: number;
  highlightedNodeKeys: string[];
  highlightedEdgeKeys: string[];
  openCommunityId?: number;
}

interface KnowledgeGraphCommandOptions {
  searchTerm?: string;
  nodeType?: string;
  communityId?: number;
  selectedNodeKey?: string;
  focusNodeKeys?: string[];
  expandDepth?: number;
  highlightedNodeKeys?: string[];
  highlightedEdgeKeys?: string[];
  openCommunityId?: number;
}

interface KnowledgeGraphViewContextValue {
  graphCommand: KnowledgeGraphNavigationCommand | null;
  focusNode: (nodeKey: string, options?: KnowledgeGraphCommandOptions) => void;
  focusCommunity: (communityId: number, options?: KnowledgeGraphCommandOptions) => void;
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
    communityId: options.communityId,
    selectedNodeKey: options.selectedNodeKey,
    focusNodeKeys: options.focusNodeKeys || [],
    expandDepth: options.expandDepth ?? 0,
    highlightedNodeKeys: options.highlightedNodeKeys || [],
    highlightedEdgeKeys: options.highlightedEdgeKeys || [],
    openCommunityId: options.openCommunityId,
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
          communityId: options.communityId,
          nodeType: options.nodeType,
          openCommunityId: options.openCommunityId,
        })
      );
    },
    [createCommandId]
  );

  const focusCommunity = useCallback(
    (communityId: number, options: KnowledgeGraphCommandOptions = {}) => {
      setGraphCommand(
        normalizeCommand(createCommandId(), 'community', {
          searchTerm: options.searchTerm,
          communityId,
          selectedNodeKey: options.selectedNodeKey,
          focusNodeKeys: options.focusNodeKeys || [],
          expandDepth: options.expandDepth ?? 0,
          highlightedNodeKeys: options.highlightedNodeKeys,
          highlightedEdgeKeys: options.highlightedEdgeKeys,
          nodeType: options.nodeType,
          openCommunityId: options.openCommunityId ?? communityId,
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
          communityId: options.communityId,
          selectedNodeKey: options.selectedNodeKey ?? uniqueNodeKeys[0],
          focusNodeKeys: options.focusNodeKeys ?? uniqueNodeKeys,
          expandDepth: options.expandDepth ?? 0,
          highlightedNodeKeys: options.highlightedNodeKeys ?? uniqueNodeKeys,
          highlightedEdgeKeys:
            options.highlightedEdgeKeys ||
            edges.map((edge) => buildKnowledgeGraphEdgeKey(edge.source, edge.target)),
          nodeType: options.nodeType,
          openCommunityId: options.openCommunityId,
        })
      );
    },
    [createCommandId]
  );

  const focusArticle = useCallback(
    (articleId: number, options: KnowledgeGraphCommandOptions = {}) => {
      const articleNodeKey = buildKnowledgeGraphArticleNodeKey(articleId);
      setGraphCommand(
        normalizeCommand(createCommandId(), 'article', {
          searchTerm: options.searchTerm ?? articleNodeKey,
          selectedNodeKey: options.selectedNodeKey ?? articleNodeKey,
          focusNodeKeys: options.focusNodeKeys ?? [articleNodeKey],
          expandDepth: options.expandDepth ?? 1,
          highlightedNodeKeys: options.highlightedNodeKeys ?? [articleNodeKey],
          highlightedEdgeKeys: options.highlightedEdgeKeys,
          communityId: options.communityId,
          nodeType: options.nodeType,
          openCommunityId: options.openCommunityId,
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
      focusCommunity,
      focusPath,
      focusArticle,
      issueCustomCommand,
      clearGraphCommand,
    }),
    [
      clearGraphCommand,
      focusArticle,
      focusCommunity,
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
