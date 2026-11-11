// Reads the content bundle from disk (dart:io): VM only.
@TestOn('vm')
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:langquest_mobile/core/audio/clip_player_provider.dart';
import 'package:langquest_mobile/core/backend/account.dart';
import 'package:langquest_mobile/core/backend/api_client.dart';
import 'package:langquest_mobile/core/backend/server_course.dart';
import 'package:langquest_mobile/core/services/app_state.dart';
import 'package:langquest_mobile/features/call/call_screen.dart';
import 'package:langquest_mobile/features/learn/learn_logic.dart';
import 'package:langquest_mobile/features/learn/record_take.dart';
import 'package:langquest_mobile/main.dart';
import 'package:langquest_mobile/navigation/app_router.dart';

import 'call_fakes.dart';
import 'recording_fakes.dart';
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

    // Nothing is called until the learner taps Call.
    expect(find.text('Practise it in a real conversation'), findsOneWidget);
    expect(find.text('Uses LangQuest’s AI. Your recordings aren’t kept.'), findsOneWidget);
    expect(server.requests, isEmpty);
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

  testWidgets('a course without conversation says so, and offers no retry', (t) async {
    final semantics = t.ensureSemantics();
    await pump(t, server: FakeConversationServer(startStatus: 501), player: FakeClipPlayer());
    await tapLabel(t, 'Call', ms: 1500);
    expect(find.text('Live calls aren’t available for this course yet.'), findsOneWidget);
    expect(find.text('Try again'), findsNothing);
    semantics.dispose();
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
