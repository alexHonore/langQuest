import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../core/backend/server_skills.dart';
import '../../core/content/content_bundle.dart';
import '../../core/learning/srs.dart';
import '../../core/services/app_state.dart';
import '../../core/services/learner_state.dart';
import '../../core/services/speaking_stats.dart';
import '../../core/theme/glass.dart';
import '../../l10n/l10n.dart';
import '../audio/audio_screens.dart';
import '../learn/learn_content.dart';
import '../learn/learn_logic.dart';

/// Progress shows only what was measured: XP (practice, never proficiency), active days, missions completed, phrases
/// met and how firmly the review schedule holds them, and — once there is any — what was done out loud: takes the
/// server understood, live calls, audio lessons heard. For a course on the learner's account, "What you can do" lists
/// the skills the server has evidence for, on its mastery ladder. No invented word counts or levels.
class ProgressScreen extends ConsumerWidget {
  const ProgressScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final appState = ref.watch(appStateProvider);
    final course = appState.activeCourse;
    if (course == null) return const SizedBox.shrink();
    final accent = appState.accent;
    final colors = appState.colors;
    final l10n = context.l10n;
    final now = ref.watch(clockProvider)();
    final content = ref.watch(contentBundleProvider);
    final progress = appState.progress;
    final streak = appState.streak(now);
    final missionsDone = course.missions.where((m) => progress.isMissionCompleted(m.key)).length;
    final met = <String>{
      for (final m in course.missions)
        if (progress.stopsDone(m.key).contains(PathStop.learn))
          for (final e in buildLearnPlan(mission: m, track: course.track, source: course.source, character: content.characterOf(m)).phrases) e.id,
    };
    final cards = progress.cards.values.toList();
    int count(PhraseStrength s) => cards.where((c) => strengthOf(c) == s).length;
    // On a new device the server may already know what the learner can do: then Progress is not "empty".
    final measured = ref.watch(skillsEnrollmentProvider) != null && (ref.watch(serverSkillsProvider).value?.isNotEmpty ?? false);
    final hasActivity = appState.learner.xpTotal > 0 || cards.isNotEmpty || met.isNotEmpty || measured;
    final speaking = ref.watch(speakingStatsProvider)[course.id] ?? const SpeakingStat();
    final lessons = ref.watch(audioListenedProvider)[course.id]?.length ?? 0;

    return Scaffold(
      backgroundColor: colors.background,
      body: Stack(
        children: [
          Positioned(
            top: 60,
            left: -40,
            child: IgnorePointer(
              child: Container(
                width: 260,
                height: 260,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: accent.primary.withValues(alpha: appState.isDark ? 0.12 : 0.07),
                ),
              ),
            ),
          ),
          SafeArea(
            bottom: false,
            child: ListView(
              padding: const EdgeInsets.fromLTRB(20, 16, 20, 110),
              children: [
                Text(
                  course.track.name(appState.uiLanguage).toUpperCase(),
                  style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, letterSpacing: 1.2, color: accent.primaryText),
                ),
                const SizedBox(height: 6),
                Semantics(
                  header: true,
                  child: Text(
                    l10n.progressTitle,
                    style: TextStyle(fontSize: 24, fontWeight: FontWeight.w800, color: colors.textPrimary),
                  ),
                ),
                if (!hasActivity) ...[const SizedBox(height: 8), Text(l10n.progressEmpty, style: TextStyle(fontSize: 14, color: colors.textSecondary))],
                const SizedBox(height: 16),
                Row(
                  children: [
                    Expanded(
                      child: _StatTile(icon: LucideIcons.sparkles, iconColor: colors.amber, label: l10n.xpLabel, value: '${appState.learner.xpTotal}'),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: _StatTile(
                        icon: LucideIcons.flame,
                        iconColor: colors.amber,
                        label: l10n.streakTitle,
                        value: '$streak',
                        caption: streak > 0 ? l10n.streakDays(streak) : l10n.streakPaused,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                Text(l10n.xpNote, style: TextStyle(fontSize: 12, color: colors.textMuted)),
                const SizedBox(height: 16),
                _WeekCard(xpByDay: appState.learner.xpByDay, now: now),
                const _CanDoCard(),
                const SizedBox(height: 14),
                GlassContainer(
                  level: GlassLevel.level1,
                  radius: 20,
                  padding: const EdgeInsets.all(18),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              l10n.missionsDoneTitle,
                              style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: colors.textPrimary),
                            ),
                          ),
                          Text(
                            l10n.countOfTotal(missionsDone, course.missions.length),
                            style: TextStyle(fontSize: 13.5, fontWeight: FontWeight.w700, color: accent.primaryText),
                          ),
                        ],
                      ),
                      const SizedBox(height: 10),
                      _Bar(fraction: course.missions.isEmpty ? 0 : missionsDone / course.missions.length, color: accent.primary),
                    ],
                  ),
                ),
                const SizedBox(height: 14),
                GlassContainer(
                  level: GlassLevel.level1,
                  radius: 20,
                  padding: const EdgeInsets.all(18),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        l10n.phrasesTitle,
                        style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: colors.textPrimary),
                      ),
                      const SizedBox(height: 12),
                      _CountRow(label: l10n.phrasesMet, value: met.length),
                      _CountRow(label: l10n.phrasesInReview, value: cards.length),
                      if (cards.isNotEmpty) ...[
                        const SizedBox(height: 10),
                        _StrengthRow(label: l10n.strengthLearning, value: count(PhraseStrength.learning), total: cards.length, color: colors.amber),
                        _StrengthRow(label: l10n.strengthYoung, value: count(PhraseStrength.young), total: cards.length, color: colors.cyan),
                        _StrengthRow(label: l10n.strengthSolid, value: count(PhraseStrength.solid), total: cards.length, color: colors.success),
                        const SizedBox(height: 6),
                        Text(l10n.strengthNote, style: TextStyle(fontSize: 12, color: colors.textMuted)),
                      ],
                    ],
                  ),
                ),
                // Out loud: what the server judged and the calls made, as measured on this device.
                if (speaking.checked > 0 || speaking.calls > 0 || lessons > 0) ...[
                  const SizedBox(height: 14),
                  GlassContainer(
                    level: GlassLevel.level1,
                    radius: 20,
                    padding: const EdgeInsets.all(18),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          l10n.progressSpeakingTitle,
                          style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: colors.textPrimary),
                        ),
                        const SizedBox(height: 12),
                        if (speaking.checked > 0) ...[
                          _TextRow(label: l10n.progressUnderstood, value: l10n.countOfTotal(speaking.understood, speaking.checked)),
                          Padding(
                            padding: const EdgeInsets.only(bottom: 8),
                            child: _Bar(fraction: speaking.understood / speaking.checked, color: colors.success),
                          ),
                        ],
                        if (speaking.calls > 0)
                          _TextRow(label: l10n.progressCalls, value: l10n.progressCallsValue(speaking.calls, math.max(1, (speaking.seconds / 60).ceil()))),
                        if (lessons > 0) _CountRow(label: l10n.progressLessons, value: lessons),
                      ],
                    ),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// "What you can do": the skills the server measured for the active course, strongest first, each on the four-step
/// mastery ladder (emerging → practised → independent → durable) with the number of observations behind it. Shown
/// only for a course on the learner's account; nothing while signed out.
class _CanDoCard extends ConsumerStatefulWidget {
  const _CanDoCard();

  @override
  ConsumerState<_CanDoCard> createState() => _CanDoCardState();
}

class _CanDoCardState extends ConsumerState<_CanDoCard> {
  var _explained = false;

  static String levelOf(AppLocalizations l10n, Mastery m) => switch (m) {
    Mastery.notAttempted => '',
    Mastery.emerging => l10n.masteryEmerging,
    Mastery.practiced => l10n.masteryPracticed,
    Mastery.independent => l10n.masteryIndependent,
    Mastery.durable => l10n.masteryDurable,
  };

  static String hintOf(AppLocalizations l10n, Mastery m) => switch (m) {
    Mastery.notAttempted => '',
    Mastery.emerging => l10n.masteryHintEmerging,
    Mastery.practiced => l10n.masteryHintPracticed,
    Mastery.independent => l10n.masteryHintIndependent,
    Mastery.durable => l10n.masteryHintDurable,
  };

  @override
  Widget build(BuildContext context) {
    // Signed out, or a course not on the account: nothing to show (no empty card, no loading row).
    if (ref.watch(skillsEnrollmentProvider) == null) return const SizedBox.shrink();
    final skills = ref.watch(serverSkillsProvider);
    final appState = ref.watch(appStateProvider);
    final colors = appState.colors;
    final accent = appState.accent;
    final l10n = context.l10n;
    final content = ref.watch(contentBundleProvider);
    final language = appState.uiLanguage;
    final muted = TextStyle(fontSize: 13, height: 1.4, color: colors.textMuted);

    final list = skills.value;
    final List<Widget> body;
    if (list != null) {
      body = list.isEmpty
          ? [Text(l10n.progressCanDoEmpty, style: muted)]
          : [
              for (final skill in list)
                _SkillRow(
                  name: content.skill(skill.key)?.name(language) ?? skill.key,
                  cefr: content.skill(skill.key)?.cefr ?? '',
                  level: levelOf(l10n, skill.mastery),
                  step: skill.step,
                  evidence: l10n.progressEvidenceCount(skill.evidence),
                ),
            ];
    } else if (skills.hasError && (!skills.isLoading || skills.retrying)) {
      // Failed: said at once, while the provider keeps retrying on its own; Try again reloads now.
      body = [
        Text(l10n.progressCanDoFailed, style: muted),
        Align(
          alignment: AlignmentDirectional.centerStart,
          child: TextButton(
            onPressed: () => ref.invalidate(serverSkillsProvider),
            child: Text(
              l10n.callTryAgain,
              style: TextStyle(fontWeight: FontWeight.w700, color: accent.primaryText),
            ),
          ),
        ),
      ];
    } else {
      body = [
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 12),
          child: Center(
            child: SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.5, color: colors.textMuted)),
          ),
        ),
      ];
    }

    return Padding(
      padding: const EdgeInsets.only(top: 14),
      child: GlassContainer(
        level: GlassLevel.level1,
        radius: 20,
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Semantics(
              container: true,
              header: true,
              child: Text(
                l10n.progressCanDoTitle,
                style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: colors.textPrimary),
              ),
            ),
            const SizedBox(height: 4),
            Text(l10n.progressCanDoNote, style: TextStyle(fontSize: 12.5, height: 1.4, color: colors.textSecondary)),
            const SizedBox(height: 12),
            ...body,
            if (skills.value?.isNotEmpty ?? false) ...[
              const SizedBox(height: 2),
              Semantics(
                container: true,
                button: true,
                expanded: _explained,
                child: InkWell(
                  borderRadius: BorderRadius.circular(10),
                  onTap: () => setState(() => _explained = !_explained),
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(minHeight: 44),
                    child: Row(
                      children: [
                        Expanded(
                          child: Text(
                            l10n.progressHowMeasured,
                            style: TextStyle(fontSize: 13.5, fontWeight: FontWeight.w700, color: accent.primaryText),
                          ),
                        ),
                        Icon(_explained ? LucideIcons.chevronUp : LucideIcons.chevronDown, size: 18, color: accent.primaryText),
                      ],
                    ),
                  ),
                ),
              ),
              if (_explained) ...[
                for (final m in Mastery.values.skip(1))
                  Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Padding(
                          padding: const EdgeInsets.only(top: 3),
                          child: _Ladder(step: m.index),
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Text.rich(
                            TextSpan(
                              children: [
                                TextSpan(
                                  text: '${levelOf(l10n, m)} · ',
                                  style: TextStyle(fontWeight: FontWeight.w700, color: colors.textPrimary),
                                ),
                                TextSpan(text: hintOf(l10n, m)),
                              ],
                            ),
                            style: TextStyle(fontSize: 13, height: 1.4, color: colors.textSecondary),
                          ),
                        ),
                      ],
                    ),
                  ),
                Text(l10n.progressHowMeasuredNote, style: muted),
              ],
            ],
          ],
        ),
      ),
    );
  }
}

/// One skill: its name and CEFR band, then the ladder, the level and the evidence. One semantics node.
class _SkillRow extends ConsumerWidget {
  const _SkillRow({required this.name, required this.cefr, required this.level, required this.step, required this.evidence});

  final String name;
  final String cefr;
  final String level;
  final int step;
  final String evidence;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final appState = ref.watch(appStateProvider);
    final colors = appState.colors;
    // Its own node (the card is one list item, which would otherwise merge every row into one label).
    return Semantics(
      container: true,
      label: context.l10n.progressSkillLabel(name, level, step, evidence),
      excludeSemantics: true,
      child: Padding(
        padding: const EdgeInsets.only(bottom: 12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Text(
                    name,
                    style: TextStyle(fontSize: 14.5, fontWeight: FontWeight.w700, height: 1.3, color: colors.textPrimary),
                  ),
                ),
                if (cefr.isNotEmpty) ...[
                  const SizedBox(width: 8),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(6),
                      border: Border.all(color: colors.border),
                    ),
                    child: Text(
                      cefr,
                      style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: colors.textMuted),
                    ),
                  ),
                ],
              ],
            ),
            const SizedBox(height: 6),
            Row(
              children: [
                _Ladder(step: step),
                const SizedBox(width: 10),
                Flexible(
                  child: Text('$level · $evidence', style: TextStyle(fontSize: 12.5, color: colors.textSecondary)),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

/// Four segments, the first [step] lit: emerging, practised, independent, durable.
class _Ladder extends ConsumerWidget {
  const _Ladder({required this.step});

  final int step;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final appState = ref.watch(appStateProvider);
    final colors = appState.colors;
    final lit = [colors.amber, colors.cyan, colors.success, colors.success];
    return ExcludeSemantics(
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          for (var i = 0; i < 4; i++)
            Container(
              width: 16,
              height: 6,
              margin: EdgeInsetsDirectional.only(end: i == 3 ? 0 : 3),
              decoration: BoxDecoration(borderRadius: BorderRadius.circular(3), color: i < step ? lit[step - 1] : colors.surfaceMuted),
            ),
        ],
      ),
    );
  }
}

class _StatTile extends ConsumerWidget {
  final IconData icon;
  final Color iconColor;
  final String label;
  final String value;
  final String? caption;
  const _StatTile({required this.icon, required this.iconColor, required this.label, required this.value, this.caption});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colors = ref.watch(appStateProvider.select((s) => s.colors));
    return GlassContainer(
      level: GlassLevel.level2,
      radius: 20,
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, size: 16, color: iconColor),
              const SizedBox(width: 6),
              Text(
                label.toUpperCase(),
                style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: colors.textMuted),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            value,
            style: TextStyle(fontSize: 26, fontWeight: FontWeight.w800, color: colors.textPrimary),
          ),
          if (caption != null) Text(caption!, maxLines: 2, style: TextStyle(fontSize: 12, color: colors.textSecondary)),
        ],
      ),
    );
  }
}

class _WeekCard extends ConsumerWidget {
  final Map<String, int> xpByDay;
  final DateTime now;
  const _WeekCard({required this.xpByDay, required this.now});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colors = ref.watch(appStateProvider.select((s) => s.colors));
    final l10n = context.l10n;
    final locale = Localizations.localeOf(context).toLanguageTag();
    final today = DateTime(now.toLocal().year, now.toLocal().month, now.toLocal().day);
    final monday = today.subtract(Duration(days: today.weekday - DateTime.monday));
    final days = [for (var i = 0; i < 7; i++) DateTime(monday.year, monday.month, monday.day + i)];
    return GlassContainer(
      level: GlassLevel.level1,
      radius: 20,
      padding: const EdgeInsets.all(18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            l10n.thisWeek,
            style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: colors.textPrimary),
          ),
          const SizedBox(height: 14),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              for (final d in days)
                Flexible(
                  child: Builder(
                    builder: (context) {
                      final active = (xpByDay[dayKey(d)] ?? 0) > 0;
                      final isToday = d == today;
                      final label = DateFormat.E(locale).format(d);
                      return Semantics(
                        label: '${DateFormat.MMMMEEEEd(locale).format(d)}${active ? ' ✓' : ''}',
                        excludeSemantics: true,
                        child: Column(
                          children: [
                            Container(
                              width: 34,
                              height: 34,
                              decoration: BoxDecoration(
                                shape: BoxShape.circle,
                                color: active ? colors.amber : colors.surfaceMuted,
                                border: isToday ? Border.all(color: colors.amberText, width: 2) : null,
                              ),
                              child: Icon(active ? LucideIcons.check : LucideIcons.circle, size: 15, color: active ? colors.onAmber : colors.textMuted),
                            ),
                            const SizedBox(height: 6),
                            // Large text sizes: the day's name shrinks to fit its seventh of the row.
                            FittedBox(
                              fit: BoxFit.scaleDown,
                              child: Text(
                                label,
                                style: TextStyle(
                                  fontSize: 11,
                                  fontWeight: isToday ? FontWeight.w700 : FontWeight.w500,
                                  color: isToday ? colors.textPrimary : colors.textMuted,
                                ),
                              ),
                            ),
                          ],
                        ),
                      );
                    },
                  ),
                ),
            ],
          ),
        ],
      ),
    );
  }
}

class _Bar extends ConsumerWidget {
  final double fraction;
  final Color color;
  const _Bar({required this.fraction, required this.color});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colors = ref.watch(appStateProvider.select((s) => s.colors));
    return ClipRRect(
      borderRadius: BorderRadius.circular(4),
      child: LinearProgressIndicator(
        value: fraction.clamp(0.0, 1.0),
        minHeight: 6,
        backgroundColor: colors.surfaceMuted,
        valueColor: AlwaysStoppedAnimation<Color>(color),
      ),
    );
  }
}

class _CountRow extends ConsumerWidget {
  final String label;
  final int value;
  const _CountRow({required this.label, required this.value});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colors = ref.watch(appStateProvider.select((s) => s.colors));
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Row(
        children: [
          Expanded(
            child: Text(label, style: TextStyle(fontSize: 13.5, color: colors.textSecondary)),
          ),
          Text(
            '$value',
            style: TextStyle(fontSize: 15, fontWeight: FontWeight.w800, color: colors.textPrimary),
          ),
        ],
      ),
    );
  }
}

class _TextRow extends ConsumerWidget {
  final String label;
  final String value;
  const _TextRow({required this.label, required this.value});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colors = ref.watch(appStateProvider.select((s) => s.colors));
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Row(
        children: [
          Expanded(
            child: Text(label, style: TextStyle(fontSize: 13.5, color: colors.textSecondary)),
          ),
          Text(
            value,
            style: TextStyle(fontSize: 15, fontWeight: FontWeight.w800, color: colors.textPrimary),
          ),
        ],
      ),
    );
  }
}

class _StrengthRow extends ConsumerWidget {
  final String label;
  final int value;
  final int total;
  final Color color;
  const _StrengthRow({required this.label, required this.value, required this.total, required this.color});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colors = ref.watch(appStateProvider.select((s) => s.colors));
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  label,
                  style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: colors.textPrimary),
                ),
              ),
              Text(
                '$value',
                style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: colors.textPrimary),
              ),
            ],
          ),
          const SizedBox(height: 4),
          _Bar(fraction: total == 0 ? 0 : value / total, color: color),
        ],
      ),
    );
  }
}
