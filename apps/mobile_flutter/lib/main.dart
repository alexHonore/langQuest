import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'core/content/content_bundle.dart';
import 'core/layout/phone_frame.dart';
import 'core/services/app_state.dart';
import 'core/services/learner_store.dart';
import 'core/theme/app_theme.dart';
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

    return MaterialApp.router(
      onGenerateTitle: (context) => context.l10n.appTitle,
      debugShowCheckedModeBanner: false,
      routerConfig: router,
      locale: Locale(appState.uiLanguage),
      supportedLocales: AppLocalizations.supportedLocales,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      scrollBehavior: kIsWeb ? const PhoneScrollBehavior() : null,
      builder: (context, child) => AnnotatedRegion<SystemUiOverlayStyle>(
        value: (appState.isDark ? SystemUiOverlayStyle.light : SystemUiOverlayStyle.dark).copyWith(
          statusBarColor: Colors.transparent,
          systemNavigationBarColor: colors.background,
        ),
        child: PhoneFrame(
          backdrop: Color.alphaBlend(Colors.black.withValues(alpha: appState.isDark ? 0.5 : 0.07), colors.background),
          outline: colors.border,
          child: child ?? const SizedBox.shrink(),
        ),
      ),
      theme: buildAppTheme(colors, accent, isDark: appState.isDark),
    );
  }
}
