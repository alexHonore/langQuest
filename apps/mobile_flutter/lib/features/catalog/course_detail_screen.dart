import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../navigation/nav.dart';
import '../../core/backend/account.dart';
import '../../core/services/app_state.dart';
import '../../core/theme/accents.dart';
import '../../core/theme/glass.dart';
import '../../core/theme/script_fonts.dart';
import '../../l10n/l10n.dart';
import '../learn/learn_widgets.dart';

/// One course before enrolling (CONVENTIONS §8 disclosure): what it includes from the chosen instruction
/// language, and what it does not have yet — the draft status first. Learners only enroll where content exists.
/// What an account adds (live calls, spoken answers checked) is listed only when the server offers it for this course
/// (`GET /v1/courses`); offline, those stay under "not yet".
class CourseDetailScreen extends ConsumerStatefulWidget {
  final String trackId;
  const CourseDetailScreen({super.key, required this.trackId});

  @override
  ConsumerState<CourseDetailScreen> createState() => _CourseDetailScreenState();
}

class _CourseDetailScreenState extends ConsumerState<CourseDetailScreen> {
  String? _source;

  @override
  Widget build(BuildContext context) {
    final appState = ref.watch(appStateProvider);
    final colors = appState.colors;
    final l10n = context.l10n;
    final track = appState.content.track(widget.trackId);
    if (track == null) return const MissionUnavailable();
    final ui = appState.uiLanguage;
    final accent = CourseAccent.forTrack(track, isDark: appState.isDark);
    final sources = appState.content.sourcesFor(track.id);
    final source = _source != null && sources.contains(_source) ? _source! : defaultSourceFor(sources, ui);
    final course = source == null ? null : appState.content.course(track.id, source);
    final enrolled = source != null && appState.learner.isEnrolled(track.id, source);
    final offer = source == null ? null : ref.watch(serverOffersProvider(source)).asData?.value[track.id];
    final liveCalls = offer?.liveCalls ?? false;
    final spokenCheck = offer?.spokenCheck ?? false;
    // A dialect without a device voice (Darija): the server's recognizer and voices are rated "limited" for it too.
    final dialect = track.voiceLocale == null;

    Widget bullet(IconData icon, Color color, String text) => Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.only(top: 1),
            child: Icon(icon, size: 17, color: color),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Text(text, style: TextStyle(fontSize: 14, height: 1.35, color: colors.textPrimary)),
          ),
        ],
      ),
    );

    return Scaffold(
      backgroundColor: colors.background,
      body: SafeArea(
        child: Column(
          children: [
            Expanded(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
                children: [
                  Row(
                    children: [
                      IconButton(
                        icon: Icon(LucideIcons.arrowLeft, color: colors.textPrimary),
                        tooltip: l10n.back,
                        onPressed: () => context.popOrHome(),
                      ),
                    ],
                  ),
                  Container(
                    height: 120,
                    decoration: BoxDecoration(
                      gradient: LinearGradient(
                        colors: [accent.primary, accent.lantern[1], accent.lantern[2]],
                        begin: Alignment.topLeft,
                        end: Alignment.bottomRight,
                      ),
                      borderRadius: BorderRadius.circular(24),
                    ),
                    alignment: Alignment.bottomLeft,
                    padding: const EdgeInsets.all(18),
                    child: Text(
                      track.nativeName,
                      textDirection: track.rtl ? TextDirection.rtl : TextDirection.ltr,
                      style: TextStyle(
                        fontSize: 26,
                        fontWeight: FontWeight.w800,
                        color: CourseAccent.readableOn(accent.primary),
                        fontFamilyFallback: fontFallbackFor(track),
                      ),
                    ),
                  ),
                  const SizedBox(height: 16),
                  Semantics(
                    header: true,
                    child: Text(
                      track.name(ui),
                      style: TextStyle(fontSize: 24, fontWeight: FontWeight.w800, color: colors.textPrimary),
                    ),
                  ),
                  if (ui == 'en' && track.teachingFocus.isNotEmpty) ...[
                    // The catalog's teaching focus exists in English only; never shown inside a French interface.
                    const SizedBox(height: 6),
                    Text(track.teachingFocus, style: TextStyle(fontSize: 14, height: 1.4, color: colors.textSecondary)),
                  ],
                  const SizedBox(height: 18),
                  if (course == null)
                    GlassContainer(
                      level: GlassLevel.level1,
                      radius: 18,
                      padding: const EdgeInsets.all(16),
                      child: Row(
                        children: [
                          Icon(LucideIcons.calendarDays, color: colors.textMuted),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Text(
                              l10n.coursePlanned,
                              style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: colors.textPrimary),
                            ),
                          ),
                        ],
                      ),
                    )
                  else ...[
                    if (sources.length > 1) ...[
                      Text(
                        l10n.courseLearnFrom,
                        style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: colors.textSecondary),
                      ),
                      const SizedBox(height: 8),
                      Wrap(
                        spacing: 8,
                        children: [
                          for (final s in sources)
                            ChoiceChip(label: Text(s == 'en' ? 'English' : 'Français'), selected: s == source, onSelected: (_) => setState(() => _source = s)),
                        ],
                      ),
                      const SizedBox(height: 16),
                    ] else ...[
                      Text(
                        l10n.courseExplanationsIn(l10n.languageName(source!)),
                        style: TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600, color: colors.textSecondary),
                      ),
                      const SizedBox(height: 16),
                    ],
                    GlassContainer(
                      level: GlassLevel.level1,
                      radius: 18,
                      padding: const EdgeInsets.all(16),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            l10n.courseIncludesTitle,
                            style: TextStyle(fontSize: 15, fontWeight: FontWeight.w800, color: colors.textPrimary),
                          ),
                          const SizedBox(height: 12),
                          bullet(LucideIcons.check, colors.success, l10n.courseIncludesMissions(course.missions.length)),
                          bullet(LucideIcons.check, colors.success, l10n.courseIncludesLearn),
                          bullet(LucideIcons.check, colors.success, l10n.courseIncludesReview),
                          if (track.voiceLocale != null) bullet(LucideIcons.check, colors.success, l10n.courseIncludesVoice),
                          if (liveCalls) bullet(LucideIcons.phoneCall, colors.success, l10n.courseIncludesLiveCalls(offer!.characters)),
                          if (spokenCheck) bullet(LucideIcons.mic, colors.success, l10n.courseIncludesSpokenCheck),
                        ],
                      ),
                    ),
                    const SizedBox(height: 12),
                    GlassContainer(
                      level: GlassLevel.level1,
                      radius: 18,
                      padding: const EdgeInsets.all(16),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            l10n.courseMissingTitle,
                            style: TextStyle(fontSize: 15, fontWeight: FontWeight.w800, color: colors.textPrimary),
                          ),
                          const SizedBox(height: 12),
                          if (course.isDraft) bullet(LucideIcons.triangleAlert, colors.warning, l10n.courseMissingNativeReview),
                          if (dialect && (liveCalls || spokenCheck)) bullet(LucideIcons.triangleAlert, colors.warning, l10n.courseLimitedForDialect),
                          if (track.voiceLocale == null) bullet(LucideIcons.minus, colors.textMuted, l10n.courseMissingVoiceDialect),
                          if (!liveCalls) bullet(LucideIcons.minus, colors.textMuted, l10n.courseMissingConversation),
                          bullet(LucideIcons.minus, colors.textMuted, spokenCheck ? l10n.courseMissingPronunciationScore : l10n.courseMissingPronunciation),
                          bullet(LucideIcons.minus, colors.textMuted, l10n.courseMissingAudio),
                        ],
                      ),
                    ),
                  ],
                ],
              ),
            ),
            if (course != null)
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 4, 16, 12),
                child: LearnPrimaryButton(
                  label: enrolled ? l10n.courseContinue : l10n.courseStart,
                  icon: LucideIcons.chevronRight,
                  onPressed: () {
                    final notifier = ref.read(appStateProvider.notifier);
                    // The very first course ends the first run with a warm-up phrase; later ones open Home.
                    final firstCourse = !ref.read(appStateProvider).hasEnrollment;
                    if (enrolled) {
                      notifier.switchCourse(course.id);
                    } else {
                      notifier.enroll(track.id, course.source);
                    }
                    context.go(firstCourse ? '/warmup' : '/');
                  },
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// The instruction language preselected for a course: the interface language when the course is taught from it,
/// else the first one it is taught from (null for a planned course).
String? defaultSourceFor(List<String> sources, String uiLanguage) => sources.contains(uiLanguage) ? uiLanguage : (sources.isEmpty ? null : sources.first);
