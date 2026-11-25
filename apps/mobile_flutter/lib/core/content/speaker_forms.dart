import 'content_bundle.dart';
import 'content_models.dart';
import 'speaker_form_phrases.dart';

/// Choose the learner's own form once when content or the preference changes. Stable expression IDs keep progress,
/// games and checkpoints together. Audio and speech checks resolve to the recording of the selected wording.
ContentBundle forSpeaker(ContentBundle original, SpeakerForm form) {
  if (form == SpeakerForm.course) return original;
  final references = <String, String?>{};
  final chapters = <Chapter>[];
  Map<String, SpeakerPhrase> index(List<SpeakerPhrase> pairs) => {for (final p in pairs) p.masculine: p, for (final p in pairs) p.feminine: p};
  final recordings = {
    for (final c in original.chapters)
      for (final m in c.missions)
        for (final e in m.expressions)
          if (original.voices.clipOf(e.id) != null) (c.courseTrackId, original.voices.voiceOf[e.id], e.text): e,
  };
  for (final chapter in original.chapters) {
    final phrases = index(speakerPhrases[chapter.courseTrackId] ?? const []);
    final addressed = index(addresseePhrases[chapter.courseTrackId] ?? const []);
    final feminine = form == SpeakerForm.feminine;
    Expression adapt(Expression line) {
      final pair = (line.byLearner ? phrases : addressed)[line.text];
      final text = pair == null
          ? line.text
          : feminine
          ? pair.feminine
          : pair.masculine;
      if (line.text == text) {
        final french = line.meaningIn('fr');
        if (french == null) return line;
        final gloss = _optionalFrench(french.meaning, line.byLearner, feminine);
        if (gloss == french.meaning) return line;
        return line.withWording(
          meanings: {
            ...line.meanings,
            'fr': Meaning(meaning: gloss, note: french.note, literal: french.literal),
          },
        );
      }
      final other = recordings[(chapter.courseTrackId, original.voices.voiceOf[line.id], text)];
      final latin = feminine ? pair!.reading?.$2 : pair!.reading?.$1;
      references[line.id] = other?.id ?? (pair.sameSound ? line.id : null);
      return line.withWording(
        text: text,
        forms:
            other?.forms ??
            [
              for (final f in line.forms)
                if (f.scheme == null)
                  ExpressionForm(script: f.script, scheme: null, text: text)
                else if (f.script == 'Latn' && latin != null)
                  ExpressionForm(script: f.script, scheme: f.scheme, text: latin),
            ],
        meanings: other != null && other.id.split(':')[1] == line.id.split(':')[1]
            ? other.meanings
            : {
                for (final entry in line.meanings.entries)
                  entry.key: Meaning(meaning: _gloss(entry.value.meaning, entry.key, feminine), note: null, literal: null),
              },
        keepPronunciationNote: false,
      );
    }

    chapters.add(chapter.withMissions([for (final mission in chapter.missions) mission.withExpressions(mission.expressions.map(adapt).toList())]));
  }
  return ContentBundle(
    tracks: original.tracks,
    chapters: chapters,
    loadedTracks: original.tracks.where((t) => original.isLoaded(t.id)).map((t) => t.id),
    skills: original.skills,
    roles: original.roles,
    examples: original.examples,
    voices: original.voices,
    speakerReferences: references,
  );
}

String _optionalFrench(String gloss, bool byLearner, bool feminine) {
  // Optional endings on a character's first-person description belong to the character.
  if (!byLearner && (gloss.contains('content(e)') || !RegExp(r"\b(tu|vous)\b|^Perdu\(e\)", caseSensitive: false).hasMatch(gloss))) return gloss;
  return gloss
      .replaceAll(
        RegExp(r'votre (?:nouveau voisin / (?:votre )?nouvelle voisine|nouvelle voisine / votre nouveau voisin|nouvel\(le\) voisin\(e\))'),
        feminine ? 'votre nouvelle voisine' : 'votre nouveau voisin',
      )
      .replaceAll('(e)', feminine ? 'e' : '');
}

String _gloss(String meaning, String language, bool feminine) {
  var result = meaning.replaceAll(
    RegExp(
      r'\s*\((?:said by a (?:wo)?man|(?:fe)?male speaker|(?:masculine|feminine)|dit par (?:un homme|une femme)|au (?:masculin|féminin))\)',
      caseSensitive: false,
    ),
    '',
  );
  if (language == 'fr') {
    result = _optionalFrench(result, true, feminine);
    for (final (male, female) in const [
      ('le nouveau voisin', 'la nouvelle voisine'),
      ('votre nouveau voisin', 'votre nouvelle voisine'),
      ('ton nouveau voisin', 'ta nouvelle voisine'),
      ('Je suis nouveau', 'Je suis nouvelle'),
      ('tu as l’air fatigué', 'tu as l’air fatiguée'),
      ("tu as l'air fatigué", "tu as l'air fatiguée"),
      ('Je suis fatigué', 'Je suis fatiguée'),
      ('je suis fatigué', 'je suis fatiguée'),
      ('Je suis ingénieur', 'Je suis ingénieure'),
      ('Je suis épuisé', 'Je suis épuisée'),
      ('Enchanté', 'Enchantée'),
      ('Désolé', 'Désolée'),
      ('Ravi de', 'Ravie de'),
    ]) {
      result = result.replaceAll(RegExp('${RegExp.escape(feminine ? male : female)}(?![a-zà-ÿ])'), feminine ? female : male);
    }
  }
  return result.trim();
}
