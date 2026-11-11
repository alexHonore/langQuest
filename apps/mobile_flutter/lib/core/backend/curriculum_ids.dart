import 'dart:convert';
import 'dart:math';

import 'package:crypto/crypto.dart';

/// Server ids of the bundled curriculum, computed offline.
///
/// The seed (`packages/db/src/seed/curriculum-uuid.ts`) names every content row with an RFC 4122 version-5 UUID of
/// `langquest.curriculum:<kind>:<key>` in one namespace, and the bundle carries the same keys: a mission is
/// `<chapterKey>:<missionKey>`, an expression is its bundle id (`<chapterKey>:<missionKey>:<expressionKey>`).
const curriculumNamespace = '7b1f3c58-2e64-4a9d-9c0e-4f6a8d2b5e17';

String missionServerId(String chapterKey, String missionKey) => uuidV5(curriculumNamespace, 'langquest.curriculum:mission:$chapterKey:$missionKey');

String expressionServerId(String expressionId) => uuidV5(curriculumNamespace, 'langquest.curriculum:expression:$expressionId');

/// RFC 4122 version-5 (SHA-1, name-based) UUID of [name] in [namespace].
String uuidV5(String namespace, String name) {
  final ns = [for (var i = 0; i < 32; i += 2) int.parse(namespace.replaceAll('-', '').substring(i, i + 2), radix: 16)];
  final hash = sha1.convert([...ns, ...utf8.encode(name)]).bytes.sublist(0, 16);
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  return _format(hash);
}

final _random = Random.secure();

/// A random (version-4) UUID: the client ids of requests the API replays on retry.
String randomUuid() {
  final bytes = [for (var i = 0; i < 16; i++) _random.nextInt(256)];
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return _format(bytes);
}

String _format(List<int> bytes) {
  final hex = bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();
  return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}';
}
