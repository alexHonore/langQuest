import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../core/layout/motion.dart';
import '../../core/content/content_models.dart';
import '../../core/services/app_state.dart';
import '../../l10n/l10n.dart';
import '../learn/learn_widgets.dart';
import 'call_history.dart';
import 'call_portrait.dart';
import 'call_record_screen.dart';
import 'call_screen.dart';

/// The Speak tab: the course's characters (from the course manifest), each a tap away from a free call — by voice or
/// in writing, outside any mission — then the learner's recent calls on this device (their goals, corrections and
/// transcript). Shown when live calls back the active course (signed in, the server's snapshot says so); signed out on
/// a course with calls, it shows the course's people and how to call them (a free account).
class SpeakScreen extends ConsumerWidget {
  const SpeakScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colors = ref.watch(appStateProvider.select((s) => s.colors));
    final l10n = context.l10n;
    if (ref.watch(liveCallCourseProvider) == null) return const _SignUpToCall();
    final characters = ref.watch(courseCharactersProvider);
    final courseId = ref.watch(appStateProvider.select((s) => s.activeCourse?.id));
    final calls = courseId == null ? const <CallRecord>[] : ref.watch(courseCallsProvider(courseId));
    return SafeArea(
      bottom: false,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 110),
        children: [
          Semantics(
            header: true,
            child: Text(
              l10n.speakTitle,
              style: TextStyle(fontSize: 26, fontWeight: FontWeight.w800, color: colors.textPrimary),
            ),
          ),
          const SizedBox(height: 6),
          Text(l10n.speakBody, style: TextStyle(fontSize: 14.5, height: 1.4, color: colors.textSecondary)),
          const SizedBox(height: 18),
          ...characters.when(
            loading: () => [
              Center(
                child: Padding(
                  padding: const EdgeInsets.all(24),
                  child: CircularProgressIndicator(color: colors.textMuted),
                ),
              ),
            ],
            error: (_, _) => [Text(l10n.speakNoCharacters, style: TextStyle(fontSize: 14, color: colors.textMuted))],
            data: (list) => list.isEmpty
                ? [Text(l10n.speakNoCharacters, style: TextStyle(fontSize: 14, color: colors.textMuted))]
                : [
                    for (final (i, c) in list.indexed)
                      _CharacterCard(character: c)
                          .withMotion(context, (a) => a.fadeIn(delay: (70 * i).ms, duration: 260.ms).slideY(begin: 0.1, delay: (70 * i).ms, duration: 260.ms)),
                  ],
          ),
          if (calls.isNotEmpty) ...[
            const SizedBox(height: 18),
            Semantics(
              header: true,
              child: Text(
                l10n.speakRecentCalls,
                style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: colors.textPrimary),
              ),
            ),
            const SizedBox(height: 10),
            for (final r in calls.take(10)) CallRecordTile(record: r),
          ],
        ],
      ),
    );
  }
}

class _CharacterCard extends ConsumerWidget {
  const _CharacterCard({required this.character});

  final CourseCharacter character;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final appState = ref.watch(appStateProvider);
    final colors = appState.colors;
    final accent = appState.accent;
    final l10n = context.l10n;
    final roster = character.rosterId;
    final initial = character.name.isEmpty ? '?' : String.fromCharCode(character.name.runes.first).toUpperCase();
    final portrait = roster != null
        ? SvgPicture.asset(portraitAsset(roster, 'neutral'), width: 72, height: 72, excludeFromSemantics: true)
        : Container(
            width: 72,
            height: 72,
            decoration: const BoxDecoration(shape: BoxShape.circle, color: Color(0xFFF7EFE6)),
            alignment: Alignment.center,
            child: Text(
              initial,
              style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w800, color: Color(0xFF3A2A22)),
            ),
          );
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      // One target for the whole card: "Call Pablo, Schoolboy".
      child: Semantics(
        button: true,
        label: character.role.isEmpty ? l10n.speakCall(character.name) : '${l10n.speakCall(character.name)}, ${character.role}',
        excludeSemantics: true,
        child: Material(
          color: colors.surface,
          borderRadius: BorderRadius.circular(20),
          child: InkWell(
            borderRadius: BorderRadius.circular(20),
            onTap: () => context.push('/talk/${character.id}'),
            child: Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(20),
                border: Border.all(color: colors.border),
              ),
              child: Row(
                children: [
                  portrait,
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          character.name,
                          style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800, color: colors.textPrimary),
                        ),
                        if (character.role.isNotEmpty) Text(character.role, style: TextStyle(fontSize: 13.5, color: colors.textSecondary)),
                      ],
                    ),
                  ),
                  Container(
                    width: 48,
                    height: 48,
                    decoration: BoxDecoration(shape: BoxShape.circle, color: accent.primary),
                    child: Icon(LucideIcons.phone, color: accent.onPrimary, size: 22),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Signed out: the course's people (from the bundle) and the way to call them, a free account.
class _SignUpToCall extends ConsumerWidget {
  const _SignUpToCall();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final appState = ref.watch(appStateProvider);
    final colors = appState.colors;
    final accent = appState.accent;
    final l10n = context.l10n;
    final course = appState.activeCourse;
    final people = <StoryCharacter>[for (final chapter in course?.chapters ?? const <Chapter>[]) ...chapter.characters];
    return SafeArea(
      bottom: false,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 110),
        children: [
          Semantics(
            header: true,
            child: Text(
              l10n.speakTitle,
              style: TextStyle(fontSize: 26, fontWeight: FontWeight.w800, color: colors.textPrimary),
            ),
          ),
          const SizedBox(height: 14),
          Container(
            padding: const EdgeInsets.all(18),
            decoration: BoxDecoration(
              color: accent.primarySoft,
              borderRadius: BorderRadius.circular(20),
              border: Border.all(color: accent.primary.withValues(alpha: 0.5)),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(LucideIcons.phoneCall, size: 28, color: accent.primaryText),
                const SizedBox(height: 10),
                Text(
                  l10n.speakSignUpTitle,
                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: colors.textPrimary),
                ),
                const SizedBox(height: 6),
                Text(l10n.speakSignUpBody, style: TextStyle(fontSize: 14.5, height: 1.4, color: colors.textSecondary)),
                const SizedBox(height: 14),
                SizedBox(
                  width: double.infinity,
                  child: FilledButton.icon(
                    style: FilledButton.styleFrom(backgroundColor: accent.primary, foregroundColor: accent.onPrimary, minimumSize: const Size(0, 48)),
                    onPressed: () => context.push('/account'),
                    icon: const Icon(LucideIcons.userPlus, size: 18),
                    label: Text(l10n.speakSignUpButton),
                  ),
                ),
                Center(
                  child: TextButton(onPressed: () => context.push('/account'), child: Text(l10n.speakSignUpAlready)),
                ),
              ],
            ),
          ),
          if (people.isNotEmpty) ...[
            const SizedBox(height: 18),
            for (final p in people)
              Semantics(
                container: true,
                child: Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: Row(
                    children: [
                      CharacterBadge(name: p.name, speaking: false, size: 44, showName: false),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              p.name,
                              style: TextStyle(fontSize: 15.5, fontWeight: FontWeight.w700, color: colors.textPrimary),
                            ),
                            Text(p.role, style: TextStyle(fontSize: 13, color: colors.textMuted)),
                          ],
                        ),
                      ),
                      Icon(LucideIcons.lock, size: 16, color: colors.textMuted),
                    ],
                  ),
                ),
              ),
          ],
        ],
      ),
    );
  }
}
