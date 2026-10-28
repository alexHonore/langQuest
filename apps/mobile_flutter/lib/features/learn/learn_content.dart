/// Learn-path content (approved declination L1 + L3 inside N2, 2026-10-27).
///
/// Each mission on the pathway gets a short teaching block BEFORE its spoken steps:
/// - a scene (L1): the mission's character says 2–4 lines; the learner hears them, reads them in
///   target text + pronunciation + meaning, and shadows them (says them out loud, no score);
/// - discovery cards (L3): the phrases the mission needs, one per card, tap to hear;
/// - practice (L3): a pairs game (phrase ↔ meaning) and a sentence built from tiles.
///
/// The prototype has no backend, so the content lives here, keyed by mission id. The phrases are the
/// ones the mission player asks for afterwards, so nothing is tested before it was taught.
library;

import 'learn_logic.dart';

class SceneLine {
  /// Who speaks: the mission character, or the learner (the line to shadow).
  final String speaker;
  final bool byLearner;
  final String text;
  final String pronunciation;
  final String meaning;

  const SceneLine({
    required this.speaker,
    required this.text,
    required this.pronunciation,
    required this.meaning,
    this.byLearner = false,
  });
}

class LearnPhrase {
  final String id;
  final String text;
  final String pronunciation;
  final String meaning;

  /// One short usage example in the target language, with its meaning.
  final String example;
  final String exampleMeaning;

  const LearnPhrase({
    required this.id,
    required this.text,
    required this.pronunciation,
    required this.meaning,
    required this.example,
    required this.exampleMeaning,
  });
}

/// A sentence to rebuild from tiles: the prompt (meaning), the correct tiles in order and distractors.
class TileChallenge {
  final String prompt;
  final List<String> answer;
  final List<String> distractors;

  const TileChallenge({required this.prompt, required this.answer, required this.distractors});
}

class MissionLearnPlan {
  final String missionId;
  final String characterName;

  /// BCP-47 voice locale for the phone's speech synthesizer.
  final String voiceLocale;
  final String sceneIntro;
  final List<SceneLine> sceneLines;
  final List<LearnPhrase> phrases;
  final TileChallenge tiles;

  const MissionLearnPlan({
    required this.missionId,
    required this.characterName,
    required this.voiceLocale,
    required this.sceneIntro,
    required this.sceneLines,
    required this.phrases,
    required this.tiles,
  });
}

class LearnContent {
  static const List<MissionLearnPlan> plans = [
    MissionLearnPlan(
      missionId: 'm1',
      characterName: 'Camille',
      voiceLocale: 'fr-FR',
      sceneIntro: 'Morning at the café. Camille is behind the counter.',
      sceneLines: [
        SceneLine(speaker: 'Camille', text: 'Bonjour ! Qu’est-ce que je vous sers ?', pronunciation: 'bon-ZHOOR. kes-kuh zhuh voo SAIR?', meaning: 'Hello! What can I get you?'),
        SceneLine(speaker: 'You', byLearner: true, text: 'Bonjour. Je voudrais un café, s’il vous plaît.', pronunciation: 'bon-ZHOOR. zhuh voo-DRAY uhn ka-FAY, seel voo PLAY', meaning: 'Hello. I would like a coffee, please.'),
        SceneLine(speaker: 'Camille', text: 'Avec plaisir. Sur place ou à emporter ?', pronunciation: 'a-VEK play-ZEER. sur PLASS oo a ahn-por-TAY?', meaning: 'With pleasure. For here or to go?'),
        SceneLine(speaker: 'You', byLearner: true, text: 'Sur place, merci.', pronunciation: 'sur PLASS, mair-SEE', meaning: 'For here, thank you.'),
      ],
      phrases: [
        LearnPhrase(id: 'm1-bonjour', text: 'Bonjour', pronunciation: 'bon-ZHOOR', meaning: 'Hello', example: 'Bonjour madame !', exampleMeaning: 'Hello madam!'),
        LearnPhrase(id: 'm1-voudrais', text: 'Je voudrais…', pronunciation: 'zhuh voo-DRAY', meaning: 'I would like…', example: 'Je voudrais un croissant.', exampleMeaning: 'I would like a croissant.'),
        LearnPhrase(id: 'm1-svp', text: 's’il vous plaît', pronunciation: 'seel voo PLAY', meaning: 'please', example: 'Un café, s’il vous plaît.', exampleMeaning: 'A coffee, please.'),
        LearnPhrase(id: 'm1-surplace', text: 'Sur place', pronunciation: 'sur PLASS', meaning: 'For here (eat in)', example: 'Sur place, merci.', exampleMeaning: 'For here, thanks.'),
      ],
      tiles: TileChallenge(prompt: 'I would like a coffee, please.', answer: ['Je', 'voudrais', 'un', 'café,', 's’il', 'vous', 'plaît.'], distractors: ['merci', 'thé']),
    ),
    MissionLearnPlan(
      missionId: 'm2',
      characterName: 'Camille',
      voiceLocale: 'fr-FR',
      sceneIntro: 'You have finished your coffee. Time to pay.',
      sceneLines: [
        SceneLine(speaker: 'You', byLearner: true, text: 'L’addition, s’il vous plaît.', pronunciation: 'la-dee-SYON, seel voo PLAY', meaning: 'The bill, please.'),
        SceneLine(speaker: 'Camille', text: 'Bien sûr. Ça fait quatre euros.', pronunciation: 'byan SUR. sa fay KATR uh-ROH', meaning: 'Of course. That comes to four euros.'),
        SceneLine(speaker: 'You', byLearner: true, text: 'Je peux payer par carte ?', pronunciation: 'zhuh puh pay-YAY par KART?', meaning: 'Can I pay by card?'),
        SceneLine(speaker: 'Camille', text: 'Oui, pas de problème.', pronunciation: 'wee, pa duh pro-BLEM', meaning: 'Yes, no problem.'),
      ],
      phrases: [
        LearnPhrase(id: 'm2-addition', text: 'L’addition', pronunciation: 'la-dee-SYON', meaning: 'The bill', example: 'L’addition, s’il vous plaît.', exampleMeaning: 'The bill, please.'),
        LearnPhrase(id: 'm2-cafait', text: 'Ça fait…', pronunciation: 'sa FAY', meaning: 'That comes to…', example: 'Ça fait quatre euros.', exampleMeaning: 'That comes to four euros.'),
        LearnPhrase(id: 'm2-carte', text: 'par carte', pronunciation: 'par KART', meaning: 'by card', example: 'Je peux payer par carte ?', exampleMeaning: 'Can I pay by card?'),
        LearnPhrase(id: 'm2-probleme', text: 'Pas de problème', pronunciation: 'pa duh pro-BLEM', meaning: 'No problem', example: 'Oui, pas de problème.', exampleMeaning: 'Yes, no problem.'),
      ],
      tiles: TileChallenge(prompt: 'Can I pay by card?', answer: ['Je', 'peux', 'payer', 'par', 'carte', '?'], distractors: ['l’addition', 'euros']),
    ),
    MissionLearnPlan(
      missionId: 'm3',
      characterName: 'Mehdi',
      voiceLocale: 'fr-FR',
      sceneIntro: 'Evening market. Mehdi sells fruit and vegetables.',
      sceneLines: [
        SceneLine(speaker: 'Mehdi', text: 'Bonsoir ! Elles sont belles, mes tomates.', pronunciation: 'bon-SWAR! el son BEL, may to-MAT', meaning: 'Good evening! My tomatoes are lovely.'),
        SceneLine(speaker: 'You', byLearner: true, text: 'C’est combien, le kilo ?', pronunciation: 'say kom-BYAN, luh kee-LOH?', meaning: 'How much is it per kilo?'),
        SceneLine(speaker: 'Mehdi', text: 'Trois euros le kilo.', pronunciation: 'TRWA uh-ROH luh kee-LOH', meaning: 'Three euros a kilo.'),
        SceneLine(speaker: 'You', byLearner: true, text: 'Je prends un kilo, merci.', pronunciation: 'zhuh PRAHN uhn kee-LOH, mair-SEE', meaning: 'I’ll take a kilo, thanks.'),
      ],
      phrases: [
        LearnPhrase(id: 'm3-bonsoir', text: 'Bonsoir', pronunciation: 'bon-SWAR', meaning: 'Good evening', example: 'Bonsoir monsieur !', exampleMeaning: 'Good evening, sir!'),
        LearnPhrase(id: 'm3-combien', text: 'C’est combien ?', pronunciation: 'say kom-BYAN', meaning: 'How much is it?', example: 'C’est combien, ce melon ?', exampleMeaning: 'How much is this melon?'),
        LearnPhrase(id: 'm3-kilo', text: 'le kilo', pronunciation: 'luh kee-LOH', meaning: 'per kilo', example: 'Deux euros le kilo.', exampleMeaning: 'Two euros a kilo.'),
        LearnPhrase(id: 'm3-prends', text: 'Je prends…', pronunciation: 'zhuh PRAHN', meaning: 'I’ll take…', example: 'Je prends trois pommes.', exampleMeaning: 'I’ll take three apples.'),
      ],
      tiles: TileChallenge(prompt: 'How much is it per kilo?', answer: ['C’est', 'combien,', 'le', 'kilo', '?'], distractors: ['prends', 'bonsoir']),
    ),
    MissionLearnPlan(
      missionId: 'm4',
      characterName: 'Hélène',
      voiceLocale: 'fr-FR',
      sceneIntro: 'A metro platform. Hélène is waiting for her train.',
      sceneLines: [
        SceneLine(speaker: 'You', byLearner: true, text: 'Pardon, madame. Où est la ligne quatre ?', pronunciation: 'par-DON, ma-DAM. oo ay la LEEN KATR?', meaning: 'Excuse me, madam. Where is line four?'),
        SceneLine(speaker: 'Hélène', text: 'C’est par là, à droite.', pronunciation: 'say par LA, a DRWAT', meaning: 'It’s that way, on the right.'),
        SceneLine(speaker: 'You', byLearner: true, text: 'Merci beaucoup !', pronunciation: 'mair-SEE boh-KOO!', meaning: 'Thank you very much!'),
        SceneLine(speaker: 'Hélène', text: 'Je vous en prie. Bonne journée !', pronunciation: 'zhuh voo zahn PREE. bun zhoor-NAY!', meaning: 'You’re welcome. Have a good day!'),
      ],
      phrases: [
        LearnPhrase(id: 'm4-pardon', text: 'Pardon', pronunciation: 'par-DON', meaning: 'Excuse me', example: 'Pardon, monsieur.', exampleMeaning: 'Excuse me, sir.'),
        LearnPhrase(id: 'm4-ouest', text: 'Où est… ?', pronunciation: 'oo AY', meaning: 'Where is…?', example: 'Où est la gare ?', exampleMeaning: 'Where is the station?'),
        LearnPhrase(id: 'm4-droite', text: 'à droite', pronunciation: 'a DRWAT', meaning: 'on the right', example: 'C’est à droite.', exampleMeaning: 'It’s on the right.'),
        LearnPhrase(id: 'm4-journee', text: 'Bonne journée', pronunciation: 'bun zhoor-NAY', meaning: 'Have a good day', example: 'Merci, bonne journée !', exampleMeaning: 'Thanks, have a good day!'),
      ],
      tiles: TileChallenge(prompt: 'Excuse me. Where is line four?', answer: ['Pardon.', 'Où', 'est', 'la', 'ligne', 'quatre', '?'], distractors: ['droite', 'merci']),
    ),
  ];

  /// The plan for a mission, or null when the mission has no teaching block (then the path starts at
  /// the mission itself — never an empty Learn stop, CONVENTIONS §8).
  static MissionLearnPlan? forMission(String missionId) {
    for (final plan in plans) {
      if (plan.missionId == missionId) return plan;
    }
    return null;
  }
}

/// What the Mission stop asks, built from the same plan the Learn stop taught (so the mission never
/// tests a phrase that was not taught first): the character's line, the learner's reply to it, and two
/// distractor replies taken from other missions.
class MissionScript {
  final String speaker;
  final SceneLine characterLine;
  final SceneLine answer;

  /// The answer plus up to two distractors, in a stable per-mission order.
  final List<String> options;

  const MissionScript({required this.speaker, required this.characterLine, required this.answer, required this.options});

  int get answerIndex => options.indexOf(answer.text);
}

MissionScript? missionScriptFor(String missionId) {
  final plan = LearnContent.forMission(missionId);
  if (plan == null) return null;
  final lines = plan.sceneLines;
  final charIndex = lines.indexWhere((l) => !l.byLearner);
  if (charIndex < 0) return null;
  final replyIndex = lines.indexWhere((l) => l.byLearner, charIndex + 1);
  final answer = replyIndex >= 0 ? lines[replyIndex] : lines.firstWhere((l) => l.byLearner);
  final others = [
    for (final p in LearnContent.plans)
      if (p.missionId != missionId)
        for (final l in p.sceneLines)
          if (l.byLearner) l.text,
  ];
  final distractors = stableShuffle(others, '$missionId/distract', (t) => t).take(2);
  final options = stableShuffle([answer.text, ...distractors], '$missionId/options', (t) => t);
  return MissionScript(speaker: plan.characterName, characterLine: lines[charIndex], answer: answer, options: options);
}
