# 知识图谱 V2.1 实现记录

## 1. 本轮交付

本轮完成的不是单点功能，而是一套“图谱原生融入系统”的闭环，核心结果如下：

- 新增全局图谱导航上下文，打通文章详情、AI 对话、知识图谱工作台
- 扩展快照接口，支持聚焦子图与 1 跳 / 2 跳邻域展开
- 新增社区钻取抽屉，补齐社区摘要、关系概览与二次动作
- 增强图谱画布，支持路径高亮、缩放、平移、重置视图和节点内问答
- 补充前端 Vitest 测试基建与关键交互测试

## 2. 后端实现

### 2.1 快照视图增强

在 `KnowledgeGraphService.get_snapshot_view()` 中新增：

- `focus_node_keys`
- `expand_depth`

行为：

- 聚焦节点优先进入结果集
- 当 `expand_depth` 为 `1` 或 `2` 时，基于图邻接关系展开局部子图
- 结果仍受节点数量上限控制，避免局部图无限膨胀

对应接口：

- `GET /knowledge-graph/snapshot`

对应前端 SDK：

- `apiService.getKnowledgeGraphSnapshot()`

### 2.2 社区详情增强

在 `KnowledgeGraphService.get_community_detail()` 中补充：

- `summary_text`
- `relation_types`

生成逻辑：

- 汇总社区内边的 `relation_types`
- 提取代表节点标签作为社区预览
- 生成可直接显示的社区摘要文本

对应返回 schema 已同步扩展。

## 3. 前端实现

### 3.1 全局图谱导航上下文

新增：

- `frontend/src/contexts/KnowledgeGraphViewContext.tsx`

提供：

- `focusNode`
- `focusCommunity`
- `focusPath`
- `focusArticle`
- `issueCustomCommand`

`App.tsx` 已在应用根部挂载 `KnowledgeGraphViewProvider`。  
`Dashboard.tsx` 在收到命令后会自动切到 `knowledge-graph` 页签。

### 3.2 图谱工作台增强

`KnowledgeGraphPanel.tsx` 已升级为命令消费中心：

- 路径查询成功后驱动画布路径高亮
- 社区入口可同步打开社区抽屉
- 问答结果、文章入口、节点入口和社区入口都能继续驱动画布

新增组件：

- `frontend/src/components/KnowledgeGraphCommunityDrawer.tsx`

能力：

- 展示社区摘要、主导关系、代表节点、代表文章
- 支持 Graph / Hybrid 问答
- 支持聚焦社区、定位节点、定位文章

### 3.3 图谱画布增强

`frontend/src/components/KnowledgeGraphExplorer.tsx` 新增：

- 聚焦子图
- 1 跳邻域 / 2 跳邻域
- 路径高亮
- 缩放、平移、重置视图
- 节点详情内 Graph / Hybrid 问答
- 节点详情内继续扩展邻域

另外修复了一个真实交互缺陷：

- 外部命令先设置 `selectedNodeKey`、再等待快照返回时，组件会过早清空选中节点
- 现已改为仅在快照可用后再校验选中节点是否仍存在，保证图谱定位后节点详情能稳定打开

### 3.4 外部入口联动

文章详情：

- `ArticleDetailModal.tsx` 现在可以从文章、关联实体、命中社区、相关文章直接跳转到图谱

AI 对话：

- `AIConversationModal.tsx` 现在可以从命中节点、命中社区、参考文章直接驱动画布

## 4. 测试基建与用例

### 4.1 后端测试

补充并通过：

- `backend/tests/test_knowledge_graph_service.py`
- `backend/tests/test_knowledge_graph_api.py`

覆盖重点：

- 聚焦快照与邻域展开
- 社区详情 `summary_text` / `relation_types`
- 路径查询
- Graph / Hybrid 上下文相关行为

### 4.2 前端测试基建

新增：

- `frontend/package.json` 中的 `test` 与 `test:run`
- `frontend/vite.config.ts` 中的 Vitest 配置
- `frontend/src/test/setup.ts`
- `frontend/src/test/renderWithProviders.tsx`

测试栈：

- Vitest
- Testing Library
- JSDOM

### 4.3 前端交互测试

新增并通过：

- `frontend/src/components/KnowledgeGraphCommunityDrawer.test.tsx`
- `frontend/src/components/KnowledgeGraphExplorer.test.tsx`

覆盖重点：

- 社区抽屉中的 Graph 问答、社区聚焦、节点定位、文章定位
- 路径聚焦后驱动画布快照请求
- 节点详情打开后触发邻域扩展

## 5. 验证结果

已执行并通过：

```bash
python -m unittest backend.tests.test_knowledge_graph_service backend.tests.test_knowledge_graph_api -v
```

```bash
npm.cmd run test:run
```

```bash
npm.cmd run build
```

说明：

- 前端构建仍有 Vite 大包体积 warning，但本轮功能、测试和构建结果均为通过
- 当前 warning 不影响知识图谱功能验收，因此未在本轮扩展处理范围内

## 6. 验收结论

当前知识图谱能力已经从“能构图、能问答、能看图”推进到“能原生嵌入系统并由多入口驱动图谱探索”阶段，满足以下验收点：

- 图谱能力已能被文章详情、AI 对话、路径结果、社区列表共同驱动
- 用户可以围绕节点、社区、路径和文章做连续探索，而不是单次查看
- Graph / Hybrid 问答与图谱工作台已经形成双向联动
- 仓库内已包含 TODO、设计文档、实现记录和测试用例
