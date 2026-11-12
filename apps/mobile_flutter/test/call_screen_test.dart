// Reads the content bundle from disk (dart:io): VM only.
@TestOn('vm')
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:langquest_mobile/core/audio/clip_player_provider.dart';
import 'package:langquest_mobile/core/platform/browser_kind.dart';
import 'package:langquest_mobile/core/audio/take_recorder.dart';
import 'package:langquest_mobile/core/backend/account.dart';
import 'package:langquest_mobile/core/backend/api_client.dart';
import 'package:langquest_mobile/core/backend/auth_gateway.dart';
import 'package:langquest_mobile/core/backend/server_course.dart';
import 'package:langquest_mobile/core/services/app_state.dart';
import 'package:langquest_mobile/core/services/speaking_stats.dart';
import 'package:langquest_mobile/features/call/call_portrait.dart';
import 'package:langquest_mobile/features/call/call_screen.dart';
import 'package:langquest_mobile/features/learn/learn_logic.dart';
import 'package:langquest_mobile/features/learn/learn_providers.dart';
import 'package:langquest_mobile/features/learn/record_take.dart';
import 'package:langquest_mobile/main.dart';
import 'package:langquest_mobile/navigation/app_router.dart';

import 'call_fakes.dart';
import 'recording_fakes.dart';

import 'package:langquest_mobile/core/backend/curriculum_ids.dart';

import 'support.dart';

const missionKey = 'es_greet_and_introduce';
const course = ServerCourse(enrollmentId: 'enr-1', targetVarietyId: 'es-ES', speechCheck: true, liveConversation: true, voiceConversation: true);

/// Pump frames for [ms] (scenes and portraits animate; `pumpAndSettle` would wait on them).
Future<void> settle(WidgetTester t, [int ms = 900]) async {
  for (var i = 0; i < ms ~/ 100; i++) {
    await t.pump(const Duration(milliseconds: 100));
  }
}

Future<void> tapLabel(WidgetTester t, String label, {int ms = 900}) async {
  final f = find.bySemanticsLabel(label);
  expect(f, findsWidgets, reason: 'nothing labelled "$label"');
  await t.ensureVisible(f.first);
  await t.tap(f.first);
  await settle(t, ms);
}

void main() {
  setUpAll(() => GoogleFonts.config.allowRuntimeFetching = false);

  Future<ProviderContainer> pump(
    WidgetTester t, {
    FakeConversationServer? server,
    FakeClipPlayer? player,
    bool canRecord = true,
    ServerCourse? call = course,
    String route = '/call/$missionKey',
    List<CourseCharacter> characters = const [],
    Map<String, Object?>? manifest,
  }) async {
    t.view.physicalSize = const Size(390 * 3, 844 * 3);
    t.view.devicePixelRatio = 3;
    addTearDown(t.view.reset);
    final api = LangQuestApi(baseUrl: 'https://api.test', accessToken: () async => 't', client: (server ?? FakeConversationServer()).client);
    await t.pumpWidget(
      ProviderScope(
        overrides: [
          ...await testOverrides(),
          liveCallCourseProvider.overrideWithValue(call),
          apiProvider.overrideWithValue(api),
          takeRecorderFactoryProvider.overrideWithValue(canRecord ? () => FakeRecorder(take: FakeTake()) : null),
          clipPlayerFactoryProvider.overrideWithValue(player == null ? null : () => player),
          courseCharactersProvider.overrideWith((ref) async => characters),
          if (manifest != null) courseManifestProvider.overrideWith((ref) async => manifest),
        ],
        child: const LangQuestApp(),
      ),
    );
    final container = ProviderScope.containerOf(t.element(find.byType(LangQuestApp)));
    final notifier = container.read(appStateProvider.notifier)..setReduceMotion(true);
    notifier.enroll('spanish-spain', 'en');
    container.read(appRouterProvider).go(route);
    await settle(t, 1200);
    return container;
  }

  testWidgets('a live call: Pablo picks up, speaks, hears the learner, helps, and the evaluation shows on hanging up', (t) async {
    final semantics = t.ensureSemantics();
    final server = FakeConversationServer(
      turns: [
        const ScriptedTurn(heard: 'Hola, me llamo Alex', reply: '¡Encantado, Alex!', objectives: ['greet'], expression: 'friendly_success'),
      ],
    );
    final player = FakeClipPlayer();
    final container = await pump(t, server: server, player: player);

    final xpBefore = container.read(appStateProvider).learner.xpTotal;
    // Nothing is called until the learner taps Call.
    expect(find.text('Practise it in a real conversation'), findsOneWidget);
    expect(find.text('Uses LangQuest’s AI. Your recordings aren’t kept.'), findsOneWidget);
    expect(server.requests.where((r) => r.contains('/ai/')), isEmpty, reason: 'no AI call before Call (the lobby may read the public catalog)');
    await tapLabel(t, 'Call', ms: 1500);
    expect(player.primed, 1, reason: 'audio is readied inside the tap');

    // Pablo picks up: his portrait (the art roster's), his opening line spoken, the goals.
    expect(find.text('Pablo'), findsOneWidget);
    expect(find.text('¡Hola! Soy Pablo. ¿Cómo te llamas?'), findsOneWidget);
    expect(player.played.single, startsWith('data:audio/mpeg'));
    expect(find.text('Pablo is speaking'), findsOneWidget);
    final art = t.widgetList<SvgPicture>(find.byType(SvgPicture)).map((p) => (p.bytesLoader as SvgAssetLoader).assetName).toSet();
    expect(art, containsAll(['assets/characters/es-es-schoolboy-pablo.talking.svg', 'assets/characters/es-es-schoolboy-pablo.lip_sync.svg']));
    expect(find.bySemanticsLabel('Greet Pablo: not yet'), findsOneWidget);
    player.finish();
    await settle(t);
    expect(find.text('Your turn: tap the microphone and answer'), findsOneWidget);

    // Translate: the server's gloss of the line.
    expect(find.text('Hi! I’m Pablo. What’s your name?'), findsNothing);
    await tapLabel(t, 'Translate');
    expect(find.text('Hi! I’m Pablo. What’s your name?'), findsOneWidget);

    // Push to talk: tap, speak, tap to send.
    await tapLabel(t, 'Talk');
    expect(find.text('Listening to you…'), findsOneWidget);
    await tapLabel(t, 'Send', ms: 1500);
    expect(find.text('Hola, me llamo Alex'), findsOneWidget, reason: 'what the server heard');
    expect(find.text('¡Encantado, Alex!'), findsOneWidget);
    expect(player.played, hasLength(2));
    expect(find.bySemanticsLabel('Greet Pablo: done'), findsOneWidget);
    player.finish();
    await settle(t);

    // Help: a hint from Pablo.
    await tapLabel(t, 'Hint', ms: 1500);
    expect(find.text('Puedes decir: «Me llamo…»'), findsOneWidget);
    player.finish();
    await settle(t);

    // Explain: the server explains his last line, in the learner's language; Example: another sentence using it.
    await tapLabel(t, 'Explain', ms: 1500);
    expect(server.turnBodies().last['input'], {'kind': 'command', 'command': 'meaning'});
    expect(find.text('Explanation'), findsOneWidget);
    expect(find.text('Pablo says hello, gives his name and asks yours.'), findsOneWidget);
    player.finish();
    await settle(t);
    await tapLabel(t, 'Example', ms: 1500);
    expect(server.turnBodies().last['input'], {'kind': 'command', 'command': 'example'});
    expect(find.text('Hola, me llamo Ana. ¿Y tú?'), findsOneWidget);
    expect(find.text('Another way to answer: say your name, then ask theirs.'), findsOneWidget);
    player.finish();
    await settle(t);

    // Hang up: the server's evaluation.
    await tapLabel(t, 'Hang up', ms: 1500);
    expect(find.textContaining('Call ended'), findsOneWidget);
    expect(find.text('+30 XP'), findsOneWidget);
    expect(find.text('Goals met: 1 of 2'), findsOneWidget);
    expect(find.text('You greeted Pablo and said your name.'), findsOneWidget);
    expect(find.text('Next time, try'), findsOneWidget);
    expect(find.text('Me llamo Alex.'), findsOneWidget);
    expect(find.text('You said: “Yo llamo Alex”'), findsOneWidget);
    expect(container.read(appStateProvider).stopsDone(missionKey), contains(PathStop.talk));
    // The server's XP for the call counts in the learner's total; the call is counted for Progress.
    expect(container.read(appStateProvider).learner.xpTotal, xpBefore + 30 + 5, reason: 'the call\'s 30 XP and the Talk stop\'s 5');
    expect(container.read(speakingStatsProvider)['spanish-spain|en']!.calls, 1);
    container.read(appRouterProvider).go('/progress');
    await settle(t);
    expect(find.text('Out loud'), findsOneWidget);
    expect(find.text('Live calls'), findsOneWidget);
    expect(find.text('1 · 1 min'), findsOneWidget);
    semantics.dispose();
  });

  testWidgets('without a recorder the call is written: type, send, read the reply', (t) async {
    final semantics = t.ensureSemantics();
    final server = FakeConversationServer(turns: [const ScriptedTurn(reply: '¡Hola, Alex!')]);
    await pump(t, server: server, canRecord: false);
    expect(find.text('Start the chat'), findsOneWidget);
    await tapLabel(t, 'Start the chat', ms: 1500);
    expect(server.bodies['POST /v1/ai/conversation/session']!.single['mode'], 'text_only');
    expect(find.text('Your turn: type your answer'), findsOneWidget);
    await t.enterText(find.byType(TextField), 'Hola, soy Alex');
    await t.tap(find.byTooltip('Send'));
    await settle(t, 1500);
    expect(find.text('Hola, soy Alex'), findsOneWidget);
    expect(find.text('¡Hola, Alex!'), findsOneWidget);
    await tapLabel(t, 'End the chat', ms: 1500);
    expect(find.textContaining('Chat ended'), findsOneWidget);
    semantics.dispose();
  });

  testWidgets('a live call holds up at 200% text on a small phone, and its controls are labelled and big enough', (t) async {
    final semantics = t.ensureSemantics();
    final server = FakeConversationServer(
      turns: [
        const ScriptedTurn(heard: 'Hola, me llamo Alex', reply: '¡Encantado, Alex!', objectives: ['greet']),
      ],
    );
    t.platformDispatcher.textScaleFactorTestValue = 2;
    addTearDown(t.platformDispatcher.clearTextScaleFactorTestValue);
    final player = FakeClipPlayer(instant: true);
    await pump(t, server: server, player: player);
    t.view.physicalSize = const Size(360 * 3, 690 * 3);
    await settle(t);
    await tapLabel(t, 'Call', ms: 1500);
    expect(t.takeException(), isNull);
    await tapLabel(t, 'Talk');
    await tapLabel(t, 'Send', ms: 1500);
    expect(find.text('¡Encantado, Alex!'), findsOneWidget);
    expect(t.takeException(), isNull);
    await expectLater(t, meetsGuideline(labeledTapTargetGuideline));
    await expectLater(t, meetsGuideline(androidTapTargetGuideline));
    await tapLabel(t, 'Hang up', ms: 1500);
    expect(t.takeException(), isNull);
    semantics.dispose();
  });

  testWidgets('goals the server cannot word are shown as progress, never as invented text', (t) async {
    final semantics = t.ensureSemantics();
    final server = FakeConversationServer(
      describedGoals: false,
      turns: [
        const ScriptedTurn(heard: 'Hola', reply: '¡Hola!', objectives: ['greet']),
      ],
    );
    await pump(t, server: server, player: FakeClipPlayer(instant: true));
    await tapLabel(t, 'Call', ms: 1500);
    expect(find.bySemanticsLabel('Goals met: 0 of 2'), findsOneWidget);
    expect(find.text('0/2'), findsOneWidget);
    await tapLabel(t, 'Talk');
    await tapLabel(t, 'Send', ms: 1500);
    expect(find.bySemanticsLabel('Goals met: 1 of 2'), findsOneWidget);
    await tapLabel(t, 'Hang up', ms: 1500);
    expect(find.text('Goals met: 1 of 2'), findsOneWidget);
    semantics.dispose();
  });

  testWidgets('the Speak tab lists the course\'s characters; a free call names the character, has no goals and credits no stop', (t) async {
    final semantics = t.ensureSemantics();
    final server = FakeConversationServer(
      turns: [const ScriptedTurn(heard: 'Hola', reply: '¡Hola! ¿Qué tal?')],
    );
    final pablo = CourseCharacter(id: pabloId, name: 'Pablo', role: 'Schoolboy');
    final container = await pump(
      t,
      server: server,
      player: FakeClipPlayer(instant: true),
      route: '/',
      characters: [
        pablo,
        const CourseCharacter(id: '00000000-0000-4000-8000-0000000000aa', name: 'Marta', role: 'Coworker'),
      ],
    );
    expect(find.text('Speak'), findsOneWidget, reason: 'live calls back the course');
    await t.tap(find.text('Speak'));
    await settle(t);
    expect(find.text('Talk with the locals'), findsOneWidget);
    expect(find.text('Pablo'), findsOneWidget);
    expect(find.text('Marta'), findsOneWidget);
    expect(find.bySemanticsLabel('Call Marta, Coworker'), findsOneWidget);
    // Pablo's portrait is the art roster's; Marta (no art in this build) gets her initial.
    expect(
      t.widgetList<SvgPicture>(find.byType(SvgPicture)).map((p) => (p.bytesLoader as SvgAssetLoader).assetName),
      contains('assets/characters/es-es-schoolboy-pablo.neutral.svg'),
    );

    await t.tap(find.text('Pablo'));
    await settle(t);
    expect(find.text('Call Pablo'), findsWidgets);
    expect(find.text('Street'), findsWidgets, reason: 'a schoolboy has no one place: the next mission\'s scene');
    expect(find.text('Phrases you might need'), findsNothing, reason: 'a free call has no mission phrases');
    expect(find.text('Schoolboy'), findsOneWidget);
    await tapLabel(t, 'Call', ms: 1500);
    final start = server.bodies['POST /v1/ai/conversation/session']!.single;
    expect(start['characterId'], pabloId);
    expect(start.containsKey('missionId'), isFalse);
    expect(find.textContaining('Goals'), findsNothing, reason: 'a free call has no goals');
    expect(find.bySemanticsLabel('Phrases'), findsNothing);
    await tapLabel(t, 'Talk');
    await tapLabel(t, 'Send', ms: 1500);
    expect(find.text('¡Hola! ¿Qué tal?'), findsOneWidget);
    await tapLabel(t, 'Hang up', ms: 1500);
    expect(find.textContaining('Call ended'), findsOneWidget);
    expect(container.read(appStateProvider).stopsDone(missionKey), isNot(contains(PathStop.talk)), reason: 'no mission stop for a free call');
    semantics.dispose();
  });

  testWidgets('before a mission call, the mission\'s phrases; during it, a Phrases sheet (no request)', (t) async {
    final semantics = t.ensureSemantics();
    final server = FakeConversationServer();
    final container = await pump(t, server: server, player: FakeClipPlayer(instant: true));
    final plan = container.read(learnPlanProvider(missionKey))!;
    final first = plan.phrases.first;
    expect(find.text('Phrases you might need'), findsOneWidget);
    await t.ensureVisible(find.text(first.text).first);
    expect(find.text(plan.meaningOf(first)), findsWidgets);
    expect(find.text(plan.phrases[1].text), findsWidgets);
    await tapLabel(t, 'Call', ms: 1500);
    final before = server.requests.length;
    await tapLabel(t, 'Phrases');
    expect(find.text('Phrases you might need'), findsOneWidget);
    expect(find.text(first.text), findsWidgets);
    expect(find.text(plan.meaningOf(first)), findsWidgets);
    expect(server.requests, hasLength(before), reason: 'the bundle\'s phrases: no request');
    semantics.dispose();
  });

  testWidgets('a free call with a coworker happens at the office', (t) async {
    final marta = CourseCharacter(id: characterServerId('es-es-coworker-marta'), name: 'Marta', role: 'Coworker');
    await pump(t, route: '/talk/${marta.id}', characters: [marta], player: FakeClipPlayer());
    expect(find.text('Call Marta'), findsWidgets);
    expect(find.text('Office'), findsWidgets);
    expect(find.text('Street'), findsNothing);
  });

  testWidgets('hanging up before saying anything: a plain message, no summary or corrections, nothing credited', (t) async {
    final semantics = t.ensureSemantics();
    final container = await pump(t, player: FakeClipPlayer(instant: true));
    final xpBefore = container.read(appStateProvider).learner.xpTotal;
    await tapLabel(t, 'Call', ms: 1500);
    expect(find.text('¡Hola! Soy Pablo. ¿Cómo te llamas?'), findsOneWidget);
    await tapLabel(t, 'Hang up', ms: 1500);
    expect(find.textContaining('Call ended'), findsOneWidget);
    expect(find.text('You hung up before answering, so there was nothing to evaluate. Call again when you’re ready.'), findsOneWidget);
    expect(find.text('You greeted Pablo and said your name.'), findsNothing, reason: 'the server\'s summary would describe only Pablo\'s lines');
    expect(find.text('LangQuest couldn’t evaluate this call, so nothing was counted.'), findsNothing);
    expect(find.text('Next time, try'), findsNothing);
    expect(find.text('Goals met: 0 of 2'), findsOneWidget, reason: 'the goals stay, as what to aim for next time');
    expect(find.text('Call again'), findsOneWidget);
    expect(container.read(appStateProvider).learner.xpTotal, xpBefore);
    expect(container.read(appStateProvider).stopsDone(missionKey), isNot(contains(PathStop.talk)));
    expect(container.read(speakingStatsProvider)['spanish-spain|en']?.calls ?? 0, 0);
    semantics.dispose();
  });

  testWidgets('a call where the learner only asked for help: the server\'s XP counts, but no Talk stop', (t) async {
    final semantics = t.ensureSemantics();
    final container = await pump(t, player: FakeClipPlayer(instant: true));
    final xpBefore = container.read(appStateProvider).learner.xpTotal;
    await tapLabel(t, 'Call', ms: 1500);
    await tapLabel(t, 'Hint', ms: 1500);
    await tapLabel(t, 'Hang up', ms: 1500);
    expect(find.text('+30 XP'), findsOneWidget);
    expect(container.read(appStateProvider).learner.xpTotal, xpBefore + 30, reason: 'the summary\'s XP is the total\'s');
    expect(container.read(appStateProvider).stopsDone(missionKey), isNot(contains(PathStop.talk)));
    semantics.dispose();
  });

  testWidgets('a refused microphone: the call goes on in writing, and says how to allow it', (t) async {
    final semantics = t.ensureSemantics();
    t.view.physicalSize = const Size(390 * 3, 844 * 3);
    t.view.devicePixelRatio = 3;
    addTearDown(t.view.reset);
    final api = LangQuestApi(baseUrl: 'https://api.test', accessToken: () async => 't', client: FakeConversationServer().client);
    await t.pumpWidget(
      ProviderScope(
        overrides: [
          ...await testOverrides(),
          liveCallCourseProvider.overrideWithValue(course),
          apiProvider.overrideWithValue(api),
          takeRecorderFactoryProvider.overrideWithValue(() => FakeRecorder(failure: RecorderFailure.blocked)),
          clipPlayerFactoryProvider.overrideWithValue(() => FakeClipPlayer(instant: true)),
          browserKindProvider.overrideWithValue(BrowserKind.iosSafari),
        ],
        child: const LangQuestApp(),
      ),
    );
    final container = ProviderScope.containerOf(t.element(find.byType(LangQuestApp)));
    container.read(appStateProvider.notifier)
      ..setReduceMotion(true)
      ..enroll('spanish-spain', 'en');
    container.read(appRouterProvider).go('/call/$missionKey');
    await settle(t, 1200);
    await tapLabel(t, 'Call', ms: 1500);
    await tapLabel(t, 'Talk');
    expect(find.text('The microphone is blocked, so you can write your answers. Allow it to speak.'), findsOneWidget);
    expect(find.byType(TextField), findsOneWidget, reason: 'the call goes on in writing');
    await t.tap(find.text('How to allow the microphone'));
    await settle(t, 300);
    expect(find.textContaining('Website Settings › Microphone › Allow'), findsOneWidget);
    semantics.dispose();
  });

  testWidgets('without live calls there is no Speak tab', (t) async {
    await pump(t, call: null, route: '/');
    expect(find.text('Speak'), findsNothing);
  });

  testWidgets('a course without conversation says so, and offers no retry', (t) async {
    final semantics = t.ensureSemantics();
    await pump(t, server: FakeConversationServer(startStatus: 501), player: FakeClipPlayer());
    await tapLabel(t, 'Call', ms: 1500);
    expect(find.text('Live calls aren’t available for this course yet.'), findsOneWidget);
    expect(find.text('Try again'), findsNothing);
    semantics.dispose();
  });

  group('signed out, on a course with live calls', () {
    Future<ProviderContainer> containerWith(AccountState account, {bool liveCalls = true}) async {
      final c = ProviderContainer(
        overrides: [
          ...await testOverrides(),
          accountProvider.overrideWith(() => _FixedAccount(account)),
          serverOffersProvider.overrideWith((ref, source) async => {'spanish-spain': ServerTrackOffer(characters: 4, liveCalls: liveCalls)}),
        ],
      );
      addTearDown(c.dispose);
      return c;
    }

    test('the invitation shows only signed out, with a backend, on a course whose characters can be called', () async {
      Future<bool> needs(AccountState account, {bool liveCalls = true}) async {
        final c = await containerWith(account, liveCalls: liveCalls);
        c.read(appStateProvider.notifier).enroll('spanish-spain', 'en');
        c.listen(callsNeedAccountProvider, (_, _) {});
        await c.read(serverOffersProvider('en').future);
        return c.read(callsNeedAccountProvider);
      }

      expect(await needs(const AccountState(available: true)), isTrue);
      expect(
        await needs(
          const AccountState(
            available: true,
            user: AccountUser(id: 'u', email: 'a@b.c'),
          ),
        ),
        isFalse,
        reason: 'signed in: the real Talk stop',
      );
      expect(await needs(const AccountState()), isFalse, reason: 'no backend: no account to make');
      expect(await needs(const AccountState(available: true), liveCalls: false), isFalse, reason: 'nothing to unlock');
    });

    testWidgets('the path shows Talk locked, and it opens the account', (t) async {
      final semantics = t.ensureSemantics();
      t.view.physicalSize = const Size(390 * 3, 844 * 3);
      t.view.devicePixelRatio = 3;
      addTearDown(t.view.reset);
      await t.pumpWidget(
        ProviderScope(
          overrides: [...await testOverrides(), liveCallCourseProvider.overrideWithValue(null), callsNeedAccountProvider.overrideWithValue(true)],
          child: const LangQuestApp(),
        ),
      );
      final container = ProviderScope.containerOf(t.element(find.byType(LangQuestApp)));
      container.read(appStateProvider.notifier)
        ..setReduceMotion(true)
        ..enroll('spanish-spain', 'en');
      container.read(appRouterProvider).go('/path/$missionKey');
      await settle(t, 1200);
      final locked = find.bySemanticsLabel('5. Talk. A live call with Lucía: with a free account');
      expect(locked, findsOneWidget);
      await t.tap(locked);
      await settle(t, 1200);
      expect(find.text('Settings'), findsOneWidget, reason: 'the account screen, where signing up is');
      semantics.dispose();
    });
  });

  testWidgets('a mission the server does not have yet (a newer chapter) offers no call', (t) async {
    // The server's manifest lists chapter 1 only.
    final chapter1 = testBundle.course('spanish-spain', 'en')!.chapters.first;
    final manifest = {
      'chapters': [
        {
          'id': 'c1',
          'missions': [
            for (final m in chapter1.missions) {'id': missionServerId(m.chapterKey, m.key)},
          ],
        },
      ],
      'characters': const <Object>[],
    };
    await pump(t, player: FakeClipPlayer(), route: '/path/$missionKey', manifest: manifest);
    expect(find.text('Talk'), findsOneWidget, reason: 'chapter 1 is on the server');
    await t.pumpWidget(const SizedBox());

    final container = await pump(t, player: FakeClipPlayer(), route: '/path/es_restaurant_order_meal', manifest: manifest);
    expect(container.read(appStateProvider).activeCourse!.chapters.last.missions.first.key, 'es_restaurant_order_meal');
    expect(find.text('Talk'), findsNothing, reason: 'chapter 2 is not published on the server yet');
    expect(find.text('Mission'), findsOneWidget, reason: 'everything else of the mission is there');
  });

  testWidgets('the path offers the Talk stop only when a live call backs it', (t) async {
    await pump(t, call: null, route: '/path/$missionKey');
    expect(find.text('Talk'), findsNothing);
    await t.pumpWidget(const SizedBox());

    await pump(t, player: FakeClipPlayer(), route: '/path/$missionKey');
    expect(find.text('Talk'), findsOneWidget);
    expect(find.text('A live call: use what you learned, out loud'), findsOneWidget);
  });
}

class _FixedAccount extends AccountController {
  _FixedAccount(this.fixed);

  final AccountState fixed;

  @override
  AccountState build() => fixed;
}
