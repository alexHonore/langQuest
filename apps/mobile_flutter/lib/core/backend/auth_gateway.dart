import 'package:flutter/foundation.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

/// The signed-in learner.
@immutable
class AccountUser {
  const AccountUser({required this.id, required this.email});

  final String id;
  final String email;

  @override
  bool operator ==(Object other) => other is AccountUser && other.id == id && other.email == email;

  @override
  int get hashCode => Object.hash(id, email);
}

/// How a sign-up ended: signed in straight away, or waiting for the learner to confirm their email.
enum SignUpResult { signedIn, confirmEmail }

/// The kind of email link the app was opened from: a sign-up confirmation, or a password reset.
enum EmailLink { confirmed, passwordRecovery }

/// Whether [uri] is an email link's way back into the app: a PKCE `code`, implicit-flow tokens, or the error the
/// server puts there instead (expired or used link). App routes (`#/missions`) never match.
bool isEmailLink(Uri uri) {
  final query = uri.queryParameters;
  if (query.containsKey('code') || query.containsKey('error_description') || query.containsKey('error_code')) return true;
  final fragment = uri.fragment;
  return fragment.contains('access_token=') || fragment.contains('error_description=') || fragment.contains('error_code=');
}

/// A sign-in or sign-up refused by the server, with its message (wrong password, email taken, weak password…).
class AuthFailure implements Exception {
  AuthFailure(this.message);

  final String message;

  @override
  String toString() => message;
}

/// Sign-in and the learner's own rows that row-level security lets them read. Separate from Supabase so the sync and
/// the settings screen can be tested without a server.
abstract class AuthGateway {
  AccountUser? get currentUser;
  Stream<AccountUser?> get userChanges;

  /// A valid access token for the API (refreshed when it has expired), or null when signed out.
  Future<String?> accessToken();

  Future<void> signIn(String email, String password);

  /// [redirectTo]: where the confirmation link opens the app (the server falls back to its Site URL).
  Future<SignUpResult> signUp(String email, String password, {required String uiLocale, required String sourceLanguage, String? redirectTo});
  Future<void> signOut();

  /// Emails a link to choose a new password; [redirectTo] is where the link opens the app.
  Future<void> sendPasswordReset(String email, {String? redirectTo});

  /// The signed-in learner's new password (after a password-reset link).
  Future<void> updatePassword(String password);

  /// Signs in from the email link the app was opened from ([uri], see [isEmailLink]) and says which kind it was.
  /// Throws [AuthFailure] when the link is invalid, expired, already used, or was asked for in another browser.
  Future<EmailLink> openEmailLink(Uri uri);

  /// Server ids of the missions [enrollmentId] has completed (`mission_progress`, owner-readable under RLS).
  Future<Set<String>> completedMissionIds(String enrollmentId);
}

class SupabaseAuthGateway implements AuthGateway {
  SupabaseAuthGateway(this._client);

  final SupabaseClient _client;

  static AccountUser? _user(User? user) => user == null ? null : AccountUser(id: user.id, email: user.email ?? '');

  @override
  AccountUser? get currentUser => _user(_client.auth.currentUser);

  @override
  Stream<AccountUser?> get userChanges => _client.auth.onAuthStateChange.map((state) => _user(state.session?.user));

  @override
  Future<String?> accessToken() async {
    var session = _client.auth.currentSession;
    if (session == null) return null;
    if (session.isExpired) {
      try {
        session = (await _client.auth.refreshSession()).session;
      } catch (_) {
        return null;
      }
    }
    return session?.accessToken;
  }

  @override
  Future<void> signIn(String email, String password) async {
    try {
      await _client.auth.signInWithPassword(email: email.trim(), password: password);
    } on AuthException catch (e) {
      throw AuthFailure(e.message);
    }
  }

  @override
  Future<SignUpResult> signUp(String email, String password, {required String uiLocale, required String sourceLanguage, String? redirectTo}) async {
    try {
      // The `handle_new_user` trigger reads these to create the profile and account settings.
      final res = await _client.auth.signUp(
        email: email.trim(),
        password: password,
        emailRedirectTo: redirectTo,
        data: {'ui_locale': uiLocale, 'default_source_language_code': sourceLanguage},
      );
      return res.session == null ? SignUpResult.confirmEmail : SignUpResult.signedIn;
    } on AuthException catch (e) {
      throw AuthFailure(e.message);
    }
  }

  @override
  Future<void> signOut() => _client.auth.signOut();

  @override
  Future<void> sendPasswordReset(String email, {String? redirectTo}) async {
    try {
      await _client.auth.resetPasswordForEmail(email.trim(), redirectTo: redirectTo);
    } on AuthException catch (e) {
      throw AuthFailure(e.message);
    }
  }

  @override
  Future<void> updatePassword(String password) async {
    try {
      await _client.auth.updateUser(UserAttributes(password: password));
    } on AuthException catch (e) {
      throw AuthFailure(e.message);
    }
  }

  @override
  Future<EmailLink> openEmailLink(Uri uri) async {
    try {
      final res = await _client.auth.getSessionFromUrl(uri);
      // PKCE links name the event their code was asked for with; implicit ones carry `type=recovery`.
      return const {'passwordRecovery', 'recovery'}.contains(res.redirectType) ? EmailLink.passwordRecovery : EmailLink.confirmed;
    } on AuthException catch (e) {
      throw AuthFailure(e.message);
    }
  }

  @override
  Future<Set<String>> completedMissionIds(String enrollmentId) async {
    final rows = await _client.from('mission_progress').select('mission_id').eq('enrollment_id', enrollmentId).eq('status', 'completed');
    return {for (final row in rows) row['mission_id'] as String};
  }
}
