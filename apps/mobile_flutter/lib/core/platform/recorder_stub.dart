import '../audio/take_recorder.dart';

bool get canRecordTakes => false;

TakeRecorder createTakeRecorder() => throw UnsupportedError('No recorder outside the browser in this build');
