// Reads the content bundle from disk (dart:io): VM only.
@TestOn('vm')
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:langquest_mobile/core/audio/take_recorder.dart';
import 'package:langquest_mobile/core/backend/speech_check.dart';
import 'package:langquest_mobile/core/services/speech_service.dart';
import 'package:langquest_mobile/features/learn/record_take.dart';
import 'package:langquest_mobile/l10n/l10n.dart';

import 'recording_fakes.dart';
import 'support.dart';

/// The device voice, without a synthesizer: every locale has a voice; stops are counted.
class FakeSpeech extends SpeechService {
  int stops = 0;

  @override
  Future<bool> supports(String? locale) async => locale != null;

  @override
  Future<void> speak(String text, {required String locale, bool slow = false}) async {}

  @override
  Future<void> stop() async => stops++;
}

void main() {
  test('levels are dBFS of the peak sample; the silence floor is the server speech gate\'s', () {
    expect(peakToDbfs(1), 0);
    expect(peakToDbfs(0.5), closeTo(-6.02, 0.01));
    expect(peakToDbfs(0), minLevelDbfs);
    expect(peakToDbfs(1e-12), minLevelDbfs);
    expect(silencePeakDbfs, -50);
    expect(isSilentTake(-50), isTrue);
    expect(isSilentTake(-49.9), isFalse);
    expect(isSilentTake(null), isFalse, reason: 'an unmeasured take is not called silent');
  });

  group('RecordTake', () {
    late List<FakeRecorder> recorders;
    late List<FakeRecorder> made;
    late FakeSpeech speech;

    Future<void> pump(
      WidgetTester tester, {
      bool canRecord = true,
      String? voiceLocale = 'es-ES',
      String device = 'en',
      SpeechChecker? checker,
      SpeechTarget? check,
      ValueChanged<SpeechVerdict>? onVerdict,
    }) async {
      made = [];
      speech = FakeSpeech();
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            ...await testOverrides(device: device),
            speechServiceProvider.overrideWithValue(speech),
            speechCheckerProvider.overrideWithValue(checker),
            takeRecorderFactoryProvider.overrideWithValue(
              canRecord
                  ? () {
                      final recorder = recorders.removeAt(0);
                      made.add(recorder);
                      return recorder;
                    }
                  : null,
            ),
          ],
          child: MaterialApp(
            locale: Locale(device),
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            home: Scaffold(
              body: Center(
                child: RecordTake(voiceLocale: voiceLocale, centered: true, check: check, onVerdict: onVerdict),
              ),
            ),
          ),
        ),
      );
      await tester.pump();
    }

    Future<void> tap(WidgetTester tester, String label) async {
      await tester.tap(find.bySemanticsLabel(label));
      await tester.pump();
      await tester.pump();
    }

    testWidgets('is not shown where the device cannot record (visible means usable)', (tester) async {
      recorders = [];
      await pump(tester, canRecord: false);
      expect(find.text('Record yourself'), findsNothing);
      expect(find.text('Your recording stays on this device.'), findsNothing);
    });

    testWidgets('record, stop, then hear the take next to the reference — no score anywhere', (tester) async {
      final take = FakeTake();
      recorders = [FakeRecorder(take: take)];
      await pump(tester);
      expect(find.text('Record yourself'), findsOneWidget);
      expect(find.text('Your recording stays on this device.'), findsOneWidget);

      await tap(tester, 'Record yourself');
      expect(made.single.started, isTrue);
      expect(speech.stops, 1, reason: 'the reference voice is stopped so it does not end up in the take');
      expect(find.bySemanticsLabel('Stop recording'), findsOneWidget);
      made.single.level(-20);
      await tester.pump(const Duration(milliseconds: 1200));
      expect(find.text('0:01'), findsOneWidget);

      await tap(tester, 'Stop recording');
      expect(made.single.stopped, isTrue);
      expect(made.single.disposed, isTrue, reason: 'the microphone is released as soon as the take is made');
      expect(find.text('My voice'), findsOneWidget);
      expect(find.text('Again'), findsOneWidget);
      expect(find.text('Compare: Listen, then My voice.'), findsOneWidget);
      expect(find.textContaining('%'), findsNothing);

      await tap(tester, 'Play your recording');
      expect(take.plays, 1);
      expect(find.bySemanticsLabel('Stop playing your recording'), findsOneWidget);
      take.stop();
      await tester.pump();
      expect(find.text('My voice'), findsOneWidget);
    });

    testWidgets('recording again drops the previous take', (tester) async {
      final first = FakeTake();
      recorders = [FakeRecorder(take: first), FakeRecorder(take: FakeTake())];
      await pump(tester);
      await tap(tester, 'Record yourself');
      await tap(tester, 'Stop recording');
      await tap(tester, 'Record again');
      expect(first.disposed, isTrue);
      expect(made, hasLength(2));
      expect(made.last.started, isTrue);
    });

    testWidgets('a silent take is called what it is, and offers no playback', (tester) async {
      final silent = FakeTake(peakLevelDb: -63);
      recorders = [FakeRecorder(take: silent)];
      await pump(tester);
      await tap(tester, 'Record yourself');
      await tap(tester, 'Stop recording');
      expect(find.text('I didn’t hear anything. Check your microphone and try again.'), findsOneWidget);
      expect(find.text('My voice'), findsNothing);
      expect(silent.disposed, isTrue);
      expect(find.text('Try again'), findsOneWidget);
    });

    testWidgets('a slip of the finger (under half a second) is not a take', (tester) async {
      final slip = FakeTake(duration: const Duration(milliseconds: 200));
      recorders = [FakeRecorder(take: slip)];
      await pump(tester);
      await tap(tester, 'Record yourself');
      await tap(tester, 'Stop recording');
      expect(slip.disposed, isTrue);
      expect(find.text('Record yourself'), findsOneWidget);
    });

    testWidgets('a blocked microphone is explained, and can be tried again', (tester) async {
      recorders = [FakeRecorder(failure: RecorderFailure.blocked), FakeRecorder(take: FakeTake())];
      await pump(tester);
      await tap(tester, 'Record yourself');
      expect(find.text('The microphone is blocked. Allow it for this site, then try again.'), findsOneWidget);
      expect(made.first.disposed, isTrue);
      await tap(tester, 'Try again');
      expect(made.last.started, isTrue);
      expect(find.bySemanticsLabel('Stop recording'), findsOneWidget);
    });

    testWidgets('a forgotten recording stops by itself', (tester) async {
      recorders = [FakeRecorder(take: FakeTake(duration: RecordTake.maxTake))];
      await pump(tester);
      await tap(tester, 'Record yourself');
      await tester.pump(RecordTake.maxTake);
      await tester.pump();
      expect(made.single.stopped, isTrue);
      expect(find.text('My voice'), findsOneWidget);
    });

    testWidgets('leaving the line while recording releases the microphone', (tester) async {
      recorders = [FakeRecorder(take: FakeTake())];
      await pump(tester);
      await tap(tester, 'Record yourself');
      await tester.pumpWidget(const SizedBox());
      expect(made.single.disposed, isTrue);
    });

    testWidgets('without a reference voice there is nothing to name in the comparison hint', (tester) async {
      recorders = [FakeRecorder(take: FakeTake())];
      await pump(tester, voiceLocale: null);
      await tap(tester, 'Record yourself');
      await tap(tester, 'Stop recording');
      expect(find.text('My voice'), findsOneWidget);
      expect(find.textContaining('Compare'), findsNothing);
    });

    testWidgets('in French', (tester) async {
      recorders = [FakeRecorder(take: FakeTake())];
      await pump(tester, device: 'fr');
      expect(find.text('Enregistrez-vous'), findsOneWidget);
      await tap(tester, 'Enregistrez-vous');
      await tap(tester, 'Arrêter l’enregistrement');
      expect(find.text('Comparez : Écouter, puis Ma voix.'), findsOneWidget);
    });

    group('checked by the server', () {
      const target = SpeechTarget(expressionId: 'ch:m:hola', chapterKey: 'ch', missionKey: 'm');

      testWidgets('a take is checked: understood, with what was heard, and the verdict is reported', (tester) async {
        final take = FakeTake();
        final checker = FakeChecker([const SpeechVerdict(SpeechVerdictKind.understood, heard: 'hola buenos días')])..gate = Completer<void>();
        final verdicts = <SpeechVerdict>[];
        recorders = [FakeRecorder(take: take)];
        await pump(tester, checker: checker, check: target, onVerdict: verdicts.add);
        expect(find.text('LangQuest checks what you said; the recording isn’t kept.'), findsOneWidget);
        expect(find.text('Your recording stays on this device.'), findsNothing);

        await tap(tester, 'Record yourself');
        await tap(tester, 'Stop recording');
        expect(find.text('Checking what you said…'), findsOneWidget);
        expect(checker.checked.single.$1, same(take));
        expect(checker.checked.single.$2.expressionId, 'ch:m:hola');
        expect(find.textContaining('Compare'), findsNothing, reason: 'the verdict replaces the comparison hint');

        checker.gate!.complete();
        await tester.pumpAndSettle();
        expect(find.text('Understood!'), findsOneWidget);
        expect(find.text('I heard: “hola buenos días”'), findsOneWidget);
        expect(verdicts.single.understood, isTrue);
        expect(find.text('My voice'), findsOneWidget, reason: 'the take can still be played back');
        expect(find.textContaining('%'), findsNothing, reason: 'meaning, never a score');
      });

      testWidgets('not quite: what was heard, a hint, and another try is checked again', (tester) async {
        final checker = FakeChecker([
          const SpeechVerdict(SpeechVerdictKind.notUnderstood, heard: 'ola'),
          const SpeechVerdict(SpeechVerdictKind.understood, heard: 'hola'),
        ]);
        recorders = [FakeRecorder(take: FakeTake()), FakeRecorder(take: FakeTake())];
        await pump(tester, checker: checker, check: target);
        await tap(tester, 'Record yourself');
        await tap(tester, 'Stop recording');
        await tester.pumpAndSettle();
        expect(find.text('Not quite'), findsOneWidget);
        expect(find.text('I heard: “ola”'), findsOneWidget);
        expect(find.text('Listen to the model, then try again.'), findsOneWidget);

        await tap(tester, 'Record again');
        expect(find.text('Not quite'), findsNothing, reason: 'a new take clears the old verdict');
        await tap(tester, 'Stop recording');
        await tester.pumpAndSettle();
        expect(find.text('Understood!'), findsOneWidget);
        expect(checker.checked, hasLength(2));
      });

      testWidgets('the server heard no speech: said like a silent take, no playback', (tester) async {
        final take = FakeTake();
        recorders = [FakeRecorder(take: take)];
        await pump(tester, checker: FakeChecker([const SpeechVerdict(SpeechVerdictKind.noSpeech)]), check: target);
        await tap(tester, 'Record yourself');
        await tap(tester, 'Stop recording');
        await tester.pump();
        expect(find.text('I didn’t hear anything. Check your microphone and try again.'), findsOneWidget);
        expect(find.text('My voice'), findsNothing);
        expect(take.disposed, isTrue);
      });

      testWidgets('a check that fails falls back to comparing by ear', (tester) async {
        recorders = [FakeRecorder(take: FakeTake())];
        await pump(tester, checker: FakeChecker([null]), check: target);
        await tap(tester, 'Record yourself');
        await tap(tester, 'Stop recording');
        await tester.pump();
        expect(find.text('Couldn’t check this take. Compare: Listen, then My voice.'), findsOneWidget);
        expect(find.text('Understood!'), findsNothing);
      });

      testWidgets('a silent take is never sent; a line without a target is never checked', (tester) async {
        final checker = FakeChecker([]);
        recorders = [FakeRecorder(take: FakeTake(peakLevelDb: -70)), FakeRecorder(take: FakeTake())];
        await pump(tester, checker: checker, check: target);
        await tap(tester, 'Record yourself');
        await tap(tester, 'Stop recording');
        expect(checker.checked, isEmpty);
        await tester.pumpWidget(const SizedBox());

        recorders = [FakeRecorder(take: FakeTake())];
        await pump(tester, checker: checker);
        expect(find.text('Your recording stays on this device.'), findsOneWidget);
        await tap(tester, 'Record yourself');
        await tap(tester, 'Stop recording');
        expect(checker.checked, isEmpty);
        expect(find.text('Compare: Listen, then My voice.'), findsOneWidget);
      });

      testWidgets('an account that keeps recordings says so', (tester) async {
        recorders = [];
        await pump(tester, checker: FakeChecker([], keepsRecordings: true), check: target);
        expect(find.text('LangQuest checks what you said; recordings are kept as your privacy settings allow.'), findsOneWidget);
      });

      testWidgets('in French', (tester) async {
        recorders = [FakeRecorder(take: FakeTake())];
        await pump(
          tester,
          device: 'fr',
          checker: FakeChecker([const SpeechVerdict(SpeechVerdictKind.notUnderstood, heard: 'ola')]),
          check: target,
        );
        await tap(tester, 'Enregistrez-vous');
        await tap(tester, 'Arrêter l’enregistrement');
        await tester.pumpAndSettle();
        expect(find.text('Pas tout à fait'), findsOneWidget);
        expect(find.text('J’ai entendu : « ola »'), findsOneWidget);
      });
    });
  });
}
