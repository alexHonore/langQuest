import 'dart:async';
import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import '../../core/services/app_state.dart';

enum ConversationTurnState {
  listening, // Learner speaks (cyan)
  thinking, // AI LLM generating (purple)
  speaking, // AI voice responding (magenta)
}

class ChatMessage {
  final bool isUser;
  final String text;
  final String? translation;
  final String time;

  const ChatMessage({
    required this.isUser,
    required this.text,
    this.translation,
    required this.time,
  });
}

class ConversationScreen extends ConsumerStatefulWidget {
  const ConversationScreen({super.key});

  @override
  ConsumerState<ConversationScreen> createState() => _ConversationScreenState();
}

class _ConversationScreenState extends ConsumerState<ConversationScreen>
    with SingleTickerProviderStateMixin {
  ConversationTurnState _state = ConversationTurnState.listening;
  bool _isMuted = false;
  double _voiceMetering = 0.3;
  late final AnimationController _pulseController;
  Timer? _simTimer;
  final ScrollController _scrollController = ScrollController();

  final List<ChatMessage> _messages = [
    const ChatMessage(
      isUser: false,
      text: 'Bonjour ! Comment se passe votre journée à Paris ?',
      translation: 'Hello! How is your day going in Paris?',
      time: '14:02',
    ),
    const ChatMessage(
      isUser: true,
      text: 'Très bien merci ! Je visite le musée du Louvre cet après-midi.',
      translation: 'Very well thanks! I am visiting the Louvre museum this afternoon.',
      time: '14:03',
    ),
    const ChatMessage(
      isUser: false,
      text: 'C’est formidable ! N’oubliez pas de jeter un coup d’œil à la cour carrée, elle est magnifique sous le soleil.',
      translation: 'That is wonderful! Don’t forget to check out the Cour Carrée, it is magnificent in the sunshine.',
      time: '14:03',
    ),
  ];

  @override
  void initState() {
    super.initState();
    _pulseController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1600),
    )..repeat(reverse: true);

    _startVoiceSimulation();
  }

  void _startVoiceSimulation() {
    final rand = math.Random();
    _simTimer = Timer.periodic(const Duration(milliseconds: 120), (_) {
      if (!mounted) return;
      setState(() {
        _voiceMetering = 0.2 + rand.nextDouble() * 0.75;
      });
    });
  }

  @override
  void dispose() {
    _simTimer?.cancel();
    _pulseController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  void _simulateTurn() {
    setState(() => _state = ConversationTurnState.thinking);
    Future.delayed(const Duration(milliseconds: 1400), () {
      if (!mounted) return;
      setState(() {
        _messages.add(
          const ChatMessage(
            isUser: true,
            text: 'Merci pour le conseil ! Et pour manger un bon croissant ?',
            translation: 'Thanks for the tip! And for eating a good croissant?',
            time: '14:04',
          ),
        );
        _state = ConversationTurnState.speaking;
      });
      _scrollToBottom();

      Future.delayed(const Duration(milliseconds: 2200), () {
        if (!mounted) return;
        setState(() {
          _messages.add(
            const ChatMessage(
              isUser: false,
              text: 'La boulangerie Utopie rue Jean-Pierre Timbaud fait les meilleurs croissants au beurre !',
              translation: 'The Utopie bakery on rue Jean-Pierre Timbaud makes the best butter croissants!',
              time: '14:04',
            ),
          );
          _state = ConversationTurnState.listening;
        });
        _scrollToBottom();
      });
    });
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scrollController.hasClients) {
        _scrollController.animateTo(
          _scrollController.position.maxScrollExtent,
          duration: const Duration(milliseconds: 300),
          curve: Curves.easeOut,
        );
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final appState = ref.watch(appStateProvider);
    final colors = appState.colors;

    final stateColor = switch (_state) {
      ConversationTurnState.listening => const Color(0xFF3EE1E8),
      ConversationTurnState.thinking => const Color(0xFFC9B8FF),
      ConversationTurnState.speaking => const Color(0xFFFF4FA3),
    };

    final stateTitle = switch (_state) {
      ConversationTurnState.listening => 'LISTENING TO YOU',
      ConversationTurnState.thinking => 'PARTNER THINKING...',
      ConversationTurnState.speaking => 'ÉLISE IS SPEAKING',
    };

    return Scaffold(
      backgroundColor: colors.background,
      body: SafeArea(
        child: Column(
          children: [
            // Top Navigation & Session Info
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  IconButton(
                    icon: const Icon(LucideIcons.x, color: Colors.white70),
                    onPressed: () => context.pop(),
                  ),
                  Column(
                    children: [
                      Text(
                        'Élise Laurent',
                        style: TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w700,
                          color: colors.textPrimary,
                        ),
                      ),
                      Row(
                        children: [
                          Container(
                            width: 7,
                            height: 7,
                            decoration: BoxDecoration(
                              shape: BoxShape.circle,
                              color: stateColor,
                            ),
                          ),
                          const SizedBox(width: 5),
                          Text(
                            stateTitle,
                            style: TextStyle(
                              fontSize: 11,
                              fontWeight: FontWeight.w700,
                              color: stateColor,
                              letterSpacing: 0.8,
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                  IconButton(
                    icon: const Icon(LucideIcons.info, color: Colors.white70),
                    onPressed: () {},
                  ),
                ],
              ),
            ),

            // Transcript Scroll Area
            Expanded(
              child: ListView.builder(
                controller: _scrollController,
                padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 12),
                itemCount: _messages.length,
                itemBuilder: (context, index) {
                  final msg = _messages[index];
                  final isUser = msg.isUser;

                  return Align(
                    alignment: isUser ? Alignment.centerRight : Alignment.centerLeft,
                    child: Container(
                      margin: const EdgeInsets.only(bottom: 12),
                      constraints: BoxConstraints(
                        maxWidth: MediaQuery.of(context).size.width * 0.78,
                      ),
                      padding: const EdgeInsets.all(14),
                      decoration: BoxDecoration(
                        color: isUser
                            ? const Color(0xFF3EE1E8).withOpacity(0.18)
                            : colors.elevated,
                        borderRadius: BorderRadius.circular(18).copyWith(
                          bottomRight: isUser ? const Radius.circular(2) : null,
                          bottomLeft: !isUser ? const Radius.circular(2) : null,
                        ),
                        border: Border.all(
                          color: isUser
                              ? const Color(0xFF3EE1E8).withOpacity(0.5)
                              : Colors.white12,
                        ),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            msg.text,
                            style: const TextStyle(
                              fontSize: 15,
                              fontWeight: FontWeight.w500,
                              color: Colors.white,
                              height: 1.35,
                            ),
                          ),
                          if (msg.translation != null) ...[
                            const SizedBox(height: 4),
                            Text(
                              msg.translation!,
                              style: TextStyle(
                                fontSize: 12.5,
                                color: colors.textMuted,
                              ),
                            ),
                          ],
                        ],
                      ),
                    ),
                  );
                },
              ),
            ),

            // Giant Audio-Reactive Pulsing Neon Rings Bottom Section
            Container(
              padding: const EdgeInsets.symmetric(vertical: 24, horizontal: 20),
              decoration: BoxDecoration(
                color: colors.elevated,
                borderRadius: const BorderRadius.vertical(top: Radius.circular(32)),
                border: Border.all(color: Colors.white10),
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  // Animated Pulsing Center Ring with Voice Metering
                  GestureDetector(
                    onTap: _simulateTurn,
                    child: AnimatedBuilder(
                      animation: _pulseController,
                      builder: (context, _) {
                        final waveScale = 1.0 + (_voiceMetering * 0.35);

                        return Container(
                          width: 100 * waveScale,
                          height: 100 * waveScale,
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            color: stateColor.withOpacity(0.16),
                            border: Border.all(color: stateColor, width: 2.5),
                            boxShadow: [
                              BoxShadow(
                                color: stateColor.withOpacity(0.45),
                                blurRadius: 28 * waveScale,
                                spreadRadius: 4,
                              ),
                            ],
                          ),
                          child: Center(
                            child: Container(
                              width: 64,
                              height: 64,
                              decoration: BoxDecoration(
                                shape: BoxShape.circle,
                                color: stateColor,
                              ),
                              child: Icon(
                                _state == ConversationTurnState.listening
                                    ? LucideIcons.mic
                                    : _state == ConversationTurnState.thinking
                                        ? LucideIcons.loader
                                        : LucideIcons.volume2,
                                size: 28,
                                color: const Color(0xFF130F21),
                              ),
                            ),
                          ),
                        );
                      },
                    ),
                  ),
                  const SizedBox(height: 18),
                  Text(
                    _state == ConversationTurnState.listening
                        ? 'Hands-free mode active · Speak naturally'
                        : 'Tap sphere to reply',
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w500,
                      color: colors.textMuted,
                    ),
                  ),
                  const SizedBox(height: 16),

                  // Bottom Controls (Mute, Keyboard, End Call)
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                    children: [
                      IconButton(
                        icon: Icon(
                          _isMuted ? LucideIcons.micOff : LucideIcons.mic,
                          color: _isMuted ? colors.error : Colors.white70,
                        ),
                        onPressed: () {
                          setState(() => _isMuted = !_isMuted);
                        },
                      ),
                      // End call button
                      GestureDetector(
                        onTap: () => context.pop(),
                        child: Container(
                          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
                          decoration: BoxDecoration(
                            color: const Color(0xFFFF8A96),
                            borderRadius: BorderRadius.circular(20),
                          ),
                          child: const Row(
                            children: [
                              Icon(LucideIcons.phoneOff, size: 18, color: Color(0xFF2A0718)),
                              SizedBox(width: 8),
                              Text(
                                'End Call',
                                style: TextStyle(
                                  fontSize: 14,
                                  fontWeight: FontWeight.w700,
                                  color: Color(0xFF2A0718),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                      IconButton(
                        icon: const Icon(LucideIcons.keyboard, color: Colors.white70),
                        onPressed: () {},
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
