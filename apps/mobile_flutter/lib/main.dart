import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'core/backend/narrator.dart';
import 'core/backend/account.dart';
import 'core/backend/auth_gateway.dart';
import 'core/backend/backend_config.dart';
import 'core/content/content_bundle.dart';
import 'core/content/content_cache.dart';
import 'core/content/content_source.dart';
import 'core/content/content_unreachable.dart';
import 'core/content/course_loading.dart';
import 'core/layout/display_preferences.dart';
import 'core/layout/phone_frame.dart';
import 'core/platform/browser_url.dart';
import 'core/services/app_state.dart';
import 'core/services/learner_store.dart';
import 'core/theme/app_theme.dart';
import 'features/account/email_link_prompt.dart';
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

  final prefs = await SharedPreferences.getInstance();
  final learnerStore = LearnerStore(prefs);
  // The content lives in the published bucket, not in the app: the catalog, then the chapters and voices of the
  // learner's courses only (each course is a file of its own); any other course is read when the learner opens it. The
  // device keeps what was read for the learner's courses, so the app opens offline afterwards.
  final source = ContentSource(location: ContentLocation.parse(await loadContentBaseUrl()), cache: await openContentCache());
  final ContentBundle content;
  try {
    content = await ContentBundle.load(source.read, courses: {for (final e in learnerStore.load().enrollments) e.trackId});
  } catch (e) {
    // A first start without the network (nothing kept yet): say so, and try again.
    debugPrint('Content not reachable: $e');
    runApp(ContentUnreachableApp(onRetry: main));
    return;
  }

  // An account is optional: without a backend in this build (or if it cannot start) the app stays offline.
  var backend = await loadBackendConfig();
  // Opened from a confirmation or password-reset email (web): the link's code, or the server's error, is in the address.
  final fromEmailLink = kIsWeb && isEmailLink(Uri.base);
  EmailLinkOutcome? emailLink;
  if (backend != null) {
    try {
      await Supabase.initialize(
        url: backend.supabaseUrl,
        publishableKey: backend.supabaseAnonKey,
        // Email links are read below, once, by the app itself: it routes with #/…, which is not an auth callback.
        authOptions: const FlutterAuthClientOptions(detectSessionInUri: false),
      );
      if (fromEmailLink) emailLink = await openStartupEmailLink(SupabaseAuthGateway(Supabase.instance.client), Uri.base);
    } catch (e) {
      debugPrint('Account features off: $e');
      backend = null;
    }
  }
  // The link's code or error leaves the address bar before the router reads it (the app routes with #/…), and a
  // reload never tries a spent code again.
  if (fromEmailLink) replaceBrowserUrl('${Uri.base.origin}${Uri.base.path}');

  runApp(
    ProviderScope(
      overrides: [
        contentBundleProvider.overrideWith(() => ContentNotifier(content, read: source.read)),
        contentSourceProvider.overrideWithValue(source),
        learnerStoreProvider.overrideWithValue(learnerStore),
        backendConfigProvider.overrideWithValue(backend),
        startupEmailLinkProvider.overrideWithValue(emailLink),
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
    // The active course's recorded narration is read as soon as the course is active, not when a lesson first speaks.
    ref.listen(narratorProvider, (_, _) {});
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
            child: ActiveCourseGate(child: EmailLinkPrompt(child: child ?? const SizedBox.shrink())),
          ),
        ),
      ),
      theme: buildAppTheme(colors, accent, isDark: appState.isDark),
    );
  }
}
