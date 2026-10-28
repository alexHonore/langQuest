import 'package:flutter_test/flutter_test.dart';
import 'package:langquest_mobile/features/learn/learn_content.dart';
import 'package:langquest_mobile/features/learn/learn_logic.dart';

void main() {
  group('mission path (N2)', () {
    test('a mission with a learn plan teaches before it tests', () {
      final stops = stopsFor(hasLearnPlan: true);
      expect(stops, [PathStop.learn, PathStop.practise, PathStop.mission, PathStop.talk]);
      expect(nextStop(stops, {}), PathStop.learn);
      expect(nextStop(stops, {PathStop.learn}), PathStop.practise);
      expect(nextStop(stops, {PathStop.learn, PathStop.practise, PathStop.mission, PathStop.talk}), isNull);
    });

    test('a mission without a plan never shows empty learn stops', () {
      expect(stopsFor(hasLearnPlan: false), [PathStop.mission, PathStop.talk]);
    });

    test('progress counts only the node’s own stops', () {
      final stops = stopsFor(hasLearnPlan: true);
      expect(nodeProgress(stops, {PathStop.learn}), 0.25);
      expect(nodeProgress(stopsFor(hasLearnPlan: false), {PathStop.learn}), 0);
    });
  });

  group('content', () {
    test('every plan has a scene, phrases to learn and a solvable tile challenge', () {
      for (final plan in LearnContent.plans) {
        expect(plan.sceneLines.length, inInclusiveRange(2, 4), reason: plan.missionId);
        expect(plan.sceneLines.any((l) => l.byLearner), isTrue, reason: '${plan.missionId} has a line to shadow');
        expect(plan.phrases.length, greaterThanOrEqualTo(3), reason: plan.missionId);
        expect(plan.phrases.map((p) => p.id).toSet().length, plan.phrases.length, reason: 'unique phrase ids');
        final solved = TilesState.start(plan.tiles.answer, plan.tiles.distractors, plan.missionId);
        var s = solved;
        for (final word in plan.tiles.answer) {
          s = s.place(s.bank.firstWhere((t) => t.text == word && !s.isPlaced(t)));
        }
        expect(s.check().verdict, TilesVerdict.correct, reason: plan.missionId);
      }
    });

    test('unknown missions have no plan', () {
      expect(LearnContent.forMission('nope'), isNull);
      expect(LearnContent.forMission('m2')?.characterName, 'Camille');
    });
  });

  group('pairs game', () {
    final pairs = [
      (id: 'a', phrase: 'Bonjour', meaning: 'Hello'),
      (id: 'b', phrase: 'Merci', meaning: 'Thanks'),
      (id: 'c', phrase: 'Pardon', meaning: 'Excuse me'),
    ];

    test('columns are shuffled stably and not aligned row by row', () {
      final a = PairsState.start(pairs, 'm1');
      final b = PairsState.start(pairs, 'm1');
      expect(a.phrases.map((c) => c.pairId), b.phrases.map((c) => c.pairId));
      expect(a.phrases.length, 3);
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
      expect(s.matched, isEmpty);

      s = s.clearWrong().tap(hello).tap(bonjour);
      expect(s.matched, {'a'});
      expect(s.finished, isFalse);
    });

    test('tapping a matched card does nothing; re-picking in the same column moves the selection', () {
      var s = PairsState.start(pairs, 'x');
      final p1 = s.phrases[0];
      final p2 = s.phrases[1];
      s = s.tap(p1).tap(p2);
      expect(s.selected?.key, p2.key);
      expect(s.mistakes, 0);
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
    test('wrong order is wrong; right order is right regardless of punctuation spacing', () {
      var s = TilesState.start(['Je', 'peux', 'payer', 'par', 'carte', '?'], ['euros'], 'm2');
      TileItem tile(String w) => s.bank.firstWhere((t) => t.text == w);
      for (final w in ['peux', 'Je']) {
        s = s.place(tile(w));
      }
      expect(s.check().verdict, TilesVerdict.wrong);

      s = TilesState.start(['Je', 'peux', 'payer', 'par', 'carte', '?'], ['euros'], 'm2');
      for (final w in ['Je', 'peux', 'payer', 'par', 'carte', '?']) {
        s = s.place(tile(w));
      }
      expect(s.sentence.join(' '), 'Je peux payer par carte ?');
      expect(s.check().verdict, TilesVerdict.correct);
    });

    test('a placed tile can be taken back; a tile cannot be placed twice', () {
      var s = TilesState.start(['Bonjour'], ['Merci'], 'k');
      final b = s.bank.firstWhere((t) => t.text == 'Bonjour');
      s = s.place(b).place(b);
      expect(s.placed.length, 1);
      s = s.remove(b);
      expect(s.placed, isEmpty);
    });
  });

  group('mission script (the mission tests what Learn taught)', () {
    test('every mission asks for a reply that was taught in its scene', () {
      for (final plan in LearnContent.plans) {
        final script = missionScriptFor(plan.missionId)!;
        expect(plan.sceneLines.contains(script.answer), isTrue, reason: plan.missionId);
        expect(script.answer.byLearner, isTrue);
        expect(script.characterLine.byLearner, isFalse);
        expect(script.options.length, 3);
        expect(script.options.toSet().length, 3, reason: 'no duplicate options');
        expect(script.answerIndex, isNonNegative);
      }
    });

    test('the reply follows the character line it answers', () {
      final m2 = missionScriptFor('m2')!;
      expect(m2.characterLine.text, 'Bien sûr. Ça fait quatre euros.');
      expect(m2.answer.text, 'Je peux payer par carte ?');
    });

    test('the answer is not always first', () {
      final positions = LearnContent.plans.map((p) => missionScriptFor(p.missionId)!.answerIndex).toSet();
      expect(positions.length, greaterThan(1));
    });

    test('missions without a plan have no script', () {
      expect(missionScriptFor('nope'), isNull);
    });
  });
}
