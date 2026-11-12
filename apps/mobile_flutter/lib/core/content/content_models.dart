/// Content model of the offline bundle (`assets/content/*.json`).
///
/// The bundle is generated from the shared TypeScript packages by
/// `pnpm --filter @langquest/scripts export-flutter-content` — never edit the JSON by hand. The shapes mirror the
/// curriculum seed (`packages/curriculum/src/content/types.ts`) so the same model can later be filled from the
/// LangQuest API's course manifest.
library;

enum Speaker { learner, character }

/// The instruction languages this app's interface is translated into (CONVENTIONS §2.2: no mixed-language UI).
const supportedInstructionLanguages = ['en', 'fr'];

String _str(Object? v) => v is String ? v : '';
String? _strOrNull(Object? v) => v is String && v.isNotEmpty ? v : null;
Map<String, String> _strMap(Object? v) => v is Map ? {for (final e in v.entries) '${e.key}': _str(e.value)} : const {};
List<String> _strList(Object? v) => v is List ? [for (final e in v) _str(e)] : const [];

/// A skill the server tracks mastery of (`GET /v1/me/skills`), with its learner-facing names (`skills.json`, exported
/// from `packages/locales` `progress.skill.<key>`).
class SkillInfo {
  /// Stable key (`greet_politely`, `speaking.intelligibility`).
  final String key;

  /// CEFR can-do band (descriptive only, never a certificate).
  final String cefr;
  final Map<String, String> names;

  /// An evidence dimension recorded outside mission goals (`speaking.intelligibility`), not a can-do skill.
  final bool system;

  const SkillInfo({required this.key, required this.cefr, required this.names, this.system = false});

  factory SkillInfo.fromJson(Map<String, Object?> json) =>
      SkillInfo(key: _str(json['key']), cefr: _str(json['cefr']), names: _strMap(json['names']), system: json['system'] == true);

  /// The name in [language], else English, else the key.
  String name(String language) => names[language] ?? names['en'] ?? key;
}

/// One written form of an expression: the native script (`scheme == null`) or a transliteration / reading aid.
class ExpressionForm {
  /// ISO 15924 script of the text (`Latn` for romanizations).
  final String script;

  /// Transliteration scheme (`romaji`, `arabizi`, `furigana`, …) or null for the native-script form.
  final String? scheme;
  final String text;

  const ExpressionForm({required this.script, required this.scheme, required this.text});

  factory ExpressionForm.fromJson(Map<String, Object?> json) =>
      ExpressionForm(script: _str(json['script']), scheme: _strOrNull(json['scheme']), text: _str(json['text']));
}

/// The meaning of an expression in one instruction language, with an optional usage note and literal gloss.
class Meaning {
  final String meaning;
  final String? note;
  final String? literal;

  const Meaning({required this.meaning, this.note, this.literal});

  factory Meaning.fromJson(Map<String, Object?> json) =>
      Meaning(meaning: _str(json['meaning']), note: _strOrNull(json['note']), literal: _strOrNull(json['literal']));
}

class Expression {
  /// Stable id `<chapter>:<mission>:<expression>` (the seed id the database derives its keys from).
  final String id;
  final String key;
  final String intentKey;

  /// Blueprint dialogue slot this line fills, or null for an extra variant.
  final String? slotId;
  final Speaker speaker;

  /// Canonical target text in the native script.
  final String text;
  final List<ExpressionForm> forms;
  final Map<String, Meaning> meanings;
  final String register;
  final String? codeSwitchNote;
  final String? pronunciationNote;

  const Expression({
    required this.id,
    required this.key,
    required this.intentKey,
    required this.slotId,
    required this.speaker,
    required this.text,
    required this.forms,
    required this.meanings,
    required this.register,
    this.codeSwitchNote,
    this.pronunciationNote,
  });

  factory Expression.fromJson(Map<String, Object?> json) => Expression(
    id: _str(json['id']),
    key: _str(json['key']),
    intentKey: _str(json['intentKey']),
    slotId: _strOrNull(json['slotId']),
    speaker: json['speaker'] == 'character' ? Speaker.character : Speaker.learner,
    text: _str(json['text']),
    forms: [for (final f in (json['forms'] as List? ?? const [])) ExpressionForm.fromJson((f as Map).cast<String, Object?>())],
    meanings: {for (final e in ((json['meanings'] as Map?) ?? const {}).entries) '${e.key}': Meaning.fromJson((e.value as Map).cast<String, Object?>())},
    register: _str(json['register']),
    codeSwitchNote: _strOrNull(json['codeSwitchNote']),
    pronunciationNote: _strOrNull(json['pronunciationNote']),
  );

  bool get byLearner => speaker == Speaker.learner;

  /// Latin romanization (romaji, Arabizi, …) when the expression has one.
  String? get romanization {
    for (final f in forms) {
      if (f.scheme != null && f.script == 'Latn' && f.text != text) return f.text;
    }
    return null;
  }

  /// A same-script reading aid (Japanese furigana as full kana) when it differs from the text itself.
  String? get reading {
    for (final f in forms) {
      if (f.scheme == 'furigana' && f.text != text) return f.text;
    }
    return null;
  }

  Meaning? meaningIn(String language) => meanings[language];
}

class StoryCharacter {
  final String key;
  final String name;
  final String role;
  final String personality;
  final String homeRegion;

  const StoryCharacter({required this.key, required this.name, required this.role, required this.personality, required this.homeRegion});

  factory StoryCharacter.fromJson(Map<String, Object?> json) => StoryCharacter(
    key: _str(json['key']),
    name: _str(json['name']),
    role: _str(json['role']),
    personality: _str(json['personality']),
    homeRegion: _str(json['homeRegion']),
  );
}

class Mission {
  /// Unique across the bundle (e.g. `ary_cafe_order_drink`); used in routes and progress.
  final String key;
  final String chapterKey;
  final String blueprintKey;
  final String missionType;
  final String level;

  /// Blueprint situation (`cafe`, `market`, `directions`, …) — picks the painted scene.
  final String situation;
  final String characterKey;
  final Map<String, String> titles;
  final Map<String, String> sceneNotes;
  final List<Expression> expressions;

  const Mission({
    required this.key,
    required this.chapterKey,
    required this.blueprintKey,
    required this.missionType,
    required this.level,
    required this.situation,
    required this.characterKey,
    required this.titles,
    required this.sceneNotes,
    required this.expressions,
  });

  factory Mission.fromJson(Map<String, Object?> json, String chapterKey) => Mission(
    key: _str(json['key']),
    chapterKey: chapterKey,
    blueprintKey: _str(json['blueprintKey']),
    missionType: _str(json['missionType']),
    level: _str(json['level']),
    situation: _str(json['situation']),
    characterKey: _str(json['characterKey']),
    titles: _strMap(json['titles']),
    sceneNotes: _strMap(json['sceneNotes']),
    expressions: [for (final e in (json['expressions'] as List? ?? const [])) Expression.fromJson((e as Map).cast<String, Object?>())],
  );

  /// Title in [language]; null when the chapter has no overlay for it (never another language's title).
  String? titleIn(String language) => titles[language];
  String? sceneNoteIn(String language) => sceneNotes[language];

  List<Expression> get learnerExpressions => [
    for (final e in expressions)
      if (e.byLearner) e,
  ];
}

class Chapter {
  final String key;
  final int chapterIndex;
  final String courseTrackId;
  final String targetVarietyId;
  final List<String> sourceLanguages;
  final Map<String, String> titles;
  final String provenance;

  /// Always false for the bundled drafts; the app discloses it before enrolling and on the pathway.
  final bool nativeReviewed;
  final String reviewStatus;
  final List<StoryCharacter> characters;
  final List<Mission> missions;

  const Chapter({
    required this.key,
    required this.chapterIndex,
    required this.courseTrackId,
    required this.targetVarietyId,
    required this.sourceLanguages,
    required this.titles,
    required this.provenance,
    required this.nativeReviewed,
    required this.reviewStatus,
    required this.characters,
    required this.missions,
  });

  factory Chapter.fromJson(Map<String, Object?> json) {
    final key = _str(json['key']);
    return Chapter(
      key: key,
      chapterIndex: (json['chapterIndex'] as num?)?.toInt() ?? 1,
      courseTrackId: _str(json['courseTrackId']),
      targetVarietyId: _str(json['targetVarietyId']),
      sourceLanguages: _strList(json['sourceLanguages']),
      titles: _strMap(json['titles']),
      provenance: _str(json['provenance']),
      nativeReviewed: json['nativeReviewed'] == true,
      reviewStatus: _str(json['reviewStatus']),
      characters: [for (final c in (json['characters'] as List? ?? const [])) StoryCharacter.fromJson((c as Map).cast<String, Object?>())],
      missions: [for (final m in (json['missions'] as List? ?? const [])) Mission.fromJson((m as Map).cast<String, Object?>(), key)],
    );
  }

  String? titleIn(String language) => titles[language];

  StoryCharacter? character(String key) {
    for (final c in characters) {
      if (c.key == key) return c;
    }
    return null;
  }
}

/// Per-course cover recipe (`@langquest/ui` COVER_RECIPES): the hues the course accent is derived from.
class CoverRecipe {
  final double hue;
  final double hue2;
  final String motif;
  final int variant;

  const CoverRecipe({required this.hue, required this.hue2, required this.motif, required this.variant});

  factory CoverRecipe.fromJson(Map<String, Object?> json) => CoverRecipe(
    hue: (json['hue'] as num?)?.toDouble() ?? 0,
    hue2: (json['hue2'] as num?)?.toDouble() ?? 0,
    motif: _str(json['motif']),
    variant: (json['variant'] as num?)?.toInt() ?? 0,
  );
}

class CourseTrackInfo {
  final String id;
  final int order;
  final Map<String, String> names;
  final String nativeName;
  final String languageCode;
  final String targetVarietyId;
  final String varietyName;
  final String defaultLocale;

  /// BCP-47 tag for the phone's speech synthesizer; null when no device voice may speak this variety
  /// (colloquial Arabic: phone Arabic voices speak MSA, which must never stand in for a dialect).
  final String? voiceLocale;
  final String primaryScript;
  final List<String> transliterations;
  final bool tonal;
  final String teachingFocus;
  final CoverRecipe cover;

  /// Instruction languages the course is taught from (its chapters' overlays), known before its chapters are loaded.
  final List<String> sources;

  /// Missions per instruction language, for the course list and page before the chapters are loaded.
  final Map<String, int> missionCounts;

  /// Whether its content is an unreviewed AI draft (disclosed before enrolling).
  final bool draft;

  const CourseTrackInfo({
    required this.id,
    required this.order,
    required this.names,
    required this.nativeName,
    required this.languageCode,
    required this.targetVarietyId,
    required this.varietyName,
    required this.defaultLocale,
    required this.voiceLocale,
    required this.primaryScript,
    required this.transliterations,
    required this.tonal,
    required this.teachingFocus,
    required this.cover,
    this.sources = const [],
    this.missionCounts = const {},
    this.draft = false,
  });

  factory CourseTrackInfo.fromJson(Map<String, Object?> json) => CourseTrackInfo(
    id: _str(json['id']),
    order: (json['order'] as num?)?.toInt() ?? 0,
    names: _strMap(json['names']),
    nativeName: _str(json['nativeName']),
    languageCode: _str(json['languageCode']),
    targetVarietyId: _str(json['targetVarietyId']),
    varietyName: _str(json['varietyName']),
    defaultLocale: _str(json['defaultLocale']),
    voiceLocale: _strOrNull(json['voiceLocale']),
    primaryScript: _str(json['primaryScript']),
    transliterations: _strList(json['transliterations']),
    tonal: json['tonal'] == true,
    teachingFocus: _str(json['teachingFocus']),
    cover: CoverRecipe.fromJson(((json['cover'] as Map?) ?? const {}).cast<String, Object?>()),
    sources: _strList(json['sources']),
    missionCounts: {
      for (final e in ((json['missionCounts'] as Map?) ?? const {}).entries)
        if (e.value is num) '${e.key}': (e.value as num).toInt(),
    },
    draft: json['draft'] == true,
  );

  /// Course name in the interface language (English fallback: the catalog always carries `en`).
  String name(String uiLanguage) => names[uiLanguage] ?? names['en'] ?? id;

  /// Right-to-left native script (Arabic, Hebrew).
  bool get rtl => primaryScript == 'Arab' || primaryScript == 'Hebr';

  /// Whether tiles and drills should use the Latin romanization (non-Latin primary script with a transliteration).
  bool get usesRomanization => primaryScript != 'Latn';
}
