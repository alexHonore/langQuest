import 'package:flutter/material.dart';

enum MeloState {
  companion,
  curious,
  welcome,
  happy,
  celebrate,
  thinking,
  error,
}

class MeloTint {
  final Color body;
  final Color bodyShade;
  final Color belly;
  final Color crest;
  final Color cheek;

  const MeloTint({
    required this.body,
    required this.bodyShade,
    required this.belly,
    required this.crest,
    required this.cheek,
  });

  static MeloTint forCourseAndState(String? trackId, MeloState state) {
    // Base chameleon emerald green
    Color body = const Color(0xFF38D39F);
    Color bodyShade = const Color(0xFF24A277);
    Color belly = const Color(0xFF8CF2CB);
    Color crest = const Color(0xFFFFB547); // Saffron crest
    Color cheek = const Color(0xFFFF7CBB);

    switch (state) {
      case MeloState.curious:
        body = const Color(0xFF3EE1E8);
        bodyShade = const Color(0xFF1CB7BD);
        belly = const Color(0xFFA2F6F9);
        break;
      case MeloState.happy:
      case MeloState.celebrate:
        body = const Color(0xFFFFD15C);
        bodyShade = const Color(0xFFE5A91E);
        belly = const Color(0xFFFFF2B2);
        crest = const Color(0xFFFF4FA3);
        break;
      case MeloState.welcome:
        body = const Color(0xFFFF7CBB);
        bodyShade = const Color(0xFFD6448D);
        belly = const Color(0xFFFFBEDE);
        crest = const Color(0xFF3EE1E8);
        break;
      case MeloState.thinking:
        body = const Color(0xFFB197FC);
        bodyShade = const Color(0xFF845EF7);
        belly = const Color(0xFFE5DBFF);
        crest = const Color(0xFF5FE9EF);
        break;
      case MeloState.error:
        body = const Color(0xFFFF8A96);
        bodyShade = const Color(0xFFD94857);
        belly = const Color(0xFFFFCCD2);
        crest = const Color(0xFFFFC46A);
        break;
      case MeloState.companion:
        break;
    }

    return MeloTint(
      body: body,
      bodyShade: bodyShade,
      belly: belly,
      crest: crest,
      cheek: cheek,
    );
  }
}
