---
name: model-evaluation
description: 评估新模型的影响力、技术质量、创新性和实用性，并计算综合评分。用于自主探索流程中的质量过滤与优先级决策。
---

# Model Evaluation Skill

## Steps

1. Call `scripts/calculate_impact.py` to get impact score.
2. Call `scripts/evaluate_quality.py` to get quality, innovation, and practicality scores.
3. Call `scripts/calculate_final_score.py` to compute final weighted score.
4. Mark models with `final_score >= threshold` as notable.

## Inputs

- `model_data`: normalized model info dictionary.
- `threshold`: minimum score for notable models (default `70`).

## Outputs

- `impact_score`: float in `[0, 100]`
- `quality_score`: float in `[0, 100]`
- `innovation_score`: float in `[0, 100]`
- `practicality_score`: float in `[0, 100]`
- `final_score`: float in `[0, 100]`
- `is_notable`: boolean
