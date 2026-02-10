# Analysis Patterns

## Structure

- Prefer repository-level signals first (README, docs, stars/forks, update recency).
- Avoid claiming implementation details that are not present in metadata.

## Architecture

- Infer architecture from model type and public description.
- Mark uncertain conclusions as "inference" explicitly.

## Benchmarks

- Extract only concrete benchmark names and metrics that appear in source text.
- If absent, return a clear "missing benchmark evidence" statement.
