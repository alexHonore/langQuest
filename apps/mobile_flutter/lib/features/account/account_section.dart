import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../core/backend/account.dart';
import '../../core/services/app_state.dart';
import '../../core/theme/glass.dart';
import '../../l10n/l10n.dart';

/// Settings › Account: sign in to keep courses and completed missions with an account. Rendered only when a backend
/// is configured and answering (CONVENTIONS §8: visible means usable); an offline build shows nothing.
class AccountSection extends ConsumerStatefulWidget {
  const AccountSection({super.key});

  @override
  ConsumerState<AccountSection> createState() => _AccountSectionState();
}

class _AccountSectionState extends ConsumerState<AccountSection> {
  final _email = TextEditingController();
  final _password = TextEditingController();
  String? _notice;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit({required bool create}) async {
    final l10n = context.l10n;
    final email = _email.text.trim(), password = _password.text;
    if (email.isEmpty || password.isEmpty) {
      setState(() => _notice = l10n.accountMissingFields);
      return;
    }
    setState(() => _notice = null);
    final controller = ref.read(accountProvider.notifier);
    final signedIn = create ? await controller.signUp(email, password) : await controller.signIn(email, password);
    if (!mounted) return;
    if (signedIn) {
      _password.clear();
    } else if (create && ref.read(accountProvider).error == null) {
      setState(() => _notice = l10n.accountConfirmEmail);
    }
  }

  @override
  Widget build(BuildContext context) {
    final account = ref.watch(accountProvider);
    if (!account.available) return const SizedBox.shrink();
    final appState = ref.watch(appStateProvider);
    final colors = appState.colors;
    final accent = appState.accent;
    final l10n = context.l10n;
    final body = TextStyle(fontSize: 13.5, height: 1.4, color: colors.textSecondary);
    final user = account.user;

    InputDecoration field(String label, IconData icon) => InputDecoration(
      labelText: label,
      prefixIcon: Icon(icon, size: 18, color: colors.textMuted),
      filled: true,
      fillColor: colors.surface,
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: BorderSide(color: colors.border)),
      enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: BorderSide(color: colors.border)),
    );

    final children = <Widget>[
      Row(
        children: [
          Icon(user == null ? LucideIcons.cloudUpload : LucideIcons.cloudCheck, size: 20, color: accent.primaryText),
          const SizedBox(width: 10),
          Expanded(
            child: Semantics(
              header: true,
              child: Text(
                user == null ? l10n.accountTitle : l10n.accountSignedInAs(user.email),
                style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: colors.textPrimary),
              ),
            ),
          ),
        ],
      ),
      const SizedBox(height: 8),
    ];

    if (user == null) {
      children.addAll([
        Text(l10n.accountPitch, style: body),
        const SizedBox(height: 12),
        AutofillGroup(
          child: Column(
            children: [
              TextField(
                controller: _email,
                keyboardType: TextInputType.emailAddress,
                autofillHints: const [AutofillHints.email],
                textInputAction: TextInputAction.next,
                decoration: field(l10n.accountEmail, LucideIcons.mail),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: _password,
                obscureText: true,
                autofillHints: const [AutofillHints.password],
                onSubmitted: (_) => _submit(create: false),
                decoration: field(l10n.accountPassword, LucideIcons.lock),
              ),
            ],
          ),
        ),
        if (account.error != null || _notice != null) ...[
          const SizedBox(height: 8),
          Text(account.error ?? _notice!, style: TextStyle(fontSize: 13, color: account.error != null ? colors.error : colors.textSecondary)),
        ],
        const SizedBox(height: 12),
        Wrap(
          spacing: 10,
          runSpacing: 8,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            FilledButton(
              onPressed: account.busy ? null : () => _submit(create: false),
              style: FilledButton.styleFrom(backgroundColor: accent.primary, foregroundColor: accent.onPrimary),
              child: Text(l10n.accountSignIn),
            ),
            OutlinedButton(onPressed: account.busy ? null : () => _submit(create: true), child: Text(l10n.accountCreate)),
            if (account.busy) const SizedBox.square(dimension: 18, child: CircularProgressIndicator(strokeWidth: 2)),
          ],
        ),
      ]);
    } else {
      final report = account.lastReport;
      final notSaved = [
        for (final id in report?.coursesNotSaved ?? const <String>[])
          if (appState.content.track(id.split("|").first) case final t?) t.name(appState.uiLanguage),
      ];
      children.addAll([
        Text(switch (account.phase) {
          SyncPhase.syncing => l10n.accountSaving,
          SyncPhase.failed => l10n.accountSyncFailed,
          SyncPhase.idle => l10n.accountSaved,
        }, style: body),
        if (notSaved.isNotEmpty) ...[const SizedBox(height: 6), Text(l10n.accountNotSaved(notSaved.join(', ')), style: body)],
        const SizedBox(height: 6),
        Text(l10n.accountDeviceOnly, style: TextStyle(fontSize: 12.5, height: 1.4, color: colors.textMuted)),
        const SizedBox(height: 12),
        Wrap(
          spacing: 10,
          children: [
            if (account.phase == SyncPhase.failed)
              FilledButton(
                onPressed: () => ref.read(accountProvider.notifier).syncNow(),
                style: FilledButton.styleFrom(backgroundColor: accent.primary, foregroundColor: accent.onPrimary),
                child: Text(l10n.accountTryAgain),
              ),
            OutlinedButton(onPressed: account.busy ? null : () => ref.read(accountProvider.notifier).signOut(), child: Text(l10n.accountSignOut)),
          ],
        ),
      ]);
    }

    return Padding(
      padding: const EdgeInsets.only(top: 16),
      child: GlassContainer(
        level: GlassLevel.level1,
        radius: 20,
        padding: const EdgeInsets.all(18),
        child: Material(
          type: MaterialType.transparency,
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: children),
        ),
      ),
    );
  }
}
