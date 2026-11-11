import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/backend/account.dart';
import '../../core/backend/auth_gateway.dart';
import '../../l10n/l10n.dart';
import '../../navigation/app_router.dart';

/// Says once what the email link the app was opened from did: a confirmed email has signed the learner in; a
/// password-reset link asks for the new password; a refused link says why and what to do instead.
class EmailLinkPrompt extends ConsumerStatefulWidget {
  const EmailLinkPrompt({super.key, required this.child});

  final Widget child;

  @override
  ConsumerState<EmailLinkPrompt> createState() => _EmailLinkPromptState();
}

class _EmailLinkPromptState extends ConsumerState<EmailLinkPrompt> {
  @override
  void initState() {
    super.initState();
    final outcome = ref.read(startupEmailLinkProvider);
    if (outcome != null) WidgetsBinding.instance.addPostFrameCallback((_) => _show(outcome));
  }

  Future<void> _show(EmailLinkOutcome outcome) async {
    if (!mounted) return;
    final l10n = context.l10n;
    final messenger = ScaffoldMessenger.of(context);
    void say(String message) => messenger.showSnackBar(SnackBar(content: Text(message), duration: const Duration(seconds: 8)));
    switch (outcome.kind) {
      case EmailLink.confirmed:
        say(l10n.emailConfirmed);
      case EmailLink.passwordRecovery:
        final navigator = rootNavigatorKey.currentContext;
        if (navigator == null) return;
        final changed = await showDialog<bool>(context: navigator, barrierDismissible: false, builder: (_) => const NewPasswordDialog());
        if (changed == true && mounted) say(l10n.passwordChanged);
      case null:
        say(l10n.emailLinkFailed);
    }
  }

  @override
  Widget build(BuildContext context) => widget.child;
}

/// The new password after a password-reset link (the link has signed the learner in). Owns its text field's
/// controller, so the field outlives the dialog's closing animation.
class NewPasswordDialog extends ConsumerStatefulWidget {
  const NewPasswordDialog({super.key});

  @override
  ConsumerState<NewPasswordDialog> createState() => _NewPasswordDialogState();
}

class _NewPasswordDialogState extends ConsumerState<NewPasswordDialog> {
  final _password = TextEditingController();
  bool _saving = false;
  String? _error;

  @override
  void dispose() {
    _password.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final password = _password.text;
    if (password.isEmpty || _saving) return;
    setState(() {
      _saving = true;
      _error = null;
    });
    final refused = await ref.read(accountProvider.notifier).updatePassword(password);
    if (!mounted) return;
    if (refused == null) {
      Navigator.of(context).pop(true);
    } else {
      setState(() {
        _saving = false;
        _error = refused.isEmpty ? context.l10n.newPasswordFailed : refused;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final email = ref.watch(accountProvider.select((s) => s.user?.email)) ?? '';
    return AlertDialog(
      title: Text(l10n.newPasswordTitle),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(l10n.newPasswordBody(email)),
            const SizedBox(height: 12),
            AutofillGroup(
              child: TextField(
                controller: _password,
                autofocus: true,
                obscureText: true,
                autofillHints: const [AutofillHints.newPassword],
                decoration: InputDecoration(labelText: l10n.newPasswordLabel, errorText: _error, errorMaxLines: 4),
                onChanged: (_) => setState(() {}),
                onSubmitted: (_) => _save(),
              ),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(onPressed: _saving ? null : () => Navigator.of(context).pop(false), child: Text(l10n.later)),
        TextButton(onPressed: _saving || _password.text.isEmpty ? null : _save, child: Text(l10n.newPasswordSave)),
      ],
    );
  }
}
