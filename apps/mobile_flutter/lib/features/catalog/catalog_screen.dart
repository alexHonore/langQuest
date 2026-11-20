import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../core/content/content_models.dart';
import '../../core/services/app_state.dart';
import '../../core/theme/accents.dart';
import '../../core/theme/script_fonts.dart';
import '../../l10n/l10n.dart';
import '../../navigation/nav.dart';
import '../learn/learn_logic.dart';

/// The same course picker serves first run and subsequent enrollments.
class CatalogScreen extends ConsumerStatefulWidget {
  const CatalogScreen({super.key, this.onboarding = false});

  final bool onboarding;

  @override
  ConsumerState<CatalogScreen> createState() => _CatalogScreenState();
}

class _CatalogScreenState extends ConsumerState<CatalogScreen> {
  String _source = preferredInstructionLanguage;
  String _query = '';

  @override
  Widget build(BuildContext context) {
    final appState = ref.watch(appStateProvider);
    final colors = appState.colors;
    final l10n = context.l10n;
    final ui = appState.uiLanguage;
    final terms = foldDiacritics(_query).trim().split(RegExp(r'\s+'));
    final groups = <String, List<CourseTrackInfo>>{};
    for (final track in appState.content.tracks) {
      final sources = appState.content.sourcesFor(track.id);
      if (!sources.contains(_source) && (widget.onboarding || sources.isNotEmpty)) continue;
      final names = foldDiacritics([track.id, track.nativeName, track.varietyName, ...track.names.values].join(' '));
      if (terms.every(names.contains)) {
        (groups[track.languageCode] ??= []).add(track);
      }
    }

    return Scaffold(
      backgroundColor: colors.background,
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
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
                    child: Semantics(
                      header: true,
                      child: Text(
                        widget.onboarding ? l10n.pickCourseTitle : l10n.catalogTitle,
                        style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800, color: colors.textPrimary),
                      ),
                    ),
                  ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 10, 16, 6),
              child: TextField(
                style: TextStyle(color: colors.textPrimary, fontSize: 15),
                decoration: InputDecoration(
                  prefixIcon: Icon(LucideIcons.search, size: 18, color: colors.textSecondary),
                  hintText: l10n.catalogSearch,
                  hintStyle: TextStyle(color: colors.textSecondary, fontSize: 14),
                  filled: true,
                  fillColor: colors.surface,
                  contentPadding: const EdgeInsets.symmetric(vertical: 12),
                  enabledBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(14),
                    borderSide: BorderSide(color: colors.border),
                  ),
                  focusedBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(14),
                    borderSide: BorderSide(color: colors.focusRing, width: 2),
                  ),
                ),
                onChanged: (query) => setState(() => _query = query),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 0),
              child: Wrap(
                spacing: 8,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  Text(l10n.courseLearnFrom, style: TextStyle(fontSize: 13, color: colors.textSecondary)),
                  for (final source in supportedInstructionLanguages)
                    ChoiceChip(label: Text(l10n.languageName(source)), selected: source == _source, onSelected: (_) => setState(() => _source = source)),
                ],
              ),
            ),
            Expanded(
              child: groups.isEmpty
                  ? Center(
                      child: Padding(
                        padding: const EdgeInsets.all(16),
                        child: Text(
                          _query.trim().isEmpty ? l10n.pickCourseNone : l10n.catalogNoResults(_query.trim()),
                          textAlign: TextAlign.center,
                          style: TextStyle(color: colors.textSecondary),
                        ),
                      ),
                    )
                  : ListView(
                      padding: const EdgeInsets.fromLTRB(16, 4, 16, 24),
                      keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
                      children: [
                        for (final tracks in groups.values) ...[
                          if (tracks.length > 1)
                            Padding(
                              padding: const EdgeInsets.fromLTRB(4, 8, 4, 8),
                              child: Semantics(
                                header: true,
                                child: Text(
                                  tracks.first.name(ui).split(' (').first,
                                  style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: colors.textSecondary),
                                ),
                              ),
                            ),
                          for (final track in tracks) _TrackRow(track: track, source: _source),
                        ],
                      ],
                    ),
            ),
          ],
        ),
      ),
    );
  }
}

class _TrackRow extends ConsumerWidget {
  const _TrackRow({required this.track, required this.source});

  final CourseTrackInfo track;
  final String source;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final appState = ref.watch(appStateProvider);
    final colors = appState.colors;
    final l10n = context.l10n;
    final accent = CourseAccent.forTrack(track, isDark: appState.isDark);
    final enrolled = appState.learner.isEnrolled(track.id, source);
    final ready = appState.content.isAvailable(track.id, source);
    final status = enrolled ? l10n.catalogEnrolled : (ready ? l10n.missionsCount(track.missionsFrom(source)) : l10n.catalogPlanned);
    final name = track.name(appState.uiLanguage);
    final shape = RoundedRectangleBorder(
      borderRadius: BorderRadius.circular(16),
      side: BorderSide(color: enrolled ? accent.primary : colors.border),
    );
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: MergeSemantics(
        child: Semantics(
          button: true,
          child: Material(
            color: enrolled ? accent.primarySoft : colors.surface,
            shape: shape,
            clipBehavior: Clip.antiAlias,
            child: InkWell(
              onTap: () => context.push(Uri(path: '/course/${track.id}', queryParameters: {'from': source}).toString()),
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Row(
                  children: [
                    Container(
                      width: 40,
                      height: 40,
                      alignment: Alignment.center,
                      decoration: BoxDecoration(color: accent.primarySoft, borderRadius: BorderRadius.circular(12)),
                      child: ExcludeSemantics(
                        child: Text(
                          (track.nativeName.isEmpty ? name : track.nativeName).characters.first,
                          style: TextStyle(fontSize: 19, fontWeight: FontWeight.w800, color: accent.primaryText, fontFamilyFallback: fontFallbackFor(track)),
                        ),
                      ),
                    ),
                    const SizedBox(width: 12),
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
                            style: TextStyle(fontSize: 13, color: colors.textSecondary, fontFamilyFallback: fontFallbackFor(track)),
                          ),
                          Text(status, style: TextStyle(fontSize: 12.5, color: enrolled ? accent.primaryText : colors.textSecondary)),
                        ],
                      ),
                    ),
                    Icon(LucideIcons.chevronRight, size: 18, color: colors.textSecondary),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
