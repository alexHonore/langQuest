/**
 * Vitest global setup: generates tiny WAV/MP3/M4A/FLAC fixtures with ffmpeg when it is available.
 * Tests that need fixtures skip themselves when `LANGQUEST_MEDIA_FIXTURES` is unset.
 */
import { generateFixtures } from './fixtures';

export default async function setup(): Promise<void> {
  const dir = await generateFixtures();
  if (dir) process.env.LANGQUEST_MEDIA_FIXTURES = dir;
}
