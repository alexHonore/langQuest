// Reads the content bundle from disk (dart:io): VM only.
@TestOn('vm')
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:langquest_mobile/core/audio/take_recorder.dart';
import 'package:langquest_mobile/core/services/speech_service.dart';
import 'package:langquest_mobile/features/learn/record_take.dart';
import 'package:langquest_mobile/l10n/l10n.dart';

import 'support.dart';

class FakeTake implements RecordedTake {
  FakeTake({this.duration = const Duration(seconds: 2), this.peakLevelDb = -14});

  @override
  final Duration duration;
  @override
  final double? peakLevelDb;
  int plays = 0;
  bool disposed = false;
  Completer<void>? _playing;

  @override
  Future<void> play() {
    plays++;
    _playing = Completer<void>();
    return _playing!.future;
  }

  @override
  void stop() {
    if (_playing != null && !_playing!.isCompleted) _playing!.complete();
  }

  @override
  void dispose() {
    disposed = true;
    stop();
  }
}

class FakeRecorder implements TakeRecorder {
  FakeRecorder({this.failure, this.take});

  final RecorderFailure? failure;
  final RecordedTake? take;
  final _levels = StreamController<double>.broadcast();
  bool started = false;
  bool stopped = false;
  bool disposed = false;

  void level(double dbfs) => _levels.add(dbfs);

  @override
  Future<void> start() async {
    if (failure != null) throw RecorderException(failure!);
    started = true;
  }

  @override
  Stream<double> get levels => _levels.stream;

  @override
  Future<RecordedTake?> stop() async {
    stopped = true;
    return take;
  }

  @override
  Future<void> dispose() async {
    disposed = true;
    await _levels.close();
  }
}

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

    Future<void> pump(WidgetTester tester, {bool canRecord = true, String? voiceLocale = 'es-ES', String device = 'en'}) async {
      made = [];
      speech = FakeSpeech();
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            ...await testOverrides(device: device),
            speechServiceProvider.overrideWithValue(speech),
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
              body: Center(child: RecordTake(voiceLocale: voiceLocale, centered: true)),
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
  });
}
