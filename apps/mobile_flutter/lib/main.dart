import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'core/services/app_state.dart';
import 'core/theme/typography.dart';
import 'navigation/app_router.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();

  // Dark navigation & status bar
  SystemChrome.setSystemUIOverlayStyle(
    const SystemUiOverlayStyle(
      statusBarColor: Colors.transparent,
      statusBarIconBrightness: Brightness.light,
      systemNavigationBarColor: Color(0xFF0B0913),
      systemNavigationBarIconBrightness: Brightness.light,
    ),
  );

  runApp(
    const ProviderScope(
      child: LangQuestApp(),
    ),
  );
}

class LangQuestApp extends ConsumerWidget {
  const LangQuestApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final router = ref.watch(appRouterProvider);
    final appState = ref.watch(appStateProvider);
    final colors = appState.colors;
    final accent = appState.accent;

    return MaterialApp.router(
      title: 'LangQuest',
      debugShowCheckedModeBanner: false,
      routerConfig: router,
      theme: ThemeData(
        brightness: appState.isDark ? Brightness.dark : Brightness.light,
        scaffoldBackgroundColor: colors.background,
        colorScheme: ColorScheme(
          brightness: appState.isDark ? Brightness.dark : Brightness.light,
          primary: accent.primary,
          onPrimary: accent.onPrimary,
          secondary: accent.lantern[1],
          onSecondary: Colors.white,
          error: colors.error,
          onError: Colors.white,
          surface: colors.surface,
          onSurface: colors.textPrimary,
        ),
        textTheme: LangQuestTypography.createTextTheme(colors),
        appBarTheme: AppBarTheme(
          backgroundColor: colors.background,
          elevation: 0,
        ),
      ),
    );
  }
}
