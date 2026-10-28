enum SceneId {
  cafe,
  street,
  airport,
  market,
  home,
  office,
  transit,
  restaurant,
  gathering,
  station,
  park,
  clinic,
}

enum SceneVariant { day, evening }

class SceneDefinition {
  final SceneId id;
  final String title;
  final String altText;
  final String placeType;
  final List<String> suggestedTracks;

  const SceneDefinition({
    required this.id,
    required this.title,
    required this.altText,
    required this.placeType,
    this.suggestedTracks = const [],
  });

  static const List<SceneDefinition> all = [
    SceneDefinition(
      id: SceneId.cafe,
      title: 'Café counter',
      altText: 'Warm café interior with espresso machine, fresh pastries and sunlight streaming in.',
      placeType: 'cafe',
      suggestedTracks: ['french', 'italian', 'english', 'portuguese-brazilian'],
    ),
    SceneDefinition(
      id: SceneId.street,
      title: 'Night Market & Street',
      altText: 'Vibrant evening street with glowing lanterns, food stalls and neon storefronts.',
      placeType: 'street',
      suggestedTracks: ['chinese-cantonese', 'chinese-mandarin', 'vietnamese', 'japanese'],
    ),
    SceneDefinition(
      id: SceneId.airport,
      title: 'Airport Terminal',
      altText: 'Expansive departures concourse with floor-to-ceiling glass and active runways.',
      placeType: 'airport',
      suggestedTracks: ['english', 'german', 'spanish-latin-american'],
    ),
    SceneDefinition(
      id: SceneId.market,
      title: 'Old Town Bazaar',
      altText: 'Bustling covered souk with woven carpets, spices and hanging copper lamps.',
      placeType: 'market',
      suggestedTracks: ['arabic-moroccan', 'arabic-eastern', 'arabic-egyptian', 'swahili'],
    ),
    SceneDefinition(
      id: SceneId.home,
      title: 'Living Room',
      altText: 'Cozy living room with bookshelf, warm tea on the table and plant sunlight.',
      placeType: 'home',
      suggestedTracks: ['danish', 'swedish', 'german', 'russian'],
    ),
    SceneDefinition(
      id: SceneId.office,
      title: 'Studio & Workspace',
      altText: 'Modern workspace overlooking the city skyline with warm desk lighting.',
      placeType: 'office',
      suggestedTracks: ['english', 'japanese', 'korean'],
    ),
    SceneDefinition(
      id: SceneId.transit,
      title: 'Train Carriage',
      altText: 'Sleek passenger rail car with passing countryside and city bridges through panoramic windows.',
      placeType: 'transit',
      suggestedTracks: ['japanese', 'german', 'french'],
    ),
    SceneDefinition(
      id: SceneId.restaurant,
      title: 'Dining Room',
      altText: 'Intimate restaurant with linen tables, flickering candlelight and outdoor courtyard view.',
      placeType: 'restaurant',
      suggestedTracks: ['italian', 'french', 'spanish-spain', 'greek'],
    ),
    SceneDefinition(
      id: SceneId.gathering,
      title: 'Rooftop Plaza',
      altText: 'Festive rooftop terrace with string fairy lights, wooden benches and sunset horizon.',
      placeType: 'gathering',
      suggestedTracks: ['spanish-latin-american', 'lingala', 'portuguese-brazilian'],
    ),
    SceneDefinition(
      id: SceneId.station,
      title: 'Grand Station',
      altText: 'Arched iron and glass railway hall with heritage platform clock and departure boards.',
      placeType: 'station',
      suggestedTracks: ['english', 'french', 'ukrainian', 'romanian'],
    ),
    SceneDefinition(
      id: SceneId.park,
      title: 'City Garden',
      altText: 'Sun-dappled urban park with blossoming cherry trees, quiet stone benches and walking paths.',
      placeType: 'park',
      suggestedTracks: ['japanese', 'korean', 'chinese-mandarin'],
    ),
    SceneDefinition(
      id: SceneId.clinic,
      title: 'Wellness Clinic',
      altText: 'Serene medical consultation reception with soft wood paneling and gentle indoor garden.',
      placeType: 'clinic',
      suggestedTracks: ['english', 'french', 'german'],
    ),
  ];

  static SceneDefinition get(SceneId id) {
    return all.firstWhere((s) => s.id == id, orElse: () => all.first);
  }
}
