// Reads the content bundle from disk (dart:io): VM only.
@TestOn('vm')
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:langquest_mobile/core/content/content_models.dart';
import 'package:langquest_mobile/features/learn/learn_content.dart';
import 'package:langquest_mobile/features/learn/practice_session.dart';

import 'support.dart';

/// Every mission of every course, taught from each of its interface languages, with the missions before it.
Iterable<({String at, MissionLearnPlan plan, List<MissionLearnPlan> earlier})> everyMission() sync* {
  for (final track in testBundle.tracks) {
    for (final source in testBundle.sourcesFor(track.id)) {
      final course = testBundle.course(track.id, source)!;
      final plans = [
        for (final mission in course.missions) buildLearnPlan(mission: mission, track: track, source: source, character: testBundle.characterOf(mission)),
      ];
      for (final (i, plan) in plans.indexed) {
        yield (at: '${track.id}|$source ${plan.mission.key}', plan: plan, earlier: plans.sublist(0, i));
      }
    }
  }
}

MissionLearnPlan spanish(String key) {
  final mission = testBundle.mission(key)!;
  return buildLearnPlan(mission: mission, track: testBundle.track('spanish-spain')!, source: 'en', character: testBundle.characterOf(mission));
}

void main() {
  group('a practice session, for every mission of the bundle', () {
    test('asks more than the pairs, each question once, and only about what the mission (or an earlier one) taught', () {
      for (final m in everyMission()) {
        final steps = buildPracticeSession(m.plan, earlier: m.earlier, canHear: (_) => true);
        expect({for (final s in steps) s.id}.length, steps.length, reason: '${m.at}: no question twice');
        expect(steps.whereType<PairsStep>().map((s) => s.round), [
          for (var r = 0; r < m.plan.pairRounds.length; r++) r,
        ], reason: '${m.at}: every pairs round, in order');
        final taught = {for (final e in m.plan.phrases) e.id};
        final before = {
          for (final p in m.earlier)
            for (final e in p.phrases) e.id,
        };
        for (final step in steps) {
          final subject = step.subject;
          if (subject == null) continue;
          final earlier = step is ChoiceStep && step.earlier;
          expect(earlier ? before : taught, contains(subject.id), reason: '${m.at}: ${step.id}');
        }
        if (m.plan.pairPhrases.length >= 3) {
          expect(steps.where((s) => s.subject != null).length, greaterThanOrEqualTo(5), reason: '${m.at}: a session is more than its pairs');
        }
      }
    });

    test('the pairs come before the questions about them, and what was learned earlier opens the session', () {
      for (final m in everyMission()) {
        final steps = buildPracticeSession(m.plan, earlier: m.earlier, canHear: (_) => true);
        final earlier = [
          for (final (i, s) in steps.indexed)
            if (s is ChoiceStep && s.earlier) i,
        ];
        final firstPairs = steps.indexWhere((s) => s is PairsStep);
        if (m.earlier.any((p) => p.pairPhrases.length >= 3)) {
          expect(earlier, isNotEmpty, reason: '${m.at}: earlier missions come back');
          expect(earlier.every((i) => i < firstPairs), isTrue, reason: '${m.at}: before anything new');
        } else {
          expect(earlier, isEmpty, reason: m.at);
        }
        for (final (i, s) in steps.indexed) {
          if (s.subject != null && !(s is ChoiceStep && s.earlier)) expect(i, greaterThan(firstPairs), reason: '${m.at}: ${s.id} after the first pairs');
        }
      }
    });

    test('a choice has three options with one right answer; a true/false shows another meaning when it is false', () {
      for (final m in everyMission()) {
        for (final step in buildPracticeSession(m.plan, earlier: m.earlier, canHear: (_) => true)) {
          switch (step) {
            case ChoiceStep(:final question):
              expect(question.options, hasLength(3), reason: '${m.at}: ${step.id}');
              expect(question.options.where((o) => o == question.expression), hasLength(1), reason: '${m.at}: ${step.id}');
              expect({for (final o in question.options) o.intentKey}, hasLength(3), reason: '${m.at}: ${step.id}: no variant among the options');
              expect({for (final o in question.options) normalizeForCompare(m.plan.shortMeaningOf(o))}, hasLength(3), reason: '${m.at}: ${step.id}');
            case TrueFalseStep(:final expression, :final shown, :final isTrue):
              expect(isTrue, shown == expression, reason: '${m.at}: ${step.id}');
              if (!isTrue) {
                expect(m.plan.shortMeaningOf(shown), isNot(m.plan.shortMeaningOf(expression)), reason: '${m.at}: ${step.id}');
                expect(shown.intentKey, isNot(expression.intentKey), reason: '${m.at}: ${step.id}');
              }
            case BuildStep(:final tiles):
              expect(tiles.answer.length, inInclusiveRange(3, 7), reason: '${m.at}: ${step.id}');
              expect(tiles.distractors.toSet().intersection(tiles.answer.toSet()), isEmpty, reason: '${m.at}: ${step.id}');
            case GapStep(:final gap):
              expect(gap.options, contains(gap.answer), reason: '${m.at}: ${step.id}');
            case TypeStep(:final expression):
              expect(m.plan.track.primaryScript, 'Latn', reason: '${m.at}: typed only where the keyboard writes the script');
              expect(expression.text, isNot(contains('…')), reason: '${m.at}: ${step.id}');
            case PairsStep():
              break;
          }
        }
      }
    });

    test('nothing is asked by ear where nothing can say it; the two sentences to build are different ones', () {
      for (final m in everyMission()) {
        final silent = buildPracticeSession(m.plan, earlier: m.earlier);
        expect(silent.whereType<ChoiceStep>().where((s) => s.question.kind == ChoiceKind.hear), isEmpty, reason: m.at);
        expect(silent.whereType<BuildStep>().where((s) => s.byEar), isEmpty, reason: m.at);
        final heard = buildPracticeSession(m.plan, earlier: m.earlier, canHear: (_) => true);
        final built = heard.whereType<BuildStep>().toList();
        expect({for (final b in built) b.tiles.expression.id}.length, built.length, reason: m.at);
        expect(built.where((b) => b.byEar).length, lessThanOrEqualTo(1), reason: m.at);
      }
    });

    test('a session is the same every time it is built (a rebuild never reshuffles it)', () {
      final plan = spanish('es_cafe_order_drink');
      final earlier = [spanish('es_greet_and_introduce')];
      List<String> ids() => [for (final s in buildPracticeSession(plan, earlier: earlier, canHear: (_) => true)) s.id];
      expect(ids(), ids());
    });

    test('Spanish at the bar: by ear, by meaning, to complete, to build twice, to type', () {
      final steps = buildPracticeSession(spanish('es_cafe_order_drink'), earlier: [spanish('es_greet_and_introduce')], canHear: (_) => true);
      expect(steps.take(2).every((s) => s is ChoiceStep && s.earlier), isTrue);
      final kinds = [for (final s in steps.whereType<ChoiceStep>().where((s) => !s.earlier)) s.question.kind];
      expect(kinds, containsAll(ChoiceKind.values));
      expect(steps.whereType<BuildStep>().map((s) => s.byEar), [false, true]);
      expect(steps.last, isA<TypeStep>());
    });
  });

  group('progress through a session', () {
    final steps = buildPracticeSession(spanish('es_cafe_order_drink'));
    final questions = steps.where((s) => s.subject != null).toList();

    test('a question missed comes back once, at the end; missing it again does not bring it back', () {
      var p = PracticeProgress.start(steps);
      while (p.current.subject == null) {
        p = p.next();
      }
      final missed = p.current;
      p = p.answered(false);
      expect(p.queue.length, steps.length + 1);
      expect((p.queue.last.id, p.queue.last.retry), (missed.id, true));
      // Answering it a second time on the spot changes nothing: the first answer is the one that counts.
      p = p.answered(true);
      expect(p.firstTry[missed.id], isFalse);
      while (!p.finished && !p.current.retry) {
        if (p.current.subject != null) p = p.answered(true);
        p = p.next();
      }
      expect(p.current.id, missed.id);
      p = p.answered(false).next();
      expect(p.finished, isTrue);
      expect(p.queue.length, steps.length + 1, reason: 'a retry is not retried');
      expect(p.questions, questions.length);
      expect(p.rightFirstTime, questions.length - 1);
      expect(p.toRevisit.single.id, missed.subject!.id);
      expect(p.fraction, 1);
    });

    test('a step worked on until it is right (a sentence to build) counts its first check and does not come back', () {
      var p = PracticeProgress.start(steps);
      while (p.current is! BuildStep) {
        p = p.next();
      }
      final build = p.current;
      p = p.answered(false, again: false).answered(true, again: false);
      expect(p.queue.length, steps.length);
      expect(p.firstTry[build.id], isFalse);
      expect(p.toRevisit.single.id, build.subject!.id);
    });

    test('the pairs are not questions: they neither count nor come back', () {
      final p = PracticeProgress.start(steps).answered(false);
      expect(p.current, isA<PairsStep>());
      expect((p.questions, p.queue.length), (0, steps.length));
    });
  });

  group('typed answers', () {
    test('case, punctuation and spacing never count', () {
      expect(checkTyped('hola buenos dias', 'Hola, buenos días.'), TypedVerdict.accents);
      expect(checkTyped('  ¿QUÉ   TAL? ', '¿Qué tal?'), TypedVerdict.exact);
      expect(checkTyped('Bien, gracias. ¿Y tú?', 'Bien, gracias. ¿Y tú?'), TypedVerdict.exact);
    });

    test('missing accents are accepted and pointed out, in every Latin-script course', () {
      expect(checkTyped('ca va tres bien', 'Ça va très bien.'), TypedVerdict.accents);
      expect(checkTyped('Tschuss', 'Tschüss!'), TypedVerdict.accents);
      expect(checkTyped('strasse', 'Straße'), TypedVerdict.accents);
      expect(checkTyped('cam on', 'Cảm ơn.'), TypedVerdict.accents);
      expect(checkTyped('multumesc', 'Mulțumesc.'), TypedVerdict.accents);
      expect(checkTyped('obrigado, ate logo', 'Obrigado, até logo.'), TypedVerdict.accents);
      // A decomposed accent (e + U+0301) is never a wrong letter.
      expect(checkTyped('cafe\u0301', 'café'), TypedVerdict.accents);
    });

    test('one slip is accepted in a phrase of five letters or more, two in a long one; a short word must be right', () {
      expect(checkTyped('gracis', 'Gracias.'), TypedVerdict.typo);
      expect(checkTyped('grasias', 'Gracias.'), TypedVerdict.typo);
      expect(checkTyped('un cafe com leche por fabor', 'Un café con leche, por favor.'), TypedVerdict.typo);
      expect(checkTyped('un cafe com lechi por fabor', 'Un café con leche, por favor.'), TypedVerdict.wrong, reason: 'three letters off');
      expect(checkTyped('un cafe solo', 'Un café con leche, por favor.'), TypedVerdict.wrong);
      expect(checkTyped('si', 'No.'), TypedVerdict.wrong);
      expect(checkTyped('ni', 'No.'), TypedVerdict.wrong, reason: 'too short to forgive a letter');
      expect(checkTyped('', 'Gracias.'), TypedVerdict.wrong);
      expect(checkTyped('   ', 'Gracias.'), TypedVerdict.wrong);
    });

    test('edit distance and folding', () {
      expect(editDistance('kitten', 'sitting'), 3);
      expect(editDistance('', 'abc'), 3);
      expect(editDistance('abc', 'abc'), 0);
      expect(foldDiacritics('Ça, Œuvre, Größe, Señor, Đà Nẵng'), 'ca, oeuvre, grosse, senor, da nang');
    });

    test('every phrase a session asks to type is accepted as written, and without its accents', () {
      var typed = 0;
      for (final m in everyMission()) {
        for (final step in buildPracticeSession(m.plan, earlier: m.earlier).whereType<TypeStep>()) {
          typed++;
          expect(checkTyped(step.expression.text, step.expression.text), TypedVerdict.exact, reason: '${m.at}: ${step.expression.text}');
          expect(
            checkTyped(foldDiacritics(step.expression.text), step.expression.text),
            anyOf(TypedVerdict.exact, TypedVerdict.accents),
            reason: '${m.at}: ${step.expression.text} typed on a keyboard without accents',
          );
        }
      }
      expect(typed, greaterThan(100), reason: 'the Latin-script courses each type a phrase per mission');
    });
  });

  test('the phrase cards give the word-for-word reading where the course has one that says more than the meaning', () {
    final track = testBundle.track('german')!;
    final mission = testBundle.course('german', 'en')!.missions.first;
    final plan = buildLearnPlan(mission: mission, track: track, source: 'en', character: testBundle.characterOf(mission));
    Expression phrase(String text) => plan.phrases.firstWhere((e) => e.text == text);
    expect(plan.literalOf(phrase('Wie geht es Ihnen?')), 'how goes it to-you (formal)');
    expect(plan.literalOf(phrase('Guten Morgen!')), isNull, reason: 'the same words as the meaning');
  });
}
