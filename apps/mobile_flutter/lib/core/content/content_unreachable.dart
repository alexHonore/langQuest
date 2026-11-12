import 'dart:ui' show PlatformDispatcher;

import 'package:flutter/material.dart';

/// Shown instead of the app when the very first start finds no network: the courses are downloaded, not built in.
/// Plain words in the device's language (English or French: the app's own strings need the content's catalog).
class ContentUnreachableApp extends StatefulWidget {
  const ContentUnreachableApp({super.key, required this.onRetry});

  final Future<void> Function() onRetry;

  @override
  State<ContentUnreachableApp> createState() => _ContentUnreachableAppState();
}

class _ContentUnreachableAppState extends State<ContentUnreachableApp> {
  bool _trying = false;

  @override
  Widget build(BuildContext context) {
    final fr = PlatformDispatcher.instance.locale.languageCode == 'fr';
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      theme: ThemeData(brightness: Brightness.dark, colorSchemeSeed: const Color(0xFFF2542D), useMaterial3: true),
      home: Scaffold(
        body: SafeArea(
          child: Center(
            child: Padding(
              padding: const EdgeInsets.all(28),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(Icons.wifi_off_rounded, size: 44),
                  const SizedBox(height: 16),
                  Text(
                    fr ? 'Connectez-vous à Internet pour télécharger les cours.' : 'Connect to the internet to download the courses.',
                    textAlign: TextAlign.center,
                    style: const TextStyle(fontSize: 18, height: 1.4),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    fr ? 'Ensuite, vos cours restent disponibles hors ligne.' : 'After that, your courses work offline too.',
                    textAlign: TextAlign.center,
                    style: const TextStyle(fontSize: 15, height: 1.4),
                  ),
                  const SizedBox(height: 24),
                  FilledButton(
                    onPressed: _trying
                        ? null
                        : () async {
                            setState(() => _trying = true);
                            await widget.onRetry();
                            if (mounted) setState(() => _trying = false);
                          },
                    child: Text(fr ? 'Réessayer' : 'Try again'),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
