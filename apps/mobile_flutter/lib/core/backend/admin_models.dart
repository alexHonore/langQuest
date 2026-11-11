import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'account.dart';
import 'api_client.dart';

/// One model route of a task (`ai_model_profiles` row, or the package default when no admin changed it): which model
/// does the task, then its fallbacks in order, for every course or one variety.
@immutable
class ModelRoute {
  const ModelRoute({
    required this.task,
    required this.targetVariety,
    required this.sourceLanguage,
    required this.provider,
    required this.primaryModel,
    required this.fallbackModels,
    required this.params,
    required this.latencyClass,
    required this.enabled,
    required this.version,
    required this.fromAdmin,
  });

  factory ModelRoute.fromJson(Map<String, Object?> j, {required bool fromAdmin}) => ModelRoute(
    task: '${j['task']}',
    targetVariety: j['targetVariety'] as String?,
    sourceLanguage: j['sourceLanguage'] as String?,
    provider: '${j['provider']}',
    primaryModel: '${j['primaryModel']}',
    fallbackModels: [for (final m in (j['fallbackModels'] as List? ?? const [])) '$m'],
    params: (j['params'] is Map ? (j['params'] as Map).cast<String, Object?>() : const <String, Object?>{}),
    latencyClass: '${j['latencyClass'] ?? 'interactive'}',
    enabled: j['enabled'] != false,
    version: (j['version'] as num?)?.toInt() ?? 0,
    fromAdmin: fromAdmin,
  );

  final String task;

  /// Null: every course.
  final String? targetVariety;
  final String? sourceLanguage;
  final String provider;
  final String primaryModel;
  final List<String> fallbackModels;
  final Map<String, Object?> params;
  final String latencyClass;
  final bool enabled;
  final int version;

  /// Saved by an admin (else the built-in default).
  final bool fromAdmin;

  String? get voiceId => params['voiceId'] as String?;
}

@immutable
class VoiceOption {
  const VoiceOption({
    required this.voiceId,
    required this.varietyId,
    required this.model,
    required this.providerVoice,
    required this.gender,
    required this.status,
  });

  final String voiceId;
  final String varietyId;
  final String model;
  final String providerVoice;
  final String gender;
  final String status;

  String get label => '${providerVoice.split(':').first} · ${model.split('/').last} · $gender';
}

/// What `GET /v1/admin/models` says: the routes in effect per task and scope, the router's models, the voices.
@immutable
class ModelsOverview {
  const ModelsOverview({required this.routes, required this.availableModels, required this.voices});

  factory ModelsOverview.fromResponse(Map<String, Object?> data) {
    final db = [
      for (final p in (data['profiles'] as List? ?? const []))
        if (p is Map) ModelRoute.fromJson(p.cast<String, Object?>(), fromAdmin: true),
    ];
    final defaults = [
      for (final p in (data['defaults'] as List? ?? const []))
        if (p is Map) ModelRoute.fromJson(p.cast<String, Object?>(), fromAdmin: false),
    ];
    // An enabled admin row replaces the default of the same scope (as the server's registry does).
    String key(ModelRoute r) => '${r.task}|${r.targetVariety ?? '*'}|${r.sourceLanguage ?? '*'}';
    final byScope = <String, ModelRoute>{for (final d in defaults) key(d): d};
    for (final r in db) {
      if (r.enabled) byScope[key(r)] = r;
    }
    return ModelsOverview(
      routes: byScope.values.toList()
        ..sort((a, b) => a.task.compareTo(b.task) != 0 ? a.task.compareTo(b.task) : (a.targetVariety ?? '').compareTo(b.targetVariety ?? '')),
      availableModels: [
        for (final m in (data['availableModels'] as List? ?? const []))
          if (m is Map && m['id'] is String) (id: m['id'] as String, modalities: [for (final x in (m['modalities'] as List? ?? const [])) '$x']),
      ],
      voices: [
        for (final v in (data['voices'] as List? ?? const []))
          if (v is Map)
            VoiceOption(
              voiceId: '${v['voiceId']}',
              varietyId: '${v['varietyId']}',
              model: '${v['model']}',
              providerVoice: '${v['providerVoice']}',
              gender: '${v['gender']}',
              status: '${v['status']}',
            ),
      ],
    );
  }

  final List<ModelRoute> routes;
  final List<({String id, List<String> modalities})> availableModels;
  final List<VoiceOption> voices;

  /// The tasks in the order the screen lists them (what learners meet first).
  static const taskOrder = [
    'character_dialogue',
    'source_explanation',
    'learner_evaluation',
    'scene_planning',
    'meaning_assessment',
    'pronunciation_feedback',
    'speech_recognition',
    'speech_synthesis',
    'language_quality_check',
    'content_generation',
    'transcription_alignment',
    'realtime_conversation',
    'pronunciation_assessment',
  ];

  /// Tasks routed elsewhere than a model choice: a pipeline, or an acoustic assessor that may never be an LLM (ADR-006).
  static const readOnlyTasks = {'realtime_conversation', 'pronunciation_assessment'};

  List<ModelRoute> routesOf(String task) => [
    for (final r in routes)
      if (r.task == task) r,
  ];

  /// Router models that fit [task]: speech in, text in, or speech out.
  List<String> modelsFor(String task) => [
    for (final m in availableModels)
      if (switch (task) {
        'speech_synthesis' => m.modalities.contains('speech') || m.modalities.contains('audio'),
        'speech_recognition' || 'transcription_alignment' => m.modalities.contains('transcription') || m.modalities.contains('text'),
        _ => m.modalities.contains('text'),
      })
        m.id,
  ];
}

/// Whether the signed-in account is an admin (`GET /v1/me` → roles); false signed out or offline.
final isAdminProvider = FutureProvider<bool>((ref) async {
  final api = ref.watch(apiProvider);
  final user = ref.watch(accountProvider.select((a) => a.user));
  if (api == null || user == null) return false;
  try {
    final me = await api.me();
    final roles = [for (final r in (me['roles'] as List? ?? const [])) '$r'];
    return roles.contains('admin') || roles.contains('super_admin');
  } on ApiException {
    return false;
  }
});

final modelsOverviewProvider = FutureProvider.autoDispose<ModelsOverview>((ref) async {
  final api = ref.watch(apiProvider);
  if (api == null) throw ApiException(0, 'offline', 'No server');
  return ModelsOverview.fromResponse(await api.adminModels());
});
