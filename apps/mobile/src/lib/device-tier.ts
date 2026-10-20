/**
 * Device tier for the Night Market glass + lantern effects (U2 risk note: backdrop blur and
 * drifting blobs are expensive on low-end Android). The theme's `lowEndDevice` flag switches
 * to solid surfaces and freezes the lantern drift; nothing else changes.
 *
 * Heuristic, read once: Android with < 3 GB of RAM or an unknown memory figure on an Android
 * device whose model year is older than 2019. iOS and web are never considered low-end here.
 */
import * as Device from 'expo-device';
import { Platform } from 'react-native';

const THREE_GB = 3 * 1024 * 1024 * 1024;

export function detectLowEndDevice(): boolean {
  if (Platform.OS !== 'android') return false;
  try {
    const memory = Device.totalMemory;
    if (typeof memory === 'number' && memory > 0) return memory < THREE_GB;
    const year = Device.deviceYearClass;
    return typeof year === 'number' && year < 2019;
  } catch {
    return false;
  }
}

export const LOW_END_DEVICE: boolean = detectLowEndDevice();
