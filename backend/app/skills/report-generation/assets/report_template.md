# {{title}}

> 报告类型：模型偷跑预警  
> 生成时间：{{generated_at}}  
> 生成模型：{{model_used}}  
> 报告版本：{{report_version}}

## 1. 偷跑判定结论
- 信号等级：**{{leak_signal_level}}**
- 发布置信度：**{{release_confidence}}**
- 判定结论：{{conclusion}}

## 2. 执行摘要
{{summary}}

## 3. 信号快照
| 字段 | 值 |
| --- | --- |
| 更新类型 | {{update_type}} |
| 监控名单命中 | {{watch_hit}} |
| 最近更新时间 | {{updated_at}} |
| 首次发现时间 | {{discovered_at}} |
| 来源平台 | {{source_platform}} |
| 来源标识 | `{{source_uid}}` |
| 原始来源链接 | {{source_url}} |

## 4. 关键发现
{{highlights}}

## 5. 触发原因与更新说明
### 5.1 触发原因
{{signal_reasons}}

### 5.2 更新摘要
{{update_summary}}

## 6. 证据链
| 证据类型 | 链接 |
| --- | --- |
| GitHub | {{github_url}} |
| 模型主页 | {{model_url}} |
| 论文 | {{paper_url}} |

## 7. 技术分析
{{technical_analysis}}

## 8. 性能与基准
{{performance_analysis}}

## 9. 代码与工程实现
{{code_analysis}}

## 10. 潜在应用场景
{{use_cases}}

## 11. 风险与反证
{{risks}}

## 12. 后续行动建议
{{recommendations}}

## 13. 引用与佐证
{{references}}

## 14. 模型基础信息
| 字段 | 内容 |
| --- | --- |
| 模型名称 | {{model_name}} |
| 发布组织 | {{organization}} |
| 模型类型 | {{model_type}} |
| 发布时间 | {{release_date}} |
| 开源协议 | {{license}} |
| GitHub 指标 | stars={{github_stars}}, forks={{github_forks}} |
| 论文指标 | citations={{paper_citations}} |
| 社交讨论度 | {{social_mentions}} |
| 综合评分 | **{{final_score}} / 100** |
| 影响力/质量/创新/实用 | {{impact_score}} / {{quality_score}} / {{innovation_score}} / {{practicality_score}} |
