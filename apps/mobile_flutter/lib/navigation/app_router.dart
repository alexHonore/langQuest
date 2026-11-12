import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../core/services/app_state.dart';
import '../core/theme/glass.dart';
import '../features/audio/audio_screens.dart';
import '../features/call/call_record_screen.dart';
import '../features/call/call_screen.dart';
import '../features/admin/admin_models_screen.dart';
import '../features/call/speak_screen.dart';
import '../features/account/account_screen.dart';
import '../features/catalog/catalog_screen.dart';
import '../features/catalog/course_detail_screen.dart';
import '../features/games/game_screens.dart';
import '../features/games/games_hub_screen.dart';
import '../features/home/home_screen.dart';
import '../features/learn/cards_screen.dart';
import '../features/learn/mission_path_screen.dart';
import '../features/learn/practice_screen.dart';
import '../features/learn/practise_saying_screen.dart';
import '../features/learn/scene_lesson_screen.dart';
import '../features/missions/mission_player_screen.dart';
import '../features/missions/missions_screen.dart';
import '../features/onboarding/warmup_screen.dart';
import '../features/onboarding/welcome_screen.dart';
import '../features/progress/progress_screen.dart';
import '../features/review/review_screen.dart';
import '../l10n/l10n.dart';

/// Routes a learner without any course may visit (the first-run flow and the catalog it links to).
bool isOnboardingLocation(String location) =>
    location == '/welcome' || location.startsWith('/welcome/') || location == '/catalog' || location.startsWith('/course/');

/// Where to send [location]: first-run screens until the first enrollment, never back to them afterwards.
String? redirectFor(String location, {required bool hasEnrollment}) {
  if (!hasEnrollment && !isOnboardingLocation(location)) return '/welcome';
  if (hasEnrollment && (location == '/welcome' || location.startsWith('/welcome/'))) return '/';
  return null;
}

/// Re-runs the redirect when the learner gains or loses their last course (and only then).
class _EnrollmentListenable extends ChangeNotifier {
  _EnrollmentListenable(Ref ref) {
    ref.listen<bool>(appStateProvider.select((s) => s.hasEnrollment), (_, _) => notifyListeners());
  }
}

/// The app's top navigator: dialogs that belong to no screen (an email link opening the app) are shown with it.
final rootNavigatorKey = GlobalKey<NavigatorState>(debugLabel: 'root');

final appRouterProvider = Provider<GoRouter>((ref) {
  final rootKey = rootNavigatorKey;
  final shellKey = GlobalKey<NavigatorState>(debugLabel: 'shell');
  final refresh = _EnrollmentListenable(ref);
  ref.onDispose(refresh.dispose);

  GoRoute page(String path, Widget Function(GoRouterState state) build) =>
      GoRoute(path: path, parentNavigatorKey: rootKey, builder: (context, state) => build(state));

  final router = GoRouter(
    navigatorKey: rootKey,
    initialLocation: '/',
    refreshListenable: refresh,
    redirect: (context, state) => redirectFor(state.matchedLocation, hasEnrollment: ref.read(appStateProvider).hasEnrollment),
    routes: [
      ShellRoute(
        navigatorKey: shellKey,
        builder: (context, state, child) => AppScaffold(child: child),
        routes: [
          GoRoute(
            path: '/',
            pageBuilder: (context, state) => const NoTransitionPage(child: HomeScreen()),
          ),
          GoRoute(
            path: '/missions',
            pageBuilder: (context, state) => const NoTransitionPage(child: MissionsScreen()),
          ),
          GoRoute(
            path: '/progress',
            pageBuilder: (context, state) => const NoTransitionPage(child: ProgressScreen()),
          ),
          GoRoute(
            path: '/audio',
            pageBuilder: (context, state) => const NoTransitionPage(child: AudioLibraryScreen()),
          ),
          GoRoute(
            path: '/play',
            pageBuilder: (context, state) => const NoTransitionPage(child: GamesHubScreen()),
          ),
          GoRoute(
            path: '/talk',
            pageBuilder: (context, state) => const NoTransitionPage(child: SpeakScreen()),
          ),
        ],
      ),
      page('/welcome', (_) => const WelcomeScreen()),
      page('/welcome/courses', (_) => const PickCourseScreen()),
      page('/catalog', (_) => const CatalogScreen()),
      page('/course/:trackId', (s) => CourseDetailScreen(trackId: s.pathParameters['trackId']!)),
      // Learn path (approved L1 + L3 inside N2): a mission node, then its learn, practise, play and mission stops.
      page('/path/:id', (s) => MissionPathScreen(missionKey: s.pathParameters['id']!)),
      page('/admin/models', (s) => const AdminModelsScreen()),
      page('/learn/:id/scene', (s) => SceneLessonScreen(missionKey: s.pathParameters['id']!)),
      page('/learn/:id/cards', (s) => CardsScreen(missionKey: s.pathParameters['id']!)),
      page('/learn/:id/practice', (s) => PracticeScreen(missionKey: s.pathParameters['id']!)),
      // A mission's Play stop: a round of a mini-game with the mission's own phrases.
      page('/learn/:id/play', (s) => MissionPlayScreen(missionKey: s.pathParameters['id']!)),
      page('/mission/:id', (s) => MissionPlayerScreen(missionKey: s.pathParameters['id']!)),
      page('/speak/:id', (s) => PractiseSayingScreen(missionKey: s.pathParameters['id']!)),
      page('/call/:id', (s) => CallScreen(missionKey: s.pathParameters['id']!)),
      page('/talk/:character', (s) => CallScreen(characterId: s.pathParameters['character']!)),
      page('/calls/:id', (s) => CallRecordScreen(recordId: s.pathParameters['id']!)),
      // The chapter's mixes (every conversation back to back, a recall of what was learned) before a mission's lesson.
      page('/audio/mix/:kind', (s) => AudioLessonScreen.mix(kind: s.pathParameters['kind']!)),
      page('/audio/:id', (s) => AudioLessonScreen(missionKey: s.pathParameters['id']!)),
      // Mini-games (the Play tab opens them): the phrases already taught, another way.
      page('/play/memory', (_) => const MemoryGameScreen()),
      page('/play/quick', (_) => const QuickGameScreen()),
      page('/play/ear', (_) => const EarGameScreen()),
      page('/play/dash', (_) => const DashGameScreen()),
      page('/warmup', (_) => const WarmupScreen()),
      page('/review', (_) => const ReviewScreen()),
      page('/account', (_) => const AccountScreen()),
    ],
  );
  ref.onDispose(router.dispose);
  return router;
});

/// The tab shell: Home, Missions, Play, Progress; Speak when live calls back the course (signed in, the server's
/// snapshot); Audio when the course's lessons can be heard here (a device voice for it, or the server's AI voice). A
/// tab never opens onto a placeholder (CONVENTIONS §8): before anything is taught, Play leads to the first lesson.
class AppScaffold extends ConsumerWidget {
  final Widget child;

  const AppScaffold({super.key, required this.child});

  int _selectedIndex(BuildContext context, List<String> tabs) {
    final location = GoRouterState.of(context).matchedLocation;
    for (var i = tabs.length - 1; i > 0; i--) {
      if (location.startsWith(tabs[i])) return i;
    }
    return 0;
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final appState = ref.watch(appStateProvider);
    final accent = appState.accent;
    final colors = appState.colors;
    final l10n = context.l10n;
    final audio = ref.watch(audioLessonsAvailableProvider);
    // Signed out on a course with calls, the tab says how to unlock them (a free account) rather than hiding them.
    final speak = ref.watch(liveCallCourseProvider) != null || ref.watch(callsNeedAccountProvider);
    final tabs = ['/', '/missions', '/play', if (speak) '/talk', if (audio) '/audio', '/progress'];
    final selected = _selectedIndex(context, tabs);
    final items = [
      (LucideIcons.home, l10n.tabHome),
      (LucideIcons.target, l10n.tabMissions),
      (LucideIcons.gamepad2, l10n.tabPlay),
      if (speak) (LucideIcons.messagesSquare, l10n.tabSpeak),
      if (audio) (LucideIcons.headphones, l10n.tabAudio),
      (LucideIcons.barChart2, l10n.tabProgress),
    ];

    return Scaffold(
      backgroundColor: colors.background,
      body: Stack(
        children: [
          Positioned.fill(child: child),
          Positioned(
            left: 0,
            right: 0,
            bottom: 0,
            child: GlassContainer(
              level: GlassLevel.level3,
              radius: 0,
              padding: EdgeInsets.zero,
              border: Border(top: BorderSide(color: colors.border, width: 1)),
              child: SafeArea(
                top: false,
                child: SizedBox(
                  height: 64,
                  child: Row(
                    children: [
                      for (var i = 0; i < items.length; i++)
                        Expanded(
                          child: Semantics(
                            button: true,
                            selected: i == selected,
                            label: items[i].$2,
                            excludeSemantics: true,
                            child: InkWell(
                              onTap: () => context.go(tabs[i]),
                              child: Column(
                                mainAxisAlignment: MainAxisAlignment.center,
                                children: [
                                  Icon(items[i].$1, size: 21, color: i == selected ? accent.primaryText : colors.textMuted),
                                  const SizedBox(height: 4),
                                  // Up to six tabs: a long label shrinks to fit rather than overflowing.
                                  FittedBox(
                                    fit: BoxFit.scaleDown,
                                    child: Padding(
                                      padding: const EdgeInsets.symmetric(horizontal: 2),
                                      child: Text(
                                        items[i].$2,
                                        maxLines: 1,
                                        style: TextStyle(
                                          fontSize: 11.5,
                                          fontWeight: i == selected ? FontWeight.w700 : FontWeight.w500,
                                          color: i == selected ? accent.primaryText : colors.textMuted,
                                        ),
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ),
                        ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
