import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:langquest_mobile/main.dart';

void main() {
  testWidgets('LangQuest app smoke test', (WidgetTester tester) async {
    await tester.pumpWidget(
      const ProviderScope(
        child: LangQuestApp(),
      ),
    );

    // Initial frame builds successfully
    await tester.pump();
    expect(find.byType(LangQuestApp), findsOneWidget);
  });
}
