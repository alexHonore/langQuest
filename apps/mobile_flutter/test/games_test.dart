// Reads the content bundle from disk (dart:io): VM only.
@TestOn('vm')
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:langquest_mobile/core/services/app_state.dart';
import 'package:langquest_mobile/core/services/learner_state.dart';
import 'package:langquest_mobile/core/services/learner_store.dart';
import 'package:langquest_mobile/core/services/speech_service.dart';
import 'package:langquest_mobile/features/games/game_logic.dart';
import 'package:langquest_mobile/features/games/game_pool.dart';
import 'package:langquest_mobile/features/games/game_screens.dart';
import 'package:langquest_mobile/features/learn/learn_content.dart';
import 'package:langquest_mobile/features/learn/learn_logic.dart';
import 'package:langquest_mobile/main.dart';
import 'package:langquest_mobile/navigation/app_router.dart';

import 'support.dart';

const courseId = 'spanish-spain|en';
const firstMission = 'es_greet_and_introduce';
const secondMission = 'es_cafe_order_drink';

/// A device with a voice for Spain Spanish; what is said is recorded, and each utterance ends at once.
class SpeakingDevice extends SpeechService {
  final said = <String>[];

  @override
  Future<bool> supports(String? locale) async => locale == 'es-ES';

  @override
  Future<String?> voiceForLanguage(String language) async => null;

  @override
  Future<void> speak(String text, {required String locale, bool slow = false}) async => said.add(text);

  @override
  Future<void> stop() async {}
}

List<GameItem> items(int count) => [
  for (var i = 0; i < count; i++) GameItem(id: 'p$i', text: 'frase $i', meaning: 'phrase $i', intent: 'intent$i', tileSource: 'uno dos tres $i'),
];

Future<void> settle(WidgetTester t, [int ms = 600]) async {
  for (var i = 0; i < ms ~/ 100; i++) {
    await t.pump(const Duration(milliseconds: 100));
  }
}

Future<void> tapText(WidgetTester t, String text) async {
  final f = find.text(text);
  expect(f, findsWidgets, reason: 'no "$text" on screen');
  await t.ensureVisible(f.first);
  await t.tap(f.first);
  await settle(t);
}

/// The app on a phone, enrolled in Spanish with [learned] missions' Learn stop done, opened at [route].
Future<ProviderContainer> openApp(
  WidgetTester t, {
  List<String> learned = const [firstMission],
  String route = '/',
  SpeechService? device,
  TestClock? clock,
}) async {
  t.view.physicalSize = const Size(390 * 3, 844 * 3);
  t.view.devicePixelRatio = 3;
  addTearDown(t.view.reset);
  await t.pumpWidget(
    ProviderScope(
      overrides: [
        ...await testOverrides(clock: clock),
        if (device != null) speechServiceProvider.overrideWithValue(device),
      ],
      child: const LangQuestApp(),
    ),
  );
  final container = ProviderScope.containerOf(t.element(find.byType(LangQuestApp)));
  final notifier = container.read(appStateProvider.notifier)
    ..setReduceMotion(true)
    ..enroll('spanish-spain', 'en');
  for (final mission in learned) {
    notifier.completeStop(mission, PathStop.learn);
  }
  container.read(appRouterProvider).go(route);
  await settle(t);
  return container;
}

void main() {
  setUpAll(() => GoogleFonts.config.allowRuntimeFetching = false);

  group('rules', () {
    test('a seeded shuffle is a permutation, the same for the same seed and another for another', () {
      final list = List.generate(12, (i) => i);
      expect(seededShuffle(list, 'a'), seededShuffle(list, 'a'));
      expect(seededShuffle(list, 'a'), isNot(seededShuffle(list, 'b')));
      expect(seededShuffle(list, 'a').toSet(), list.toSet());
      expect(list, List.generate(12, (i) => i), reason: 'the list given is left as it is');
    });

    test('Lantern pairs: a phrase and its meaning stay lit; two cards that do not go together turn back', () {
      var board = MemoryState.start(items(3), 'seed');
      expect(board.cards, hasLength(6));
      int indexOf(String id, MemorySide side) => board.cards.indexWhere((c) => c.pairId == id && c.side == side);

      // Two cards of different pairs: a move, both open, then turned back.
      board = board.flip(indexOf('p0', MemorySide.phrase));
      expect((board.open.length, board.moves), (1, 0));
      expect(identical(board.flip(indexOf('p0', MemorySide.phrase)), board), isTrue, reason: 'the open card is not turned twice');
      board = board.flip(indexOf('p1', MemorySide.meaning));
      expect((board.mismatch, board.moves), (true, 1));
      expect(board.matched, isEmpty);
      // The next card turned closes them.
      board = board.flip(indexOf('p2', MemorySide.phrase));
      expect(board.open, [indexOf('p2', MemorySide.phrase)]);
      board = board.flip(indexOf('p2', MemorySide.meaning));
      expect(board.matched, {'p2'});
      expect(board.moves, 2);
      expect(board.open, isEmpty);
      expect(identical(board.flip(indexOf('p2', MemorySide.phrase)), board), isTrue, reason: 'a matched card stays as it is');
      // closeOpen turns a mismatch back without a move.
      board = board.flip(indexOf('p0', MemorySide.phrase)).flip(indexOf('p1', MemorySide.phrase));
      expect(board.mismatch, isTrue);
      board = board.closeOpen();
      expect(board.open, isEmpty);
      expect(board.moves, 3, reason: 'turning back is not a move');
      for (final id in ['p0', 'p1']) {
        board = board.flip(indexOf(id, MemorySide.phrase)).flip(indexOf(id, MemorySide.meaning));
      }
      expect((board.finished, board.moves), (true, 5));
    });

    test('Quick fire: true about half the time, a false statement shows another meaning, no phrase twice in a row', () {
      final round = QuickRound(items(8), 'seed');
      final statements = [for (var i = 0; i < 80; i++) round.statementAt(i)];
      final trues = statements.where((s) => s.isTrue).length;
      expect(trues, inInclusiveRange(25, 55));
      for (final s in statements.where((s) => !s.isTrue)) {
        expect(s.shown.meaning, isNot(s.item.meaning));
      }
      for (var i = 1; i < statements.length; i++) {
        expect(statements[i].item.id, isNot(statements[i - 1].item.id), reason: 'statement $i');
      }
      // Every phrase comes once per lap.
      expect({for (final s in statements.take(8)) s.item.id}, hasLength(8));
      expect(round.statementAt(5).item.id, QuickRound(items(8), 'seed').statementAt(5).item.id, reason: 'the same seed gives the same round');
    });

    test('Quick fire: phrases that say the same thing another way are never offered against each other', () {
      final pool = [
        const GameItem(id: 'a', text: 'Gracias.', meaning: 'Thank you.', intent: 'thank'),
        const GameItem(id: 'b', text: 'Muchas gracias.', meaning: 'Thank you very much.', intent: 'thank'),
        const GameItem(id: 'c', text: 'Hola.', meaning: 'Hello.', intent: 'greet'),
      ];
      final round = QuickRound(pool, 'seed');
      for (var i = 0; i < 60; i++) {
        final s = round.statementAt(i);
        if (!s.isTrue) expect(s.shown.intent, isNot(s.item.intent), reason: 'statement $i');
      }
    });

    test('the score of a timed round keeps the longest run without a mistake', () {
      var score = const QuickScore();
      for (final right in [true, true, true, false, true, true]) {
        score = score.answer(right);
      }
      expect((score.answered, score.right, score.streak, score.bestStreak), (6, 5, 2, 3));
    });

    test('By ear: each question offers the phrase said among written ones, all different', () {
      final pool = items(9);
      final questions = earQuestions(pool: pool, audible: pool.take(6).toList(), seed: 'seed');
      expect(questions, hasLength(6), reason: 'only phrases that can be said are asked');
      for (final q in questions) {
        expect(q.options, hasLength(4));
        expect(q.options[q.answerIndex].id, q.item.id);
        expect({for (final o in q.options) o.text}, hasLength(4));
      }
      expect({for (final q in questions) q.item.id}, hasLength(6), reason: 'no phrase asked twice');
      expect(
        earQuestions(pool: pool, audible: pool, seed: 'seed'),
        hasLength(8),
        reason: 'eight questions a round',
      );
    });

    test('Sentence dash: sentences of 3–7 words, each with one word that does not belong', () {
      final pool = [
        ...items(6),
        const GameItem(id: 'short', text: 'Hola.', meaning: 'Hello.', tileSource: 'Hola'),
        const GameItem(id: 'name', text: 'Me llamo …', meaning: 'My name is …'),
        const GameItem(id: 'long', text: 'x', meaning: 'x', tileSource: 'a b c d e f g h'),
      ];
      expect(pool.where(canDash).map((p) => p.id), [for (var i = 0; i < 6; i++) 'p$i']);
      final sentences = dashSentences(pool: pool, seed: 'seed');
      expect(sentences, hasLength(5));
      for (final s in sentences) {
        expect(s.answer, tileTokens(s.item.tileSource));
        expect(s.distractors, hasLength(1));
        expect(s.answer.map(normalizeForCompare), isNot(contains(normalizeForCompare(s.distractors.single))));
        var tiles = dashTiles(s, 'seed');
        expect(tiles.bank, hasLength(s.answer.length + 1));
        for (final word in s.answer) {
          tiles = tiles.place(tiles.bank.firstWhere((t) => t.text == word && !tiles.isPlaced(t)));
        }
        expect(tiles.check().verdict, TilesVerdict.correct);
      }
    });

    test('a record is fewer moves or seconds, or more right answers', () {
      expect(beats(GameKind.memory, 9, null), isTrue);
      expect(beats(GameKind.memory, 8, 9), isTrue);
      expect(beats(GameKind.memory, 9, 9), isFalse);
      expect(beats(GameKind.dash, 70, 65), isFalse);
      expect(beats(GameKind.quick, 12, 11), isTrue);
      expect(beats(GameKind.ear, 6, 7), isFalse);
    });
  });

  group('what the games play with', () {
    test('only phrases of missions whose Learn stop is done, one per text and per meaning', () async {
      final container = await testContainer();
      addTearDown(container.dispose);
      final notifier = container.read(appStateProvider.notifier)..enroll('spanish-spain', 'en');
      expect(container.read(gamePoolProvider), isEmpty);
      expect(container.read(gamesAvailableProvider), isFalse, reason: 'nothing taught yet');

      notifier.completeStop(firstMission, PathStop.learn);
      final first = container.read(gamePoolProvider);
      final plan = buildLearnPlan(
        mission: testBundle.mission(firstMission)!,
        track: testBundle.track('spanish-spain')!,
        source: 'en',
        character: testBundle.characterOf(testBundle.mission(firstMission)!),
      );
      expect([for (final p in first) p.expression.id], [for (final e in plan.pairPhrases) e.id]);
      expect(container.read(gamesAvailableProvider), isTrue);
      // A line with a name to fill in is never rebuilt from tiles.
      expect(first.firstWhere((p) => p.expression.text == 'Me llamo …').item.tileSource, isEmpty);

      notifier.completeStop(secondMission, PathStop.learn);
      final both = container.read(gamePoolProvider);
      expect(both.length, greaterThan(first.length));
      expect({for (final p in both) normalizeForCompare(p.item.text)}, hasLength(both.length));
      expect({for (final p in both) normalizeForCompare(p.item.meaning)}, hasLength(both.length));
      // A later mission that is not learned adds nothing.
      expect(both.any((p) => p.expression.id.contains('es_market_ask_price')), isFalse);
    });

    test('Japanese is rebuilt from its romanization, and its phrases keep their script', () async {
      final container = await testContainer();
      addTearDown(container.dispose);
      container.read(appStateProvider.notifier)
        ..enroll('japanese', 'en')
        ..completeStop('ja_greet_and_introduce', PathStop.learn);
      final pool = container.read(gamePoolProvider);
      expect(pool, isNotEmpty);
      for (final p in pool.where((p) => p.item.tileSource.isNotEmpty)) {
        expect(p.item.tileSource, p.expression.romanization);
      }
    });
  });

  group('records', () {
    test('a round is counted, its best kept, and it pays XP once a day per game', () async {
      final clock = TestClock();
      final container = await testContainer(clock: clock);
      addTearDown(container.dispose);
      container.read(appStateProvider.notifier).enroll('spanish-spain', 'en');
      final stats = container.read(gameStatsProvider.notifier);
      int xp() => container.read(appStateProvider).learner.xpTotal;

      expect(stats.finished(courseId, GameKind.memory, 11, variant: '6'), (
        record: false,
        xp: true,
      ), reason: 'a first round sets the record, it does not beat one');
      expect(xp(), XpAmounts.stepCompleted);
      expect(stats.finished(courseId, GameKind.memory, 9, variant: '6'), (record: true, xp: false));
      expect(stats.finished(courseId, GameKind.memory, 10, variant: '6'), (record: false, xp: false));
      final record = stats.recordOf(courseId, GameKind.memory, variant: '6');
      expect((record.plays, record.best), (3, 9));
      expect(xp(), XpAmounts.stepCompleted, reason: 'one round a day pays');
      // Another game the same day pays too; a higher score is its record.
      expect(stats.finished(courseId, GameKind.quick, 7), (record: false, xp: true));
      expect(stats.finished(courseId, GameKind.quick, 12), (record: true, xp: false));
      expect(stats.recordOf(courseId, GameKind.quick).best, 12);
      expect(xp(), 2 * XpAmounts.stepCompleted);
      // The next day.
      clock.advance(const Duration(days: 1));
      expect(stats.finished(courseId, GameKind.memory, 12, variant: '6').xp, isTrue);
      expect(xp(), 3 * XpAmounts.stepCompleted);
      // A smaller board has its own record.
      expect(stats.recordOf(courseId, GameKind.memory, variant: '4').best, isNull);

      // Kept on the device, per course.
      final again = ProviderContainer(
        overrides: [
          ...await testOverrides(prefs: {GameStats.key: container.read(learnerStoreProvider).prefs.getString(GameStats.key)!}, clock: clock),
        ],
      );
      addTearDown(again.dispose);
      expect(again.read(gameStatsProvider.notifier).recordOf(courseId, GameKind.memory, variant: '6').best, 9);
      expect(again.read(gameStatsProvider.notifier).recordOf('japanese|en', GameKind.memory, variant: '6').best, isNull);
      stats.clear();
      expect(container.read(gameStatsProvider), isEmpty);
    });
  });

  group('on screen', () {
    testWidgets('no games before anything is taught; then Home leads to them, each with what it can be played with', (t) async {
      final container = await openApp(t, learned: const []);
      expect(find.text('Mini-games'), findsNothing, reason: 'visible means usable');
      container.read(appRouterProvider).go('/play');
      await settle(t);
      expect(find.textContaining('Finish the Learn step of a mission'), findsOneWidget);
      await tapText(t, 'Back home');

      container.read(appStateProvider.notifier).completeStop(firstMission, PathStop.learn);
      await settle(t);
      await t.scrollUntilVisible(find.text('Mini-games'), 200, scrollable: find.byType(Scrollable).first);
      await tapText(t, 'Mini-games');
      expect(container.read(appRouterProvider).state.matchedLocation, '/play');
      expect(find.text('Lantern pairs'), findsOneWidget);
      expect(find.text('Quick fire'), findsOneWidget);
      expect(find.text('Sentence dash'), findsOneWidget);
      expect(find.text('By ear'), findsNothing, reason: 'nothing can say the phrases here');
      // A game that cannot be played is not reachable by its address either.
      container.read(appRouterProvider).go('/play/ear');
      await settle(t);
      expect(find.text('This mission is not part of your current course.'), findsOneWidget);
    });

    testWidgets('a voice adds By ear; the mission page links to the games', (t) async {
      final container = await openApp(t, learned: const [firstMission, secondMission], route: '/play', device: SpeakingDevice());
      for (final game in ['Lantern pairs', 'Quick fire', 'By ear', 'Sentence dash']) {
        expect(find.text(game), findsOneWidget, reason: game);
      }
      container.read(appRouterProvider).go('/path/$secondMission');
      await settle(t);
      expect(find.text('More ways to practise'), findsOneWidget);
      await tapText(t, 'Play the mini-games');
      expect(container.read(appRouterProvider).state.matchedLocation, '/play');
    });

    testWidgets('Lantern pairs: cards that do not go together turn back; every pair found ends the round with its record and XP', (t) async {
      final semantics = t.ensureSemantics();
      final container = await openApp(t, route: '/play/memory');
      final pool = container.read(gamePoolProvider);
      const seed = '$courseId/memory/0';
      final board = MemoryState.start([for (final p in seededShuffle(pool, seed).take(6)) p.item], seed);
      expect(find.text('Turn two lanterns: a phrase and its meaning stay lit.'), findsOneWidget);
      Future<void> turn(int index) async {
        final card = find.bySemanticsLabel('Lantern ${index + 1}, not turned');
        await t.ensureVisible(card);
        await t.tap(card);
        await t.pump(const Duration(milliseconds: 100));
      }

      int indexOf(String id, MemorySide side) => board.cards.indexWhere((c) => c.pairId == id && c.side == side);
      final ids = {for (final c in board.cards) c.pairId}.toList();

      // Two cards that do not go together: both shown, then turned back.
      await turn(indexOf(ids[0], MemorySide.phrase));
      await turn(indexOf(ids[1], MemorySide.meaning));
      expect(find.text(board.cards[indexOf(ids[0], MemorySide.phrase)].label), findsOneWidget);
      expect(find.text(board.cards[indexOf(ids[1], MemorySide.meaning)].label), findsOneWidget);
      await t.pump(const Duration(milliseconds: 1200));
      expect(find.text(board.cards[indexOf(ids[0], MemorySide.phrase)].label), findsNothing);
      expect(find.bySemanticsLabel('1 move'), findsOneWidget);

      for (final id in ids) {
        await turn(indexOf(id, MemorySide.phrase));
        await turn(indexOf(id, MemorySide.meaning));
      }
      await settle(t);
      expect(find.text('All the pairs in 7 moves'), findsOneWidget);
      expect(find.text('6 phrases found with their meaning.'), findsOneWidget);
      expect(find.text('+5 XP'), findsOneWidget);
      expect(find.text('New record'), findsNothing, reason: 'a first round');
      expect(container.read(gameStatsProvider.notifier).recordOf(courseId, GameKind.memory, variant: '6').best, 7);
      expect(container.read(appStateProvider).learner.xpTotal, 2 * XpAmounts.stepCompleted, reason: 'the Learn stop, and the day\'s first round');

      // Again: a new board; a perfect round beats the record, without more XP today.
      await tapText(t, 'Play again');
      const second = '$courseId/memory/1';
      final next = MemoryState.start([for (final p in seededShuffle(pool, second).take(6)) p.item], second);
      for (final id in {for (final c in next.cards) c.pairId}) {
        await turn(next.cards.indexWhere((c) => c.pairId == id && c.side == MemorySide.phrase));
        await turn(next.cards.indexWhere((c) => c.pairId == id && c.side == MemorySide.meaning));
      }
      await settle(t);
      expect(find.text('All the pairs in 6 moves'), findsOneWidget);
      expect(find.text('New record'), findsOneWidget);
      expect(find.text('+5 XP'), findsNothing);
      await tapText(t, 'Back to the games');
      expect(find.text('Your record: 6 moves'), findsOneWidget);
      semantics.dispose();
    });

    testWidgets('Quick fire: right answers count against the clock; a wrong one shows the meaning; time ends the round', (t) async {
      final container = await openApp(t, route: '/play/quick');
      final pool = container.read(gamePoolProvider);
      final round = QuickRound([for (final p in pool) p.item], '$courseId/quick/0');
      expect(find.textContaining('Answer as many as you can in 45 seconds'), findsOneWidget);
      await tapText(t, 'Start');

      // Four right answers.
      for (var i = 0; i < 4; i++) {
        final statement = round.statementAt(i);
        expect(find.text(statement.item.text), findsOneWidget, reason: 'statement $i');
        await t.tap(find.text(statement.isTrue ? 'Yes' : 'No'));
        await t.pump(const Duration(milliseconds: 500));
      }
      expect(find.text('4 in a row'), findsOneWidget);
      // A wrong one: what the phrase means, while the clock waits.
      final missed = round.statementAt(4);
      await t.tap(find.text(missed.isTrue ? 'No' : 'Yes'));
      await t.pump(const Duration(milliseconds: 300));
      expect(find.text('It means: ${missed.item.meaning}'), findsOneWidget);
      await t.pump(const Duration(milliseconds: 1500));
      expect(find.text(round.statementAt(5).item.text), findsOneWidget);
      // The time runs out.
      for (var i = 0; i < 50 && find.text('Play again').evaluate().isEmpty; i++) {
        await t.pump(const Duration(seconds: 1));
      }
      expect(find.text('4 right answers'), findsOneWidget);
      expect(find.text('Out of 5 answered. Longest run without a mistake: 4.'), findsOneWidget);
      // The phrase missed, to look at again.
      expect(find.text(missed.item.text), findsOneWidget);
      expect(container.read(gameStatsProvider.notifier).recordOf(courseId, GameKind.quick).best, 4);
    });

    testWidgets('Sentence dash: each sentence rebuilt moves on to the next; the time is the result', (t) async {
      final container = await openApp(t, learned: const [firstMission, secondMission], route: '/play/dash');
      final pool = container.read(gamePoolProvider);
      final sentences = dashSentences(pool: [for (final p in pool) p.item], seed: '$courseId/dash/0');
      expect(sentences.length, greaterThanOrEqualTo(3));
      await tapText(t, 'Start');
      Finder bankTile(String w) => find.descendant(of: find.byType(Wrap).last, matching: find.text(w)).first;
      for (final (i, sentence) in sentences.indexed) {
        expect(find.text(sentence.item.meaning), findsOneWidget, reason: 'sentence $i');
        if (i == 0) {
          // A wrong order is refused, word by word.
          for (final w in sentence.answer.reversed) {
            await t.tap(bankTile(w));
            await t.pump(const Duration(milliseconds: 100));
          }
          await tapText(t, 'Check');
          expect(find.text('Not quite — tap a word to take it back.'), findsOneWidget);
          for (final w in sentence.answer.reversed) {
            await t.tap(find.descendant(of: find.byType(Wrap).first, matching: find.text(w)).first);
            await t.pump(const Duration(milliseconds: 100));
          }
        }
        for (final w in sentence.answer) {
          await t.tap(bankTile(w));
          await t.pump(const Duration(milliseconds: 100));
        }
        await t.tap(find.text('Check'));
        await t.pump(const Duration(milliseconds: 200));
        expect(find.text('That’s it!'), findsOneWidget);
        await t.pump(const Duration(seconds: 1));
      }
      await settle(t);
      expect(find.textContaining('${sentences.length} sentences in 0:'), findsOneWidget);
      expect(container.read(gameStatsProvider.notifier).recordOf(courseId, GameKind.dash).best, isNotNull);
    });

    testWidgets('By ear: the phrase is said, found among the written ones, and its meaning shown', (t) async {
      final device = SpeakingDevice();
      final container = await openApp(t, route: '/play/ear', device: device);
      final pool = container.read(gamePoolProvider);
      final questions = earQuestions(pool: [for (final p in pool) p.item], audible: [for (final p in pool) p.item], seed: '$courseId/ear/0');
      expect(device.said.last, questions.first.item.text, reason: 'said as the question opens');
      for (final (i, q) in questions.indexed) {
        expect(find.text('Listen. Which one did you hear?'), findsOneWidget);
        // The first is missed on purpose.
        final pick = i == 0 ? q.options.firstWhere((o) => o.id != q.item.id) : q.item;
        await tapText(t, pick.text);
        expect(find.text(i == 0 ? 'Not quite' : 'That’s it!'), findsOneWidget);
        expect(find.text(q.item.meaning), findsOneWidget, reason: 'what the phrase means');
        await tapText(t, 'Continue');
      }
      expect(find.text('${questions.length - 1} of ${questions.length} caught by ear'), findsOneWidget);
      expect(find.text(questions.first.item.meaning), findsOneWidget, reason: 'the phrase missed, to look at again');
      expect(container.read(gameStatsProvider.notifier).recordOf(courseId, GameKind.ear).best, questions.length - 1);
    });

    testWidgets('Reset all progress forgets the games\' records', (t) async {
      final container = await openApp(t, route: '/account');
      container.read(gameStatsProvider.notifier).finished(courseId, GameKind.quick, 9);
      expect(container.read(gameStatsProvider), isNotEmpty);
      await t.scrollUntilVisible(find.text('Reset all progress'), 300, scrollable: find.byType(Scrollable).first);
      await tapText(t, 'Reset all progress');
      await tapText(t, 'Reset');
      expect(container.read(gameStatsProvider), isEmpty);
    });
  });

  test('the round lasts 45 seconds', () => expect(quickRoundLength, const Duration(seconds: 45)));
}
