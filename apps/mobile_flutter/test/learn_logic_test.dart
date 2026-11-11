// Reads the content bundle from disk (dart:io): VM only. Pure logic shared with web is covered by srs_test.dart.
@TestOn('vm')
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:langquest_mobile/core/content/content_models.dart';
import 'package:langquest_mobile/core/learning/seeded_random.dart';
import 'package:langquest_mobile/features/learn/learn_content.dart';
import 'package:langquest_mobile/features/learn/learn_logic.dart';

import 'support.dart';

/// Every (course, instruction language, mission) the bundle can teach.
Iterable<MissionLearnPlan> allPlans() sync* {
  for (final track in testBundle.tracks) {
    for (final source in testBundle.sourcesFor(track.id)) {
      final course = testBundle.course(track.id, source)!;
      for (final m in course.missions) {
        yield buildLearnPlan(mission: m, track: track, source: source, character: testBundle.characterOf(m));
      }
    }
  }
}

void main() {
  group('mission path (N2)', () {
    test('a mission with a teaching block teaches before it tests; Talk only with a conversation partner', () {
      final stops = stopsFor(hasLearnPlan: true);
      expect(stops, [PathStop.learn, PathStop.practise, PathStop.mission]);
      expect(stopsFor(hasLearnPlan: true, canTalk: true), [PathStop.learn, PathStop.practise, PathStop.mission, PathStop.talk]);
      expect(stopsFor(hasLearnPlan: false), [PathStop.mission]);
      expect(nextStop(stops, {}), PathStop.learn);
      expect(nextStop(stops, {PathStop.learn}), PathStop.practise);
      expect(nextStop(stops, {PathStop.learn, PathStop.practise, PathStop.mission}), isNull);
    });

    test('progress counts only the node’s own stops', () {
      final stops = stopsFor(hasLearnPlan: true);
      expect(nodeProgress(stops, {PathStop.learn}), closeTo(1 / 3, 1e-9));
      expect(nodeProgress(stopsFor(hasLearnPlan: false), {PathStop.learn}), 0);
    });

    test('the stable hash is the web-safe FNV-1a of the API', () {
      expect(stableHash('ary_ch1:ary_cafe:bghit'), fnv1a32('ary_ch1:ary_cafe:bghit'));
      expect(stableHash('a'), 3826002220);
    });
  });

  group('text helpers', () {
    test('shortMeaning drops literal glosses and usage clauses, keeps qualifiers', () {
      expect(shortMeaning('Hello (lit. "peace be upon you").'), 'Hello.');
      expect(shortMeaning('Merci (litt. « que Dieu te donne la santé ») — se dit à quelqu\'un qui a travaillé pour vous.'), 'Merci');
      expect(shortMeaning('Tu es d\'où ? (à un homme)'), 'Tu es d\'où ? (à un homme)');
      expect(shortMeaning('L\'addition, s\'il vous plaît ? (litt. « combien, le compte ? »)'), 'L\'addition, s\'il vous plaît ?');
    });

    test('promptMeaning drops the final full stop for use inside a question, keeps an ellipsis', () {
      expect(promptMeaning('Bonjour (litt. « que la paix soit sur vous »).'), 'Bonjour');
      expect(promptMeaning('A coffee with milk, please.'), 'A coffee with milk, please');
      expect(promptMeaning('My name is …'), 'My name is …');
      expect(promptMeaning('Where is the station?'), 'Where is the station?');
    });

    test('tiles are words without surrounding punctuation; comparison ignores case and punctuation', () {
      expect(tileTokens('3afak, bghit wa7ed l9ahwa'), ['3afak', 'bghit', 'wa7ed', 'l9ahwa']);
      expect(tileTokens('¿Me lo dejas un poco más barato?'), ['Me', 'lo', 'dejas', 'un', 'poco', 'más', 'barato']);
      expect(normalizeForCompare('¿Me cobras, por favor?'), normalizeForCompare('me cobras por favor'));
    });

    test('rounds are as even as possible and never larger than the cap', () {
      List<int> sizes(int n, int cap) => evenRounds(List.generate(n, (i) => i), cap).map((r) => r.length).toList();
      expect(sizes(0, 5), isEmpty);
      expect(sizes(5, 5), [5]);
      expect(sizes(7, 5), [4, 3]);
      expect(sizes(10, 5), [5, 5]);
      expect(sizes(11, 5), [4, 4, 3]);
    });
  });

  group('pairs game', () {
    final pairs = [
      (id: 'a', phrase: 'Bonjour', meaning: 'Hello'),
      (id: 'b', phrase: 'Merci', meaning: 'Thanks'),
      (id: 'c', phrase: 'Pardon', meaning: 'Excuse me'),
    ];

    test('columns are shuffled stably', () {
      final a = PairsState.start(pairs, 'm1');
      final b = PairsState.start(pairs, 'm1');
      expect(a.phrases.map((c) => c.pairId), b.phrases.map((c) => c.pairId));
      expect(a.meanings.length, 3);
    });

    test('a correct pick matches, a wrong pick counts a mistake and highlights both cards', () {
      var s = PairsState.start(pairs, 'm1');
      final bonjour = s.phrases.firstWhere((c) => c.pairId == 'a');
      final hello = s.meanings.firstWhere((c) => c.pairId == 'a');
      final thanks = s.meanings.firstWhere((c) => c.pairId == 'b');
      s = s.tap(bonjour).tap(thanks);
      expect(s.mistakes, 1);
      expect(s.wrongKeys, {bonjour.key, thanks.key});
      s = s.clearWrong().tap(hello).tap(bonjour);
      expect(s.matched, {'a'});
      expect(s.finished, isFalse);
    });

    test('finishes when every pair is matched', () {
      var s = PairsState.start(pairs, 'z');
      for (final p in pairs) {
        s = s.tap(s.phrases.firstWhere((c) => c.pairId == p.id)).tap(s.meanings.firstWhere((c) => c.pairId == p.id));
      }
      expect(s.finished, isTrue);
    });
  });

  group('tiles game', () {
    test('wrong order is wrong; right order is right', () {
      var s = TilesState.start(['Me', 'cobras', 'por', 'favor'], ['vale'], 'k');
      TileItem tile(String w) => s.bank.firstWhere((t) => t.text == w);
      s = s.place(tile('cobras')).place(tile('Me'));
      expect(s.check().verdict, TilesVerdict.wrong);
      s = TilesState.start(['Me', 'cobras', 'por', 'favor'], ['vale'], 'k');
      for (final w in ['Me', 'cobras', 'por', 'favor']) {
        s = s.place(tile(w));
      }
      expect(s.check().verdict, TilesVerdict.correct);
    });

    test('a repeated word may use either tile (ness ness)', () {
      var s = TilesState.start(['ness', 'ness', '3afak'], ['salam'], 'n');
      final nessTiles = s.bank.where((t) => t.text == 'ness').toList();
      s = s.place(nessTiles[1]).place(nessTiles[0]).place(s.bank.firstWhere((t) => t.text == '3afak'));
      expect(s.check().verdict, TilesVerdict.correct);
    });
  });

  group('choice state', () {
    test('a wrong pick is marked and another can follow; the right pick solves it, and nothing changes after', () {
      var s = ChoiceState.start(2);
      s = s.pick(0);
      expect(s.isWrong(0), isTrue);
      expect(s.solved, isFalse);
      s = s.pick(2);
      expect(s.solved, isTrue);
      expect(s.pick(1).isWrong(1), isFalse);
    });
  });

  group('learn plans built from the real draft curriculum', () {
    final plans = allPlans().toList();

    test('the bundle teaches every course from English and French (French from English, English from French)', () {
      for (final track in testBundle.tracks) {
        final sources = testBundle.sourcesFor(track.id);
        if (track.id == 'english') {
          expect(sources, ['fr'], reason: 'the UI languages are en and fr: English is offered from French');
        } else if (track.id == 'french') {
          expect(sources, ['en']);
        } else {
          expect(sources, ['en', 'fr'], reason: track.id);
        }
      }
      expect(testBundle.tracks, hasLength(30));
      // Darija 7 + Spanish 6 + Japanese 4 (each from en and fr), English 4 (fr), French 7 (en), 25 more courses × 7 (en, fr).
      expect(plans.length, (7 + 6 + 4) * 2 + 4 + 7 + 25 * 7 * 2);
    });

    test('every plan has a scene with a line to shadow, cards, pairs and exchanges', () {
      for (final p in plans) {
        final at = '${p.mission.key}/${p.source}';
        expect(p.sceneLines.length, greaterThanOrEqualTo(2), reason: at);
        expect(p.sceneLines.any((l) => l.byLearner), isTrue, reason: at);
        expect(p.phrases, isNotEmpty, reason: at);
        expect(p.phrases.every((e) => e.byLearner), isTrue, reason: at);
        expect(p.phrases.map((e) => normalizeForCompare(e.text)).toSet().length, p.phrases.length, reason: '$at unique phrases');
        expect(p.exchanges.length, p.sceneLines.where((l) => l.byLearner).length, reason: at);
        expect(p.mission.titleIn(p.source), isNotNull, reason: '$at title in the instruction language');
      }
    });

    test('meanings are always in the instruction language (never another overlay)', () {
      for (final p in plans) {
        for (final e in [...p.phrases, ...p.sceneLines.map((l) => l.expression)]) {
          expect(e.meaningIn(p.source)?.meaning, isNotEmpty, reason: '${e.id} ${p.source}');
          expect(p.meaningOf(e), e.meanings[p.source]!.meaning);
        }
      }
    });

    test('pair rounds fit the screen and never hold two cards with the same meaning', () {
      for (final p in plans) {
        final all = [for (final r in p.pairRounds) ...r];
        expect(p.pairRounds, isNotEmpty, reason: p.mission.key);
        for (final r in p.pairRounds) {
          expect(r.length, inInclusiveRange(1, 5), reason: p.mission.key);
        }
        expect(all.map((e) => normalizeForCompare(p.shortMeaningOf(e))).toSet().length, all.length, reason: '${p.mission.key}/${p.source}');
      }
    });

    test('tiles are solvable, 3–7 words, romanized for non-Latin scripts, with distractors that are not answer words', () {
      var withTiles = 0;
      for (final p in plans) {
        final t = p.tiles;
        if (t == null) continue;
        withTiles++;
        expect(t.answer.length, inInclusiveRange(3, 7), reason: p.mission.key);
        expect(t.expression.byLearner, isTrue);
        if (p.track.usesRomanization) {
          // Latin letters, with the diacritics a romanization needs (pinyin tones, jyutping, translit-latn).
          expect(t.answer.join(' '), matches(RegExp(r'^[\p{Script=Latin}\p{M}\p{N}\p{P}\p{Zs}]+$', unicode: true)), reason: '${p.mission.key} romanized tiles');
        }
        final answerWords = {for (final w in t.answer) normalizeForCompare(w)};
        for (final d in t.distractors) {
          expect(answerWords.contains(normalizeForCompare(d)), isFalse, reason: '${p.mission.key} distractor $d');
        }
        var s = TilesState.start(t.answer, t.distractors, p.mission.key);
        for (var i = 0; i < t.answer.length; i++) {
          s = s.place(s.bank.firstWhere((tile) => tile.index == i));
        }
        expect(s.check().verdict, TilesVerdict.correct, reason: p.mission.key);
      }
      expect(withTiles, greaterThan(plans.length ~/ 2));
    });

    test('practice asks listen and reverse questions about different phrases, three distinct options each', () {
      var withChoices = 0;
      for (final p in plans) {
        final at = '${p.mission.key}/${p.source}';
        if (p.pairRounds.expand((r) => r).length < 3) {
          expect(p.choices, isEmpty, reason: at);
          continue;
        }
        withChoices++;
        final listen = [
          for (final q in p.choices)
            if (q.kind == ChoiceKind.listen) q.expression.id,
        ];
        final reverse = [
          for (final q in p.choices)
            if (q.kind == ChoiceKind.reverse) q.expression.id,
        ];
        expect(listen, isNotEmpty, reason: at);
        expect(reverse, isNotEmpty, reason: at);
        expect(listen.toSet().intersection(reverse.toSet()), isEmpty, reason: '$at: each phrase is asked once');
        for (final q in p.choices) {
          expect(q.options, hasLength(3), reason: at);
          expect(q.answerIndex, isNonNegative, reason: at);
          expect(q.options.map((o) => normalizeForCompare(o.text)).toSet(), hasLength(3), reason: '$at distinct phrases');
          expect(q.options.map((o) => normalizeForCompare(p.shortMeaningOf(o))).toSet(), hasLength(3), reason: '$at distinct meanings');
          expect(p.phrases, containsAll(q.options), reason: '$at: options are taught phrases');
          expect(q.options.map((o) => o.intentKey).toSet(), hasLength(3), reason: '$at: no option is a variant of another (two right answers)');
        }
      }
      expect(withChoices, greaterThan(plans.length * 0.9));
    });

    test('the gap hides a word of 2+ letters; the other words to choose from are not in the phrase', () {
      var withGap = 0;
      for (final p in plans) {
        final g = p.gap;
        if (g == null) continue;
        withGap++;
        final at = '${p.mission.key}/${p.source}';
        expect(g.words, tileTokens(p.tileSourceOf(g.expression)), reason: at);
        expect(g.words.length, inInclusiveRange(3, 9), reason: at);
        expect(normalizeForCompare(g.answer).length, greaterThanOrEqualTo(2), reason: at);
        expect(g.options, hasLength(3), reason: at);
        expect(g.options.map(normalizeForCompare).toSet(), hasLength(3), reason: '$at distinct words');
        final inPhrase = {for (final w in g.words) normalizeForCompare(w)};
        for (final o in g.options) {
          if (o != g.answer) expect(inPhrase.contains(normalizeForCompare(o)), isFalse, reason: '$at distractor $o');
        }
        expect(g.expression, isNot(p.tiles?.expression), reason: '$at: not the tiles sentence');
      }
      expect(withGap, greaterThan(plans.length * 0.5));
    });

    test('the mission asks only for taught lines, cued by the character line before them', () {
      final positions = <int>{};
      for (final p in plans) {
        final taught = {for (final e in p.phrases) e.id};
        final scene = [for (final l in p.sceneLines) l.expression];
        for (final x in p.exchanges) {
          final at = '${p.mission.key}/${x.answer.key}';
          expect(x.answer.byLearner, isTrue, reason: at);
          expect(taught, contains(x.answer.id), reason: '$at taught on a card');
          expect(scene, contains(x.answer), reason: '$at met in the scene');
          expect(x.options, contains(x.answer), reason: at);
          expect(x.options.length, inInclusiveRange(2, 3), reason: at);
          expect(x.options.map((o) => normalizeForCompare(o.text)).toSet().length, x.options.length, reason: '$at distinct options');
          expect(x.options.map((o) => o.intentKey).toSet().length, x.options.length, reason: '$at: no distractor says what the answer says');
          for (final o in x.options) {
            expect(taught, contains(o.id), reason: '$at option ${o.key} was taught');
          }
          if (x.cue != null) {
            expect(x.cue!.speaker, Speaker.character, reason: at);
            expect(scene.indexOf(x.cue!) + 1, scene.indexOf(x.answer), reason: '$at cue precedes the reply');
          }
          positions.add(x.answerIndex);
        }
      }
      expect(positions.length, greaterThan(1), reason: 'the answer is not always in the same place');
    });

    test('Darija gets no device voice; Spanish, Japanese and English do', () {
      expect(testBundle.track('arabic-moroccan')!.voiceLocale, isNull);
      expect(testBundle.track('spanish-spain')!.voiceLocale, 'es-ES');
      expect(testBundle.track('japanese')!.voiceLocale, 'ja-JP');
      expect(testBundle.track('english')!.voiceLocale, 'en-US');
    });

    test('Darija lines carry Arabizi and are right-to-left; Japanese lines carry a kana reading and romaji', () {
      final ary = testBundle.mission('ary_cafe_order_drink')!;
      final order = ary.expressions.firstWhere((e) => e.key == 'bghit_qahwa');
      expect(order.romanization, '3afak, bghit wa7ed l9ahwa');
      expect(testBundle.track('arabic-moroccan')!.rtl, isTrue);
      final ja = testBundle.mission('ja_greet_and_introduce')!.expressions.firstWhere((e) => e.key == 'ogenki_desu_ka');
      expect(ja.reading, 'おげんきですか');
      expect(ja.romanization, 'ogenki desu ka');
    });
  });
}
