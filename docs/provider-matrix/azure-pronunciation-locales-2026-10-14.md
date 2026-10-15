# Azure Speech — pronunciation assessment locales (verified 2026-10-14)

Source page: https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support?tabs=pronunciation-assessment

> **Correction:** an earlier automated scrape of this page pasted the *video translation* locale grid (which lists ar-MA,
> sw-KE, he-IL, …) under pronunciation headings. That was wrong. The list below is the actual "Pronunciation assessment" tab,
> re-fetched and cross-checked by the `@langquest/ai` build (`packages/ai/src/capability/azure-locales.ts` is the code source of truth).

## Supported locales (33)

ar-EG, ar-SA, ca-ES, zh-HK, zh-CN, zh-TW, da-DK, nl-NL, en-AU, en-CA, en-IN, en-GB, en-US, fi-FI, fr-CA, fr-FR, de-DE, hi-IN,
it-IT, ja-JP, ko-KR, ms-MY, nb-NO, pl-PL, pt-BR, pt-PT, ru-RU, es-MX, es-ES, sv-SE, ta-IN, th-TH, vi-VN.

## LangQuest tracks with NO acoustic pronunciation scorer

Arabic (Moroccan `ary` / ar-MA), Arabic (Eastern `ar-levant` / ar-SY, ar-LB, ar-JO, ar-PS), Haitian Creole (ht-HT),
Kinyarwanda (rw-RW), Lingala (ln-CD), Swahili (sw-KE / sw-TZ), Hebrew (he-IL), Greek (el-GR), Ukrainian (uk-UA), Romanian (ro-RO).
These tracks use `ReferenceComparisonAssessor` (`numericScore: null`, `assessmentMode: 'reference-comparison'`,
`confidence: 'limited'`) and the UI must say "detailed phoneme assessment not yet available".

MSA (`arb`) maps to `ar-SA` and is labelled **limited** (Gulf-trained model scoring formal MSA). Azure credentials were not
available during the build, so the adapter is implemented and fixture-tested but **not exercised live**.

Re-verify this list against the live page before enabling the Azure adapter in production.
