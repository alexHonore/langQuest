import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../core/backend/account.dart';
import '../../core/backend/admin_models.dart';
import '../../core/backend/api_client.dart';
import '../../core/services/app_state.dart';
import '../../l10n/l10n.dart';
import '../../navigation/nav.dart';

/// Admin › AI models: each task the AI does, the model that does it (then its fallbacks), for every course or one
/// variety, and a way to change it. Saving goes through `PUT /v1/admin/models/:task/config`, which runs the task's
/// smoke tests first and refuses a change that fails them; the Worker picks the change up within its profile cache
/// (about a minute). Shown to admins only (the server checks the role on every call).
class AdminModelsScreen extends ConsumerWidget {
  const AdminModelsScreen({super.key});

  static String taskLabel(AppLocalizations l10n, String task) => switch (task) {
    'character_dialogue' => l10n.adminTask_character_dialogue,
    'learner_evaluation' => l10n.adminTask_learner_evaluation,
    'source_explanation' => l10n.adminTask_source_explanation,
    'scene_planning' => l10n.adminTask_scene_planning,
    'meaning_assessment' => l10n.adminTask_meaning_assessment,
    'pronunciation_feedback' => l10n.adminTask_pronunciation_feedback,
    'speech_recognition' => l10n.adminTask_speech_recognition,
    'speech_synthesis' => l10n.adminTask_speech_synthesis,
    'language_quality_check' => l10n.adminTask_language_quality_check,
    'content_generation' => l10n.adminTask_content_generation,
    'transcription_alignment' => l10n.adminTask_transcription_alignment,
    'pronunciation_assessment' => l10n.adminTask_pronunciation_assessment,
    'realtime_conversation' => l10n.adminTask_realtime_conversation,
    _ => task,
  };

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colors = ref.watch(appStateProvider.select((s) => s.colors));
    final l10n = context.l10n;
    final overview = ref.watch(modelsOverviewProvider);
    return Scaffold(
      backgroundColor: colors.background,
      appBar: AppBar(
        backgroundColor: colors.background,
        foregroundColor: colors.textPrimary,
        title: Text(l10n.adminModelsTitle),
        leading: IconButton(icon: const Icon(LucideIcons.arrowLeft), tooltip: l10n.close, onPressed: () => context.popOrHome()),
      ),
      body: overview.when(
        loading: () => Center(child: CircularProgressIndicator(color: colors.textMuted)),
        error: (_, _) => Padding(
          padding: const EdgeInsets.all(20),
          child: Text(l10n.adminModelsLoadFailed, style: TextStyle(fontSize: 15, color: colors.textSecondary)),
        ),
        data: (data) => ListView(
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 40),
          children: [
            Text(l10n.adminModelsIntro, style: TextStyle(fontSize: 14, height: 1.4, color: colors.textSecondary)),
            const SizedBox(height: 14),
            for (final task in ModelsOverview.taskOrder)
              if (data.routesOf(task).isNotEmpty) _TaskCard(task: task, overview: data),
          ],
        ),
      ),
    );
  }
}

class _TaskCard extends ConsumerWidget {
  const _TaskCard({required this.task, required this.overview});

  final String task;
  final ModelsOverview overview;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final appState = ref.watch(appStateProvider);
    final colors = appState.colors;
    final accent = appState.accent;
    final l10n = context.l10n;
    final readOnly = ModelsOverview.readOnlyTasks.contains(task);
    final routes = overview.routesOf(task);
    String scope(ModelRoute r) => r.targetVariety == null ? l10n.adminModelsAllCourses : _varietyName(appState, r.targetVariety!);
    String voiceName(String id) => overview.voices.where((v) => v.voiceId == id).firstOrNull?.label ?? id;
    return Semantics(
      container: true,
      child: Container(
        margin: const EdgeInsets.only(bottom: 12),
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: colors.surface,
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: colors.border),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    AdminModelsScreen.taskLabel(l10n, task),
                    style: TextStyle(fontSize: 15.5, fontWeight: FontWeight.w800, color: colors.textPrimary),
                  ),
                ),
                if (readOnly)
                  Text(l10n.adminModelsReadOnly, style: TextStyle(fontSize: 12, color: colors.textMuted))
                else
                  TextButton.icon(
                    onPressed: () => _edit(context, ref, routes.firstWhere((r) => r.targetVariety == null, orElse: () => routes.first)),
                    icon: const Icon(LucideIcons.pencil, size: 16),
                    label: Text(l10n.adminModelsChange),
                  ),
              ],
            ),
            Text(
              task,
              style: TextStyle(fontSize: 11.5, color: colors.textMuted, fontFamily: 'monospace'),
            ),
            const SizedBox(height: 8),
            for (final r in routes)
              InkWell(
                borderRadius: BorderRadius.circular(10),
                onTap: readOnly ? null : () => _edit(context, ref, r),
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 6),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        '${scope(r)} · ${r.fromAdmin ? l10n.adminModelsChanged : l10n.adminModelsDefault}',
                        style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: r.fromAdmin ? accent.primaryText : colors.textMuted),
                      ),
                      Text(
                        r.primaryModel,
                        style: TextStyle(fontSize: 14.5, fontWeight: FontWeight.w600, color: colors.textPrimary),
                      ),
                      if (r.voiceId != null) Text(l10n.adminModelsVoice(voiceName(r.voiceId!)), style: TextStyle(fontSize: 13, color: colors.textSecondary)),
                      if (r.fallbackModels.isNotEmpty)
                        Text(l10n.adminModelsFallbacks(r.fallbackModels.join(', ')), style: TextStyle(fontSize: 12.5, color: colors.textMuted)),
                    ],
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }

  static String _varietyName(AppState appState, String variety) {
    for (final t in appState.content.tracks) {
      if (t.targetVarietyId == variety) return t.names[appState.uiLanguage] ?? t.names['en'] ?? variety;
    }
    return variety;
  }

  void _edit(BuildContext context, WidgetRef ref, ModelRoute route) {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      backgroundColor: ref.read(appStateProvider).colors.surface,
      builder: (_) => _EditRoute(route: route, overview: overview),
    );
  }
}

class _EditRoute extends ConsumerStatefulWidget {
  const _EditRoute({required this.route, required this.overview});

  final ModelRoute route;
  final ModelsOverview overview;

  @override
  ConsumerState<_EditRoute> createState() => _EditRouteState();
}

class _EditRouteState extends ConsumerState<_EditRoute> {
  late String? _variety = widget.route.targetVariety;
  late final _primary = TextEditingController(text: widget.route.primaryModel);
  late final _fallbacks = TextEditingController(text: widget.route.fallbackModels.join(', '));
  late String? _voice = widget.route.voiceId;
  bool _saving = false;
  bool _bound = false;
  String? _result;
  bool _ok = false;

  @override
  void dispose() {
    _primary.dispose();
    _fallbacks.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final api = ref.read(apiProvider);
    if (api == null) return;
    final l10n = context.l10n;
    final r = widget.route;
    setState(() {
      _saving = true;
      _result = null;
    });
    final body = <String, Object?>{
      'task': r.task,
      'targetVariety': _variety,
      'sourceLanguage': r.targetVariety == _variety ? r.sourceLanguage : null,
      'provider': r.provider,
      'primaryModel': _primary.text.trim(),
      'fallbackModels': [
        for (final m in _fallbacks.text.split(','))
          if (m.trim().isNotEmpty) m.trim(),
      ],
      'params': {...r.params, 'voiceId': ?_voice}..removeWhere((k, v) => k == 'voiceId' && _voice == null),
      'latencyClass': r.latencyClass,
      'enabled': true,
      'dailyBudgetUsd': null,
      'requireSmokeTests': true,
    };
    try {
      await api.adminModelConfig(r.task, body);
      ref.invalidate(modelsOverviewProvider);
      setState(() {
        _ok = true;
        _result = l10n.adminModelsSaved;
      });
    } on ApiException catch (e) {
      final tests = e.details['smokeTests'];
      final failed = tests is List
          ? [
              for (final t in tests)
                if (t is Map && t['passed'] != true) '${t['name']}: ${t['detail'] ?? ''}',
            ]
          : const <String>[];
      setState(() {
        _ok = false;
        _result = l10n.adminModelsFailed(failed.isEmpty ? e.message : failed.join(' · '));
      });
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final appState = ref.watch(appStateProvider);
    final colors = appState.colors;
    final accent = appState.accent;
    final l10n = context.l10n;
    final task = widget.route.task;
    final varieties = {for (final t in appState.content.tracks) t.targetVarietyId: t.names[appState.uiLanguage] ?? t.names['en'] ?? t.targetVarietyId};
    final voices = _variety == null ? const <VoiceOption>[] : widget.overview.voices.where((v) => v.varietyId == _variety).toList();
    final suggestions = widget.overview.modelsFor(task);
    return SafeArea(
      child: Padding(
        padding: EdgeInsets.fromLTRB(20, 0, 20, 20 + MediaQuery.viewInsetsOf(context).bottom),
        child: SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                AdminModelsScreen.taskLabel(l10n, task),
                style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: colors.textPrimary),
              ),
              const SizedBox(height: 14),
              DropdownButtonFormField<String?>(
                initialValue: _variety,
                decoration: InputDecoration(labelText: l10n.adminModelsScope),
                items: [
                  DropdownMenuItem(value: null, child: Text(l10n.adminModelsAllCourses)),
                  for (final e in varieties.entries) DropdownMenuItem(value: e.key, child: Text(e.value)),
                ],
                onChanged: (v) => setState(() {
                  _variety = v;
                  _voice = null;
                }),
              ),
              const SizedBox(height: 12),
              Autocomplete<String>(
                initialValue: TextEditingValue(text: _primary.text),
                optionsBuilder: (v) => suggestions.where((m) => m.contains(v.text.trim())).take(30),
                onSelected: (m) => _primary.text = m,
                fieldViewBuilder: (context, controller, focus, submit) {
                  if (!_bound) {
                    _bound = true;
                    controller.addListener(() => _primary.text = controller.text);
                  }
                  return TextField(
                    controller: controller,
                    focusNode: focus,
                    decoration: InputDecoration(labelText: l10n.adminModelsPrimary),
                  );
                },
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _fallbacks,
                decoration: InputDecoration(labelText: l10n.adminModelsFallbacksField),
              ),
              if (task == 'speech_synthesis' && voices.isNotEmpty) ...[
                const SizedBox(height: 12),
                DropdownButtonFormField<String?>(
                  initialValue: voices.any((v) => v.voiceId == _voice) ? _voice : null,
                  decoration: InputDecoration(labelText: l10n.adminModelsVoiceField),
                  items: [
                    DropdownMenuItem(value: null, child: Text(l10n.adminModelsVoiceDefault)),
                    for (final v in voices)
                      DropdownMenuItem(
                        value: v.voiceId,
                        child: Text(v.label, overflow: TextOverflow.ellipsis),
                      ),
                  ],
                  onChanged: (v) => setState(() => _voice = v),
                ),
              ],
              const SizedBox(height: 18),
              FilledButton.icon(
                style: FilledButton.styleFrom(backgroundColor: accent.primary, foregroundColor: accent.onPrimary, minimumSize: const Size(0, 48)),
                onPressed: _saving ? null : _save,
                icon: _saving
                    ? SizedBox.square(dimension: 16, child: CircularProgressIndicator(strokeWidth: 2, color: accent.onPrimary))
                    : const Icon(LucideIcons.flaskConical, size: 18),
                label: Text(l10n.adminModelsSave),
              ),
              if (_result != null) ...[
                const SizedBox(height: 10),
                Semantics(
                  liveRegion: true,
                  child: Text(_result!, style: TextStyle(fontSize: 13.5, height: 1.35, color: _ok ? colors.success : colors.error)),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
