import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import '../../core/services/app_state.dart';
import '../../core/theme/accents.dart';
import '../../core/theme/colors.dart';
import '../mascot/melo_model.dart';
import '../mascot/melo_widget.dart';

class ReviewScreen extends ConsumerStatefulWidget {
  const ReviewScreen({super.key});

  @override
  ConsumerState<ReviewScreen> createState() => _ReviewScreenState();
}

class _ReviewScreenState extends ConsumerState<ReviewScreen>
    with SingleTickerProviderStateMixin {
  late final AnimationController _flipController;
  late final Animation<double> _flipAnimation;
  bool _isBack = false;
  double _cardDragX = 0.0;

  @override
  void initState() {
    super.initState();
    _flipController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 400),
    );
    _flipAnimation = Tween<double>(begin: 0.0, end: 1.0).animate(
      CurvedAnimation(parent: _flipController, curve: Curves.easeInOut),
    );
  }

  @override
  void dispose() {
    _flipController.dispose();
    super.dispose();
  }

  void _flipCard() {
    if (_isBack) {
      _flipController.reverse();
    } else {
      _flipController.forward();
    }
    setState(() => _isBack = !_isBack);
  }

  void _handleReviewDecision(bool remembered, String cardId) {
    ref.read(appStateProvider.notifier).removeReviewedCard(cardId);
    setState(() {
      _isBack = false;
      _cardDragX = 0.0;
    });
    _flipController.reset();
  }

  @override
  Widget build(BuildContext context) {
    final appState = ref.watch(appStateProvider);
    final accent = appState.accent;
    final colors = appState.colors;
    final deck = appState.reviewDeck;

    return Scaffold(
      backgroundColor: colors.background,
      body: SafeArea(
        child: Column(
          children: [
            // Header Bar
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  IconButton(
                    icon: const Icon(LucideIcons.x, color: Colors.white70),
                    onPressed: () => context.pop(),
                  ),
                  Text(
                    'SPACED REPETITION REVIEW',
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                      letterSpacing: 1.2,
                      color: accent.primaryText,
                    ),
                  ),
                  IconButton(
                    icon: const Icon(LucideIcons.helpCircle, color: Colors.white70),
                    onPressed: () {},
                  ),
                ],
              ),
            ),

            if (deck.isEmpty) ...[
              const Spacer(),
              Center(
                child: Column(
                  children: [
                    MeloWidget(
                      state: MeloState.celebrate,
                      speech: 'All done for today! Your memory retention is durable.',
                      size: 110,
                    ),
                    const SizedBox(height: 24),
                    const Text(
                      'All Cards Reviewed !',
                      style: TextStyle(
                        fontSize: 22,
                        fontWeight: FontWeight.w800,
                        color: Colors.white,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      'Come back tomorrow for your next spaced review cycle.',
                      style: TextStyle(fontSize: 14, color: colors.textSecondary),
                    ),
                    const SizedBox(height: 32),
                    ElevatedButton(
                      style: ElevatedButton.styleFrom(
                        backgroundColor: accent.primary,
                        foregroundColor: accent.onPrimary,
                        padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 14),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                      ),
                      onPressed: () => context.pop(),
                      child: const Text('Return Home', style: TextStyle(fontWeight: FontWeight.w700)),
                    ),
                  ],
                ),
              ),
              const Spacer(),
            ] else ...[
              // Remaining count indicator
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 8),
                child: Text(
                  '${deck.length} cards remaining',
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    color: colors.textMuted,
                  ),
                ),
              ),

              // Interactive 3D Flip Flashcard with Swipe Physics
              Expanded(
                child: Center(
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 24),
                    child: GestureDetector(
                      onTap: _flipCard,
                      onHorizontalDragUpdate: (details) {
                        setState(() {
                          _cardDragX += details.delta.dx;
                        });
                      },
                      onHorizontalDragEnd: (details) {
                        final currentCard = deck.first;
                        if (_cardDragX > 80) {
                          _handleReviewDecision(true, currentCard.id);
                        } else if (_cardDragX < -80) {
                          _handleReviewDecision(false, currentCard.id);
                        } else {
                          setState(() => _cardDragX = 0.0);
                        }
                      },
                      child: Transform.translate(
                        offset: Offset(_cardDragX, 0),
                        child: Transform.rotate(
                          angle: (_cardDragX / 400.0) * 0.25,
                          child: AnimatedBuilder(
                            animation: _flipAnimation,
                            builder: (context, _) {
                              final isUnder = _flipAnimation.value > 0.5;
                              final angle = _flipAnimation.value * math.pi;

                              return Transform(
                                transform: Matrix4.identity()
                                  ..setEntry(3, 2, 0.0015)
                                  ..rotateY(angle),
                                alignment: Alignment.center,
                                child: isUnder
                                    ? Transform(
                                        transform: Matrix4.identity()..rotateY(math.pi),
                                        alignment: Alignment.center,
                                        child: _buildCardBack(deck.first, accent, colors),
                                      )
                                    : _buildCardFront(deck.first, accent, colors),
                              );
                            },
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
              ),

              // Swipe Action Buttons (Review Again / Remembered)
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 20),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                  children: [
                    // Review Again (Left)
                    GestureDetector(
                      onTap: () => _handleReviewDecision(false, deck.first.id),
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 14),
                        decoration: BoxDecoration(
                          color: const Color(0x22FFB547),
                          borderRadius: BorderRadius.circular(20),
                          border: Border.all(color: const Color(0xFFFFB547)),
                        ),
                        child: const Row(
                          children: [
                            Icon(LucideIcons.rotateCcw, size: 18, color: Color(0xFFFFB547)),
                            SizedBox(width: 8),
                            Text(
                              'Review Again',
                              style: TextStyle(
                                fontSize: 14,
                                fontWeight: FontWeight.w700,
                                color: Color(0xFFFFB547),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),

                    // Remembered (Right)
                    GestureDetector(
                      onTap: () => _handleReviewDecision(true, deck.first.id),
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 28, vertical: 14),
                        decoration: BoxDecoration(
                          color: const Color(0xFF45E0A6),
                          borderRadius: BorderRadius.circular(20),
                          boxShadow: const [
                            BoxShadow(
                              color: Color(0x4045E0A6),
                              blurRadius: 16,
                              spreadRadius: 2,
                            ),
                          ],
                        ),
                        child: const Row(
                          children: [
                            Icon(LucideIcons.check, size: 18, color: Color(0xFF0F3328)),
                            SizedBox(width: 8),
                            Text(
                              'Remembered',
                              style: TextStyle(
                                fontSize: 14,
                                fontWeight: FontWeight.w700,
                                color: Color(0xFF0F3328),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _buildCardFront(FlashcardItem card, CourseAccent accent, LangQuestColors colors) {
    return Container(
      width: double.infinity,
      height: 380,
      padding: const EdgeInsets.all(28),
      decoration: BoxDecoration(
        color: colors.elevated,
        borderRadius: BorderRadius.circular(28),
        border: Border.all(color: Colors.white12),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.4),
            blurRadius: 24,
            spreadRadius: 4,
          ),
        ],
      ),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
            decoration: BoxDecoration(
              color: const Color(0x18FFFFFF),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Text(
              'TARGET PHRASE',
              style: TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w700,
                letterSpacing: 1.0,
                color: colors.textMuted,
              ),
            ),
          ),
          const SizedBox(height: 24),
          Text(
            card.front,
            textAlign: TextAlign.center,
            style: const TextStyle(
              fontSize: 24,
              fontWeight: FontWeight.w700,
              color: Colors.white,
              height: 1.35,
            ),
          ),
          const SizedBox(height: 12),
          Text(
            card.phonetic,
            style: TextStyle(
              fontSize: 14,
              fontStyle: FontStyle.italic,
              color: accent.primaryText,
            ),
          ),
          const SizedBox(height: 32),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(LucideIcons.refreshCw, size: 14, color: colors.textMuted),
              const SizedBox(width: 6),
              Text(
                'Tap to flip card',
                style: TextStyle(fontSize: 12, color: colors.textMuted),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildCardBack(FlashcardItem card, CourseAccent accent, LangQuestColors colors) {
    return Container(
      width: double.infinity,
      height: 380,
      padding: const EdgeInsets.all(28),
      decoration: BoxDecoration(
        color: const Color(0xFF1B152B),
        borderRadius: BorderRadius.circular(28),
        border: Border.all(color: accent.primary.withOpacity(0.5), width: 1.5),
        boxShadow: [
          BoxShadow(
            color: accent.primary.withOpacity(0.25),
            blurRadius: 28,
            spreadRadius: 2,
          ),
        ],
      ),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
            decoration: BoxDecoration(
              color: accent.primarySoft,
              borderRadius: BorderRadius.circular(10),
            ),
            child: Text(
              'TRANSLATION & CONTEXT',
              style: TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w700,
                letterSpacing: 1.0,
                color: accent.primaryText,
              ),
            ),
          ),
          const SizedBox(height: 20),
          Text(
            card.back,
            textAlign: TextAlign.center,
            style: const TextStyle(
              fontSize: 22,
              fontWeight: FontWeight.w700,
              color: Colors.white,
            ),
          ),
          const SizedBox(height: 20),
          Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: const Color(0x12FFFFFF),
              borderRadius: BorderRadius.circular(16),
            ),
            child: Column(
              children: [
                Text(
                  card.example,
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                    color: Colors.white,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  card.translation,
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontSize: 12.5,
                    color: colors.textMuted,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 24),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(LucideIcons.refreshCw, size: 14, color: colors.textMuted),
              const SizedBox(width: 6),
              Text(
                'Tap to flip back',
                style: TextStyle(fontSize: 12, color: colors.textMuted),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
