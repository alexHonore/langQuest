# Call dialogue models: GPT 6 / 6.1 vs Claude 5.5 (2026-11-11)

Question from the owner: should calls ("what the character says", task `character_dialogue`) use OpenAI GPT 6.1 Terra
instead of Claude Haiku 5.5, and GPT 6.1 Sol instead of Claude Sonnet 5.5 (used for the dialect courses)?

## Method

- The app's own call code: `CharacterAgent` (character prompt, strict JSON schema, language guard, one repair retry),
  with the candidate as the only model in the chain (no fallback can answer in its place) and the route's other
  parameters unchanged.
- Three calls, two turns each (the character's opening line, then its reply to a beginner's answer):
  Spanish of Spain (Antonio, retired bus driver, Seville, learner from English), Moroccan Darija (Samira, barista,
  Casablanca, learner from French), Japanese (Kenji, convenience-store clerk, Tokyo, learner from English).
- Two runs. Run 1 kept the test fixture's `register: 'casual'`; run 2 used `register: 'neutral'`, which is what the
  API sends for every call (`apps/api/src/lib/conversation.ts`). Quality below is from run 2 only; run 1 penalised the
  models that followed the casual instruction for a shop clerk.
- Quality: a blind judge from a third provider (`google/gemini-3.8-flash`, temperature 0) scored the five candidates'
  lines for each turn, shuffled and labelled A–E, from 1 to 10 (natural and correct in that variety and register, in
  character, simple enough for a beginner, keeps the conversation moving). 12 lines per model.
- Latency and cost: 24 turns per model (both runs), run concurrently per turn from the same machine. Cost =
  tokens × the OpenRouter list price of the day.

## Results

| Model | Judge mean | Spanish | Darija | Japanese | Median turn | Slowest turn | Tokens in / out (mean) | $ per turn | $ per 20-turn call |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `anthropic/claude-haiku-5.5` | 6.25 | 7.5 | 5.3 | 6.0 | 3.2 s | 9.2 s | 1857 / 618 | $0.00049 | $0.010 |
| `openai/gpt-6-luna` | 7.50 | 7.0 | 8.0 | 7.5 | 3.4 s | 6.3 s | 912 / 219 | $0.00020 | $0.004 |
| `openai/gpt-6.1-terra` | 6.00 | 5.8 | 6.5 | 5.8 | 4.2 s | 9.5 s | 911 / 148 | $0.00165 | $0.033 |
| `openai/gpt-6.1-sol` | 6.08 | 6.5 | 5.5 | 6.3 | 3.6 s | 7.1 s | 912 / 128 | $0.00311 | $0.062 |
| `anthropic/claude-sonnet-5.5` | 7.83 | 7.5 | 9.3 | 6.8 | 1.9 s | 4.9 s | 1773 / 226 | $0.00580 | $0.116 |

List prices (USD per million tokens, in / out): Haiku 5.5 0.10 / 0.50, GPT 6 Luna 0.10 / 0.50, GPT 6.1 Terra
1.00 / 5.00, GPT 6.1 Sol 2.00 / 10.00, Sonnet 5.5 2.00 / 10.00. The GPT models count about half the input tokens
for the same prompt, and Haiku writes the most output tokens, so per turn Terra costs about 3.4× Haiku (not 10×) and Sol
about half of Sonnet.

No model failed the JSON schema or the language guard in 24 turns.

## Reading

- GPT 6.1 Terra is not cheaper than Haiku 5.5 (about 3.4× per turn) and did not write better call lines in this test;
  it was also the slowest (GPT 6.1 models reason before answering and do not take a `temperature`).
- GPT 6.1 Sol costs about half of Sonnet 5.5 per turn but scored lower, especially in Darija (5.5 vs 9.3), and was
  about twice as slow.
- Sonnet 5.5 wrote the best lines and was the fastest; it is the most expensive per call.
- GPT 6 Luna (Haiku's list price, fewer tokens per turn) scored second overall, above Haiku, in both runs.
- Small sample (12 judged lines per model, one judge, one afternoon): treat differences under about one point as noise.

## Decision (owner, 2026-11-11)

Calls default to `openai/gpt-6-luna`, then `anthropic/claude-sonnet-5.5`, then `google/gemini-3.8-flash`. The dialect
and low-resource courses (ary, arz, ar-levant, yue, ht, rw, ln, sw) keep `anthropic/claude-sonnet-5.5` first, then
`openai/gpt-6-luna`, then `google/gemini-3.8-flash`. An admin can still change either route from the admin page.

## Also found

OpenRouter rejects a request whose `models` fallback array has more than three entries ("'models' array must have 3
items or fewer"). A model override on top of a route with a primary and two fallbacks made four, so the admin smoke
test of a new primary model, and the jobs model benchmark, failed for any model outside the current chain. The client
now sends at most three and keeps the rest queued (`OPENROUTER_MAX_MODELS`).
