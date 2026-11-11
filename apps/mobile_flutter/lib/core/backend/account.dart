import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../services/app_state.dart';
import '../services/learner_store.dart';
import 'api_client.dart';
import 'auth_gateway.dart';
import 'backend_config.dart';
import 'server_course.dart';
import 'sync_service.dart';

/// Null in an offline build (no backend configured): no account features exist. Overridden in `main()`.
final backendConfigProvider = Provider<BackendConfig?>((ref) => null);

/// What the email link the app was opened from did (sign-up confirmation, password reset, or a refused link); null
/// when the app was opened normally. Set once in `main()`, before the router reads the address.
final startupEmailLinkProvider = Provider<EmailLinkOutcome?>((ref) => null);

@immutable
class EmailLinkOutcome {
  const EmailLinkOutcome(EmailLink this.kind) : error = null;
  const EmailLinkOutcome.failed(this.error) : kind = null;

  /// Null when the link was refused.
  final EmailLink? kind;

  /// The server's reason for refusing the link, when it gave one.
  final String? error;
}

/// Opens the email link the app was started from, never throwing: a refused or unreachable link is an outcome too.
Future<EmailLinkOutcome> openStartupEmailLink(AuthGateway auth, Uri uri) async {
  try {
    return EmailLinkOutcome(await auth.openEmailLink(uri).timeout(const Duration(seconds: 15)));
  } on AuthFailure catch (e) {
    return EmailLinkOutcome.failed(e.message);
  } catch (_) {
    return const EmailLinkOutcome.failed(null);
  }
}

/// Where email links (confirmation, password reset) open the app: this web app's own address. Null in the phone
/// builds, which have no link handling yet, so the server's Site URL applies.
String? emailLinkTarget() => kIsWeb ? '${Uri.base.origin}${Uri.base.path}' : null;

final authGatewayProvider = Provider<AuthGateway?>((ref) => ref.watch(backendConfigProvider) == null ? null : SupabaseAuthGateway(Supabase.instance.client));

final apiProvider = Provider<LangQuestApi?>((ref) {
  final config = ref.watch(backendConfigProvider);
  final auth = ref.watch(authGatewayProvider);
  if (config == null || auth == null) return null;
  return LangQuestApi(baseUrl: config.apiBaseUrl, accessToken: auth.accessToken);
});

/// What the server offers each course taught from [source] (public `GET /v1/courses?source=`), by track id: the course
/// page says what an account adds (live calls, spoken answers checked). Empty offline or when the server is down.
final serverOffersProvider = FutureProvider.family<Map<String, ServerTrackOffer>, String>((ref, source) async {
  final api = ref.watch(apiProvider);
  if (api == null) return const {};
  try {
    return {
      for (final c in await api.courses(source))
        if (c['track'] is Map && (c['track'] as Map)['id'] is String) (c['track'] as Map)['id'] as String: ServerTrackOffer.fromSummary(c),
    };
  } catch (_) {
    return const {};
  }
});

final syncLedgerProvider = Provider<SyncLedger>((ref) => SyncLedger(ref.watch(learnerStoreProvider).prefs));

final syncServiceProvider = Provider<SyncService?>((ref) {
  final api = ref.watch(apiProvider);
  final auth = ref.watch(authGatewayProvider);
  if (api == null || auth == null) return null;
  return SyncService(api: api, auth: auth, ledger: ref.watch(syncLedgerProvider), target: ref.read(appStateProvider.notifier), now: ref.read(clockProvider));
});

enum SyncPhase { idle, syncing, failed }

@immutable
class AccountState {
  const AccountState({this.available = false, this.user, this.busy = false, this.error, this.phase = SyncPhase.idle, this.lastSyncedAt, this.lastReport});

  /// A backend is configured and answering: only then is anything about accounts shown (visible means usable).
  final bool available;
  final AccountUser? user;

  /// Signing in, up or out.
  final bool busy;

  /// The last sign-in or sign-up refusal, as the server worded it.
  final String? error;
  final SyncPhase phase;
  final DateTime? lastSyncedAt;
  final SyncReport? lastReport;

  /// The signed-in account's course [courseId] as the server holds it (null signed out, before the first sync, or
  /// when the account does not have that course): what its AI features can do.
  ServerCourse? serverCourse(String? courseId) => user == null || !available || courseId == null ? null : lastReport?.courses[courseId];

  AccountState copyWith({
    bool? available,
    AccountUser? Function()? user,
    bool? busy,
    String? Function()? error,
    SyncPhase? phase,
    DateTime? lastSyncedAt,
    SyncReport? lastReport,
  }) => AccountState(
    available: available ?? this.available,
    user: user != null ? user() : this.user,
    busy: busy ?? this.busy,
    error: error != null ? error() : this.error,
    phase: phase ?? this.phase,
    lastSyncedAt: lastSyncedAt ?? this.lastSyncedAt,
    lastReport: lastReport ?? this.lastReport,
  );
}

class AccountController extends Notifier<AccountState> {
  StreamSubscription<AccountUser?>? _changes;
  Timer? _debounce;

  @override
  AccountState build() {
    final auth = ref.watch(authGatewayProvider);
    final api = ref.watch(apiProvider);
    ref.onDispose(() {
      _changes?.cancel();
      _debounce?.cancel();
    });
    if (auth == null || api == null) return const AccountState();
    _changes = auth.userChanges.listen((user) {
      if (user?.id != state.user?.id) {
        state = state.copyWith(user: () => user);
        if (user != null) unawaited(syncNow());
      }
    });
    unawaited(_checkAvailable(api, auth));
    return AccountState(user: auth.currentUser);
  }

  Future<void> _checkAvailable(LangQuestApi api, AuthGateway auth) async {
    final healthy = await api.isHealthy();
    if (!ref.mounted) return;
    state = state.copyWith(available: healthy);
    if (healthy && auth.currentUser != null) unawaited(syncNow());
  }

  Future<bool> signIn(String email, String password) => _auth((auth) => auth.signIn(email, password).then((_) => true));

  /// False when the account waits for an email confirmation (nothing is signed in yet).
  Future<bool> signUp(String email, String password) {
    final ui = ref.read(appStateProvider).uiLanguage;
    return _auth((auth) async => await auth.signUp(email, password, uiLocale: ui, sourceLanguage: ui, redirectTo: emailLinkTarget()) == SignUpResult.signedIn);
  }

  /// Emails [email] a link to choose a new password. True once asked (whether an account uses that address is not
  /// said, by the server or here); false on failure (see [AccountState.error]).
  Future<bool> sendPasswordReset(String email) async {
    final auth = ref.read(authGatewayProvider);
    if (auth == null) return false;
    state = state.copyWith(busy: true, error: () => null);
    try {
      await auth.sendPasswordReset(email, redirectTo: emailLinkTarget());
      state = state.copyWith(busy: false);
      return true;
    } on AuthFailure catch (e) {
      state = state.copyWith(busy: false, error: () => e.message);
      return false;
    } catch (e) {
      state = state.copyWith(busy: false, error: () => '$e');
      return false;
    }
  }

  /// Sets the signed-in learner's new password (after a password-reset link). Null on success, else the reason.
  Future<String?> updatePassword(String password) async {
    final auth = ref.read(authGatewayProvider);
    if (auth == null) return '';
    try {
      await auth.updatePassword(password);
      return null;
    } on AuthFailure catch (e) {
      return e.message;
    } catch (e) {
      return '$e';
    }
  }

  Future<void> signOut() async {
    final auth = ref.read(authGatewayProvider);
    if (auth == null) return;
    state = state.copyWith(busy: true);
    await auth.signOut();
    state = AccountState(available: state.available);
  }

  Future<bool> _auth(Future<bool> Function(AuthGateway auth) action) async {
    final auth = ref.read(authGatewayProvider);
    if (auth == null) return false;
    state = state.copyWith(busy: true, error: () => null);
    try {
      final signedIn = await action(auth);
      state = state.copyWith(busy: false, user: () => auth.currentUser);
      if (signedIn) unawaited(syncNow());
      return signedIn;
    } on AuthFailure catch (e) {
      state = state.copyWith(busy: false, error: () => e.message);
      return false;
    } catch (e) {
      state = state.copyWith(busy: false, error: () => '$e');
      return false;
    }
  }

  /// Everything the account holds, as indented JSON (`GET /v1/me/export`); null on failure (see [AccountState.error]).
  Future<String?> exportData() async {
    final api = ref.read(apiProvider);
    if (api == null || state.user == null) return null;
    state = state.copyWith(busy: true, error: () => null);
    try {
      final data = await api.exportData();
      state = state.copyWith(busy: false);
      return const JsonEncoder.withIndent('  ').convert(data);
    } on ApiException catch (e) {
      state = state.copyWith(busy: false, error: () => e.message.isNotEmpty ? e.message : e.code);
      return null;
    }
  }

  /// Deletes the account on the server. Only once the server has confirmed does this device sign out (and forget what
  /// it had sent to that account); its own progress stays until the learner resets it. Returns the server's status,
  /// `deleted` or `scheduled`, or null on failure (see [AccountState.error]).
  Future<String?> deleteAccount() async {
    final api = ref.read(apiProvider);
    final auth = ref.read(authGatewayProvider);
    final user = state.user;
    if (api == null || auth == null || user == null) return null;
    state = state.copyWith(busy: true, error: () => null);
    try {
      final status = '${(await api.deleteAccount())['status']}';
      await ref.read(syncLedgerProvider).forget(user.id);
      try {
        await auth.signOut();
      } catch (_) {
        // The account is gone; a failed local sign-out must not hide that.
      }
      state = AccountState(available: state.available);
      return status;
    } on ApiException catch (e) {
      state = state.copyWith(busy: false, error: () => e.message.isNotEmpty ? e.message : e.code);
      return null;
    }
  }

  /// Sync soon (after a change on this device), coalescing bursts of changes.
  void scheduleSync() {
    if (state.user == null || !state.available) return;
    _debounce?.cancel();
    _debounce = Timer(const Duration(seconds: 2), () => unawaited(syncNow()));
  }

  Future<void> syncNow() async {
    final sync = ref.read(syncServiceProvider);
    if (sync == null || state.user == null) return;
    state = state.copyWith(phase: SyncPhase.syncing);
    try {
      final report = await sync.sync();
      if (!ref.mounted) return;
      state = state.copyWith(phase: SyncPhase.idle, lastSyncedAt: ref.read(clockProvider)(), lastReport: report);
    } catch (e) {
      debugPrint('sync failed: $e');
      if (!ref.mounted) return;
      state = state.copyWith(phase: SyncPhase.failed);
    }
  }
}

final accountProvider = NotifierProvider<AccountController, AccountState>(AccountController.new);
