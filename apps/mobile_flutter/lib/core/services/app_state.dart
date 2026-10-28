import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../features/learn/learn_logic.dart';
import '../constants/catalog.dart';
import '../theme/accents.dart';
import '../theme/colors.dart';

class FlashcardItem {
  final String id;
  final String front;
  final String back;
  final String phonetic;
  final String example;
  final String translation;

  const FlashcardItem({
    required this.id,
    required this.front,
    required this.back,
    required this.phonetic,
    required this.example,
    required this.translation,
  });
}

class MissionItem {
  final String id;
  final String title;
  final String description;
  final int minutes;
  final String type;
  final String sceneId;
  final List<String> skills;
  final bool completed;
  final bool isNext;

  const MissionItem({
    required this.id,
    required this.title,
    required this.description,
    required this.minutes,
    required this.type,
    required this.sceneId,
    required this.skills,
    this.completed = false,
    this.isNext = false,
  });
}

class AppState {
  final String activeTrackId;
  final String sourceLanguageCode;
  final int streakDays;
  final int totalXp;
  final int speakingMinutes7d;
  final int reviewsDueCount;
  final bool isDark;
  final List<MissionItem> missions;
  final List<FlashcardItem> reviewDeck;

  /// Learn-path stops done per mission id (N2: learn → practise → mission → talk).
  final Map<String, Set<PathStop>> pathProgress;

  const AppState({
    required this.activeTrackId,
    this.sourceLanguageCode = 'en',
    this.streakDays = 5,
    this.totalXp = 380,
    this.speakingMinutes7d = 42,
    this.reviewsDueCount = 4,
    this.isDark = true,
    required this.missions,
    required this.reviewDeck,
    this.pathProgress = const {},
  });

  Set<PathStop> stopsDone(String missionId) => pathProgress[missionId] ?? const {};

  CourseTrackInfo get activeTrack => CatalogConstants.getTrack(activeTrackId);
  CourseAccent get accent => CourseAccent.forTrack(activeTrackId, isDark: isDark);
  LangQuestColors get colors => isDark ? LangQuestColors.dark : LangQuestColors.light;

  AppState copyWith({
    String? activeTrackId,
    String? sourceLanguageCode,
    int? streakDays,
    int? totalXp,
    int? speakingMinutes7d,
    int? reviewsDueCount,
    bool? isDark,
    List<MissionItem>? missions,
    List<FlashcardItem>? reviewDeck,
    Map<String, Set<PathStop>>? pathProgress,
  }) {
    return AppState(
      activeTrackId: activeTrackId ?? this.activeTrackId,
      sourceLanguageCode: sourceLanguageCode ?? this.sourceLanguageCode,
      streakDays: streakDays ?? this.streakDays,
      totalXp: totalXp ?? this.totalXp,
      speakingMinutes7d: speakingMinutes7d ?? this.speakingMinutes7d,
      reviewsDueCount: reviewsDueCount ?? this.reviewsDueCount,
      isDark: isDark ?? this.isDark,
      missions: missions ?? this.missions,
      reviewDeck: reviewDeck ?? this.reviewDeck,
      pathProgress: pathProgress ?? this.pathProgress,
    );
  }
}

class AppStateNotifier extends Notifier<AppState> {
  @override
  AppState build() {
    return const AppState(
      activeTrackId: 'french',
      // m1 is already completed in this mock, so its whole path is done.
      pathProgress: {
        'm1': {PathStop.learn, PathStop.practise, PathStop.mission, PathStop.talk},
      },
      missions: [
        MissionItem(
          id: 'm1',
          title: 'Café Arrival & Greeting',
          description: 'Order your first beverage with natural polite tone',
          minutes: 4,
          type: 'guided_roleplay',
          sceneId: 'cafe',
          skills: ['ordering', 'polite_forms', 'greetings'],
          completed: true,
        ),
        MissionItem(
          id: 'm2',
          title: 'Asking for the Bill',
          description: 'Inquire about payment and split options',
          minutes: 5,
          type: 'anticipate_speak',
          sceneId: 'cafe',
          skills: ['numbers', 'currency', 'closing'],
          completed: false,
          isNext: true,
        ),
        MissionItem(
          id: 'm3',
          title: 'Evening Market Exploration',
          description: 'Ask for prices and explore fresh ingredients',
          minutes: 6,
          type: 'mission_story',
          sceneId: 'street',
          skills: ['questions', 'food_terms', 'bargaining'],
          completed: false,
        ),
        MissionItem(
          id: 'm4',
          title: 'Metro Navigation & Directions',
          description: 'Find the right line and ask a commuter for help',
          minutes: 5,
          type: 'situational_task',
          sceneId: 'transit',
          skills: ['directions', 'metro_terms'],
          completed: false,
        ),
      ],
      reviewDeck: [
        FlashcardItem(
          id: 'c1',
          front: 'L’addition, s’il vous plaît.',
          back: 'The check / bill, please.',
          phonetic: '/la-di-sjɔ̃ sil vu plɛ/',
          example: 'Garçon, l’addition s’il vous plaît !',
          translation: 'Waiter, the check please!',
        ),
        FlashcardItem(
          id: 'c2',
          front: 'En terrasse ou à l’intérieur ?',
          back: 'On the terrace or inside?',
          phonetic: '/ɑ̃ tɛ-ʁas u a lɛ̃-te-ʁjœʁ/',
          example: 'Une table pour deux en terrasse.',
          translation: 'A table for two on the terrace.',
        ),
        FlashcardItem(
          id: 'c3',
          front: 'C’est combien ?',
          back: 'How much is it?',
          phonetic: '/sɛ kɔ̃-bjɛ̃/',
          example: 'Pardon madame, c’est combien ce livre ?',
          translation: 'Excuse me madam, how much is this book?',
        ),
        FlashcardItem(
          id: 'c4',
          front: 'Où se trouve la station ?',
          back: 'Where is the station located?',
          phonetic: '/u sə tʁuv la sta-sjɔ̃/',
          example: 'Savez-vous où se trouve la station ?',
          translation: 'Do you know where the station is located?',
        ),
      ],
    );
  }

  void switchTrack(String trackId) {
    state = state.copyWith(activeTrackId: trackId);
  }

  void switchSourceLanguage(String code) {
    state = state.copyWith(sourceLanguageCode: code);
  }

  void toggleTheme() {
    state = state.copyWith(isDark: !state.isDark);
  }

  void completeMission(String missionId) {
    final updated = state.missions.map((m) {
      if (m.id == missionId) {
        return MissionItem(
          id: m.id,
          title: m.title,
          description: m.description,
          minutes: m.minutes,
          type: m.type,
          sceneId: m.sceneId,
          skills: m.skills,
          completed: true,
          isNext: false,
        );
      }
      return m;
    }).toList();

    state = state.copyWith(
      missions: updated,
      pathProgress: _withStop(missionId, PathStop.mission),
      totalXp: state.totalXp + 25,
      speakingMinutes7d: state.speakingMinutes7d + 4,
    );
  }

  Map<String, Set<PathStop>> _withStop(String missionId, PathStop stop) => {
        ...state.pathProgress,
        missionId: {...state.stopsDone(missionId), stop},
      };

  /// Mark one learn-path stop of a mission as done (scene + cards = learn, games = practise, chat = talk).
  void completeStop(String missionId, PathStop stop) {
    if (state.stopsDone(missionId).contains(stop)) return;
    state = state.copyWith(pathProgress: _withStop(missionId, stop), totalXp: state.totalXp + 5);
  }

  void removeReviewedCard(String cardId) {
    final updated = state.reviewDeck.where((c) => c.id != cardId).toList();
    state = state.copyWith(
      reviewDeck: updated,
      reviewsDueCount: updated.length,
      totalXp: state.totalXp + 5,
    );
  }
}

final appStateProvider = NotifierProvider<AppStateNotifier, AppState>(AppStateNotifier.new);
