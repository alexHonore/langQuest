import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../core/services/app_state.dart';
import '../core/theme/glass.dart';
import '../features/account/account_screen.dart';
import '../features/catalog/catalog_screen.dart';
import '../features/catalog/course_detail_screen.dart';
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
        ],
      ),
      page('/welcome', (_) => const WelcomeScreen()),
      page('/welcome/courses', (_) => const PickCourseScreen()),
      page('/catalog', (_) => const CatalogScreen()),
      page('/course/:trackId', (s) => CourseDetailScreen(trackId: s.pathParameters['trackId']!)),
      // Learn path (approved L1 + L3 inside N2): a mission node, then its learn, practise and mission stops.
      page('/path/:id', (s) => MissionPathScreen(missionKey: s.pathParameters['id']!)),
      page('/learn/:id/scene', (s) => SceneLessonScreen(missionKey: s.pathParameters['id']!)),
      page('/learn/:id/cards', (s) => CardsScreen(missionKey: s.pathParameters['id']!)),
      page('/learn/:id/practice', (s) => PracticeScreen(missionKey: s.pathParameters['id']!)),
      page('/mission/:id', (s) => MissionPlayerScreen(missionKey: s.pathParameters['id']!)),
      page('/speak/:id', (s) => PractiseSayingScreen(missionKey: s.pathParameters['id']!)),
      page('/warmup', (_) => const WarmupScreen()),
      page('/review', (_) => const ReviewScreen()),
      page('/account', (_) => const AccountScreen()),
    ],
  );
  ref.onDispose(router.dispose);
  return router;
});

/// The tab shell: Home, Missions and Progress. Audio and Speak are not shown in this build — nothing real backs
/// them yet (no licensed audio library, no live conversation partner), and a tab never opens onto a placeholder
/// (CONVENTIONS §8, as the Expo app hides them per course capability).
class AppScaffold extends ConsumerWidget {
  final Widget child;

  const AppScaffold({super.key, required this.child});

  static const _tabs = ['/', '/missions', '/progress'];

  int _selectedIndex(BuildContext context) {
    final location = GoRouterState.of(context).matchedLocation;
    if (location.startsWith('/missions')) return 1;
    if (location.startsWith('/progress')) return 2;
    return 0;
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final appState = ref.watch(appStateProvider);
    final accent = appState.accent;
    final colors = appState.colors;
    final l10n = context.l10n;
    final selected = _selectedIndex(context);
    final items = [(LucideIcons.home, l10n.tabHome), (LucideIcons.target, l10n.tabMissions), (LucideIcons.barChart2, l10n.tabProgress)];

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
                              onTap: () => context.go(_tabs[i]),
                              child: Column(
                                mainAxisAlignment: MainAxisAlignment.center,
                                children: [
                                  Icon(items[i].$1, size: 21, color: i == selected ? accent.primaryText : colors.textMuted),
                                  const SizedBox(height: 4),
                                  Text(
                                    items[i].$2,
                                    style: TextStyle(
                                      fontSize: 11.5,
                                      fontWeight: i == selected ? FontWeight.w700 : FontWeight.w500,
                                      color: i == selected ? accent.primaryText : colors.textMuted,
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
