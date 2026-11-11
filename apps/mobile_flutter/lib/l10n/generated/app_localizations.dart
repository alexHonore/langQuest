import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:intl/intl.dart' as intl;

import 'app_localizations_en.dart';
import 'app_localizations_fr.dart';

// ignore_for_file: type=lint

/// Callers can lookup localized strings with an instance of AppLocalizations
/// returned by `AppLocalizations.of(context)`.
///
/// Applications need to include `AppLocalizations.delegate()` in their app's
/// `localizationDelegates` list, and the locales they support in the app's
/// `supportedLocales` list. For example:
///
/// ```dart
/// import 'generated/app_localizations.dart';
///
/// return MaterialApp(
///   localizationsDelegates: AppLocalizations.localizationsDelegates,
///   supportedLocales: AppLocalizations.supportedLocales,
///   home: MyApplicationHome(),
/// );
/// ```
///
/// ## Update pubspec.yaml
///
/// Please make sure to update your pubspec.yaml to include the following
/// packages:
///
/// ```yaml
/// dependencies:
///   # Internationalization support.
///   flutter_localizations:
///     sdk: flutter
///   intl: any # Use the pinned version from flutter_localizations
///
///   # Rest of dependencies
/// ```
///
/// ## iOS Applications
///
/// iOS applications define key application metadata, including supported
/// locales, in an Info.plist file that is built into the application bundle.
/// To configure the locales supported by your app, you’ll need to edit this
/// file.
///
/// First, open your project’s ios/Runner.xcworkspace Xcode workspace file.
/// Then, in the Project Navigator, open the Info.plist file under the Runner
/// project’s Runner folder.
///
/// Next, select the Information Property List item, select Add Item from the
/// Editor menu, then select Localizations from the pop-up menu.
///
/// Select and expand the newly-created Localizations item then, for each
/// locale your application supports, add a new item and select the locale
/// you wish to add from the pop-up menu in the Value field. This list should
/// be consistent with the languages listed in the AppLocalizations.supportedLocales
/// property.
abstract class AppLocalizations {
  AppLocalizations(String locale) : localeName = intl.Intl.canonicalizedLocale(locale.toString());

  final String localeName;

  static AppLocalizations of(BuildContext context) {
    return Localizations.of<AppLocalizations>(context, AppLocalizations)!;
  }

  static const LocalizationsDelegate<AppLocalizations> delegate = _AppLocalizationsDelegate();

  /// A list of this localizations delegate along with the default localizations
  /// delegates.
  ///
  /// Returns a list of localizations delegates containing this delegate along with
  /// GlobalMaterialLocalizations.delegate, GlobalCupertinoLocalizations.delegate,
  /// and GlobalWidgetsLocalizations.delegate.
  ///
  /// Additional delegates can be added by appending to this list in
  /// MaterialApp. This list does not have to be used at all if a custom list
  /// of delegates is preferred or required.
  static const List<LocalizationsDelegate<dynamic>> localizationsDelegates = <LocalizationsDelegate<dynamic>>[
    delegate,
    GlobalMaterialLocalizations.delegate,
    GlobalCupertinoLocalizations.delegate,
    GlobalWidgetsLocalizations.delegate,
  ];

  /// A list of this localizations delegate's supported locales.
  static const List<Locale> supportedLocales = <Locale>[Locale('en'), Locale('fr')];

  /// No description provided for @appTitle.
  ///
  /// In en, this message translates to:
  /// **'LangQuest'**
  String get appTitle;

  /// No description provided for @tabHome.
  ///
  /// In en, this message translates to:
  /// **'Home'**
  String get tabHome;

  /// No description provided for @tabMissions.
  ///
  /// In en, this message translates to:
  /// **'Missions'**
  String get tabMissions;

  /// No description provided for @tabProgress.
  ///
  /// In en, this message translates to:
  /// **'Progress'**
  String get tabProgress;

  /// No description provided for @back.
  ///
  /// In en, this message translates to:
  /// **'Back'**
  String get back;

  /// No description provided for @close.
  ///
  /// In en, this message translates to:
  /// **'Close'**
  String get close;

  /// No description provided for @cancel.
  ///
  /// In en, this message translates to:
  /// **'Cancel'**
  String get cancel;

  /// No description provided for @next.
  ///
  /// In en, this message translates to:
  /// **'Next'**
  String get next;

  /// No description provided for @you.
  ///
  /// In en, this message translates to:
  /// **'You'**
  String get you;

  /// No description provided for @listen.
  ///
  /// In en, this message translates to:
  /// **'Listen'**
  String get listen;

  /// No description provided for @listenSlowly.
  ///
  /// In en, this message translates to:
  /// **'Slowly'**
  String get listenSlowly;

  /// No description provided for @listenSlowlySemantics.
  ///
  /// In en, this message translates to:
  /// **'Listen slowly'**
  String get listenSlowlySemantics;

  /// No description provided for @syntheticVoice.
  ///
  /// In en, this message translates to:
  /// **'Synthetic voice'**
  String get syntheticVoice;

  /// No description provided for @stepOf.
  ///
  /// In en, this message translates to:
  /// **'Step {step} of {total}'**
  String stepOf(int step, int total);

  /// No description provided for @xpGain.
  ///
  /// In en, this message translates to:
  /// **'+{xp} XP'**
  String xpGain(int xp);

  /// No description provided for @languageName.
  ///
  /// In en, this message translates to:
  /// **'{code, select, en{English} fr{French} ru{Russian} other{{code}}}'**
  String languageName(String code);

  /// No description provided for @fromLanguage.
  ///
  /// In en, this message translates to:
  /// **'{code, select, en{from English} fr{from French} ru{from Russian} other{from {code}}}'**
  String fromLanguage(String code);

  /// No description provided for @notNativeReviewed.
  ///
  /// In en, this message translates to:
  /// **'Not yet reviewed by native speakers'**
  String get notNativeReviewed;

  /// No description provided for @draftChapterNotice.
  ///
  /// In en, this message translates to:
  /// **'AI-drafted chapter, not yet reviewed by native speakers. It may contain mistakes.'**
  String get draftChapterNotice;

  /// No description provided for @missionsCount.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 mission} other{{count} missions}}'**
  String missionsCount(int count);

  /// No description provided for @settings.
  ///
  /// In en, this message translates to:
  /// **'Settings'**
  String get settings;

  /// No description provided for @switchCourse.
  ///
  /// In en, this message translates to:
  /// **'Switch course'**
  String get switchCourse;

  /// No description provided for @welcomeTitle.
  ///
  /// In en, this message translates to:
  /// **'Learn a language by using it'**
  String get welcomeTitle;

  /// No description provided for @welcomeBody.
  ///
  /// In en, this message translates to:
  /// **'Real situations and real dialects, taught before you are tested. Free: no subscriptions, credits or paywalls.'**
  String get welcomeBody;

  /// No description provided for @welcomeLanguageLabel.
  ///
  /// In en, this message translates to:
  /// **'App and explanations in'**
  String get welcomeLanguageLabel;

  /// No description provided for @welcomeContinue.
  ///
  /// In en, this message translates to:
  /// **'Choose a course'**
  String get welcomeContinue;

  /// No description provided for @pickCourseTitle.
  ///
  /// In en, this message translates to:
  /// **'What do you want to learn?'**
  String get pickCourseTitle;

  /// No description provided for @pickCourseReady.
  ///
  /// In en, this message translates to:
  /// **'Ready to start'**
  String get pickCourseReady;

  /// No description provided for @pickCourseNone.
  ///
  /// In en, this message translates to:
  /// **'No course can be taught from this language yet.'**
  String get pickCourseNone;

  /// No description provided for @seeAllCourses.
  ///
  /// In en, this message translates to:
  /// **'See all 30 courses'**
  String get seeAllCourses;

  /// No description provided for @courseIncludesTitle.
  ///
  /// In en, this message translates to:
  /// **'What this course includes'**
  String get courseIncludesTitle;

  /// No description provided for @courseIncludesMissions.
  ///
  /// In en, this message translates to:
  /// **'Mission pathway ({count, plural, =1{1 mission} other{{count} missions}})'**
  String courseIncludesMissions(int count);

  /// No description provided for @courseIncludesLearn.
  ///
  /// In en, this message translates to:
  /// **'Before each mission: a scene, phrase cards and two mini-games'**
  String get courseIncludesLearn;

  /// No description provided for @courseIncludesReview.
  ///
  /// In en, this message translates to:
  /// **'Spaced review of the phrases you use'**
  String get courseIncludesReview;

  /// No description provided for @courseIncludesVoice.
  ///
  /// In en, this message translates to:
  /// **'Lines read by your phone\'s synthetic voice, when it has one for this language'**
  String get courseIncludesVoice;

  /// No description provided for @courseMissingTitle.
  ///
  /// In en, this message translates to:
  /// **'What this course does not have yet'**
  String get courseMissingTitle;

  /// No description provided for @courseMissingNativeReview.
  ///
  /// In en, this message translates to:
  /// **'Native-speaker review: the content is an AI draft and may contain mistakes'**
  String get courseMissingNativeReview;

  /// No description provided for @courseMissingConversation.
  ///
  /// In en, this message translates to:
  /// **'Live conversation with AI characters'**
  String get courseMissingConversation;

  /// No description provided for @courseMissingAudio.
  ///
  /// In en, this message translates to:
  /// **'Audio library'**
  String get courseMissingAudio;

  /// No description provided for @courseMissingPronunciation.
  ///
  /// In en, this message translates to:
  /// **'Spoken pronunciation feedback'**
  String get courseMissingPronunciation;

  /// No description provided for @courseMissingVoiceDialect.
  ///
  /// In en, this message translates to:
  /// **'A voice for this dialect: phone voices speak Modern Standard Arabic, which is not this variety'**
  String get courseMissingVoiceDialect;

  /// No description provided for @courseLearnFrom.
  ///
  /// In en, this message translates to:
  /// **'Learn from'**
  String get courseLearnFrom;

  /// No description provided for @coursePlanned.
  ///
  /// In en, this message translates to:
  /// **'Not available yet. Planned.'**
  String get coursePlanned;

  /// No description provided for @courseStart.
  ///
  /// In en, this message translates to:
  /// **'Start this course'**
  String get courseStart;

  /// No description provided for @courseContinue.
  ///
  /// In en, this message translates to:
  /// **'Continue this course'**
  String get courseContinue;

  /// No description provided for @courseExplanationsIn.
  ///
  /// In en, this message translates to:
  /// **'Explanations in {language}'**
  String courseExplanationsIn(String language);

  /// No description provided for @homeNextMission.
  ///
  /// In en, this message translates to:
  /// **'Next mission'**
  String get homeNextMission;

  /// No description provided for @homeNextStop.
  ///
  /// In en, this message translates to:
  /// **'Next: {stop}'**
  String homeNextStop(String stop);

  /// No description provided for @homeChapterDone.
  ///
  /// In en, this message translates to:
  /// **'Chapter complete'**
  String get homeChapterDone;

  /// No description provided for @homeChapterDoneBody.
  ///
  /// In en, this message translates to:
  /// **'You have used every phrase of this chapter. Review keeps them alive.'**
  String get homeChapterDoneBody;

  /// No description provided for @homeReviewTitle.
  ///
  /// In en, this message translates to:
  /// **'Review'**
  String get homeReviewTitle;

  /// No description provided for @reviewsDue.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =0{No reviews due} =1{1 review due} other{{count} reviews due}}'**
  String reviewsDue(int count);

  /// No description provided for @nextReviewAt.
  ///
  /// In en, this message translates to:
  /// **'Next review {when}'**
  String nextReviewAt(String when);

  /// No description provided for @streakDays.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 day in a row} other{{count} days in a row}}'**
  String streakDays(int count);

  /// No description provided for @streakPaused.
  ///
  /// In en, this message translates to:
  /// **'Streak paused. Resume whenever you like.'**
  String get streakPaused;

  /// No description provided for @pathwayTitle.
  ///
  /// In en, this message translates to:
  /// **'Your pathway'**
  String get pathwayTitle;

  /// No description provided for @chapterLabel.
  ///
  /// In en, this message translates to:
  /// **'Chapter {index}'**
  String chapterLabel(int index);

  /// No description provided for @missionLabel.
  ///
  /// In en, this message translates to:
  /// **'Mission {index}'**
  String missionLabel(int index);

  /// No description provided for @missionLocked.
  ///
  /// In en, this message translates to:
  /// **'Finish “{title}” first'**
  String missionLocked(String title);

  /// No description provided for @lockedSemantics.
  ///
  /// In en, this message translates to:
  /// **'locked'**
  String get lockedSemantics;

  /// No description provided for @stopLearn.
  ///
  /// In en, this message translates to:
  /// **'Learn'**
  String get stopLearn;

  /// No description provided for @stopPractise.
  ///
  /// In en, this message translates to:
  /// **'Practise'**
  String get stopPractise;

  /// No description provided for @stopMission.
  ///
  /// In en, this message translates to:
  /// **'Mission'**
  String get stopMission;

  /// No description provided for @stopTalk.
  ///
  /// In en, this message translates to:
  /// **'Talk'**
  String get stopTalk;

  /// No description provided for @stopsDoneSemantics.
  ///
  /// In en, this message translates to:
  /// **'{done} of {total} steps done'**
  String stopsDoneSemantics(int done, int total);

  /// No description provided for @pathLearnSubtitle.
  ///
  /// In en, this message translates to:
  /// **'A scene with {name}, then {count, plural, =1{1 phrase} other{{count} phrases}}'**
  String pathLearnSubtitle(String name, int count);

  /// No description provided for @pathPractiseSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Match the pairs, build a sentence'**
  String get pathPractiseSubtitle;

  /// No description provided for @pathPractisePairsOnly.
  ///
  /// In en, this message translates to:
  /// **'Match the pairs'**
  String get pathPractisePairsOnly;

  /// No description provided for @pathMissionSubtitle.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 exchange} other{{count} exchanges}} with {name}'**
  String pathMissionSubtitle(int count, String name);

  /// No description provided for @pathComplete.
  ///
  /// In en, this message translates to:
  /// **'Mission path complete'**
  String get pathComplete;

  /// No description provided for @pathStartStop.
  ///
  /// In en, this message translates to:
  /// **'Start: {stop}'**
  String pathStartStop(String stop);

  /// No description provided for @pathContinueStop.
  ///
  /// In en, this message translates to:
  /// **'Continue: {stop}'**
  String pathContinueStop(String stop);

  /// No description provided for @pathDoneSemantics.
  ///
  /// In en, this message translates to:
  /// **'done'**
  String get pathDoneSemantics;

  /// No description provided for @pathNextSemantics.
  ///
  /// In en, this message translates to:
  /// **'next'**
  String get pathNextSemantics;

  /// No description provided for @sceneTitle.
  ///
  /// In en, this message translates to:
  /// **'Learn · {title}'**
  String sceneTitle(String title);

  /// No description provided for @sceneYourLine.
  ///
  /// In en, this message translates to:
  /// **'Your line — say it out loud'**
  String get sceneYourLine;

  /// No description provided for @sceneISaidIt.
  ///
  /// In en, this message translates to:
  /// **'I said it'**
  String get sceneISaidIt;

  /// No description provided for @sceneLearnPhrases.
  ///
  /// In en, this message translates to:
  /// **'Learn the phrases'**
  String get sceneLearnPhrases;

  /// No description provided for @speakingSemantics.
  ///
  /// In en, this message translates to:
  /// **'{name} is speaking'**
  String speakingSemantics(String name);

  /// No description provided for @cardsTitle.
  ///
  /// In en, this message translates to:
  /// **'New phrases · {title}'**
  String cardsTitle(String title);

  /// No description provided for @cardsNextPhrase.
  ///
  /// In en, this message translates to:
  /// **'Next phrase'**
  String get cardsNextPhrase;

  /// No description provided for @cardsPractise.
  ///
  /// In en, this message translates to:
  /// **'Practise'**
  String get cardsPractise;

  /// No description provided for @noteLabel.
  ///
  /// In en, this message translates to:
  /// **'Note'**
  String get noteLabel;

  /// No description provided for @practiseTitle.
  ///
  /// In en, this message translates to:
  /// **'Practise · {title}'**
  String practiseTitle(String title);

  /// No description provided for @pairsPrompt.
  ///
  /// In en, this message translates to:
  /// **'Match each phrase with its meaning'**
  String get pairsPrompt;

  /// No description provided for @pairsDone.
  ///
  /// In en, this message translates to:
  /// **'All matched!'**
  String get pairsDone;

  /// No description provided for @pairsNextRound.
  ///
  /// In en, this message translates to:
  /// **'Next round'**
  String get pairsNextRound;

  /// No description provided for @pairsBuildSentence.
  ///
  /// In en, this message translates to:
  /// **'Build a sentence'**
  String get pairsBuildSentence;

  /// No description provided for @matchedSemantics.
  ///
  /// In en, this message translates to:
  /// **'{label}, matched'**
  String matchedSemantics(String label);

  /// No description provided for @tilesPrompt.
  ///
  /// In en, this message translates to:
  /// **'Build the sentence'**
  String get tilesPrompt;

  /// No description provided for @tilesCheck.
  ///
  /// In en, this message translates to:
  /// **'Check'**
  String get tilesCheck;

  /// No description provided for @tilesWrong.
  ///
  /// In en, this message translates to:
  /// **'Not quite — tap a word to take it back.'**
  String get tilesWrong;

  /// No description provided for @tilesRemoveSemantics.
  ///
  /// In en, this message translates to:
  /// **'{word}, remove'**
  String tilesRemoveSemantics(String word);

  /// No description provided for @startMission.
  ///
  /// In en, this message translates to:
  /// **'Start the mission'**
  String get startMission;

  /// No description provided for @missionCue.
  ///
  /// In en, this message translates to:
  /// **'{name} says'**
  String missionCue(String name);

  /// No description provided for @missionWhatDoYouAnswer.
  ///
  /// In en, this message translates to:
  /// **'What do you answer?'**
  String get missionWhatDoYouAnswer;

  /// No description provided for @missionHowDoYouSay.
  ///
  /// In en, this message translates to:
  /// **'How do you say “{meaning}”?'**
  String missionHowDoYouSay(String meaning);

  /// No description provided for @missionWrong.
  ///
  /// In en, this message translates to:
  /// **'Not quite — think of what you practised.'**
  String get missionWrong;

  /// No description provided for @missionSayIt.
  ///
  /// In en, this message translates to:
  /// **'Say it out loud'**
  String get missionSayIt;

  /// No description provided for @missionRecapTitle.
  ///
  /// In en, this message translates to:
  /// **'What you used'**
  String get missionRecapTitle;

  /// No description provided for @missionComplete.
  ///
  /// In en, this message translates to:
  /// **'Complete the mission'**
  String get missionComplete;

  /// No description provided for @missionCompleted.
  ///
  /// In en, this message translates to:
  /// **'Mission completed!'**
  String get missionCompleted;

  /// No description provided for @missionXpOnce.
  ///
  /// In en, this message translates to:
  /// **'XP for a mission counts once; this replay is practice.'**
  String get missionXpOnce;

  /// No description provided for @missionJoinReview.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 phrase joins your review} other{{count} phrases join your review}}'**
  String missionJoinReview(int count);

  /// No description provided for @missionBackToPath.
  ///
  /// In en, this message translates to:
  /// **'Back to the mission path'**
  String get missionBackToPath;

  /// No description provided for @missionNext.
  ///
  /// In en, this message translates to:
  /// **'Next mission'**
  String get missionNext;

  /// No description provided for @missionNotFound.
  ///
  /// In en, this message translates to:
  /// **'This mission is not part of your current course.'**
  String get missionNotFound;

  /// No description provided for @backHome.
  ///
  /// In en, this message translates to:
  /// **'Back home'**
  String get backHome;

  /// No description provided for @reviewTitle.
  ///
  /// In en, this message translates to:
  /// **'Review'**
  String get reviewTitle;

  /// No description provided for @reviewHowDoYouSay.
  ///
  /// In en, this message translates to:
  /// **'How do you say…'**
  String get reviewHowDoYouSay;

  /// No description provided for @reviewSayThenShow.
  ///
  /// In en, this message translates to:
  /// **'Say it out loud, then show the answer.'**
  String get reviewSayThenShow;

  /// No description provided for @reviewShowAnswer.
  ///
  /// In en, this message translates to:
  /// **'Show answer'**
  String get reviewShowAnswer;

  /// No description provided for @reviewAgain.
  ///
  /// In en, this message translates to:
  /// **'Again'**
  String get reviewAgain;

  /// No description provided for @reviewHard.
  ///
  /// In en, this message translates to:
  /// **'Hard'**
  String get reviewHard;

  /// No description provided for @reviewGood.
  ///
  /// In en, this message translates to:
  /// **'Good'**
  String get reviewGood;

  /// No description provided for @reviewEasy.
  ///
  /// In en, this message translates to:
  /// **'Easy'**
  String get reviewEasy;

  /// No description provided for @reviewLeft.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 left} other{{count} left}}'**
  String reviewLeft(int count);

  /// No description provided for @reviewAllDone.
  ///
  /// In en, this message translates to:
  /// **'All caught up for today.'**
  String get reviewAllDone;

  /// No description provided for @reviewEmpty.
  ///
  /// In en, this message translates to:
  /// **'Phrases you use in missions come back here, just before you would forget them.'**
  String get reviewEmpty;

  /// No description provided for @progressTitle.
  ///
  /// In en, this message translates to:
  /// **'Your progress'**
  String get progressTitle;

  /// No description provided for @xpLabel.
  ///
  /// In en, this message translates to:
  /// **'XP'**
  String get xpLabel;

  /// No description provided for @xpNote.
  ///
  /// In en, this message translates to:
  /// **'XP tracks how much you practise, not how well you speak.'**
  String get xpNote;

  /// No description provided for @streakTitle.
  ///
  /// In en, this message translates to:
  /// **'Streak'**
  String get streakTitle;

  /// No description provided for @thisWeek.
  ///
  /// In en, this message translates to:
  /// **'This week'**
  String get thisWeek;

  /// No description provided for @missionsDoneTitle.
  ///
  /// In en, this message translates to:
  /// **'Missions completed'**
  String get missionsDoneTitle;

  /// No description provided for @countOfTotal.
  ///
  /// In en, this message translates to:
  /// **'{done} of {total}'**
  String countOfTotal(int done, int total);

  /// No description provided for @phrasesTitle.
  ///
  /// In en, this message translates to:
  /// **'Phrases'**
  String get phrasesTitle;

  /// No description provided for @phrasesMet.
  ///
  /// In en, this message translates to:
  /// **'Met in lessons'**
  String get phrasesMet;

  /// No description provided for @phrasesInReview.
  ///
  /// In en, this message translates to:
  /// **'In review'**
  String get phrasesInReview;

  /// No description provided for @strengthLearning.
  ///
  /// In en, this message translates to:
  /// **'Learning'**
  String get strengthLearning;

  /// No description provided for @strengthYoung.
  ///
  /// In en, this message translates to:
  /// **'Getting there'**
  String get strengthYoung;

  /// No description provided for @strengthSolid.
  ///
  /// In en, this message translates to:
  /// **'Solid'**
  String get strengthSolid;

  /// No description provided for @strengthNote.
  ///
  /// In en, this message translates to:
  /// **'From your review schedule — not a score of your speech.'**
  String get strengthNote;

  /// No description provided for @progressEmpty.
  ///
  /// In en, this message translates to:
  /// **'Start a mission to see your progress here.'**
  String get progressEmpty;

  /// No description provided for @freeTitle.
  ///
  /// In en, this message translates to:
  /// **'Free for every learner'**
  String get freeTitle;

  /// No description provided for @freeBody.
  ///
  /// In en, this message translates to:
  /// **'LangQuest has no paywalls, subscriptions, credits or usage meters.'**
  String get freeBody;

  /// No description provided for @appLanguage.
  ///
  /// In en, this message translates to:
  /// **'App language'**
  String get appLanguage;

  /// No description provided for @yourCourses.
  ///
  /// In en, this message translates to:
  /// **'Your courses'**
  String get yourCourses;

  /// No description provided for @addCourse.
  ///
  /// In en, this message translates to:
  /// **'Add a course'**
  String get addCourse;

  /// No description provided for @removeCourse.
  ///
  /// In en, this message translates to:
  /// **'Remove'**
  String get removeCourse;

  /// No description provided for @removeCourseTitle.
  ///
  /// In en, this message translates to:
  /// **'Remove {course}?'**
  String removeCourseTitle(String course);

  /// No description provided for @removeCourseBody.
  ///
  /// In en, this message translates to:
  /// **'Its progress and reviews on this device are deleted. Your other courses are not touched.'**
  String get removeCourseBody;

  /// No description provided for @yourData.
  ///
  /// In en, this message translates to:
  /// **'Your data'**
  String get yourData;

  /// No description provided for @yourDataBody.
  ///
  /// In en, this message translates to:
  /// **'Everything is saved on this device only. There is no account in this version.'**
  String get yourDataBody;

  /// No description provided for @resetAll.
  ///
  /// In en, this message translates to:
  /// **'Reset all progress'**
  String get resetAll;

  /// No description provided for @resetAllTitle.
  ///
  /// In en, this message translates to:
  /// **'Reset all progress?'**
  String get resetAllTitle;

  /// No description provided for @resetAllBody.
  ///
  /// In en, this message translates to:
  /// **'All courses, reviews and XP on this device are deleted.'**
  String get resetAllBody;

  /// No description provided for @resetConfirm.
  ///
  /// In en, this message translates to:
  /// **'Reset'**
  String get resetConfirm;

  /// No description provided for @activeCourse.
  ///
  /// In en, this message translates to:
  /// **'Active'**
  String get activeCourse;

  /// No description provided for @openSourceLicenses.
  ///
  /// In en, this message translates to:
  /// **'Open-source licenses'**
  String get openSourceLicenses;

  /// No description provided for @catalogTitle.
  ///
  /// In en, this message translates to:
  /// **'Courses'**
  String get catalogTitle;

  /// No description provided for @catalogSubtitle.
  ///
  /// In en, this message translates to:
  /// **'30 courses. Real dialects. Free.'**
  String get catalogSubtitle;

  /// No description provided for @catalogSearch.
  ///
  /// In en, this message translates to:
  /// **'Search languages and dialects'**
  String get catalogSearch;

  /// No description provided for @catalogReady.
  ///
  /// In en, this message translates to:
  /// **'Ready · draft'**
  String get catalogReady;

  /// No description provided for @catalogPlanned.
  ///
  /// In en, this message translates to:
  /// **'Planned'**
  String get catalogPlanned;

  /// No description provided for @catalogEnrolled.
  ///
  /// In en, this message translates to:
  /// **'Enrolled'**
  String get catalogEnrolled;

  /// No description provided for @catalogNoResults.
  ///
  /// In en, this message translates to:
  /// **'No course matches “{query}”'**
  String catalogNoResults(String query);

  /// No description provided for @browseAllCourses.
  ///
  /// In en, this message translates to:
  /// **'Browse all 30 courses'**
  String get browseAllCourses;

  /// No description provided for @sceneCafe.
  ///
  /// In en, this message translates to:
  /// **'Café'**
  String get sceneCafe;

  /// No description provided for @sceneStreet.
  ///
  /// In en, this message translates to:
  /// **'Street'**
  String get sceneStreet;

  /// No description provided for @sceneAirport.
  ///
  /// In en, this message translates to:
  /// **'Airport'**
  String get sceneAirport;

  /// No description provided for @sceneMarket.
  ///
  /// In en, this message translates to:
  /// **'Market'**
  String get sceneMarket;

  /// No description provided for @sceneHome.
  ///
  /// In en, this message translates to:
  /// **'Home'**
  String get sceneHome;

  /// No description provided for @sceneOffice.
  ///
  /// In en, this message translates to:
  /// **'Office'**
  String get sceneOffice;

  /// No description provided for @sceneTransit.
  ///
  /// In en, this message translates to:
  /// **'On the move'**
  String get sceneTransit;

  /// No description provided for @sceneRestaurant.
  ///
  /// In en, this message translates to:
  /// **'Restaurant'**
  String get sceneRestaurant;

  /// No description provided for @sceneGathering.
  ///
  /// In en, this message translates to:
  /// **'Rooftop'**
  String get sceneGathering;

  /// No description provided for @sceneStation.
  ///
  /// In en, this message translates to:
  /// **'Station'**
  String get sceneStation;

  /// No description provided for @scenePark.
  ///
  /// In en, this message translates to:
  /// **'Park'**
  String get scenePark;

  /// No description provided for @sceneClinic.
  ///
  /// In en, this message translates to:
  /// **'Clinic'**
  String get sceneClinic;

  /// No description provided for @accountTitle.
  ///
  /// In en, this message translates to:
  /// **'Account'**
  String get accountTitle;

  /// No description provided for @accountPitch.
  ///
  /// In en, this message translates to:
  /// **'Save your courses and completed missions to an account, and pick up where you left off on another device or browser.'**
  String get accountPitch;

  /// No description provided for @accountDeviceOnly.
  ///
  /// In en, this message translates to:
  /// **'Practice XP and your review schedule stay on this device: the server counts XP only for missions with a spoken attempt it has assessed, and recordings made here never leave this device.'**
  String get accountDeviceOnly;

  /// No description provided for @accountEmail.
  ///
  /// In en, this message translates to:
  /// **'Email'**
  String get accountEmail;

  /// No description provided for @accountPassword.
  ///
  /// In en, this message translates to:
  /// **'Password'**
  String get accountPassword;

  /// No description provided for @accountSignIn.
  ///
  /// In en, this message translates to:
  /// **'Sign in'**
  String get accountSignIn;

  /// No description provided for @accountCreate.
  ///
  /// In en, this message translates to:
  /// **'Create account'**
  String get accountCreate;

  /// No description provided for @accountMissingFields.
  ///
  /// In en, this message translates to:
  /// **'Enter your email and a password.'**
  String get accountMissingFields;

  /// No description provided for @accountConfirmEmail.
  ///
  /// In en, this message translates to:
  /// **'Check your email: the link in it confirms the account and signs you in here.'**
  String get accountConfirmEmail;

  /// No description provided for @accountSignedInAs.
  ///
  /// In en, this message translates to:
  /// **'Signed in as {email}'**
  String accountSignedInAs(String email);

  /// No description provided for @accountSaving.
  ///
  /// In en, this message translates to:
  /// **'Saving to your account…'**
  String get accountSaving;

  /// No description provided for @accountSaved.
  ///
  /// In en, this message translates to:
  /// **'Your courses and completed missions are saved to your account.'**
  String get accountSaved;

  /// No description provided for @accountSyncFailed.
  ///
  /// In en, this message translates to:
  /// **'Couldn’t reach your account. Your progress is safe on this device and will be saved later.'**
  String get accountSyncFailed;

  /// No description provided for @accountTryAgain.
  ///
  /// In en, this message translates to:
  /// **'Try again'**
  String get accountTryAgain;

  /// No description provided for @accountNotSaved.
  ///
  /// In en, this message translates to:
  /// **'Not saved to your account: {courses}. Another instruction language of the same course is already active there.'**
  String accountNotSaved(String courses);

  /// No description provided for @accountSignOut.
  ///
  /// In en, this message translates to:
  /// **'Sign out'**
  String get accountSignOut;

  /// No description provided for @yourDataBodyAccount.
  ///
  /// In en, this message translates to:
  /// **'Your courses and completed missions are also kept in your account. Everything else — practice XP, reviews, settings — is saved on this device only.'**
  String get yourDataBodyAccount;

  /// No description provided for @yourDataBodySignedOut.
  ///
  /// In en, this message translates to:
  /// **'Everything is saved on this device only, unless you sign in above to keep your courses and completed missions in an account.'**
  String get yourDataBodySignedOut;

  /// No description provided for @accountExport.
  ///
  /// In en, this message translates to:
  /// **'Export my data'**
  String get accountExport;

  /// No description provided for @accountExported.
  ///
  /// In en, this message translates to:
  /// **'Saved {file}'**
  String accountExported(String file);

  /// No description provided for @accountDelete.
  ///
  /// In en, this message translates to:
  /// **'Delete my account'**
  String get accountDelete;

  /// No description provided for @accountDeleteTitle.
  ///
  /// In en, this message translates to:
  /// **'Delete your account?'**
  String get accountDeleteTitle;

  /// No description provided for @accountDeleteBody.
  ///
  /// In en, this message translates to:
  /// **'This permanently removes your account and the courses and progress saved in it. It cannot be undone. The progress on this device stays until you reset it.'**
  String get accountDeleteBody;

  /// No description provided for @accountDeleteType.
  ///
  /// In en, this message translates to:
  /// **'Type {word} to confirm.'**
  String accountDeleteType(String word);

  /// No description provided for @accountDeleteWord.
  ///
  /// In en, this message translates to:
  /// **'DELETE'**
  String get accountDeleteWord;

  /// No description provided for @accountDeleted.
  ///
  /// In en, this message translates to:
  /// **'Your account was deleted.'**
  String get accountDeleted;

  /// No description provided for @accountDeleteScheduled.
  ///
  /// In en, this message translates to:
  /// **'Your account will be deleted within 30 days. Sign in again to cancel.'**
  String get accountDeleteScheduled;

  /// No description provided for @recordYourself.
  ///
  /// In en, this message translates to:
  /// **'Record yourself'**
  String get recordYourself;

  /// No description provided for @recordStop.
  ///
  /// In en, this message translates to:
  /// **'Stop'**
  String get recordStop;

  /// No description provided for @recordStopSemantics.
  ///
  /// In en, this message translates to:
  /// **'Stop recording'**
  String get recordStopSemantics;

  /// No description provided for @recordingNow.
  ///
  /// In en, this message translates to:
  /// **'Recording'**
  String get recordingNow;

  /// No description provided for @recordMyVoice.
  ///
  /// In en, this message translates to:
  /// **'My voice'**
  String get recordMyVoice;

  /// No description provided for @recordMyVoiceSemantics.
  ///
  /// In en, this message translates to:
  /// **'Play your recording'**
  String get recordMyVoiceSemantics;

  /// No description provided for @recordStopPlayingSemantics.
  ///
  /// In en, this message translates to:
  /// **'Stop playing your recording'**
  String get recordStopPlayingSemantics;

  /// No description provided for @recordAgain.
  ///
  /// In en, this message translates to:
  /// **'Again'**
  String get recordAgain;

  /// No description provided for @recordAgainSemantics.
  ///
  /// In en, this message translates to:
  /// **'Record again'**
  String get recordAgainSemantics;

  /// No description provided for @recordTryAgain.
  ///
  /// In en, this message translates to:
  /// **'Try again'**
  String get recordTryAgain;

  /// No description provided for @recordStaysOnDevice.
  ///
  /// In en, this message translates to:
  /// **'Your recording stays on this device.'**
  String get recordStaysOnDevice;

  /// No description provided for @recordCompare.
  ///
  /// In en, this message translates to:
  /// **'Compare: {listen}, then {mine}.'**
  String recordCompare(String listen, String mine);

  /// No description provided for @recordSilent.
  ///
  /// In en, this message translates to:
  /// **'I didn’t hear anything. Check your microphone and try again.'**
  String get recordSilent;

  /// No description provided for @recordBlocked.
  ///
  /// In en, this message translates to:
  /// **'The microphone is blocked. Allow it for this site, then try again.'**
  String get recordBlocked;

  /// No description provided for @recordNoMicrophone.
  ///
  /// In en, this message translates to:
  /// **'No microphone found.'**
  String get recordNoMicrophone;

  /// No description provided for @recordFailed.
  ///
  /// In en, this message translates to:
  /// **'Recording didn’t work.'**
  String get recordFailed;

  /// No description provided for @display.
  ///
  /// In en, this message translates to:
  /// **'Display'**
  String get display;

  /// No description provided for @themeDark.
  ///
  /// In en, this message translates to:
  /// **'Dark'**
  String get themeDark;

  /// No description provided for @themeLight.
  ///
  /// In en, this message translates to:
  /// **'Light'**
  String get themeLight;

  /// No description provided for @themeDevice.
  ///
  /// In en, this message translates to:
  /// **'Device'**
  String get themeDevice;

  /// No description provided for @textSize.
  ///
  /// In en, this message translates to:
  /// **'Text size'**
  String get textSize;

  /// No description provided for @textSizeBody.
  ///
  /// In en, this message translates to:
  /// **'On top of your device\'s text size.'**
  String get textSizeBody;

  /// No description provided for @reduceMotion.
  ///
  /// In en, this message translates to:
  /// **'Reduce motion'**
  String get reduceMotion;

  /// No description provided for @reduceMotionBody.
  ///
  /// In en, this message translates to:
  /// **'Scenes, Melo and page changes stay still.'**
  String get reduceMotionBody;

  /// No description provided for @reduceMotionDevice.
  ///
  /// In en, this message translates to:
  /// **'On in your device\'s settings.'**
  String get reduceMotionDevice;

  /// No description provided for @showMascot.
  ///
  /// In en, this message translates to:
  /// **'Show Melo, the mascot'**
  String get showMascot;

  /// No description provided for @showMascotBody.
  ///
  /// In en, this message translates to:
  /// **'Melo cheers you on; hiding it hides nothing else.'**
  String get showMascotBody;

  /// No description provided for @textSmaller.
  ///
  /// In en, this message translates to:
  /// **'Smaller text'**
  String get textSmaller;

  /// No description provided for @textLarger.
  ///
  /// In en, this message translates to:
  /// **'Larger text'**
  String get textLarger;

  /// No description provided for @textSizeValue.
  ///
  /// In en, this message translates to:
  /// **'Text size {percent}'**
  String textSizeValue(String percent);

  /// No description provided for @forgotPassword.
  ///
  /// In en, this message translates to:
  /// **'Forgot password?'**
  String get forgotPassword;

  /// No description provided for @enterEmailFirst.
  ///
  /// In en, this message translates to:
  /// **'Enter your email address first.'**
  String get enterEmailFirst;

  /// No description provided for @passwordResetSent.
  ///
  /// In en, this message translates to:
  /// **'If an account uses this address, an email with a link to choose a new password is on its way.'**
  String get passwordResetSent;

  /// No description provided for @emailConfirmed.
  ///
  /// In en, this message translates to:
  /// **'Email confirmed. You\'re signed in.'**
  String get emailConfirmed;

  /// No description provided for @emailLinkFailed.
  ///
  /// In en, this message translates to:
  /// **'This email link can\'t be used: it may have expired, been used already, or been opened in another browser than the one that asked for it. Ask for a new one in Settings.'**
  String get emailLinkFailed;

  /// No description provided for @newPasswordTitle.
  ///
  /// In en, this message translates to:
  /// **'Choose a new password'**
  String get newPasswordTitle;

  /// No description provided for @newPasswordBody.
  ///
  /// In en, this message translates to:
  /// **'You opened a password reset link for {email}.'**
  String newPasswordBody(String email);

  /// No description provided for @newPasswordLabel.
  ///
  /// In en, this message translates to:
  /// **'New password'**
  String get newPasswordLabel;

  /// No description provided for @newPasswordSave.
  ///
  /// In en, this message translates to:
  /// **'Save password'**
  String get newPasswordSave;

  /// No description provided for @newPasswordFailed.
  ///
  /// In en, this message translates to:
  /// **'The password could not be saved. Try again.'**
  String get newPasswordFailed;

  /// No description provided for @later.
  ///
  /// In en, this message translates to:
  /// **'Later'**
  String get later;

  /// No description provided for @passwordChanged.
  ///
  /// In en, this message translates to:
  /// **'Your password was changed.'**
  String get passwordChanged;

  /// No description provided for @practiseSayingEntry.
  ///
  /// In en, this message translates to:
  /// **'Practise saying the phrases'**
  String get practiseSayingEntry;

  /// No description provided for @practiseSayingTitle.
  ///
  /// In en, this message translates to:
  /// **'Practise saying · {mission}'**
  String practiseSayingTitle(String mission);

  /// No description provided for @practiseSayingNote.
  ///
  /// In en, this message translates to:
  /// **'Listen, record yourself, then compare. There is no score: a number needs a speech assessor this course does not have.'**
  String get practiseSayingNote;

  /// No description provided for @practiseSayingDone.
  ///
  /// In en, this message translates to:
  /// **'Done'**
  String get practiseSayingDone;

  /// No description provided for @previousPhrase.
  ///
  /// In en, this message translates to:
  /// **'Previous phrase'**
  String get previousPhrase;

  /// No description provided for @warmupTitle.
  ///
  /// In en, this message translates to:
  /// **'Try your first phrase'**
  String get warmupTitle;

  /// No description provided for @warmupBody.
  ///
  /// In en, this message translates to:
  /// **'Listen, then say it out loud. Nothing is scored here.'**
  String get warmupBody;

  /// No description provided for @warmupContinue.
  ///
  /// In en, this message translates to:
  /// **'Start learning'**
  String get warmupContinue;

  /// No description provided for @warmupBodyNoVoice.
  ///
  /// In en, this message translates to:
  /// **'Say it out loud. Nothing is scored here.'**
  String get warmupBodyNoVoice;

  /// No description provided for @recordChecked.
  ///
  /// In en, this message translates to:
  /// **'LangQuest checks what you said; the recording isn’t kept.'**
  String get recordChecked;

  /// No description provided for @recordCheckedKept.
  ///
  /// In en, this message translates to:
  /// **'LangQuest checks what you said; recordings are kept as your privacy settings allow.'**
  String get recordCheckedKept;

  /// No description provided for @recordChecking.
  ///
  /// In en, this message translates to:
  /// **'Checking what you said…'**
  String get recordChecking;

  /// No description provided for @recordCheckFailed.
  ///
  /// In en, this message translates to:
  /// **'Couldn’t check this take.'**
  String get recordCheckFailed;

  /// No description provided for @verdictUnderstood.
  ///
  /// In en, this message translates to:
  /// **'Understood!'**
  String get verdictUnderstood;

  /// No description provided for @verdictNotQuite.
  ///
  /// In en, this message translates to:
  /// **'Not quite'**
  String get verdictNotQuite;

  /// No description provided for @verdictNotQuiteHint.
  ///
  /// In en, this message translates to:
  /// **'Listen to the model, then try again.'**
  String get verdictNotQuiteHint;

  /// No description provided for @verdictUnsure.
  ///
  /// In en, this message translates to:
  /// **'I couldn’t make that out'**
  String get verdictUnsure;

  /// No description provided for @verdictUnsureHint.
  ///
  /// In en, this message translates to:
  /// **'Try again, a little closer to the microphone.'**
  String get verdictUnsureHint;

  /// No description provided for @verdictHeard.
  ///
  /// In en, this message translates to:
  /// **'I heard: “{heard}”'**
  String verdictHeard(String heard);

  /// No description provided for @missionSpokenSummary.
  ///
  /// In en, this message translates to:
  /// **'Understood out loud: {understood} of {checked}'**
  String missionSpokenSummary(int understood, int checked);

  /// No description provided for @practiseSayingNoteChecked.
  ///
  /// In en, this message translates to:
  /// **'Listen, record yourself: LangQuest tells you whether what you said came across. That is about meaning; there is no pronunciation score.'**
  String get practiseSayingNoteChecked;

  /// No description provided for @callIntroTitle.
  ///
  /// In en, this message translates to:
  /// **'Practise it in a real conversation'**
  String get callIntroTitle;

  /// No description provided for @callIntroBody.
  ///
  /// In en, this message translates to:
  /// **'Someone from this mission picks up and talks with you in the language you’re learning. Answer out loud, or type. When you hang up, LangQuest tells you how it went.'**
  String get callIntroBody;

  /// No description provided for @callIntroBodyText.
  ///
  /// In en, this message translates to:
  /// **'Someone from this mission chats with you in the language you’re learning. When you end the chat, LangQuest tells you how it went.'**
  String get callIntroBodyText;

  /// No description provided for @callIntroNote.
  ///
  /// In en, this message translates to:
  /// **'Uses LangQuest’s AI. Your recordings aren’t kept.'**
  String get callIntroNote;

  /// No description provided for @callIntroNoteKept.
  ///
  /// In en, this message translates to:
  /// **'Uses LangQuest’s AI. Recordings are kept as your privacy settings allow.'**
  String get callIntroNoteKept;

  /// No description provided for @callStart.
  ///
  /// In en, this message translates to:
  /// **'Call'**
  String get callStart;

  /// No description provided for @callStartText.
  ///
  /// In en, this message translates to:
  /// **'Start the chat'**
  String get callStartText;

  /// No description provided for @callCalling.
  ///
  /// In en, this message translates to:
  /// **'Calling…'**
  String get callCalling;

  /// No description provided for @callFailedUnavailable.
  ///
  /// In en, this message translates to:
  /// **'Live calls aren’t available for this course yet.'**
  String get callFailedUnavailable;

  /// No description provided for @callFailedNetwork.
  ///
  /// In en, this message translates to:
  /// **'The call didn’t go through. Check your connection and try again.'**
  String get callFailedNetwork;

  /// No description provided for @callFailedEnded.
  ///
  /// In en, this message translates to:
  /// **'This call has ended.'**
  String get callFailedEnded;

  /// No description provided for @callTryAgain.
  ///
  /// In en, this message translates to:
  /// **'Try again'**
  String get callTryAgain;

  /// No description provided for @callSpeaking.
  ///
  /// In en, this message translates to:
  /// **'{name} is speaking'**
  String callSpeaking(String name);

  /// No description provided for @callThinking.
  ///
  /// In en, this message translates to:
  /// **'{name} is thinking…'**
  String callThinking(String name);

  /// No description provided for @callListening.
  ///
  /// In en, this message translates to:
  /// **'Listening to you…'**
  String get callListening;

  /// No description provided for @callYourTurnVoice.
  ///
  /// In en, this message translates to:
  /// **'Your turn: tap the microphone and answer'**
  String get callYourTurnVoice;

  /// No description provided for @callYourTurnText.
  ///
  /// In en, this message translates to:
  /// **'Your turn: type your answer'**
  String get callYourTurnText;

  /// No description provided for @callTalk.
  ///
  /// In en, this message translates to:
  /// **'Talk'**
  String get callTalk;

  /// No description provided for @callSend.
  ///
  /// In en, this message translates to:
  /// **'Send'**
  String get callSend;

  /// No description provided for @callCancelTake.
  ///
  /// In en, this message translates to:
  /// **'Cancel'**
  String get callCancelTake;

  /// No description provided for @callType.
  ///
  /// In en, this message translates to:
  /// **'Type instead'**
  String get callType;

  /// No description provided for @callTypeHint.
  ///
  /// In en, this message translates to:
  /// **'Write your answer…'**
  String get callTypeHint;

  /// No description provided for @callHangUp.
  ///
  /// In en, this message translates to:
  /// **'Hang up'**
  String get callHangUp;

  /// No description provided for @callEndChat.
  ///
  /// In en, this message translates to:
  /// **'End the chat'**
  String get callEndChat;

  /// No description provided for @callHint.
  ///
  /// In en, this message translates to:
  /// **'Hint'**
  String get callHint;

  /// No description provided for @callRepeat.
  ///
  /// In en, this message translates to:
  /// **'Repeat'**
  String get callRepeat;

  /// No description provided for @callSlower.
  ///
  /// In en, this message translates to:
  /// **'Slower'**
  String get callSlower;

  /// No description provided for @callTranslate.
  ///
  /// In en, this message translates to:
  /// **'Translate'**
  String get callTranslate;

  /// No description provided for @callGoals.
  ///
  /// In en, this message translates to:
  /// **'Goals'**
  String get callGoals;

  /// No description provided for @callGoalDone.
  ///
  /// In en, this message translates to:
  /// **'{goal}: done'**
  String callGoalDone(String goal);

  /// No description provided for @callGoalProbably.
  ///
  /// In en, this message translates to:
  /// **'{goal}: probably done'**
  String callGoalProbably(String goal);

  /// No description provided for @callGoalNotYet.
  ///
  /// In en, this message translates to:
  /// **'{goal}: not yet'**
  String callGoalNotYet(String goal);

  /// No description provided for @callNoSpeech.
  ///
  /// In en, this message translates to:
  /// **'I didn’t hear anything. Try again, a little closer to the microphone.'**
  String get callNoSpeech;

  /// No description provided for @callTurnFailed.
  ///
  /// In en, this message translates to:
  /// **'That didn’t go through. Try again.'**
  String get callTurnFailed;

  /// No description provided for @callSaidGoodbye.
  ///
  /// In en, this message translates to:
  /// **'{name} said goodbye. Hang up to see how it went.'**
  String callSaidGoodbye(String name);

  /// No description provided for @callEnding.
  ///
  /// In en, this message translates to:
  /// **'Hanging up… LangQuest is looking at how it went.'**
  String get callEnding;

  /// No description provided for @callEndedTitle.
  ///
  /// In en, this message translates to:
  /// **'Call ended'**
  String get callEndedTitle;

  /// No description provided for @callChatEndedTitle.
  ///
  /// In en, this message translates to:
  /// **'Chat ended'**
  String get callChatEndedTitle;

  /// No description provided for @callGoalsMet.
  ///
  /// In en, this message translates to:
  /// **'Goals met: {met} of {total}'**
  String callGoalsMet(int met, int total);

  /// No description provided for @callNextTime.
  ///
  /// In en, this message translates to:
  /// **'Next time, try'**
  String get callNextTime;

  /// No description provided for @callYouSaid.
  ///
  /// In en, this message translates to:
  /// **'You said: “{text}”'**
  String callYouSaid(String text);

  /// No description provided for @callNotEvaluated.
  ///
  /// In en, this message translates to:
  /// **'LangQuest couldn’t evaluate this call, so nothing was counted.'**
  String get callNotEvaluated;

  /// No description provided for @callAgain.
  ///
  /// In en, this message translates to:
  /// **'Call again'**
  String get callAgain;

  /// No description provided for @callYou.
  ///
  /// In en, this message translates to:
  /// **'You'**
  String get callYou;

  /// No description provided for @callReplayLine.
  ///
  /// In en, this message translates to:
  /// **'Play this line again'**
  String get callReplayLine;

  /// No description provided for @callHeardYou.
  ///
  /// In en, this message translates to:
  /// **'Hearing you…'**
  String get callHeardYou;

  /// No description provided for @pathTalkSubtitle.
  ///
  /// In en, this message translates to:
  /// **'A live call: use what you learned, out loud'**
  String get pathTalkSubtitle;

  /// No description provided for @pathTalkSubtitleText.
  ///
  /// In en, this message translates to:
  /// **'A live chat: use what you learned'**
  String get pathTalkSubtitleText;

  /// No description provided for @missionTryLiveCall.
  ///
  /// In en, this message translates to:
  /// **'Try it in a live call'**
  String get missionTryLiveCall;

  /// No description provided for @courseIncludesLiveCalls.
  ///
  /// In en, this message translates to:
  /// **'Live calls with {count, plural, =1{the course’s AI character} other{{count} AI characters}}, by voice or in writing (with a free account)'**
  String courseIncludesLiveCalls(int count);

  /// No description provided for @courseIncludesSpokenCheck.
  ///
  /// In en, this message translates to:
  /// **'Your spoken answers checked: LangQuest tells you whether you were understood (with a free account)'**
  String get courseIncludesSpokenCheck;

  /// No description provided for @courseMissingPronunciationScore.
  ///
  /// In en, this message translates to:
  /// **'A pronunciation score: spoken answers are checked for meaning, not accent'**
  String get courseMissingPronunciationScore;

  /// No description provided for @courseLimitedForDialect.
  ///
  /// In en, this message translates to:
  /// **'Speech recognition and AI voices are still limited for this dialect (not yet reviewed by native speakers)'**
  String get courseLimitedForDialect;

  /// No description provided for @listenAiVoiceSemantics.
  ///
  /// In en, this message translates to:
  /// **'Listen (AI voice)'**
  String get listenAiVoiceSemantics;

  /// No description provided for @listenSlowlyAiVoiceSemantics.
  ///
  /// In en, this message translates to:
  /// **'Listen slowly (AI voice)'**
  String get listenSlowlyAiVoiceSemantics;

  /// No description provided for @tabAudio.
  ///
  /// In en, this message translates to:
  /// **'Audio'**
  String get tabAudio;

  /// No description provided for @audioLibraryTitle.
  ///
  /// In en, this message translates to:
  /// **'Audio lessons'**
  String get audioLibraryTitle;

  /// No description provided for @audioLibraryBody.
  ///
  /// In en, this message translates to:
  /// **'One per mission: the conversation, then phrase by phrase with time to say each one, then the conversation again.'**
  String get audioLibraryBody;

  /// No description provided for @audioReadByAi.
  ///
  /// In en, this message translates to:
  /// **'Read by an AI voice'**
  String get audioReadByAi;

  /// No description provided for @audioReadByDevice.
  ///
  /// In en, this message translates to:
  /// **'Read by your device’s voice'**
  String get audioReadByDevice;

  /// No description provided for @audioLessonMeta.
  ///
  /// In en, this message translates to:
  /// **'{phrases, plural, =1{1 phrase} other{{phrases} phrases}} · about {minutes} min'**
  String audioLessonMeta(int phrases, int minutes);

  /// No description provided for @audioListened.
  ///
  /// In en, this message translates to:
  /// **'Listened'**
  String get audioListened;

  /// No description provided for @audioLessonLabel.
  ///
  /// In en, this message translates to:
  /// **'Audio lesson'**
  String get audioLessonLabel;

  /// No description provided for @audioIntro.
  ///
  /// In en, this message translates to:
  /// **'{mission}. Listen to the conversation.'**
  String audioIntro(String mission);

  /// No description provided for @audioPhrasesIntro.
  ///
  /// In en, this message translates to:
  /// **'Now phrase by phrase. Listen, then say it out loud.'**
  String get audioPhrasesIntro;

  /// No description provided for @audioAgainIntro.
  ///
  /// In en, this message translates to:
  /// **'Once more, the whole conversation.'**
  String get audioAgainIntro;

  /// No description provided for @audioOutro.
  ///
  /// In en, this message translates to:
  /// **'That’s the end of the lesson. Well done!'**
  String get audioOutro;

  /// No description provided for @audioSectionConversation.
  ///
  /// In en, this message translates to:
  /// **'The conversation'**
  String get audioSectionConversation;

  /// No description provided for @audioSectionPhrases.
  ///
  /// In en, this message translates to:
  /// **'Phrase by phrase'**
  String get audioSectionPhrases;

  /// No description provided for @audioSectionAgain.
  ///
  /// In en, this message translates to:
  /// **'Once more'**
  String get audioSectionAgain;

  /// No description provided for @audioYourTurn.
  ///
  /// In en, this message translates to:
  /// **'Your turn: say it'**
  String get audioYourTurn;

  /// No description provided for @audioPlay.
  ///
  /// In en, this message translates to:
  /// **'Play'**
  String get audioPlay;

  /// No description provided for @audioPause.
  ///
  /// In en, this message translates to:
  /// **'Pause'**
  String get audioPause;

  /// No description provided for @audioNextLine.
  ///
  /// In en, this message translates to:
  /// **'Next line'**
  String get audioNextLine;

  /// No description provided for @audioPreviousLine.
  ///
  /// In en, this message translates to:
  /// **'Previous line'**
  String get audioPreviousLine;

  /// No description provided for @audioSlowly.
  ///
  /// In en, this message translates to:
  /// **'Slowly'**
  String get audioSlowly;

  /// No description provided for @audioTurns.
  ///
  /// In en, this message translates to:
  /// **'Time to repeat'**
  String get audioTurns;

  /// No description provided for @audioFinished.
  ///
  /// In en, this message translates to:
  /// **'Lesson finished'**
  String get audioFinished;

  /// No description provided for @audioPlayAgain.
  ///
  /// In en, this message translates to:
  /// **'Play again'**
  String get audioPlayAgain;

  /// No description provided for @audioYou.
  ///
  /// In en, this message translates to:
  /// **'You'**
  String get audioYou;

  /// No description provided for @courseIncludesAudioLessons.
  ///
  /// In en, this message translates to:
  /// **'Audio lessons made from each mission, read by {voice}'**
  String courseIncludesAudioLessons(String voice);

  /// No description provided for @courseVoiceAi.
  ///
  /// In en, this message translates to:
  /// **'an AI voice (with a free account)'**
  String get courseVoiceAi;

  /// No description provided for @courseVoiceDevice.
  ///
  /// In en, this message translates to:
  /// **'your device’s voice'**
  String get courseVoiceDevice;

  /// No description provided for @courseMissingAudioRecorded.
  ///
  /// In en, this message translates to:
  /// **'Audio recorded by native speakers'**
  String get courseMissingAudioRecorded;

  /// No description provided for @courseIncludesAiVoiceDialect.
  ///
  /// In en, this message translates to:
  /// **'An AI voice for this dialect (with a free account)'**
  String get courseIncludesAiVoiceDialect;

  /// No description provided for @tabSpeak.
  ///
  /// In en, this message translates to:
  /// **'Speak'**
  String get tabSpeak;

  /// No description provided for @speakTitle.
  ///
  /// In en, this message translates to:
  /// **'Talk with the locals'**
  String get speakTitle;

  /// No description provided for @speakBody.
  ///
  /// In en, this message translates to:
  /// **'Free conversations with the course’s characters, by voice or in writing. Use what you’ve learned; ask for a hint whenever you need one.'**
  String get speakBody;

  /// No description provided for @speakNoCharacters.
  ///
  /// In en, this message translates to:
  /// **'No characters are published for this course yet.'**
  String get speakNoCharacters;

  /// No description provided for @speakCall.
  ///
  /// In en, this message translates to:
  /// **'Call {name}'**
  String speakCall(String name);

  /// No description provided for @callFreeTitle.
  ///
  /// In en, this message translates to:
  /// **'Call {name}'**
  String callFreeTitle(String name);

  /// No description provided for @callFreeBody.
  ///
  /// In en, this message translates to:
  /// **'A free conversation, in the language you’re learning, about everyday things. Answer out loud, or type. When you hang up, LangQuest tells you how it went.'**
  String get callFreeBody;

  /// No description provided for @callFreeBodyText.
  ///
  /// In en, this message translates to:
  /// **'A free chat, in the language you’re learning, about everyday things. When you end it, LangQuest tells you how it went.'**
  String get callFreeBodyText;

  /// No description provided for @missionAnswerOutLoud.
  ///
  /// In en, this message translates to:
  /// **'Answer out loud'**
  String get missionAnswerOutLoud;

  /// No description provided for @missionAnswerOutLoudHint.
  ///
  /// In en, this message translates to:
  /// **'Say your reply: LangQuest checks it. Or choose it below.'**
  String get missionAnswerOutLoudHint;

  /// No description provided for @missionAnsweredOutLoud.
  ///
  /// In en, this message translates to:
  /// **'Answered out loud'**
  String get missionAnsweredOutLoud;

  /// No description provided for @reviewSayItChecked.
  ///
  /// In en, this message translates to:
  /// **'Say it out loud: LangQuest checks it, then shows the answer. Or show it yourself.'**
  String get reviewSayItChecked;

  /// No description provided for @reviewSuggested.
  ///
  /// In en, this message translates to:
  /// **'suggested'**
  String get reviewSuggested;
}

class _AppLocalizationsDelegate extends LocalizationsDelegate<AppLocalizations> {
  const _AppLocalizationsDelegate();

  @override
  Future<AppLocalizations> load(Locale locale) {
    return SynchronousFuture<AppLocalizations>(lookupAppLocalizations(locale));
  }

  @override
  bool isSupported(Locale locale) => <String>['en', 'fr'].contains(locale.languageCode);

  @override
  bool shouldReload(_AppLocalizationsDelegate old) => false;
}

AppLocalizations lookupAppLocalizations(Locale locale) {
  // Lookup logic when only language code is specified.
  switch (locale.languageCode) {
    case 'en':
      return AppLocalizationsEn();
    case 'fr':
      return AppLocalizationsFr();
  }

  throw FlutterError(
    'AppLocalizations.delegate failed to load unsupported locale "$locale". This is likely '
    'an issue with the localizations generation tool. Please file an issue '
    'on GitHub with a reproducible sample app and the gen-l10n configuration '
    'that was used.',
  );
}
