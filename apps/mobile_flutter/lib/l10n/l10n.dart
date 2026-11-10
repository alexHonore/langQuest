import 'package:flutter/widgets.dart';

import 'generated/app_localizations.dart';

export 'generated/app_localizations.dart';

extension L10nContext on BuildContext {
  /// The interface strings for the current locale (English or French).
  AppLocalizations get l10n => AppLocalizations.of(this);
}
