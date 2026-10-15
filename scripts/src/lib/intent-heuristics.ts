/**
 * Keyword / pattern heuristics that map corpus sentences to `@langquest/curriculum`
 * communicative intents (spec §9.2 "curate practical expressions by intent"). These are
 * curation aids: every match becomes a `review_needed` draft with a confidence, never a
 * published fact. Patterns are per language (ISO-639-3 Tatoeba codes); the English
 * translation of a sentence is always scored too, so a Russian or Arabic sentence can be
 * curated through its linked English sentence.
 *
 * Every intent key referenced here is validated against `INTENTS` at load time.
 */
import { INTENTS, isIntentKey, type CommunicativeIntent } from '@langquest/curriculum';

export interface IntentPattern {
  intentKey: string;
  /** Case-insensitive regex tested against the normalised sentence. */
  pattern: RegExp;
  /** 0..1 — how strongly this pattern alone indicates the intent. */
  weight: number;
}

/** `\\b` is ASCII-only even with the `u` flag (fails after é, ñ, Cyrillic…); swap it for a Unicode letter boundary. */
const UNICODE_BOUNDARY = '(?:(?<![\\p{L}\\p{N}])(?=[\\p{L}\\p{N}])|(?<=[\\p{L}\\p{N}])(?![\\p{L}\\p{N}]))';
const unicodeBoundaries = (source: string): string => source.replace(/\\b/g, UNICODE_BOUNDARY);

const p = (intentKey: string, source: string, weight = 0.7): IntentPattern => ({ intentKey, pattern: new RegExp(unicodeBoundaries(source), 'iu'), weight });

/** Per-language pattern tables. Keep patterns short and anchored on fixed expressions. */
export const INTENT_PATTERNS: Readonly<Record<string, readonly IntentPattern[]>> = {
  eng: [
    p('greet_hello', '^(hi|hello|hey)\\b', 0.9),
    p('greet_time_of_day', '^good (morning|afternoon|evening)\\b', 0.9),
    p('ask_how_are_you', '\\bhow are you\\b|\\bhow(\'s| is) it going\\b|\\bhow do you do\\b', 0.9),
    p('reply_fine', "^(i'm|i am) (fine|good|well|ok|okay)\\b|^(fine|good|great)[,.!]? (thanks|thank you)", 0.9),
    p('reply_not_great', "^(i'm|i am) (not (so|very|too) (well|good)|tired|so-so|a bit tired)", 0.8),
    p('introduce_name', '^(my name is|i am|i\'m) [A-Z][a-z]+[.!]?$', 0.8),
    p('ask_name', "\\bwhat('s| is) your name\\b", 0.95),
    p('say_nice_to_meet', '\\b(nice|pleased|glad) to meet you\\b', 0.95),
    p('say_where_from', "^(i'm|i am) from\\b|^i come from\\b", 0.85),
    p('ask_where_from', '\\bwhere are you from\\b|\\bwhere do you come from\\b', 0.95),
    p('say_goodbye', '^(goodbye|bye|see you( later| soon| tomorrow)?|good night)[.!]?$', 0.9),
    p('wish_good_day', '\\bhave a (nice|good|great) (day|evening|trip|weekend)\\b', 0.9),
    p('welcome_someone', '^welcome\\b', 0.8),
    p('thank', '^(thank you|thanks)( (very|so) much| a lot)?[.!]?$', 0.95),
    p('respond_to_thanks', "^(you're welcome|you are welcome|no problem|don't mention it|my pleasure)", 0.95),
    p('apologise', "^(i'm|i am) sorry\\b|^sorry[.!,]|^excuse me, i\\b|^my (mistake|fault)", 0.8),
    p('accept_apology', "^(no problem|it's (ok|okay|fine)|don't worry( about it)?|never mind)[.!]?$", 0.8),
    p('get_attention', '^excuse me[.!,]?$|^excuse me, (sir|madam|miss)', 0.85),
    p('ask_repeat', '\\b(could|can|would) you (please )?(repeat|say (that|it) again)\\b|^(pardon|sorry)\\?$|^what\\?$', 0.9),
    p('ask_slow_down', '\\b(speak|talk|say it)( more)? slowly\\b|\\bslow down\\b', 0.9),
    p('say_not_understood', "\\bi (don't|do not|didn't) understand\\b", 0.9),
    p('ask_meaning_of_word', '\\bwhat does .+ mean\\b|\\bwhat (is|\'s) the meaning of\\b', 0.9),
    p('ask_how_to_say', '\\bhow do you say\\b', 0.95),
    p('confirm_understood', '^(i (understand|see|got it)|got it|understood)[.!]?$', 0.85),
    p('check_comprehension', '\\bdo you understand\\b|\\bis that clear\\b', 0.85),
    p('ask_if_speaks_language', '\\bdo you speak (english|french|spanish|arabic|japanese|russian|german|italian|portuguese|chinese)\\b', 0.95),
    p('say_speak_little', '\\bi (only )?speak (a little|a bit|some)\\b|\\bmy \\w+ is not (very )?good\\b', 0.85),
    p('say_dont_know', "^i (don't|do not) know[.!]?$", 0.9),
    p('request_drink', "\\b(i'd like|i would like|can i (have|get)|could i have|i'll have) (a |an |some )?(coffee|tea|water|juice|beer|glass|cup|espresso|latte|milk|cola|lemonade)\\b", 0.9),
    p('request_food', "\\b(i'd like|i would like|can i (have|get)|could i have|i'll have) (the |a |an |some )?(pizza|sandwich|salad|soup|bread|rice|chicken|fish|meat|menu|dish|burger|pasta|cake|dessert|breakfast|lunch|dinner)\\b", 0.85),
    p('request_item', "\\b(i'd like|i would like|can i (have|get)|could (i|you) (have|give me)|i need|give me) (a |an |some |the )?\\w+", 0.5),
    p('ask_recommendation', '\\bwhat do you recommend\\b|\\bwhat(\'s| is) good here\\b', 0.95),
    p('ask_ingredients', '\\bwhat(\'s| is) in (it|this|the)\\b|\\bdoes (it|this) (contain|have) \\b', 0.85),
    p('ask_for_bill', '\\b(the (bill|check),? please|can (i|we) (have|get) the (bill|check))\\b', 0.95),
    p('ask_payment_method', '\\b(do you (take|accept) (cards?|credit cards?|cash)|can i pay (by|with) card)\\b', 0.95),
    p('say_delicious', '\\b(delicious|tastes (great|good)|very tasty)\\b', 0.85),
    p('request_table', '\\ba table for (two|three|four|\\d+)\\b', 0.95),
    p('ask_price', '\\bhow much (is|does|are|do)\\b|\\bhow much\\?', 0.95),
    p('say_too_expensive', "\\b(too expensive|that's expensive|very expensive)\\b", 0.9),
    p('offer_lower_price', '\\b(can you (do|make it) (cheaper|less)|(is there|any) discount|lower the price)\\b', 0.85),
    p('decline_purchase', "\\b(no thanks|i'll (pass|leave it)|i don't want it)\\b", 0.7),
    p('say_just_looking', "\\b(i'm|i am) just looking\\b", 0.95),
    p('ask_for_variant', '\\bdo you have (it|this|these|them) in (another|a different|a bigger|a smaller|a larger) (size|colou?r)\\b|\\b(another|a different) (size|colou?r)\\b', 0.9),
    p('ask_where_is', '\\bwhere is (the|a|an) \\b|\\bwhere(\'s| are) the\\b', 0.9),
    p('ask_how_to_get', '\\bhow (do|can) i get to\\b|\\bhow do (i|we) go to\\b', 0.95),
    p('give_direction_straight', '\\bgo straight\\b|\\bstraight ahead\\b', 0.9),
    p('give_direction_turn', '\\bturn (left|right)\\b', 0.95),
    p('ask_is_it_far', '\\bis it far\\b|\\bhow far is\\b|\\bhow long does it take\\b', 0.9),
    p('say_it_is_far', "\\bit's (very |quite |too )?far\\b", 0.8),
    p('say_it_is_near', "\\bit's (very |quite )?(near|close|nearby)\\b", 0.8),
    p('say_lost', "\\b(i'm|i am|we are|we're) lost\\b", 0.95),
    p('ask_which_stop', '\\bwhich (stop|station)\\b', 0.9),
    p('hail_taxi', '^taxi!|\\bcall (me )?a taxi\\b', 0.9),
    p('ask_destination', '\\bwhere (to|are you going)\\b', 0.7),
    p('state_destination', '\\b(to the (airport|station|hotel|hospital|centre|center)|take me to)\\b', 0.85),
    p('ask_fare', '\\bhow much (is|to) (the fare|the ride|go to)\\b|\\bhow much is it to\\b', 0.85),
    p('ask_use_meter', '\\b(use|turn on|put on) the meter\\b', 0.95),
    p('say_stop_here', '\\b(stop|drop me) here\\b|\\bhere is fine\\b', 0.9),
    p('buy_ticket', '\\b(a|one|two|\\d+) tickets?( to| for)\\b|\\bticket to\\b', 0.85),
    p('ask_departure_time', '\\b(when|what time) does the (next )?(train|bus|plane|flight) (leave|depart)\\b', 0.95),
    p('ask_time', '\\bwhat time is it\\b|\\bdo you have the time\\b', 0.95),
    p('tell_time', "^it('s| is) (\\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|noon|midnight)( o'clock| thirty| fifteen|:\\d{2})?[.!]?$", 0.8),
    p('ask_opening_hours', '\\b(what time|when) (do you|does it|is it) (open|close)\\b|\\bopening hours\\b', 0.9),
    p('say_new_neighbour', "\\b(i'm|i am) your new neighbou?r\\b|\\bjust moved in\\b", 0.9),
    p('offer_help', '\\b(can|may) i help( you)?\\b|\\bdo you need (any )?help\\b|\\blet me help\\b', 0.9),
    p('ask_small_favour', '\\b(can|could|would) you (do me a favou?r|help me( with)?)\\b', 0.85),
    p('invite', "\\b(would you like to|do you want to|let's) (come|join|have|go)\\b|\\bcome (over|for (tea|dinner|lunch|coffee))\\b", 0.8),
    p('accept_invitation', "\\b(i'd love to|with pleasure|sounds (good|great)|yes, let's)\\b", 0.8),
    p('decline_invitation', "\\b(i can't|i cannot|i'm afraid i can't)( come| make it)?\\b|\\bmaybe (another|next) time\\b", 0.75),
    p('suggest_activity', '\\b(how about|what about|shall we|why don\'t we)\\b', 0.75),
    p('make_plan_time', '\\b(at (\\d{1,2}|noon|midnight)|on (monday|tuesday|wednesday|thursday|friday|saturday|sunday)|tomorrow|this (weekend|evening|afternoon)|see you at)\\b', 0.45),
    p('suggest_other_time', '\\b(another (time|day)|some other time|what about (tomorrow|next week))\\b', 0.8),
    p('confirm_plan', "\\b(it's a deal|deal|see you then|that works|perfect, see you)\\b", 0.8),
    p('cancel_plan', "\\b(i have to cancel|i can't make it|let's postpone|sorry, i can't come)\\b", 0.85),
    p('state_future_plan', "\\b(i'm going to|i am going to|i will|i'll) \\w+", 0.5),
    p('ask_about_family', '\\bdo you have (any )?(children|kids|brothers|sisters|siblings)\\b|\\bhow is your (family|mother|father|wife|husband)\\b', 0.9),
    p('describe_family', '\\bi have (a |an |one |two |three |\\d+ )?(brother|sister|son|daughter|child|children|kids)\\b', 0.85),
    p('ask_occupation', '\\bwhat do you do( for a living)?\\b|\\bwhat(\'s| is) your job\\b|\\bwhere do you work\\b', 0.95),
    p('describe_occupation', "\\b(i'm|i am) (a|an) (teacher|doctor|student|nurse|engineer|driver|cook|lawyer|farmer|programmer|designer|journalist)\\b|\\bi work (as|at|in|for)\\b", 0.85),
    p('describe_routine', '\\b(every (day|morning|evening)|i usually|i (get up|wake up) at)\\b', 0.7),
    p('call_for_help', '^help!|\\bhelp me!|\\bcall (the police|an ambulance|a doctor)\\b', 0.95),
    p('say_emergency_type', "\\b(there's been an accident|there is a fire|someone is hurt|i've been robbed)\\b", 0.9),
    p('ask_for_doctor_or_pharmacy', '\\b(i need a doctor|where is the (nearest )?(pharmacy|hospital|doctor))\\b', 0.95),
    p('describe_pain', '\\b(it hurts|my (head|stomach|back|tooth|leg|arm) hurts|i have a (headache|fever|cold|stomach ?ache))\\b', 0.9),
    p('report_lost_item', "\\bi('ve| have) lost my\\b|\\bi lost my\\b", 0.9),
    p('report_broken', "\\b(doesn't|does not|isn't|is not) work(ing)?\\b|\\bis broken\\b", 0.85),
    p('state_opinion', '^(i think|in my opinion|i believe)\\b', 0.7),
    p('ask_opinion', '\\bwhat do you think\\b|\\bwhat(\'s| is) your opinion\\b', 0.9),
    p('agree', '^(i agree|you are right|you\'re right|exactly|absolutely)[.!]?', 0.85),
    p('disagree_politely', "^(i don't (quite )?agree|i'm not sure (about that|i agree))\\b|\\bi see it differently\\b", 0.85),
    p('give_reason', '^because\\b', 0.6),
    p('ask_reason', '^why\\b|\\bwhy (not|is that)\\b', 0.7),
    p('express_like', '^i (really )?(like|love) \\b', 0.8),
    p('express_dislike', "^i (don't|do not) like\\b|^i hate\\b|^i can't stand\\b", 0.85),
    p('express_preference_between', '\\bi prefer\\b|\\bi\'d rather\\b', 0.85),
    p('express_feeling', "^(i'm|i am|i feel) (happy|sad|tired|angry|nervous|excited|scared|bored|hungry|thirsty|cold|hot)\\b", 0.85),
    p('react_with_empathy', "\\b(i'm sorry to hear that|that's too bad|poor you|don't worry)\\b", 0.85),
    p('compliment', '\\b(you look (great|nice|beautiful)|what a (beautiful|nice|lovely)|i like your)\\b', 0.8),
    p('respond_to_compliment', "\\b(that's (kind|nice) of you|you're too kind|thanks, (that's|you're))\\b", 0.8),
    p('small_talk_weather', "\\b(it's|it is|what) (a )?(beautiful|nice|lovely|cold|hot|rainy|sunny|warm) (day|weather)\\b|\\bit('s| is) (raining|snowing|hot|cold) (today|outside)\\b", 0.85),
    p('narrate_past_event', '\\b(yesterday|last (night|week|year|weekend)|this morning) i\\b', 0.6),
    p('say_when_happened', '\\b(it happened|that was) (yesterday|last|two|three|in \\d{4})\\b', 0.7),
    p('ask_permission', '\\b(may|can|could) i (sit|come in|smoke|open|take|use|park|borrow)\\b|\\bdo you mind if i\\b', 0.9),
    p('grant_permission', '^(of course|go ahead|sure, go ahead|yes, you (can|may))[.!,]', 0.8),
    p('refuse_permission', "^(i'm afraid (not|you can't)|sorry, (you can't|that's not possible))", 0.85),
    p('ask_availability', '\\bdo you have (a room|a table|any (rooms|tables|seats)|a seat)( available| free)?\\b|\\bis (it|this seat|this table) (free|taken|available)\\b', 0.9),
    p('make_reservation', "\\b(i'd like to|i would like to|can i) (book|reserve|make a reservation)\\b", 0.95),
    p('ask_alternative', '\\bwhat else (do you have|is there)\\b|\\bdo you have (anything|something) else\\b', 0.85),
    p('say_unavailable', "\\b(we're|we are) out of\\b|\\bwe (don't|do not) have (any )?(more|left)\\b|\\bthere is none left\\b", 0.8),
    p('choose_option', "^(i'll take|i'll have|the (first|second|big|small|large) one|that one)[.!,]", 0.75),
    p('specify_quantity', '^(two|three|four|a small|a large|a medium|one more|just one)[.!,]? ?(please)?[.!]?$', 0.7),
    p('confirm_order', "\\b(that's (all|it|everything)|that's right)\\b|^(yes, that's all)", 0.7),
    p('state_price', "^(it's|that's|that will be|that'll be) \\$?\\d+", 0.8),
    p('pay', '^here you (are|go)[.!]?$|\\bkeep the change\\b', 0.85),
    p('ask_for_change', "\\b(do you have change|can you break a|i need change|where's my change)\\b", 0.85),
    p('agree_to_price', "^(ok|okay|all right|fine), i'll take it[.!]?$|^deal[.!]?$", 0.8),
    p('ask_last_price', '\\b(what\'s|what is) your (best|last|final) price\\b', 0.95),
    p('accept_offer', '^(yes,? please|sure|all right|ok,? thanks|with pleasure)[.!]?$', 0.7),
    p('decline_offer', '^(no,? thank you|no,? thanks)[.!]?$', 0.85),
    p('ask_clarification', '\\bwhat do you mean\\b|\\bdo you mean\\b', 0.85),
    p('correct_self', '^(i mean|sorry, i meant|no, wait)\\b', 0.8),
  ],
  fra: [
    p('greet_hello', '^(bonjour|salut|coucou)\\b', 0.9),
    p('greet_time_of_day', '^(bonsoir|bonne (journée|soirée))\\b', 0.85),
    p('ask_how_are_you', '\\b(comment (ça va|allez-vous|vas-tu)|ça va\\s*\\?)', 0.9),
    p('reply_fine', '^(ça va|je vais) (bien|très bien)\\b|^très bien,? merci', 0.9),
    p('introduce_name', "^(je m'appelle|moi c'est|je suis) [A-ZÉ][\\wé-]+[.!]?$", 0.85),
    p('ask_name', '\\bcomment (tu t\'appelles|vous vous appelez)\\b|\\btu t\'appelles comment\\b', 0.95),
    p('say_nice_to_meet', '\\b(enchanté|enchantée|ravi(e)? de (vous|te) (rencontrer|connaître))\\b', 0.95),
    p('say_where_from', '^je (viens|suis) (de|du|des|d\')\\b', 0.8),
    p('ask_where_from', "\\b(d'où (venez-vous|viens-tu|vous venez|tu viens)|vous êtes d'où|tu es d'où)\\b", 0.95),
    p('say_goodbye', '^(au revoir|à (bientôt|plus|demain|tout à l\'heure)|salut|bonne nuit)[.!]?$', 0.9),
    p('wish_good_day', '\\bbonne (journée|soirée|route|continuation)\\b', 0.85),
    p('thank', '^merci( beaucoup| bien| infiniment)?[.!]?$', 0.95),
    p('respond_to_thanks', "^(de rien|je (vous|t')en prie|il n'y a pas de quoi|avec plaisir)", 0.95),
    p('apologise', '^(désolé|désolée|pardon|je suis désolé|excusez-moi, je)\\b', 0.8),
    p('accept_apology', "^(ce n'est (pas grave|rien)|pas de (problème|souci)|ne (vous|t') (inquiétez|inquiète) pas)", 0.8),
    p('get_attention', '^(excusez-moi|pardon),?( monsieur| madame)?[.!,]?$|^s\'il vous plaît[.!,]?$', 0.85),
    p('ask_repeat', '\\b(pouvez-vous|peux-tu|vous pouvez|tu peux) répéter\\b|^(pardon|comment)\\s*\\?$', 0.9),
    p('ask_slow_down', '\\b(parlez|parle) (plus )?lentement\\b|\\bmoins vite\\b', 0.9),
    p('say_not_understood', "\\bje (ne |n')(comprends|ai pas compris)\\b", 0.9),
    p('ask_meaning_of_word', "\\b(qu'est-ce que .+ veut dire|que veut dire|ça veut dire quoi)\\b", 0.9),
    p('ask_how_to_say', '\\bcomment (on dit|dit-on|dire)\\b', 0.95),
    p('ask_if_speaks_language', '\\b(parlez-vous|tu parles|vous parlez) (anglais|français|arabe|espagnol|allemand|italien|japonais|russe|portugais|chinois)\\b', 0.95),
    p('say_speak_little', '\\bje parle (un peu|un petit peu|seulement un peu)\\b', 0.9),
    p('say_dont_know', '^je (ne )?sais pas[.!]?$', 0.9),
    p('request_drink', '\\b(je voudrais|je vais prendre|je prends|un|une|donnez-moi) (un |une )?(café|thé|eau|verre|bière|jus|chocolat|limonade|menthe)\\b', 0.85),
    p('request_food', '\\b(je voudrais|je vais prendre|je prends) (le |la |les |un |une |du |de la |des )?(pizza|sandwich|salade|soupe|pain|riz|poulet|poisson|viande|menu|plat|tajine|couscous|dessert|gâteau)\\b', 0.85),
    p('request_item', '\\b(je voudrais|je veux|il me faut|j\'aurais besoin de|donnez-moi|pourriez-vous me donner)\\b', 0.5),
    p('ask_recommendation', "\\b(qu'est-ce que vous (me )?(conseillez|recommandez)|c'est quoi le plat du jour)\\b", 0.95),
    p('ask_for_bill', "\\b(l'addition,? s'il vous plaît|la note,? s'il vous plaît|je peux avoir l'addition)\\b", 0.95),
    p('ask_payment_method', '\\b(vous (prenez|acceptez) la carte|je peux payer (par|en) carte)\\b', 0.95),
    p('say_delicious', "\\b(c'est |c'était )?(délicieux|très bon|un régal)\\b", 0.85),
    p('request_table', '\\bune table pour (deux|trois|quatre|\\d+)\\b', 0.95),
    p('ask_price', "\\b(c'est combien|combien ça coûte|ça coûte combien|combien (coûte|coûtent))\\b", 0.95),
    p('say_too_expensive', "\\b(c'est )?trop cher\\b", 0.9),
    p('offer_lower_price', '\\b(vous pouvez (faire|baisser) (un peu|le prix)|un (petit )?rabais|une remise)\\b', 0.85),
    p('say_just_looking', '\\bje regarde (juste|seulement)\\b', 0.95),
    p('ask_for_variant', '\\b(une autre (taille|couleur)|vous (l\'avez|avez ça) en (plus grand|plus petit|une autre))\\b', 0.9),
    p('ask_where_is', '\\boù (est|sont|se trouve) (le|la|les|l\')\\b', 0.9),
    p('ask_how_to_get', '\\b(comment (aller|on va|je vais|je fais pour aller) (à|au|aux|à la)|pour aller (à|au|aux))\\b', 0.95),
    p('give_direction_straight', '\\btout droit\\b', 0.9),
    p('give_direction_turn', '\\b(tournez|tourne|prenez|prends) à (gauche|droite)\\b', 0.95),
    p('ask_is_it_far', "\\bc'est loin\\b|\\bc'est à combien\\b", 0.9),
    p('say_it_is_near', "\\bc'est (tout )?(près|à côté|pas loin)\\b", 0.8),
    p('say_it_is_far', "\\bc'est (très |assez )?loin\\b", 0.8),
    p('say_lost', '\\bje (me )?suis perdu(e)?\\b', 0.95),
    p('hail_taxi', '^taxi\\s*!', 0.9),
    p('state_destination', "\\b(à la gare|à l'aéroport|à l'hôtel|au centre-ville|emmenez-moi)\\b", 0.8),
    p('ask_use_meter', '\\b(mettez|mets) le compteur\\b', 0.95),
    p('say_stop_here', "\\b(arrêtez-vous|arrête-toi|c'est ici|je descends) ici\\b", 0.9),
    p('buy_ticket', '\\b(un|deux|\\d+) (billet|billets|ticket|tickets) (pour|aller)\\b', 0.85),
    p('ask_departure_time', '\\b(à quelle heure|quand) (part|passe) le (prochain )?(train|bus|car|tram)\\b', 0.95),
    p('ask_time', '\\b(quelle heure est-il|il est quelle heure|vous avez l\'heure)\\b', 0.95),
    p('ask_opening_hours', "\\b(à quelle heure|quand) (ça|vous) (ouvre|ferme|ouvrez|fermez)\\b|\\bles horaires d'ouverture\\b", 0.9),
    p('offer_help', '\\bje peux (vous|t\') aider\\b|\\bvous avez besoin d\'aide\\b', 0.9),
    p('invite', '\\b(tu veux|vous voulez) (venir|prendre|manger|boire)\\b|\\bviens prendre\\b|\\bon se fait\\b', 0.75),
    p('accept_invitation', '\\b(avec plaisir|volontiers|d\'accord, super)\\b', 0.8),
    p('decline_invitation', '\\bje ne peux pas venir\\b|\\bune autre fois\\b|\\bdésolé[e]?, je ne peux pas\\b', 0.75),
    p('suggest_activity', '\\b(et si on|on pourrait|ça te dit de|ça vous dit de)\\b', 0.8),
    p('ask_about_family', '\\b(tu as|vous avez) des (enfants|frères|sœurs)\\b', 0.9),
    p('describe_family', "\\bj'ai (un|une|deux|trois|\\d+) (frère|sœur|fils|fille|enfant|enfants)\\b", 0.85),
    p('ask_occupation', '\\b(qu\'est-ce que (tu fais|vous faites) dans la vie|tu fais quoi dans la vie|quel est (votre|ton) métier)\\b', 0.95),
    p('describe_occupation', '\\bje (suis|travaille) (comme |dans |chez |à )?(professeur|médecin|étudiant|étudiante|infirmier|infirmière|ingénieur|chauffeur|cuisinier)\\b|\\bje travaille (dans|chez|à|comme)\\b', 0.85),
    p('call_for_help', '^au secours|\\bà l\'aide\\b|\\bappelez (la police|une ambulance|un médecin)\\b', 0.95),
    p('ask_for_doctor_or_pharmacy', "\\b(j'ai besoin d'un médecin|où est la pharmacie|où est l'hôpital)\\b", 0.95),
    p('describe_pain', "\\b(j'ai mal (à|au|aux)|ça fait mal|j'ai de la fièvre)\\b", 0.9),
    p('report_lost_item', "\\bj'ai perdu (mon|ma|mes)\\b", 0.9),
    p('report_broken', '\\b(ne (marche|fonctionne) pas|est (cassé|cassée|en panne))\\b', 0.85),
    p('ask_opinion', "\\b(qu'est-ce que (tu|vous) en (penses|pensez)|tu en penses quoi)\\b", 0.9),
    p('agree', "^(je suis d'accord|tout à fait|exactement|tu as raison|vous avez raison)", 0.85),
    p('disagree_politely', "^(je ne suis pas (tout à fait |vraiment )?d'accord|pas sûr)", 0.85),
    p('express_like', "^j'(aime|adore) \\b", 0.8),
    p('express_dislike', "^je (n'aime pas|déteste)\\b", 0.85),
    p('express_preference_between', '\\bje préfère\\b', 0.85),
    p('express_feeling', '^je suis (content|contente|fatigué|fatiguée|triste|énervé|énervée|stressé|stressée)\\b', 0.85),
    p('small_talk_weather', '\\bil fait (beau|chaud|froid|mauvais)\\b|\\bil pleut\\b', 0.85),
    p('ask_permission', '\\b(je peux|est-ce que je peux|puis-je) (m\'asseoir|entrer|fumer|ouvrir|prendre|utiliser|emprunter)\\b|\\bça (vous|te) dérange si\\b', 0.9),
    p('ask_availability', '\\b(vous avez|il y a) (une chambre|une table|de la place|des places)( de libre| libre)?\\b|\\bcette place est (libre|prise)\\b', 0.9),
    p('make_reservation', '\\bje voudrais (réserver|faire une réservation)\\b', 0.95),
    p('decline_offer', '^non(,)? merci[.!]?$', 0.85),
    p('accept_offer', '^(oui(,)? (s\'il vous plaît|volontiers|merci)|avec plaisir)[.!]?$', 0.7),
  ],
  spa: [
    p('greet_hello', '^(hola|buenas)\\b', 0.9),
    p('greet_time_of_day', '^buen(os|as) (días|tardes|noches)\\b', 0.9),
    p('ask_how_are_you', '\\b(cómo (estás|está|está usted|te va|le va)|qué tal)\\b', 0.9),
    p('reply_fine', '^(muy )?bien,? gracias|^estoy bien\\b', 0.9),
    p('introduce_name', '^(me llamo|soy|mi nombre es) [A-ZÁÉÍÓÚÑ]\\w+[.!]?$', 0.85),
    p('ask_name', '\\bcómo (te llamas|se llama( usted)?)\\b', 0.95),
    p('say_nice_to_meet', '\\b(mucho gusto|encantad[oa]( de conocer(te|lo|la))?)\\b', 0.95),
    p('say_where_from', '^soy de\\b|^vengo de\\b', 0.8),
    p('ask_where_from', '\\bde dónde (eres|es( usted)?|vienes)\\b', 0.95),
    p('say_goodbye', '^(adiós|chao|chau|hasta (luego|pronto|mañana)|nos vemos|buenas noches)[.!]?$', 0.9),
    p('wish_good_day', '\\b(que tengas|que tenga) (un )?buen (día|viaje)\\b|\\bbuen (día|viaje|fin de semana)\\b', 0.8),
    p('thank', '^(muchas )?gracias[.!]?$|^gracias,? muy amable', 0.95),
    p('respond_to_thanks', '^(de nada|no hay de qué|con gusto|a ti|a usted)[.!]?$', 0.95),
    p('apologise', '^(lo siento|perdón|perdona|perdone|disculpa|disculpe)\\b', 0.8),
    p('accept_apology', '^(no pasa nada|no te preocupes|no se preocupe|tranquilo|tranquila)\\b', 0.8),
    p('get_attention', '^(perdón|disculpe|oiga|oye),?( señor| señora| señorita)?[.!,]?$', 0.8),
    p('ask_repeat', '\\b(puede|puedes|podría) repetir(lo)?\\b|^(cómo|perdón)\\s*\\?$', 0.9),
    p('ask_slow_down', '\\b(habla|hable) (más )?despacio\\b|\\bmás lento\\b', 0.9),
    p('say_not_understood', '\\bno (entiendo|entendí|he entendido|comprendo)\\b', 0.9),
    p('ask_meaning_of_word', '\\bqué (significa|quiere decir)\\b', 0.9),
    p('ask_how_to_say', '\\bcómo se dice\\b', 0.95),
    p('ask_if_speaks_language', '\\b(hablas|habla( usted)?) (inglés|español|francés|árabe|alemán|italiano|japonés|ruso|portugués|chino)\\b', 0.95),
    p('say_speak_little', '\\bhablo (un poco|un poquito|solo un poco)\\b', 0.9),
    p('say_dont_know', '^no (lo )?sé[.!]?$', 0.9),
    p('request_drink', '\\b(quiero|quisiera|me (pone|das|da)|me gustaría|para mí) (un |una )?(café|té|agua|cerveza|jugo|zumo|vaso|copa|refresco|leche)\\b', 0.85),
    p('request_food', '\\b(quiero|quisiera|me (pone|das|da)|me gustaría|para mí) (la |el |las |los |un |una |unas |unos )?(pizza|bocadillo|ensalada|sopa|pan|arroz|pollo|pescado|carne|menú|plato|tacos|paella|postre|tortilla)\\b', 0.85),
    p('request_item', '\\b(quiero|quisiera|necesito|me (da|das|pone)|deme|dame|me gustaría)\\b', 0.5),
    p('ask_recommendation', '\\bqué (me )?(recomienda|recomiendas)\\b', 0.95),
    p('ask_for_bill', '\\bla cuenta,? por favor\\b|\\bme (trae|traes) la cuenta\\b', 0.95),
    p('ask_payment_method', '\\b(aceptan|acepta) tarjeta\\b|\\bpuedo pagar con tarjeta\\b', 0.95),
    p('say_delicious', '\\b(está )?(delicioso|riquísimo|muy rico|buenísimo)\\b', 0.85),
    p('request_table', '\\buna mesa para (dos|tres|cuatro|\\d+)\\b', 0.95),
    p('ask_price', '\\bcuánto (cuesta|vale|es|cuestan)\\b|\\ba cuánto\\b', 0.95),
    p('say_too_expensive', '\\b(es |está )?(muy|demasiado) caro\\b', 0.9),
    p('offer_lower_price', '\\b(me (hace|haces) (un )?descuento|puede (bajar|rebajar)|más barato)\\b', 0.85),
    p('say_just_looking', '\\bsolo estoy mirando\\b|\\bsólo miro\\b', 0.95),
    p('ask_for_variant', '\\b(otra talla|otro color|en otro (color|tamaño)|más (grande|pequeño))\\b', 0.9),
    p('ask_where_is', '\\bdónde (está|están|queda|hay) (el|la|los|las|un|una)\\b', 0.9),
    p('ask_how_to_get', '\\bcómo (llego|se llega|voy|puedo ir) (a|al)\\b', 0.95),
    p('give_direction_straight', '\\b(todo )?(recto|derecho)\\b', 0.85),
    p('give_direction_turn', '\\b(gire|gira|dobla|doble) a la (izquierda|derecha)\\b', 0.95),
    p('ask_is_it_far', '\\b(está|queda) lejos\\b|\\bqué tan lejos\\b', 0.9),
    p('say_it_is_near', '\\b(está|queda) (muy )?cerca\\b', 0.8),
    p('say_it_is_far', '\\b(está|queda) (muy )?lejos\\b', 0.8),
    p('say_lost', '\\b(estoy|estamos) perdid[oa]s?\\b|\\bme (he )?perdido\\b', 0.95),
    p('hail_taxi', '^taxi\\s*!', 0.9),
    p('state_destination', '\\b(al aeropuerto|a la estación|al hotel|al centro|lléveme a|llévame a)\\b', 0.8),
    p('ask_use_meter', '\\b(ponga|pon) el taxímetro\\b', 0.95),
    p('say_stop_here', '\\b(pare|para|me quedo|déjeme) aquí\\b', 0.9),
    p('buy_ticket', '\\b(un|dos|\\d+) (boleto|boletos|billete|billetes|pasaje|pasajes) (a|para)\\b', 0.85),
    p('ask_departure_time', '\\b(a qué hora|cuándo) sale el (próximo )?(tren|autobús|bus|avión|vuelo|camión)\\b', 0.95),
    p('ask_time', '\\bqué hora es\\b|\\btiene(s)? hora\\b', 0.95),
    p('ask_opening_hours', '\\ba qué hora (abren|cierran|abre|cierra)\\b|\\bhorario de apertura\\b', 0.9),
    p('offer_help', '\\b(puedo ayudar(te|le|lo|la)|necesita(s)? ayuda|te ayudo)\\b', 0.9),
    p('invite', '\\b(quieres|quiere) (venir|tomar|comer|ir)\\b|\\bte invito\\b', 0.75),
    p('accept_invitation', '\\b(con (mucho )?gusto|me encantaría|claro que sí)\\b', 0.8),
    p('decline_invitation', '\\bno puedo( ir)?\\b|\\botro día\\b|\\ben otra ocasión\\b', 0.7),
    p('suggest_activity', '\\b(qué tal si|por qué no|y si|vamos a)\\b', 0.75),
    p('ask_about_family', '\\b(tienes|tiene) (hijos|hermanos|familia)\\b', 0.9),
    p('describe_family', '\\btengo (un|una|dos|tres|\\d+) (hermano|hermana|hijo|hija|hijos|hermanos)\\b', 0.85),
    p('ask_occupation', '\\b(a qué te dedicas|a qué se dedica|en qué trabajas|en qué trabaja|qué haces)\\b', 0.95),
    p('describe_occupation', '\\bsoy (profesor|profesora|médico|médica|estudiante|enfermero|enfermera|ingeniero|ingeniera|chofer|cocinero|cocinera|abogado|abogada)\\b|\\btrabajo (en|como|de|para)\\b', 0.85),
    p('call_for_help', '^(socorro|auxilio)|\\bayuda!|\\bllame a (la policía|una ambulancia|un médico)\\b', 0.95),
    p('ask_for_doctor_or_pharmacy', '\\b(necesito un médico|dónde (hay|está) (una|la) farmacia|dónde está el hospital)\\b', 0.95),
    p('describe_pain', '\\bme duele\\b|\\btengo (fiebre|dolor de)\\b', 0.9),
    p('report_lost_item', '\\b(he )?perdido mi\\b|\\bperdí mi\\b', 0.9),
    p('report_broken', '\\bno funciona\\b|\\bestá rot[oa]\\b', 0.85),
    p('ask_opinion', '\\bqué (opinas|opina|piensas|piensa|te parece|le parece)\\b', 0.9),
    p('agree', '^(estoy de acuerdo|tienes razón|tiene razón|exacto|claro)[.!,]', 0.85),
    p('disagree_politely', '^no estoy (muy |del todo )?de acuerdo', 0.85),
    p('express_like', '^me (gusta|encanta)\\b', 0.8),
    p('express_dislike', '^no me gusta\\b|^odio\\b', 0.85),
    p('express_preference_between', '\\bprefiero\\b', 0.85),
    p('express_feeling', '^estoy (feliz|contento|contenta|cansado|cansada|triste|enojado|enojada|nervioso|nerviosa)\\b', 0.85),
    p('small_talk_weather', '\\bhace (calor|frío|buen tiempo|mal tiempo|sol)\\b|\\bestá lloviendo\\b', 0.85),
    p('ask_permission', '\\b(puedo|podría) (sentarme|entrar|fumar|abrir|usar|tomar|pasar)\\b|\\ble importa si\\b', 0.9),
    p('ask_availability', '\\b(tienen|tiene|hay) (una habitación|una mesa|mesa|sitio|lugar)( libre| disponible)?\\b|\\bestá (libre|ocupado|ocupada)\\b', 0.85),
    p('make_reservation', '\\bquisiera (reservar|hacer una reserva)\\b|\\bquiero reservar\\b', 0.95),
    p('decline_offer', '^no,? gracias[.!]?$', 0.85),
    p('accept_offer', '^(sí,? por favor|claro|vale|bueno,? gracias)[.!]?$', 0.7),
  ],
};

/** Validate at load: every referenced intent exists. Throws so a typo fails tests immediately. */
export function validateIntentPatterns(tables: Readonly<Record<string, readonly IntentPattern[]>> = INTENT_PATTERNS): string[] {
  const problems: string[] = [];
  for (const [lang, patterns] of Object.entries(tables)) {
    for (const pat of patterns) if (!isIntentKey(pat.intentKey)) problems.push(`${lang}: unknown intent ${pat.intentKey}`);
  }
  return problems;
}

const validation = validateIntentPatterns();
if (validation.length) throw new Error(`intent-heuristics: ${validation.join('; ')}`);

export interface IntentGuess {
  intentKey: string;
  confidence: number;
  /** Which text matched: `target` (the sentence itself) or `eng` (its English translation). */
  evidence: Array<{ via: 'target' | 'eng'; lang: string; pattern: string }>;
}

/** Score one text against a language table; returns per-intent best weights. */
function scoreText(text: string, lang: string, via: 'target' | 'eng', acc: Map<string, IntentGuess>): void {
  const table = INTENT_PATTERNS[lang];
  if (!table) return;
  for (const pat of table) {
    if (!pat.pattern.test(text)) continue;
    const prev = acc.get(pat.intentKey);
    const evidence = { via, lang, pattern: pat.pattern.source };
    if (!prev) acc.set(pat.intentKey, { intentKey: pat.intentKey, confidence: pat.weight, evidence: [evidence] });
    else {
      // Two independent signals (target + English) corroborate: combine as noisy-or.
      prev.confidence = 1 - (1 - prev.confidence) * (1 - pat.weight);
      prev.evidence.push(evidence);
    }
  }
}

/**
 * Guess the communicative intent(s) of a sentence from its own text and (optionally) its
 * English translation. Returns guesses sorted by confidence; the caller decides the
 * acceptance threshold. `bare_command` / `insult` are never proposed as curation targets.
 */
export function guessIntents(target: { text: string; lang: string }, english?: { text: string } | null): IntentGuess[] {
  const acc = new Map<string, IntentGuess>();
  scoreText(target.text, target.lang, 'target', acc);
  if (english && target.lang !== 'eng') scoreText(english.text, 'eng', 'eng', acc);
  return [...acc.values()].filter((g) => g.intentKey !== 'bare_command' && g.intentKey !== 'insult').sort((a, b) => b.confidence - a.confidence);
}

/** Intents that have at least one pattern in at least one language (coverage report for curators). */
export function intentsCoveredByHeuristics(): { covered: string[]; uncovered: string[] } {
  const covered = new Set<string>();
  for (const table of Object.values(INTENT_PATTERNS)) for (const pat of table) covered.add(pat.intentKey);
  const all = INTENTS.map((i: CommunicativeIntent) => i.intentKey);
  return { covered: all.filter((k) => covered.has(k)), uncovered: all.filter((k) => !covered.has(k) && k !== 'bare_command' && k !== 'insult') };
}

/** Scenario tags for an intent: the situations of the blueprints that use it is expensive; use the concept prefix instead. */
export function scenarioTagsForIntent(intentKey: string): string[] {
  const intent = INTENTS.find((i) => i.intentKey === intentKey);
  if (!intent) return [];
  const concept = intent.conceptId.split('.')[0] ?? '';
  const map: Record<string, string> = {
    greet: 'introductions', intro: 'introductions', leave: 'introductions', thanks: 'politeness', apology: 'politeness', attention: 'politeness', repair: 'repair_misunderstanding', meta: 'repair_misunderstanding',
    request: 'cafe', offer: 'cafe', pay: 'shopping', evaluate: 'restaurant', price: 'market', decline: 'shopping', accept: 'politeness', directions: 'directions', transport: 'transport', time: 'numbers_time',
    help: 'neighbours', plans: 'plans', family: 'family', work: 'work', routine: 'daily_life', emergency: 'emergencies', health: 'health', problem: 'daily_life', opinion: 'opinions', preference: 'feelings',
    feeling: 'feelings', compliment: 'small_talk', smalltalk: 'small_talk', narrate: 'story', permission: 'politeness', availability: 'travel',
  };
  const tag = map[concept];
  return tag ? [tag] : [];
}
