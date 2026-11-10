import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../core/content/content_bundle.dart';
import '../../core/learning/srs.dart';
import '../../core/services/app_state.dart';
import '../../core/services/learner_state.dart';
import '../../core/theme/glass.dart';
import '../../l10n/l10n.dart';
import '../learn/learn_content.dart';
import '../learn/learn_logic.dart';

/// Progress shows only what was measured on this device: XP (practice, never proficiency), active days, missions
/// completed, phrases met and how firmly the review schedule holds them. No invented word counts or levels.
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
    final hasActivity = appState.learner.xpTotal > 0 || cards.isNotEmpty || met.isNotEmpty;

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
              ],
            ),
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
