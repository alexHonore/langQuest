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
  Future<SignUpResult> signUp(String email, String password, {required String uiLocale, required String sourceLanguage});
  Future<void> signOut();

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
  Future<SignUpResult> signUp(String email, String password, {required String uiLocale, required String sourceLanguage}) async {
    try {
      // The `handle_new_user` trigger reads these to create the profile and account settings.
      final res = await _client.auth.signUp(
        email: email.trim(),
        password: password,
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
  Future<Set<String>> completedMissionIds(String enrollmentId) async {
    final rows = await _client.from('mission_progress').select('mission_id').eq('enrollment_id', enrollmentId).eq('status', 'completed');
    return {for (final row in rows) row['mission_id'] as String};
  }
}
