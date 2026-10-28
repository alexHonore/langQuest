import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import '../core/services/app_state.dart';
import '../core/theme/accents.dart';
import '../core/theme/colors.dart';
import '../core/theme/glass.dart';
import '../features/account/account_screen.dart';
import '../features/audio/audio_screen.dart';
import '../features/audio/mini_player.dart';
import '../features/catalog/catalog_screen.dart';
import '../features/learn/cards_screen.dart';
import '../features/learn/mission_path_screen.dart';
import '../features/learn/practice_screen.dart';
import '../features/learn/scene_lesson_screen.dart';
import '../features/home/home_screen.dart';
import '../features/missions/mission_player_screen.dart';
import '../features/missions/missions_screen.dart';
import '../features/progress/progress_screen.dart';
import '../features/review/review_screen.dart';
import '../features/speak/conversation_screen.dart';
import '../features/speak/speak_screen.dart';

final GlobalKey<NavigatorState> _rootNavigatorKey = GlobalKey<NavigatorState>();
final GlobalKey<NavigatorState> _shellNavigatorKey = GlobalKey<NavigatorState>();

final appRouterProvider = Provider<GoRouter>((ref) {
  return GoRouter(
    navigatorKey: _rootNavigatorKey,
    initialLocation: '/',
    routes: [
      ShellRoute(
        navigatorKey: _shellNavigatorKey,
        builder: (context, state, child) {
          return AppScaffold(child: child);
        },
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
            path: '/audio',
            pageBuilder: (context, state) => const NoTransitionPage(child: AudioScreen()),
          ),
          GoRoute(
            path: '/speak',
            pageBuilder: (context, state) => const NoTransitionPage(child: SpeakScreen()),
          ),
          GoRoute(
            path: '/progress',
            pageBuilder: (context, state) => const NoTransitionPage(child: ProgressScreen()),
          ),
        ],
      ),
      GoRoute(
        path: '/mission/:id',
        parentNavigatorKey: _rootNavigatorKey,
        builder: (context, state) {
          final id = state.pathParameters['id'] ?? 'm1';
          return MissionPlayerScreen(missionId: id);
        },
      ),
      // Learn path (approved L1 + L3 inside N2): a mission node, then its learn and practise stops.
      GoRoute(
        path: '/path/:id',
        parentNavigatorKey: _rootNavigatorKey,
        builder: (context, state) => MissionPathScreen(missionId: state.pathParameters['id'] ?? 'm1'),
      ),
      GoRoute(
        path: '/learn/:id/scene',
        parentNavigatorKey: _rootNavigatorKey,
        builder: (context, state) => SceneLessonScreen(missionId: state.pathParameters['id'] ?? 'm1'),
      ),
      GoRoute(
        path: '/learn/:id/cards',
        parentNavigatorKey: _rootNavigatorKey,
        builder: (context, state) => CardsScreen(missionId: state.pathParameters['id'] ?? 'm1'),
      ),
      GoRoute(
        path: '/learn/:id/practice',
        parentNavigatorKey: _rootNavigatorKey,
        builder: (context, state) => PracticeScreen(missionId: state.pathParameters['id'] ?? 'm1'),
      ),
      GoRoute(
        path: '/conversation',
        parentNavigatorKey: _rootNavigatorKey,
        builder: (context, state) => const ConversationScreen(),
      ),
      GoRoute(
        path: '/review',
        parentNavigatorKey: _rootNavigatorKey,
        builder: (context, state) => const ReviewScreen(),
      ),
      GoRoute(
        path: '/catalog',
        parentNavigatorKey: _rootNavigatorKey,
        builder: (context, state) => const CatalogScreen(),
      ),
      GoRoute(
        path: '/account',
        parentNavigatorKey: _rootNavigatorKey,
        builder: (context, state) => const AccountScreen(),
      ),
    ],
  );
});

class AppScaffold extends ConsumerWidget {
  final Widget child;

  const AppScaffold({super.key, required this.child});

  int _calculateSelectedIndex(BuildContext context) {
    final String location = GoRouterState.of(context).matchedLocation;
    if (location.startsWith('/missions')) return 1;
    if (location.startsWith('/audio')) return 2;
    if (location.startsWith('/speak')) return 3;
    if (location.startsWith('/progress')) return 4;
    return 0;
  }

  void _onItemTapped(int index, BuildContext context) {
    switch (index) {
      case 0:
        context.go('/');
        break;
      case 1:
        context.go('/missions');
        break;
      case 2:
        context.go('/audio');
        break;
      case 3:
        context.go('/speak');
        break;
      case 4:
        context.go('/progress');
        break;
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final appState = ref.watch(appStateProvider);
    final accent = appState.accent;
    final colors = appState.colors;
    final selectedIndex = _calculateSelectedIndex(context);

    return Scaffold(
      backgroundColor: colors.background,
      body: Stack(
        children: [
          Positioned.fill(child: child),

          // Floating Mini Player (anchored right above the bottom nav bar)
          const Positioned(
            left: 0,
            right: 0,
            bottom: 70,
            child: MiniPlayerWidget(),
          ),

          // Bottom Glass Navigation Bar
          Positioned(
            left: 0,
            right: 0,
            bottom: 0,
            child: GlassContainer(
              level: GlassLevel.level3,
              radius: 0,
              padding: EdgeInsets.zero,
              border: const Border(top: BorderSide(color: Color(0x24FFFFFF), width: 1)),
              child: SafeArea(
                top: false,
                child: SizedBox(
                  height: 64,
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceAround,
                    children: [
                      _buildNavItem(context, 0, selectedIndex, LucideIcons.home, 'Home', accent, colors),
                      _buildNavItem(context, 1, selectedIndex, LucideIcons.target, 'Missions', accent, colors),
                      _buildNavItem(context, 2, selectedIndex, LucideIcons.headphones, 'Audio', accent, colors),
                      _buildNavItem(context, 3, selectedIndex, LucideIcons.messageSquare, 'Speak', accent, colors),
                      _buildNavItem(context, 4, selectedIndex, LucideIcons.barChart2, 'Progress', accent, colors),
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

  Widget _buildNavItem(
    BuildContext context,
    int index,
    int selectedIndex,
    IconData icon,
    String label,
    CourseAccent accent,
    LangQuestColors colors,
  ) {
    final isSelected = index == selectedIndex;
    final color = isSelected ? accent.primaryText : colors.textMuted;

    return GestureDetector(
      onTap: () => _onItemTapped(index, context),
      behavior: HitTestBehavior.opaque,
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(
            icon,
            size: 20,
            color: color,
          ),
          const SizedBox(height: 4),
          Text(
            label,
            style: TextStyle(
              fontSize: 11,
              fontWeight: isSelected ? FontWeight.w700 : FontWeight.w500,
              color: color,
            ),
          ),
        ],
      ),
    );
  }
}
