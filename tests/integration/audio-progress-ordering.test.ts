/**
 * §4.5 listening-position conflict resolution across devices (migration 110) through `PUT /v1/me/audio-progress/:lessonId`:
 *   - the same device is ordered by its own revision counter;
 *   - different devices are ordered by wall-clock, with `occurredAt` corrected by the skew between `clientSentAt`
 *     and the server clock, so a device with a wrong clock can neither win with a stale position nor lose a newer one;
 *   - a future `occurredAt` is capped at the server's now, never trusted;
 *   - `completed` is sticky even on a superseded write; duplicates (same clientEventId) are never re-applied.
 * Every answer is contract-validated and the stored row is checked, not just the status code.
 */
import { AudioProgressPutResponseSchema } from '@langquest/contracts';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { call, createApiHarness, createTestUser, deleteTestUsers, describeWithStack, enrol, Seeder, type ApiHarness, type TestUser } from '../src/harness';

const describeStack = describeWithStack('integration.audio-progress-ordering');

const HOUR_MS = 3_600_000;
const DURATION_MS = 45 * 60 * 1000;

describeStack('audio progress PUT: clientSentAt-corrected ordering across devices', () => {
  let h: ApiHarness;
  let seeder: Seeder;
  let learner: TestUser;
  let lessonId: string;

  interface PutInput {
    deviceId: string;
    revision: number;
    positionMs: number;
    /** True (server-clock) time of the listen; the device's reported `occurredAt` is shifted by `clockOffsetMs`. */
    trueOccurredAt: number;
    /** How far the device's clock is from the server's; `clientSentAt` carries it unless `omitClientSentAt`. */
    clockOffsetMs?: number;
    omitClientSentAt?: boolean;
    completed?: boolean;
    clientEventId?: string;
  }

  const put = async (input: PutInput) => {
    const offset = input.clockOffsetMs ?? 0;
    const body: Record<string, unknown> = {
      clientEventId: input.clientEventId ?? crypto.randomUUID(),
      deviceId: input.deviceId,
      revision: input.revision,
      positionMs: input.positionMs,
      durationMs: DURATION_MS,
      completed: input.completed ?? false,
      occurredAt: new Date(input.trueOccurredAt + offset).toISOString(),
    };
    if (!input.omitClientSentAt) body.clientSentAt = new Date(Date.now() + offset).toISOString();
    const res = await call(h, `/v1/me/audio-progress/${lessonId}`, { method: 'PUT', token: learner.token, body });
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    return AudioProgressPutResponseSchema.parse(res.json.data);
  };

  const stored = async () => {
    const res = await h.service.from('user_audio_progress').select('position_ms, completed, revision, play_count, last_device_id, last_occurred_at').eq('user_id', learner.id).eq('lesson_id', lessonId).single();
    if (res.error) throw new Error(res.error.message);
    return res.data;
  };

  beforeAll(async () => {
    h = createApiHarness();
    seeder = new Seeder(h.service);
    learner = await createTestUser(h, 'audio-order');
    await enrol(h, learner, { courseTrackId: 'arabic-moroccan', sourceLanguageCode: 'en' });
    const rights = await seeder.rights({ verified: true, commercialRedistribution: true });
    const collection = await seeder.audioCollection({ trackId: 'arabic-moroccan', varietyId: 'ary', rightsId: rights.id });
    const chapter = await seeder.audioChapter(collection.id);
    lessonId = (await seeder.audioLesson({ chapterId: chapter.id, rightsId: rights.id, varietyId: 'ary' })).id;
  });

  afterAll(async () => {
    await h.app.flush();
    await deleteTestUsers(h, [learner]);
    await seeder.cleanup();
  });

  it('orders devices by skew-corrected wall-clock: a fast clock cannot win with a stale listen, and does not lose a newer one', async () => {
    const now = Date.now();
    // Phone (clock correct) listened 60 s ago.
    const phone = await put({ deviceId: 'phone', revision: 1, positionMs: 10_000, trueOccurredAt: now - 60_000 });
    expect(phone).toMatchObject({ lessonId, positionMs: 10_000, resolution: 'applied' });
    expect(await stored()).toMatchObject({ position_ms: 10_000, last_device_id: 'phone' });

    // Tablet whose clock runs ONE HOUR fast reports a listen that truly happened 120 s ago (older than the phone's).
    // Its raw occurredAt is in the future; only the clientSentAt correction reveals it as the older event.
    const staleTablet = await put({ deviceId: 'tablet', revision: 1, positionMs: 5_000, trueOccurredAt: now - 120_000, clockOffsetMs: HOUR_MS });
    expect(staleTablet).toMatchObject({ resolution: 'superseded', reason: 'older_event', positionMs: 10_000 });
    expect(await stored()).toMatchObject({ position_ms: 10_000, last_device_id: 'phone' });

    // The same tablet then reports a genuinely newer listen (30 s ago): corrected time beats the phone's.
    const newerTablet = await put({ deviceId: 'tablet', revision: 2, positionMs: 30_000, trueOccurredAt: now - 30_000, clockOffsetMs: HOUR_MS });
    expect(newerTablet).toMatchObject({ resolution: 'applied', positionMs: 30_000 });
    const row = await stored();
    expect(row).toMatchObject({ position_ms: 30_000, last_device_id: 'tablet', revision: 2 });
    // The stored event time is the corrected one (about 30 s ago), never the tablet's future timestamp.
    const storedAt = Date.parse(row.last_occurred_at ?? '');
    expect(storedAt).toBeLessThanOrEqual(Date.now());
    expect(Math.abs(storedAt - (now - 30_000))).toBeLessThan(15_000);
  });

  it('a higher revision from ANOTHER device does not beat a newer wall-clock position; completion stays sticky', async () => {
    const now = Date.now();
    // Phone: revision 9 (its own counter) but the listen is older (90 s ago) than the tablet's stored 30 s ago.
    const res = await put({ deviceId: 'phone', revision: 9, positionMs: 40_000, trueOccurredAt: now - 90_000, completed: true });
    expect(res).toMatchObject({ resolution: 'superseded', reason: 'older_event', positionMs: 30_000, completed: true });
    expect(await stored()).toMatchObject({ position_ms: 30_000, completed: true, last_device_id: 'tablet', revision: 2 });
  });

  it('the SAME device is ordered by its revision counter, whatever its clock says', async () => {
    const now = Date.now();
    // Tablet revision 1 (lower than its stored revision 2) with a newer wall-clock still loses.
    const res = await put({ deviceId: 'tablet', revision: 1, positionMs: 35_000, trueOccurredAt: now, clockOffsetMs: HOUR_MS });
    expect(res).toMatchObject({ resolution: 'superseded', reason: 'older_revision', positionMs: 30_000 });
    expect(await stored()).toMatchObject({ position_ms: 30_000, revision: 2 });
  });

  it('a future occurredAt without clientSentAt is capped at the server clock, and duplicates are never re-applied', async () => {
    const before = await stored();
    // Laptop with no skew information claims a listen one day in the future: accepted as "now", not as the future.
    const clientEventId = crypto.randomUUID();
    const laptop = await put({ deviceId: 'laptop', revision: 1, positionMs: 50_000, trueOccurredAt: Date.now() + 86_400_000, omitClientSentAt: true, clientEventId });
    expect(laptop).toMatchObject({ resolution: 'applied', positionMs: 50_000 });
    const row = await stored();
    expect(row).toMatchObject({ position_ms: 50_000, last_device_id: 'laptop', play_count: (before.play_count ?? 0) + 1 });
    expect(Date.parse(row.last_occurred_at ?? '')).toBeLessThanOrEqual(Date.now() + 5_000);
    // Same clientEventId again: the sync ledger dedupes it — no second play, no position change.
    const dup = await put({ deviceId: 'laptop', revision: 1, positionMs: 1, trueOccurredAt: Date.now(), omitClientSentAt: true, clientEventId });
    expect(dup).toMatchObject({ resolution: 'duplicate', positionMs: 50_000 });
    expect(await stored()).toMatchObject({ position_ms: 50_000, play_count: row.play_count });
  });
});
