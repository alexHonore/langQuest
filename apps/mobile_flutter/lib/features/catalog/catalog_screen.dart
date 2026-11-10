import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../navigation/nav.dart';
import '../../core/content/content_models.dart';
import '../../core/services/app_state.dart';
import '../../core/theme/accents.dart';
import '../../core/theme/glass.dart';
import '../../l10n/l10n.dart';

/// All 30 courses with their honest status: enrolled, ready (draft content exists for an interface language) or
/// planned. Opening a course shows what it includes and lacks before any enrollment.
class CatalogScreen extends ConsumerStatefulWidget {
  const CatalogScreen({super.key});

  @override
  ConsumerState<CatalogScreen> createState() => _CatalogScreenState();
}

class _CatalogScreenState extends ConsumerState<CatalogScreen> {
  String _query = '';

  @override
  Widget build(BuildContext context) {
    final appState = ref.watch(appStateProvider);
    final colors = appState.colors;
    final l10n = context.l10n;
    final ui = appState.uiLanguage;
    final q = _query.trim().toLowerCase();
    final tracks = [
      for (final t in appState.content.tracks)
        if (q.isEmpty ||
            t.name(ui).toLowerCase().contains(q) ||
            t.names.values.any((n) => n.toLowerCase().contains(q)) ||
            t.nativeName.toLowerCase().contains(q))
          t,
    ];
    // Ready courses first (those the learner can start), then the rest in catalog order.
    tracks.sort((a, b) {
      final ra = appState.content.sourcesFor(a.id).isNotEmpty ? 0 : 1;
      final rb = appState.content.sourcesFor(b.id).isNotEmpty ? 0 : 1;
      return ra != rb ? ra - rb : a.order - b.order;
    });

    return Scaffold(
      backgroundColor: colors.background,
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(8, 8, 16, 0),
              child: Row(
                children: [
                  IconButton(
                    icon: Icon(LucideIcons.arrowLeft, color: colors.textPrimary),
                    tooltip: l10n.back,
                    onPressed: () => context.popOrHome(),
                  ),
                  const SizedBox(width: 4),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Semantics(
                          header: true,
                          child: Text(
                            l10n.catalogTitle,
                            style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800, color: colors.textPrimary),
                          ),
                        ),
                        Text(l10n.catalogSubtitle, style: TextStyle(fontSize: 12.5, color: colors.textSecondary)),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 12, 20, 4),
              child: TextField(
                style: TextStyle(color: colors.textPrimary, fontSize: 15),
                decoration: InputDecoration(
                  prefixIcon: Icon(LucideIcons.search, size: 18, color: colors.textMuted),
                  hintText: l10n.catalogSearch,
                  hintStyle: TextStyle(color: colors.textMuted, fontSize: 14),
                  filled: true,
                  fillColor: colors.surface,
                  contentPadding: const EdgeInsets.symmetric(vertical: 12),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(16),
                    borderSide: BorderSide(color: colors.border),
                  ),
                  enabledBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(16),
                    borderSide: BorderSide(color: colors.border),
                  ),
                  focusedBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(16),
                    borderSide: BorderSide(color: colors.focusRing, width: 2),
                  ),
                ),
                onChanged: (v) => setState(() => _query = v),
              ),
            ),
            Expanded(
              child: tracks.isEmpty
                  ? Center(
                      child: Text(l10n.catalogNoResults(_query.trim()), style: TextStyle(color: colors.textSecondary)),
                    )
                  : ListView.builder(
                      padding: const EdgeInsets.fromLTRB(20, 12, 20, 24),
                      itemCount: tracks.length,
                      itemBuilder: (context, i) => _TrackRow(track: tracks[i]),
                    ),
            ),
          ],
        ),
      ),
    );
  }
}

class _TrackRow extends ConsumerWidget {
  final CourseTrackInfo track;
  const _TrackRow({required this.track});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final appState = ref.watch(appStateProvider);
    final colors = appState.colors;
    final l10n = context.l10n;
    final trackAccent = CourseAccent.forTrack(track, isDark: appState.isDark);
    final enrolled = appState.learner.enrollments.any((e) => e.trackId == track.id);
    final ready = appState.content.sourcesFor(track.id).isNotEmpty;
    final status = enrolled ? l10n.catalogEnrolled : (ready ? l10n.catalogReady : l10n.catalogPlanned);
    final statusColor = enrolled ? trackAccent.primaryText : (ready ? colors.success : colors.textMuted);
    final name = track.name(appState.uiLanguage);

    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Semantics(
        button: true,
        label: '$name, ${track.nativeName}. $status',
        excludeSemantics: true,
        child: GlassContainer(
          level: enrolled ? GlassLevel.level2 : GlassLevel.level1,
          radius: 18,
          padding: const EdgeInsets.all(14),
          border: enrolled ? Border.all(color: trackAccent.primary.withValues(alpha: 0.6)) : null,
          onTap: () => context.push('/course/${track.id}'),
          child: Row(
            children: [
              Container(
                width: 46,
                height: 46,
                decoration: BoxDecoration(
                  gradient: LinearGradient(colors: [trackAccent.primary, trackAccent.lantern[1]]),
                  borderRadius: BorderRadius.circular(14),
                ),
                alignment: Alignment.center,
                child: Text(
                  String.fromCharCode(name.runes.first),
                  style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800, color: trackAccent.onPrimary),
                ),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      name,
                      style: TextStyle(fontSize: 15.5, fontWeight: FontWeight.w700, color: colors.textPrimary),
                    ),
                    Text(
                      track.nativeName,
                      textDirection: track.rtl ? TextDirection.rtl : TextDirection.ltr,
                      style: TextStyle(fontSize: 13, color: colors.textSecondary),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      status,
                      style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: statusColor),
                    ),
                  ],
                ),
              ),
              Icon(LucideIcons.chevronRight, size: 18, color: colors.textMuted),
            ],
          ),
        ),
      ),
    );
  }
}
