import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../core/content/content_bundle.dart';
import '../../core/services/app_state.dart';
import '../../core/theme/script_fonts.dart';
import '../../l10n/l10n.dart';
import '../../navigation/nav.dart';
import '../learn/learn_widgets.dart';
import 'call_history.dart';
import 'call_portrait.dart';
import 'call_screen.dart';

/// `m:ss` of a call's length.
String callLength(int seconds) => '${seconds ~/ 60}:${(seconds % 60).toString().padLeft(2, '0')}';

/// When a call was made, in the interface's language ("Wed, Nov 11, 09:12").
String callWhen(BuildContext context, DateTime at) => DateFormat.MMMEd(Localizations.localeOf(context).toLanguageTag()).add_Hm().format(at.toLocal());

/// A character's face: their roster portrait when it ships with this build, else their initial.
class CallAvatar extends StatelessWidget {
  const CallAvatar({super.key, required this.characterId, required this.name, this.size = 48, this.expression = 'neutral'});

  final String? characterId;
  final String name;
  final double size;
  final String expression;

  @override
  Widget build(BuildContext context) {
    final roster = characterId == null ? null : rosterIdFor(characterId!);
    if (roster != null) return SvgPicture.asset(portraitAsset(roster, expression), width: size, height: size, excludeFromSemantics: true);
    final initial = name.isEmpty ? '?' : String.fromCharCode(name.runes.first).toUpperCase();
    return Container(
      width: size,
      height: size,
      decoration: const BoxDecoration(shape: BoxShape.circle, color: Color(0xFFF7EFE6)),
      alignment: Alignment.center,
      child: Text(
        initial,
        style: TextStyle(fontSize: size * 0.4, fontWeight: FontWeight.w800, color: const Color(0xFF3A2A22)),
      ),
    );
  }
}

/// One past call, as kept on this device: who and when, the goals, the server's summary and corrections (with the
/// phone's voice to hear the better way, where it has one), the conversation, and Call again.
class CallRecordScreen extends ConsumerWidget {
  const CallRecordScreen({super.key, required this.recordId});

  final String recordId;

  Future<bool> _confirmDelete(BuildContext context) async {
    final l10n = context.l10n;
    final result = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(l10n.callRecordDeleteTitle),
        content: Text(l10n.callRecordDeleteBody),
        actions: [
          TextButton(onPressed: () => Navigator.of(context).pop(false), child: Text(l10n.cancel)),
          TextButton(onPressed: () => Navigator.of(context).pop(true), child: Text(l10n.callRecordDeleteConfirm)),
        ],
      ),
    );
    return result ?? false;
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final appState = ref.watch(appStateProvider);
    final colors = appState.colors;
    final accent = appState.accent;
    final l10n = context.l10n;
    final record = ref.watch(callHistoryProvider).where((r) => r.id == recordId).firstOrNull;
    final close = Align(
      alignment: AlignmentDirectional.centerStart,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(8, 4, 8, 0),
        child: IconButton(
          icon: Icon(LucideIcons.x, color: colors.textSecondary),
          tooltip: l10n.close,
          onPressed: () => context.popOrHome(),
        ),
      ),
    );
    if (record == null) {
      return Scaffold(
        backgroundColor: colors.background,
        body: SafeArea(
          child: Column(
            children: [
              close,
              Padding(
                padding: const EdgeInsets.all(24),
                child: Text(
                  l10n.callRecordMissing,
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 15, color: colors.textSecondary),
                ),
              ),
            ],
          ),
        ),
      );
    }
    final trackId = record.courseId.split('|').first;
    final track = ref.watch(contentBundleProvider).track(trackId);
    // Call again: the same mission, or the same character, while live calls back this (active) course.
    final callable = ref.watch(liveCallCourseProvider) != null && appState.activeCourse?.id == record.courseId;
    final again = !callable
        ? null
        : record.missionKey != null
        ? '/call/${record.missionKey}'
        : record.characterId != null
        ? '/talk/${record.characterId}'
        : null;
    final card = BoxDecoration(
      color: colors.surface,
      borderRadius: BorderRadius.circular(16),
      border: Border.all(color: colors.border),
    );
    TextStyle target(double size, {FontWeight weight = FontWeight.w600, Color? color}) => TextStyle(
      fontSize: size,
      height: 1.35,
      fontWeight: weight,
      color: color ?? colors.textPrimary,
      fontFamilyFallback: track == null ? null : fontFallbackFor(track),
    );
    Widget heading(String text) => Padding(
      padding: const EdgeInsets.only(top: 18, bottom: 8),
      child: Semantics(
        header: true,
        child: Text(
          text,
          style: TextStyle(fontSize: 13, fontWeight: FontWeight.w800, letterSpacing: 0.6, color: accent.primaryText),
        ),
      ),
    );

    return Scaffold(
      backgroundColor: colors.background,
      body: SafeArea(
        child: Column(
          children: [
            close,
            Expanded(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(20, 0, 20, 16),
                children: [
                  Row(
                    children: [
                      CallAvatar(characterId: record.characterId, name: record.characterName, size: 64),
                      const SizedBox(width: 14),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Semantics(
                              header: true,
                              child: Text(
                                record.characterName,
                                style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800, color: colors.textPrimary),
                              ),
                            ),
                            if (record.characterRole.isNotEmpty) Text(record.characterRole, style: TextStyle(fontSize: 13.5, color: colors.textSecondary)),
                            const SizedBox(height: 2),
                            Text(
                              '${callWhen(context, record.at)} · ${callLength(record.seconds)}${record.xp > 0 ? ' · ${l10n.xpGain(record.xp)}' : ''}',
                              style: TextStyle(fontSize: 13, color: colors.textMuted),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                  if (record.title.isNotEmpty) ...[
                    const SizedBox(height: 12),
                    Text(
                      record.title,
                      style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: accent.primaryText),
                    ),
                  ],
                  if (record.goalCount > 0) ...[
                    const SizedBox(height: 14),
                    Container(
                      padding: const EdgeInsets.all(14),
                      decoration: card,
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            l10n.callGoalsMet(record.goalsMet, record.goalCount),
                            style: TextStyle(fontSize: 15, fontWeight: FontWeight.w800, color: colors.textPrimary),
                          ),
                          const SizedBox(height: 6),
                          for (final (done, goal) in [for (final g in record.goalsDone) (true, g), for (final g in record.goalsOpen) (false, g)])
                            Padding(
                              padding: const EdgeInsets.symmetric(vertical: 3),
                              child: Row(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Icon(done ? LucideIcons.circleCheck : LucideIcons.circle, size: 18, color: done ? colors.success : colors.textMuted),
                                  const SizedBox(width: 8),
                                  Expanded(
                                    child: Text(goal, style: TextStyle(fontSize: 14, height: 1.35, color: colors.textSecondary)),
                                  ),
                                ],
                              ),
                            ),
                        ],
                      ),
                    ),
                  ],
                  if (record.summary.isNotEmpty) ...[
                    const SizedBox(height: 12),
                    Container(
                      padding: const EdgeInsets.all(14),
                      decoration: card,
                      child: Text(record.summary, style: TextStyle(fontSize: 14.5, height: 1.45, color: colors.textPrimary)),
                    ),
                  ],
                  if (!record.evaluated) ...[const SizedBox(height: 10), Text(l10n.callNotEvaluated, style: TextStyle(fontSize: 13, color: colors.textMuted))],
                  if (record.corrections.isNotEmpty) ...[
                    heading(l10n.callNextTime),
                    for (final c in record.corrections)
                      Container(
                        margin: const EdgeInsets.only(bottom: 10),
                        padding: const EdgeInsets.all(14),
                        decoration: card,
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            if (c.said.isNotEmpty) Text(l10n.callYouSaid(c.said), style: TextStyle(fontSize: 13.5, color: colors.textMuted)),
                            const SizedBox(height: 4),
                            Row(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Icon(LucideIcons.sparkles, size: 16, color: colors.success),
                                const SizedBox(width: 6),
                                Expanded(
                                  child: Text(
                                    c.better,
                                    textDirection: directionOf(c.better),
                                    style: target(17, weight: FontWeight.w700),
                                  ),
                                ),
                              ],
                            ),
                            if (c.why.isNotEmpty) ...[
                              const SizedBox(height: 4),
                              Text(c.why, style: TextStyle(fontSize: 13.5, height: 1.4, color: colors.textSecondary)),
                            ],
                            // The phone's voice only: the server reads approved course content, not a correction.
                            if (track?.voiceLocale != null) ...[
                              const SizedBox(height: 6),
                              ListenButtons(text: c.better, locale: track!.voiceLocale, compact: true),
                            ],
                          ],
                        ),
                      ),
                  ],
                  if (record.lines.isNotEmpty) ...[
                    heading(l10n.callRecordConversation),
                    for (final line in record.lines)
                      Align(
                        alignment: line.fromLearner ? AlignmentDirectional.centerEnd : AlignmentDirectional.centerStart,
                        child: ConstrainedBox(
                          constraints: const BoxConstraints(maxWidth: 300),
                          child: Semantics(
                            container: true,
                            label: '${line.fromLearner ? l10n.callRecordYou : record.characterName}: ${line.text}',
                            excludeSemantics: true,
                            child: Container(
                              margin: const EdgeInsets.only(bottom: 8),
                              padding: const EdgeInsets.fromLTRB(12, 9, 12, 9),
                              decoration: BoxDecoration(
                                color: line.fromLearner ? accent.primary : colors.surface,
                                borderRadius: BorderRadius.circular(14),
                                border: line.fromLearner ? null : Border.all(color: colors.border),
                              ),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    line.text,
                                    textDirection: directionOf(line.text),
                                    style: target(15.5, color: line.fromLearner ? accent.onPrimary : null),
                                  ),
                                  if (line.transliteration != null && line.transliteration!.isNotEmpty)
                                    Text(
                                      line.transliteration!,
                                      style: TextStyle(fontSize: 12.5, fontStyle: FontStyle.italic, color: colors.textMuted),
                                    ),
                                  if (line.gloss != null && line.gloss!.isNotEmpty)
                                    Padding(
                                      padding: const EdgeInsets.only(top: 3),
                                      child: Text(line.gloss!, style: TextStyle(fontSize: 13, height: 1.35, color: colors.textSecondary)),
                                    ),
                                ],
                              ),
                            ),
                          ),
                        ),
                      ),
                  ],
                  const SizedBox(height: 14),
                  Text(l10n.callRecordKept, style: TextStyle(fontSize: 12.5, color: colors.textMuted)),
                  Align(
                    alignment: AlignmentDirectional.centerStart,
                    child: TextButton.icon(
                      style: TextButton.styleFrom(foregroundColor: colors.error, minimumSize: const Size(48, 48)),
                      icon: const Icon(LucideIcons.trash2, size: 18),
                      label: Text(l10n.callRecordDelete),
                      onPressed: () async {
                        if (!await _confirmDelete(context)) return;
                        ref.read(callHistoryProvider.notifier).remove(record.id);
                        if (context.mounted) context.popOrHome();
                      },
                    ),
                  ),
                ],
              ),
            ),
            if (again != null)
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 4, 16, 12),
                child: LearnPrimaryButton(label: l10n.callAgain, icon: LucideIcons.phone, onPressed: () => context.push(again)),
              ),
          ],
        ),
      ),
    );
  }
}

/// A past call in the Speak tab: who, when, how long, goals met and corrections; opens the record.
class CallRecordTile extends ConsumerWidget {
  const CallRecordTile({super.key, required this.record});

  final CallRecord record;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final appState = ref.watch(appStateProvider);
    final colors = appState.colors;
    final accent = appState.accent;
    final l10n = context.l10n;
    final when = callWhen(context, record.at);
    final length = callLength(record.seconds);
    final details = [
      if (record.goalCount > 0) l10n.callGoalsMet(record.goalsMet, record.goalCount),
      if (record.corrections.isNotEmpty) l10n.speakRecordCorrections(record.corrections.length),
    ];
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Semantics(
        button: true,
        label: [l10n.speakRecordLabel(record.characterName, when, length), if (record.title.isNotEmpty) record.title, ...details].join(', '),
        excludeSemantics: true,
        child: Material(
          color: colors.surface,
          borderRadius: BorderRadius.circular(16),
          child: InkWell(
            borderRadius: BorderRadius.circular(16),
            onTap: () => context.push('/calls/${Uri.encodeComponent(record.id)}'),
            child: Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: colors.border),
              ),
              child: Row(
                children: [
                  CallAvatar(characterId: record.characterId, name: record.characterName, size: 44),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          record.title.isEmpty ? record.characterName : '${record.characterName} · ${record.title}',
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(fontSize: 15, fontWeight: FontWeight.w800, color: colors.textPrimary),
                        ),
                        Text('$when · $length', style: TextStyle(fontSize: 12.5, color: colors.textMuted)),
                        if (details.isNotEmpty) Text(details.join(' · '), style: TextStyle(fontSize: 12.5, color: accent.primaryText)),
                      ],
                    ),
                  ),
                  Icon(LucideIcons.chevronRight, size: 18, color: colors.textMuted),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
