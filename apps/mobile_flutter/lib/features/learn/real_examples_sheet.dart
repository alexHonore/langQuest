import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../core/audio/clip_player.dart';
import '../../core/audio/clip_player_provider.dart';
import '../../core/content/content_bundle.dart';
import '../../core/content/content_source.dart';
import '../../core/content/content_models.dart';
import '../../core/content/real_examples.dart';
import '../../core/services/app_state.dart';
import '../../core/services/speech_service.dart';
import '../../core/theme/script_fonts.dart';
import '../../l10n/l10n.dart';
import 'learn_widgets.dart';

/// "Real examples" under a phrase: sentences by Tatoeba contributors that use it (with their translation in the
/// learner's instruction language), whether the phrase itself is a Tatoeba sentence, and native recordings whose own
/// license allows it. Rendered only when Tatoeba has something for the phrase that the learner can read.
class RealExamplesButton extends ConsumerWidget {
  const RealExamplesButton({super.key, required this.expression, required this.track, required this.source, this.padding = const EdgeInsets.only(top: 10)});

  /// Around the button (nothing is laid out when there is no button).
  final EdgeInsets padding;

  final Expression expression;
  final CourseTrackInfo track;

  /// The learner's instruction language.
  final String source;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final found = ref.watch(contentBundleProvider).examples.of(expression.id);
    if (found == null || (found.attested == null && found.readableIn(source).isEmpty)) return const SizedBox.shrink();
    final l10n = context.l10n;
    return Padding(
      padding: padding,
      child: AudioChip(
        icon: LucideIcons.quote,
        label: l10n.realExamplesButton,
        semanticsLabel: l10n.realExamplesButtonSemantics,
        compact: true,
        onTap: () => showModalBottomSheet<void>(
          context: context,
          isScrollControlled: true,
          showDragHandle: true,
          backgroundColor: ref.read(appStateProvider).colors.surface,
          builder: (_) => RealExamplesSheet(expression: expression, track: track, source: source, found: found),
        ),
      ),
    );
  }
}

class RealExamplesSheet extends ConsumerStatefulWidget {
  const RealExamplesSheet({super.key, required this.expression, required this.track, required this.source, required this.found});

  final Expression expression;
  final CourseTrackInfo track;
  final String source;
  final PhraseExamples found;

  @override
  ConsumerState<RealExamplesSheet> createState() => _RealExamplesSheetState();
}

class _RealExamplesSheetState extends ConsumerState<RealExamplesSheet> {
  ClipPlayer? _player;
  String? _playing;

  @override
  void initState() {
    super.initState();
    // The course's voice stops: one voice at a time.
    ref.read(speechServiceProvider).stop();
  }

  @override
  void dispose() {
    _player?.dispose();
    super.dispose();
  }

  Future<void> _play(ExampleRecording recording) async {
    final make = ref.read(clipPlayerFactoryProvider);
    if (make == null) return;
    final player = _player ??= make();
    player
      ..prime()
      ..stop();
    setState(() => _playing = recording.id);
    // Fetched from the content bucket when played (the browser keeps it).
    await player.play(ref.read(contentLocationProvider).clip(recording.asset).toString());
    if (mounted && _playing == recording.id) setState(() => _playing = null);
  }

  @override
  Widget build(BuildContext context) {
    final appState = ref.watch(appStateProvider);
    final colors = appState.colors;
    final accent = appState.accent;
    final l10n = context.l10n;
    final bundle = ref.watch(contentBundleProvider);
    final canPlay = ref.watch(clipPlayerFactoryProvider) != null;
    final examples = widget.found.readableIn(widget.source);
    final attested = widget.found.attested;
    final textStyle = TextStyle(
      fontSize: 18,
      fontWeight: FontWeight.w700,
      height: 1.35,
      color: colors.textPrimary,
      fontFamilyFallback: fontFallbackFor(widget.track),
    );
    final note = TextStyle(fontSize: 12, height: 1.35, color: colors.textMuted);

    Widget recordingButton(ExampleRecording r) => Padding(
      padding: const EdgeInsets.only(top: 8),
      child: Wrap(
        crossAxisAlignment: WrapCrossAlignment.center,
        spacing: 8,
        runSpacing: 4,
        children: [
          AudioChip(
            icon: _playing == r.id ? LucideIcons.audioLines : LucideIcons.play,
            label: l10n.realExamplesRecording,
            semanticsLabel: l10n.realExamplesRecordingSemantics,
            compact: true,
            onTap: () => _play(r),
          ),
          Text(l10n.realExamplesRecordingBy(r.author ?? 'Tatoeba', r.license), style: note),
        ],
      ),
    );

    Widget example(RealExample e) => Semantics(
      container: true,
      child: Container(
        width: double.infinity,
        margin: const EdgeInsets.only(bottom: 10),
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(color: colors.surfaceMuted, borderRadius: BorderRadius.circular(16)),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Semantics(
              localeForSubtree: contentLanguageOf(widget.track),
              child: Text(
                e.text,
                locale: contentLocaleOf(widget.track),
                textDirection: widget.track.rtl ? TextDirection.rtl : TextDirection.ltr,
                style: textStyle,
              ),
            ),
            if (e.translationIn(widget.source) case final t?) ...[
              const SizedBox(height: 4),
              Text(t, style: TextStyle(fontSize: 14.5, height: 1.35, color: colors.textSecondary)),
            ],
            const SizedBox(height: 6),
            Text(e.author == null ? l10n.realExamplesById(e.id) : l10n.realExamplesBy(e.id, e.author!), style: note),
            if (canPlay && e.recording != null) recordingButton(e.recording!),
          ],
        ),
      ),
    );

    return SafeArea(
      child: ConstrainedBox(
        constraints: BoxConstraints(maxHeight: MediaQuery.sizeOf(context).height * 0.8),
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Semantics(
                header: true,
                child: Text(
                  l10n.realExamplesTitle,
                  style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800, color: colors.textPrimary),
                ),
              ),
              const SizedBox(height: 4),
              Text(l10n.realExamplesIntro(widget.expression.text), style: TextStyle(fontSize: 14, height: 1.4, color: colors.textSecondary)),
              const SizedBox(height: 14),
              if (attested != null)
                Semantics(
                  container: true,
                  child: Container(
                    width: double.infinity,
                    margin: const EdgeInsets.only(bottom: 12),
                    padding: const EdgeInsets.all(14),
                    decoration: BoxDecoration(
                      color: accent.primarySoft,
                      borderRadius: BorderRadius.circular(16),
                      border: Border.all(color: accent.primary.withValues(alpha: 0.4)),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Icon(LucideIcons.badgeCheck, size: 18, color: accent.primaryText),
                            const SizedBox(width: 8),
                            Expanded(
                              child: Text(
                                l10n.realExamplesAttested(widget.expression.text),
                                style: TextStyle(fontSize: 14, height: 1.35, fontWeight: FontWeight.w600, color: colors.textPrimary),
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 6),
                        Text(attested.author == null ? l10n.realExamplesById(attested.id) : l10n.realExamplesBy(attested.id, attested.author!), style: note),
                        if (canPlay && attested.recording != null) recordingButton(attested.recording!),
                      ],
                    ),
                  ),
                ),
              for (final e in examples) example(e),
              if (bundle.examples.untaggedVariety.contains(widget.track.id)) ...[const SizedBox(height: 4), Text(l10n.realExamplesRegion, style: note)],
              const SizedBox(height: 10),
              Text(l10n.realExamplesCredit(bundle.examples.textLicense, bundle.examples.snapshot), style: note),
            ],
          ),
        ),
      ),
    );
  }
}
