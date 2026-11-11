// ignore: unused_import
import 'package:intl/intl.dart' as intl;

import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for French (`fr`).
class AppLocalizationsFr extends AppLocalizations {
  AppLocalizationsFr([String locale = 'fr']) : super(locale);

  @override
  String get appTitle => 'LangQuest';

  @override
  String get tabHome => 'Accueil';

  @override
  String get tabMissions => 'Missions';

  @override
  String get tabProgress => 'Progrès';

  @override
  String get back => 'Retour';

  @override
  String get close => 'Fermer';

  @override
  String get cancel => 'Annuler';

  @override
  String get next => 'Suivant';

  @override
  String get you => 'Vous';

  @override
  String get listen => 'Écouter';

  @override
  String get listenSlowly => 'Lentement';

  @override
  String get listenSlowlySemantics => 'Écouter lentement';

  @override
  String get syntheticVoice => 'Voix de synthèse';

  @override
  String stepOf(int step, int total) {
    return 'Étape $step sur $total';
  }

  @override
  String xpGain(int xp) {
    return '+$xp XP';
  }

  @override
  String languageName(String code) {
    String _temp0 = intl.Intl.selectLogic(code, {'en': 'anglais', 'fr': 'français', 'ru': 'russe', 'other': '$code'});
    return '$_temp0';
  }

  @override
  String fromLanguage(String code) {
    String _temp0 = intl.Intl.selectLogic(code, {
      'en': 'à partir de l’anglais',
      'fr': 'à partir du français',
      'ru': 'à partir du russe',
      'other': 'à partir de $code',
    });
    return '$_temp0';
  }

  @override
  String get notNativeReviewed => 'Pas encore relu par des locuteurs natifs';

  @override
  String get draftChapterNotice => 'Chapitre rédigé par IA, pas encore relu par des locuteurs natifs. Il peut contenir des erreurs.';

  @override
  String missionsCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(count, locale: localeName, other: '$count missions', one: '1 mission');
    return '$_temp0';
  }

  @override
  String get settings => 'Réglages';

  @override
  String get switchCourse => 'Changer de cours';

  @override
  String get welcomeTitle => 'Apprenez une langue en la pratiquant';

  @override
  String get welcomeBody => 'De vraies situations et de vrais dialectes, enseignés avant d’être testés. Gratuit : sans abonnement, crédits ni paywall.';

  @override
  String get welcomeLanguageLabel => 'Application et explications en';

  @override
  String get welcomeContinue => 'Choisir un cours';

  @override
  String get pickCourseTitle => 'Que voulez-vous apprendre ?';

  @override
  String get pickCourseReady => 'Prêts à commencer';

  @override
  String get pickCourseNone => 'Aucun cours ne peut encore être enseigné à partir de cette langue.';

  @override
  String get seeAllCourses => 'Voir les 30 cours';

  @override
  String get courseIncludesTitle => 'Ce que ce cours comprend';

  @override
  String courseIncludesMissions(int count) {
    String _temp0 = intl.Intl.pluralLogic(count, locale: localeName, other: '$count missions', one: '1 mission');
    return 'Parcours de missions ($_temp0)';
  }

  @override
  String get courseIncludesLearn => 'Avant chaque mission : une scène, des cartes de phrases et deux mini-jeux';

  @override
  String get courseIncludesReview => 'Révision espacée des phrases que vous utilisez';

  @override
  String get courseIncludesVoice => 'Répliques lues par la voix de synthèse du téléphone, quand il en a une pour cette langue';

  @override
  String get courseMissingTitle => 'Ce que ce cours n’a pas encore';

  @override
  String get courseMissingNativeReview => 'La relecture par des locuteurs natifs : le contenu est un brouillon rédigé par IA et peut contenir des erreurs';

  @override
  String get courseMissingConversation => 'La conversation en direct avec les personnages IA';

  @override
  String get courseMissingAudio => 'La bibliothèque audio';

  @override
  String get courseMissingPronunciation => 'Le retour oral sur la prononciation';

  @override
  String get courseMissingVoiceDialect => 'Une voix pour ce dialecte : les voix du téléphone parlent l’arabe standard moderne, qui n’est pas cette variété';

  @override
  String get courseLearnFrom => 'Apprendre à partir de';

  @override
  String get coursePlanned => 'Pas encore disponible. Prévu.';

  @override
  String get courseStart => 'Commencer ce cours';

  @override
  String get courseContinue => 'Continuer ce cours';

  @override
  String courseExplanationsIn(String language) {
    return 'Explications en $language';
  }

  @override
  String get homeNextMission => 'Prochaine mission';

  @override
  String homeNextStop(String stop) {
    return 'Ensuite : $stop';
  }

  @override
  String get homeChapterDone => 'Chapitre terminé';

  @override
  String get homeChapterDoneBody => 'Vous avez utilisé toutes les phrases de ce chapitre. La révision les garde vivantes.';

  @override
  String get homeReviewTitle => 'Révision';

  @override
  String reviewsDue(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count révisions à faire',
      one: '1 révision à faire',
      zero: 'Aucune révision à faire',
    );
    return '$_temp0';
  }

  @override
  String nextReviewAt(String when) {
    return 'Prochaine révision $when';
  }

  @override
  String streakDays(int count) {
    String _temp0 = intl.Intl.pluralLogic(count, locale: localeName, other: '$count jours d’affilée', one: '1 jour d’affilée');
    return '$_temp0';
  }

  @override
  String get streakPaused => 'Série en pause. Reprenez quand vous voulez.';

  @override
  String get pathwayTitle => 'Votre parcours';

  @override
  String chapterLabel(int index) {
    return 'Chapitre $index';
  }

  @override
  String missionLabel(int index) {
    return 'Mission $index';
  }

  @override
  String missionLocked(String title) {
    return 'Terminez d’abord « $title »';
  }

  @override
  String get lockedSemantics => 'verrouillée';

  @override
  String get stopLearn => 'Apprendre';

  @override
  String get stopPractise => 'S’entraîner';

  @override
  String get stopMission => 'Mission';

  @override
  String get stopTalk => 'Parler';

  @override
  String stopsDoneSemantics(int done, int total) {
    return '$done étapes faites sur $total';
  }

  @override
  String pathLearnSubtitle(String name, int count) {
    String _temp0 = intl.Intl.pluralLogic(count, locale: localeName, other: '$count phrases', one: '1 phrase');
    return 'Une scène avec $name, puis $_temp0';
  }

  @override
  String get pathPractiseSubtitle => 'Associer les paires, construire une phrase';

  @override
  String get pathPractisePairsOnly => 'Associer les paires';

  @override
  String pathMissionSubtitle(int count, String name) {
    String _temp0 = intl.Intl.pluralLogic(count, locale: localeName, other: '$count échanges', one: '1 échange');
    return '$_temp0 avec $name';
  }

  @override
  String get pathComplete => 'Parcours de mission terminé';

  @override
  String pathStartStop(String stop) {
    return 'Commencer : $stop';
  }

  @override
  String pathContinueStop(String stop) {
    return 'Continuer : $stop';
  }

  @override
  String get pathDoneSemantics => 'fait';

  @override
  String get pathNextSemantics => 'à faire';

  @override
  String sceneTitle(String title) {
    return 'Apprendre · $title';
  }

  @override
  String get sceneYourLine => 'Votre réplique — dites-la à voix haute';

  @override
  String get sceneISaidIt => 'Je l’ai dit';

  @override
  String get sceneLearnPhrases => 'Apprendre les phrases';

  @override
  String speakingSemantics(String name) {
    return '$name parle';
  }

  @override
  String cardsTitle(String title) {
    return 'Nouvelles phrases · $title';
  }

  @override
  String get cardsNextPhrase => 'Phrase suivante';

  @override
  String get cardsPractise => 'S’entraîner';

  @override
  String get noteLabel => 'Remarque';

  @override
  String practiseTitle(String title) {
    return 'S’entraîner · $title';
  }

  @override
  String get pairsPrompt => 'Associez chaque phrase à son sens';

  @override
  String get pairsDone => 'Tout est associé !';

  @override
  String get pairsNextRound => 'Manche suivante';

  @override
  String get pairsBuildSentence => 'Construire une phrase';

  @override
  String matchedSemantics(String label) {
    return '$label, associé';
  }

  @override
  String get tilesPrompt => 'Construisez la phrase';

  @override
  String get tilesCheck => 'Vérifier';

  @override
  String get tilesWrong => 'Pas tout à fait — touchez un mot pour le retirer.';

  @override
  String tilesRemoveSemantics(String word) {
    return '$word, retirer';
  }

  @override
  String get startMission => 'Commencer la mission';

  @override
  String missionCue(String name) {
    return '$name dit';
  }

  @override
  String get missionWhatDoYouAnswer => 'Que répondez-vous ?';

  @override
  String missionHowDoYouSay(String meaning) {
    return 'Comment dit-on « $meaning » ?';
  }

  @override
  String get missionWrong => 'Pas tout à fait — pensez à ce que vous avez pratiqué.';

  @override
  String get missionSayIt => 'Dites-le à voix haute';

  @override
  String get missionRecapTitle => 'Ce que vous avez utilisé';

  @override
  String get missionComplete => 'Terminer la mission';

  @override
  String get missionCompleted => 'Mission accomplie !';

  @override
  String get missionXpOnce => 'Les XP d’une mission ne comptent qu’une fois ; cette reprise est de l’entraînement.';

  @override
  String missionJoinReview(int count) {
    String _temp0 = intl.Intl.pluralLogic(count, locale: localeName, other: '$count phrases rejoignent votre révision', one: '1 phrase rejoint votre révision');
    return '$_temp0';
  }

  @override
  String get missionBackToPath => 'Retour au parcours de la mission';

  @override
  String get missionNext => 'Mission suivante';

  @override
  String get missionNotFound => 'Cette mission ne fait pas partie de votre cours actuel.';

  @override
  String get backHome => 'Retour à l’accueil';

  @override
  String get reviewTitle => 'Révision';

  @override
  String get reviewHowDoYouSay => 'Comment dit-on…';

  @override
  String get reviewSayThenShow => 'Dites-le à voix haute, puis affichez la réponse.';

  @override
  String get reviewShowAnswer => 'Voir la réponse';

  @override
  String get reviewAgain => 'À revoir';

  @override
  String get reviewHard => 'Difficile';

  @override
  String get reviewGood => 'Bien';

  @override
  String get reviewEasy => 'Facile';

  @override
  String reviewLeft(int count) {
    String _temp0 = intl.Intl.pluralLogic(count, locale: localeName, other: 'Encore $count', one: 'Encore 1');
    return '$_temp0';
  }

  @override
  String get reviewAllDone => 'Tout est à jour pour aujourd’hui.';

  @override
  String get reviewEmpty => 'Les phrases utilisées en mission reviennent ici, juste avant que vous ne les oubliiez.';

  @override
  String get progressTitle => 'Votre progression';

  @override
  String get xpLabel => 'XP';

  @override
  String get xpNote => 'Les XP mesurent votre pratique, pas votre niveau à l’oral.';

  @override
  String get streakTitle => 'Série';

  @override
  String get thisWeek => 'Cette semaine';

  @override
  String get missionsDoneTitle => 'Missions terminées';

  @override
  String countOfTotal(int done, int total) {
    return '$done sur $total';
  }

  @override
  String get phrasesTitle => 'Phrases';

  @override
  String get phrasesMet => 'Rencontrées en leçon';

  @override
  String get phrasesInReview => 'En révision';

  @override
  String get strengthLearning => 'En apprentissage';

  @override
  String get strengthYoung => 'En progrès';

  @override
  String get strengthSolid => 'Solides';

  @override
  String get strengthNote => 'D’après votre calendrier de révision — pas une note de votre oral.';

  @override
  String get progressEmpty => 'Commencez une mission pour voir votre progression ici.';

  @override
  String get freeTitle => 'Gratuit pour tous';

  @override
  String get freeBody => 'LangQuest n’a ni paywall, ni abonnement, ni crédits, ni compteur d’utilisation.';

  @override
  String get appLanguage => 'Langue de l’application';

  @override
  String get yourCourses => 'Vos cours';

  @override
  String get addCourse => 'Ajouter un cours';

  @override
  String get removeCourse => 'Retirer';

  @override
  String removeCourseTitle(String course) {
    return 'Retirer $course ?';
  }

  @override
  String get removeCourseBody => 'Sa progression et ses révisions sur cet appareil sont supprimées. Vos autres cours ne sont pas touchés.';

  @override
  String get yourData => 'Vos données';

  @override
  String get yourDataBody => 'Tout est enregistré sur cet appareil uniquement. Cette version n’a pas de compte.';

  @override
  String get resetAll => 'Tout réinitialiser';

  @override
  String get resetAllTitle => 'Tout réinitialiser ?';

  @override
  String get resetAllBody => 'Tous les cours, révisions et XP de cet appareil sont supprimés.';

  @override
  String get resetConfirm => 'Réinitialiser';

  @override
  String get activeCourse => 'Actif';

  @override
  String get openSourceLicenses => 'Licences open source';

  @override
  String get catalogTitle => 'Cours';

  @override
  String get catalogSubtitle => '30 cours. De vrais dialectes. Gratuit.';

  @override
  String get catalogSearch => 'Rechercher une langue ou un dialecte';

  @override
  String get catalogReady => 'Prêt · brouillon';

  @override
  String get catalogPlanned => 'Prévu';

  @override
  String get catalogEnrolled => 'Inscrit';

  @override
  String catalogNoResults(String query) {
    return 'Aucun cours ne correspond à « $query »';
  }

  @override
  String get browseAllCourses => 'Parcourir les 30 cours';

  @override
  String get sceneCafe => 'Café';

  @override
  String get sceneStreet => 'Rue';

  @override
  String get sceneAirport => 'Aéroport';

  @override
  String get sceneMarket => 'Marché';

  @override
  String get sceneHome => 'Maison';

  @override
  String get sceneOffice => 'Bureau';

  @override
  String get sceneTransit => 'En route';

  @override
  String get sceneRestaurant => 'Restaurant';

  @override
  String get sceneGathering => 'Terrasse';

  @override
  String get sceneStation => 'Gare';

  @override
  String get scenePark => 'Parc';

  @override
  String get sceneClinic => 'Clinique';

  @override
  String get accountTitle => 'Compte';

  @override
  String get accountPitch =>
      'Enregistrez vos cours et vos missions terminées dans un compte, et reprenez où vous en étiez sur un autre appareil ou navigateur.';

  @override
  String get accountDeviceOnly =>
      'L’XP d’entraînement et vos révisions restent sur cet appareil : le serveur ne compte l’XP que pour les missions avec une prise de parole qu’il a évaluée, et les enregistrements faits ici ne quittent jamais cet appareil.';

  @override
  String get accountEmail => 'E-mail';

  @override
  String get accountPassword => 'Mot de passe';

  @override
  String get accountSignIn => 'Se connecter';

  @override
  String get accountCreate => 'Créer un compte';

  @override
  String get accountMissingFields => 'Saisissez votre e-mail et un mot de passe.';

  @override
  String get accountConfirmEmail => 'Confirmez le compte depuis l’e-mail reçu, puis connectez-vous.';

  @override
  String accountSignedInAs(String email) {
    return 'Connecté en tant que $email';
  }

  @override
  String get accountSaving => 'Enregistrement dans votre compte…';

  @override
  String get accountSaved => 'Vos cours et vos missions terminées sont enregistrés dans votre compte.';

  @override
  String get accountSyncFailed => 'Impossible de joindre votre compte. Votre progression reste sur cet appareil et sera enregistrée plus tard.';

  @override
  String get accountTryAgain => 'Réessayer';

  @override
  String accountNotSaved(String courses) {
    return 'Non enregistré dans votre compte : $courses. Une autre langue d’explication de ce cours y est déjà active.';
  }

  @override
  String get accountSignOut => 'Se déconnecter';

  @override
  String get yourDataBodyAccount =>
      'Vos cours et vos missions terminées sont aussi conservés dans votre compte. Tout le reste — XP d’entraînement, révisions, réglages — n’est enregistré que sur cet appareil.';

  @override
  String get yourDataBodySignedOut =>
      'Tout est enregistré uniquement sur cet appareil, sauf si vous vous connectez ci-dessus pour conserver vos cours et vos missions terminées dans un compte.';

  @override
  String get accountExport => 'Exporter mes données';

  @override
  String accountExported(String file) {
    return 'Enregistré : $file';
  }

  @override
  String get accountDelete => 'Supprimer mon compte';

  @override
  String get accountDeleteTitle => 'Supprimer votre compte ?';

  @override
  String get accountDeleteBody =>
      'Supprime définitivement votre compte, ainsi que les cours et la progression qui y sont enregistrés. Cette action est irréversible. La progression sur cet appareil reste jusqu’à ce que vous la réinitialisiez.';

  @override
  String accountDeleteType(String word) {
    return 'Tapez $word pour confirmer.';
  }

  @override
  String get accountDeleteWord => 'SUPPRIMER';

  @override
  String get accountDeleted => 'Votre compte a été supprimé.';

  @override
  String get accountDeleteScheduled => 'Votre compte sera supprimé sous 30 jours. Reconnectez-vous pour annuler.';

  @override
  String get recordYourself => 'Enregistrez-vous';

  @override
  String get recordStop => 'Arrêter';

  @override
  String get recordStopSemantics => 'Arrêter l’enregistrement';

  @override
  String get recordingNow => 'Enregistrement en cours';

  @override
  String get recordMyVoice => 'Ma voix';

  @override
  String get recordMyVoiceSemantics => 'Écouter votre enregistrement';

  @override
  String get recordStopPlayingSemantics => 'Arrêter la lecture de votre enregistrement';

  @override
  String get recordAgain => 'Recommencer';

  @override
  String get recordAgainSemantics => 'Enregistrer à nouveau';

  @override
  String get recordTryAgain => 'Réessayer';

  @override
  String get recordStaysOnDevice => 'Votre enregistrement reste sur cet appareil.';

  @override
  String recordCompare(String listen, String mine) {
    return 'Comparez : $listen, puis $mine.';
  }

  @override
  String get recordSilent => 'Je n’ai rien entendu. Vérifiez votre micro et réessayez.';

  @override
  String get recordBlocked => 'Le micro est bloqué. Autorisez-le pour ce site, puis réessayez.';

  @override
  String get recordNoMicrophone => 'Aucun micro trouvé.';

  @override
  String get recordFailed => 'L’enregistrement n’a pas fonctionné.';

  @override
  String get display => 'Affichage';

  @override
  String get themeDark => 'Sombre';

  @override
  String get themeLight => 'Clair';

  @override
  String get themeDevice => 'Appareil';

  @override
  String get textSize => 'Taille du texte';

  @override
  String get textSizeBody => 'En plus de la taille du texte de votre appareil.';

  @override
  String get reduceMotion => 'Réduire les animations';

  @override
  String get reduceMotionBody => 'Les scènes, Melo et les changements de page restent immobiles.';

  @override
  String get reduceMotionDevice => 'Activé dans les réglages de votre appareil.';

  @override
  String get showMascot => 'Afficher Melo, la mascotte';

  @override
  String get showMascotBody => 'Melo vous encourage ; le masquer ne masque rien d’autre.';

  @override
  String get textSmaller => 'Texte plus petit';

  @override
  String get textLarger => 'Texte plus grand';

  @override
  String textSizeValue(String percent) {
    return 'Taille du texte $percent';
  }
}
