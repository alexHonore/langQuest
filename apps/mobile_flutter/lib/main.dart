import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'core/content/content_bundle.dart';
import 'core/services/app_state.dart';
import 'core/services/learner_store.dart';
import 'core/theme/typography.dart';
import 'l10n/l10n.dart';
import 'navigation/app_router.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // Outfit and Inter ship in assets/fonts: text never waits on, or reports to, a font CDN.
  GoogleFonts.config.allowRuntimeFetching = false;
  LicenseRegistry.addLicense(() async* {
    for (final family in ['Inter', 'Outfit']) {
      yield LicenseEntryWithLineBreaks(['google_fonts: $family'], await rootBundle.loadString('assets/fonts/OFL-$family.txt'));
    }
  });

  final content = await ContentBundle.load(rootBundle);
  final prefs = await SharedPreferences.getInstance();

  runApp(
    ProviderScope(
      overrides: [contentBundleProvider.overrideWithValue(content), learnerStoreProvider.overrideWithValue(LearnerStore(prefs))],
      child: const LangQuestApp(),
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
    final brightness = appState.isDark ? Brightness.dark : Brightness.light;

    return MaterialApp.router(
      onGenerateTitle: (context) => context.l10n.appTitle,
      debugShowCheckedModeBanner: false,
      routerConfig: router,
      locale: Locale(appState.uiLanguage),
      supportedLocales: AppLocalizations.supportedLocales,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      builder: (context, child) => AnnotatedRegion<SystemUiOverlayStyle>(
        value: (appState.isDark ? SystemUiOverlayStyle.light : SystemUiOverlayStyle.dark).copyWith(
          statusBarColor: Colors.transparent,
          systemNavigationBarColor: colors.background,
        ),
        child: child ?? const SizedBox.shrink(),
      ),
      theme: ThemeData(
        brightness: brightness,
        scaffoldBackgroundColor: colors.background,
        colorScheme: ColorScheme(
          brightness: brightness,
          primary: accent.primary,
          onPrimary: accent.onPrimary,
          secondary: accent.lantern[1],
          onSecondary: colors.textPrimary,
          error: colors.error,
          onError: colors.background,
          surface: colors.surface,
          onSurface: colors.textPrimary,
          surfaceContainerHighest: colors.surfaceMuted,
          outline: colors.borderStrong,
          outlineVariant: colors.border,
        ),
        textTheme: LangQuestTypography.createTextTheme(colors),
        appBarTheme: AppBarTheme(backgroundColor: colors.background, elevation: 0),
        dialogTheme: DialogThemeData(backgroundColor: colors.elevated),
        snackBarTheme: SnackBarThemeData(
          backgroundColor: colors.textPrimary,
          contentTextStyle: TextStyle(color: colors.background, fontSize: 14),
          behavior: SnackBarBehavior.floating,
        ),
      ),
    );
  }
}
