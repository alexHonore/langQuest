// Reads the content bundle from disk (dart:io): VM only.
@TestOn('vm')
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:langquest_mobile/core/backend/admin_models.dart';
import 'package:langquest_mobile/core/services/app_state.dart';
import 'package:langquest_mobile/main.dart';
import 'package:langquest_mobile/navigation/app_router.dart';

import 'support.dart';

Map<String, Object?> route(
  String task,
  String model, {
  String? variety,
  List<String> fallbacks = const [],
  Map<String, Object?> params = const {},
  bool enabled = true,
}) => {
  'task': task,
  'targetVariety': variety,
  'sourceLanguage': null,
  'provider': 'openrouter',
  'primaryModel': model,
  'fallbackModels': fallbacks,
  'params': params,
  'latencyClass': 'interactive',
  'enabled': enabled,
  'version': 1,
};

final response = <String, Object?>{
  'profiles': [
    route('character_dialogue', 'admin/dialogue-model'),
    route('speech_synthesis', 'google/gemini-3.8-flash-lite-tts', variety: 'es-ES', params: {'voiceId': 'es-es-f-2'}),
    route('learner_evaluation', 'admin/disabled-model', enabled: false),
  ],
  'defaults': [
    route('character_dialogue', 'anthropic/claude-haiku-5.5', fallbacks: ['google/gemini-3.8-flash']),
    route('learner_evaluation', 'google/gemini-3.8-flash'),
    route('pronunciation_feedback', 'google/gemini-3.8-flash', fallbacks: ['google/gemini-3.5-flash-lite']),
    route('speech_synthesis', 'google/gemini-3.8-flash-lite-tts'),
    route('realtime_conversation', 'pipeline:stt_llm_tts'),
  ],
  'availableModels': [
    {
      'id': 'anthropic/claude-haiku-5.5',
      'modalities': ['text'],
    },
    {
      'id': 'google/gemini-3.8-flash-tts',
      'modalities': ['speech'],
    },
  ],
  'voices': [
    {
      'voiceId': 'es-es-f-2',
      'varietyId': 'es-ES',
      'model': 'google/gemini-3.8-flash-lite-tts',
      'providerVoice': 'Aoede',
      'gender': 'female',
      'status': 'verified',
    },
  ],
};

void main() {
  setUpAll(() => GoogleFonts.config.allowRuntimeFetching = false);

  test('an enabled admin route replaces the default of its scope; a disabled one does not', () {
    final o = ModelsOverview.fromResponse(response);
    expect(o.routesOf('character_dialogue').single.primaryModel, 'admin/dialogue-model');
    expect(o.routesOf('character_dialogue').single.fromAdmin, isTrue);
    expect(o.routesOf('learner_evaluation').single.primaryModel, 'google/gemini-3.8-flash', reason: 'the disabled row routes nothing');
    expect([for (final r in o.routesOf('speech_synthesis')) (r.targetVariety, r.voiceId)], [(null, null), ('es-ES', 'es-es-f-2')]);
    expect(o.modelsFor('speech_synthesis'), ['google/gemini-3.8-flash-tts']);
    expect(o.modelsFor('character_dialogue'), ['anthropic/claude-haiku-5.5']);
  });

  testWidgets('the screen says which model does what, per course, and what can be changed', (t) async {
    t.view.physicalSize = const Size(390 * 3, 1400 * 3);
    t.view.devicePixelRatio = 3;
    addTearDown(t.view.reset);
    await t.pumpWidget(
      ProviderScope(
        overrides: [...await testOverrides(), modelsOverviewProvider.overrideWith((ref) async => ModelsOverview.fromResponse(response))],
        child: const LangQuestApp(),
      ),
    );
    final container = ProviderScope.containerOf(t.element(find.byType(LangQuestApp)));
    container.read(appStateProvider.notifier).enroll('spanish-spain', 'en');
    container.read(appRouterProvider).go('/admin/models');
    for (var i = 0; i < 10; i++) {
      await t.pump(const Duration(milliseconds: 100));
    }
    expect(find.text('Calls: what the character says'), findsOneWidget);
    expect(find.text('admin/dialogue-model'), findsOneWidget);
    expect(find.text('All courses · changed by an admin'), findsOneWidget);
    expect(find.text('Pronunciation score (AI listening)'), findsOneWidget);
    expect(find.text('Then: google/gemini-3.5-flash-lite'), findsOneWidget);
    expect(find.text('Voice: Aoede · gemini-3.8-flash-lite-tts · female'), findsOneWidget);
    expect(find.text('Not changeable here'), findsOneWidget, reason: 'the voice-call pipeline');
  });
}
