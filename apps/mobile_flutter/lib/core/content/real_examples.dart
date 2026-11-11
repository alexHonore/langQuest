import 'dart:convert';

/// A native recording of a Tatoeba sentence, bundled because its own license allows it (CC BY / CC BY-SA / CC0).
class ExampleRecording {
  const ExampleRecording({required this.id, required this.author, required this.license});

  /// Tatoeba's audio id.
  final String id;
  final String? author;
  final String license;

  /// The bundled file (`scripts/src/attach-tatoeba-examples.ts` downloads it).
  String get asset => 'assets/audio/tatoeba/$id.mp3';

  static ExampleRecording? fromJson(Object? json) {
    if (json is! Map || json['id'] is! String || json['license'] is! String) return null;
    return ExampleRecording(id: json['id'] as String, author: json['author'] as String?, license: json['license'] as String);
  }
}

/// A sentence written by a Tatoeba contributor, with its translations (by instruction language).
class RealExample {
  const RealExample({required this.id, required this.text, required this.author, this.translations = const {}, this.recording});

  /// Tatoeba sentence id: `https://tatoeba.org/sentences/show/<id>`.
  final String id;
  final String text;
  final String? author;
  final Map<String, String> translations;
  final ExampleRecording? recording;

  String? translationIn(String language) => translations[language];

  static RealExample? fromJson(Object? json) {
    if (json is! Map || json['id'] is! String || json['text'] is! String) return null;
    final t = json['translations'];
    return RealExample(
      id: json['id'] as String,
      text: json['text'] as String,
      author: json['author'] as String?,
      translations: {
        if (t is Map)
          for (final e in t.entries)
            if (e.value is Map && (e.value as Map)['text'] is String) '${e.key}': (e.value as Map)['text'] as String,
      },
      recording: ExampleRecording.fromJson(json['audio']),
    );
  }
}

/// What Tatoeba has for one phrase: the sentence that is the phrase itself, and sentences that use it.
class PhraseExamples {
  const PhraseExamples({this.attested, this.examples = const []});

  final RealExample? attested;
  final List<RealExample> examples;

  /// The examples a learner taught from [language] can read (translated into it).
  List<RealExample> readableIn(String language) => [
    for (final e in examples)
      if (e.translationIn(language) != null) e,
  ];

  /// Native recordings of the phrase or its examples.
  bool get hasRecording => attested?.recording != null || examples.any((e) => e.recording != null);
}

/// Real examples from Tatoeba for the bundle's phrases (`assets/content/examples.json`).
class RealExamples {
  const RealExamples({this.snapshot = '', this.textLicense = 'CC BY 2.0 FR', this.phrases = const {}, this.untaggedVariety = const {}});

  static const empty = RealExamples();

  /// The Tatoeba export date the examples come from.
  final String snapshot;
  final String textLicense;
  final Map<String, PhraseExamples> phrases;

  /// Courses whose Tatoeba language does not record the country a sentence comes from (Spanish).
  final Set<String> untaggedVariety;

  PhraseExamples? of(String expressionId) => phrases[expressionId];

  factory RealExamples.parse(String source) {
    final json = (jsonDecode(source) as Map).cast<String, Object?>();
    if (json['schemaVersion'] != 1) throw FormatException('Unsupported examples schemaVersion ${json['schemaVersion']}');
    final src = json['source'] is Map ? json['source'] as Map : const {};
    final courses = json['courses'] is Map ? json['courses'] as Map : const {};
    final phrases = json['phrases'] is Map ? json['phrases'] as Map : const {};
    return RealExamples(
      snapshot: src['snapshot'] is String ? src['snapshot'] as String : '',
      textLicense: src['textLicense'] is String ? src['textLicense'] as String : 'CC BY 2.0 FR',
      untaggedVariety: {
        for (final e in courses.entries)
          if (e.value is Map && (e.value as Map)['varietyTagged'] == false) '${e.key}',
      },
      phrases: {
        for (final e in phrases.entries)
          if (e.value is Map)
            '${e.key}': PhraseExamples(
              attested: RealExample.fromJson((e.value as Map)['attested']),
              examples: [for (final x in ((e.value as Map)['examples'] as List? ?? const [])) ?RealExample.fromJson(x)],
            ),
      },
    );
  }
}
