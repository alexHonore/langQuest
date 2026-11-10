import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'core/backend/account.dart';
import 'core/backend/backend_config.dart';
import 'core/content/content_bundle.dart';
import 'core/layout/display_preferences.dart';
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
    // Subsets of these, bundled for the scripts Inter and Outfit lack (tool/subset_fonts.py).
    for (final family in ['NotoSansJP', 'NotoSansSC', 'NotoSansTC', 'NotoSansKR', 'NotoSansArabic', 'NotoSansHebrew', 'NotoSansDevanagari']) {
      yield LicenseEntryWithLineBreaks(['Noto Sans (${family.substring(8)})'], await rootBundle.loadString('assets/fonts/OFL-$family.txt'));
    }
  });

  final content = await ContentBundle.load(rootBundle);
  final prefs = await SharedPreferences.getInstance();

  // An account is optional: without a backend in this build (or if it cannot start) the app stays offline.
  var backend = await loadBackendConfig();
  if (backend != null) {
    try {
      await Supabase.initialize(
        url: backend.supabaseUrl,
        publishableKey: backend.supabaseAnonKey,
        // Password sign-in only: no email links or OAuth redirects to read from the URL (the app routes with #/…).
        authOptions: const FlutterAuthClientOptions(detectSessionInUri: false),
      );
    } catch (e) {
      debugPrint('Account features off: $e');
      backend = null;
    }
  }

  runApp(
    ProviderScope(
      overrides: [
        contentBundleProvider.overrideWithValue(content),
        learnerStoreProvider.overrideWithValue(LearnerStore(prefs)),
        backendConfigProvider.overrideWithValue(backend),
      ],
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
        child: DisplayPreferences(
          learner: appState.learner,
          child: PhoneFrame(
            backdrop: Color.alphaBlend(Colors.black.withValues(alpha: appState.isDark ? 0.5 : 0.07), colors.background),
            outline: colors.border,
            child: child ?? const SizedBox.shrink(),
          ),
        ),
      ),
      theme: buildAppTheme(colors, accent, isDark: appState.isDark),
    );
  }
}
