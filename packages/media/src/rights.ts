/**
 * Content state machine, publishing gate and takedown propagation (§7.6, §9.9, §14.1 A20).
 */
import type { ContentState, PublishChecklist, SpeakerConsentState } from '@langquest/contracts';
import { manifestInvalidationPrefixes, type InvalidationInput } from './manifests';

/** Allowed content-state transitions (§7.6). */
export const CONTENT_TRANSITIONS: Readonly<Record<ContentState, readonly ContentState[]>> = {
  imported_draft: ['metadata_needed', 'rights_unverified', 'transcription_pending', 'review_needed', 'rejected'],
  metadata_needed: ['rights_unverified', 'transcription_pending', 'review_needed', 'rejected'],
  rights_unverified: ['metadata_needed', 'transcription_pending', 'review_needed', 'rejected'],
  transcription_pending: ['metadata_needed', 'rights_unverified', 'review_needed', 'rejected'],
  review_needed: ['metadata_needed', 'rights_unverified', 'transcription_pending', 'approved', 'rejected'],
  approved: ['published', 'review_needed', 'rights_unverified', 'rejected'],
  published: ['unpublished'],
  unpublished: ['review_needed', 'approved', 'published', 'rejected'],
  rejected: ['review_needed', 'metadata_needed'],
};

export function canTransitionContent(from: ContentState, to: ContentState): boolean {
  return CONTENT_TRANSITIONS[from].includes(to);
}

export function assertContentTransition(from: ContentState, to: ContentState): void {
  if (!canTransitionContent(from, to)) throw new Error(`Illegal content transition ${from} → ${to}`);
}

export const PUBLISH_BLOCK_CODES = [
  'missing_title',
  'missing_language',
  'integrity_unverified',
  'audio_inaccessible',
  'asset_revoked',
  'speaker_metadata_missing',
  'chapter_missing',
  'rights_missing',
  'rights_unverified',
  'no_redistribution_right',
  'rights_expired',
  'rights_revoked',
  'alt_text_missing',
  'native_review_missing',
  'invalid_state',
] as const;
export type PublishBlockCode = (typeof PUBLISH_BLOCK_CODES)[number];

export interface PublishBlockReason {
  code: PublishBlockCode;
  message: string;
  /** Which admin field/section resolves it. */
  field: string;
  /** `blocker` prevents publishing; `warning` is surfaced but does not block. */
  severity: 'blocker' | 'warning';
}

export interface RightsRecord {
  licenseId: string;
  licenseVersion?: string | null;
  verified: boolean;
  commercialRedistribution: boolean;
  attributionRequired: boolean;
  attributionText?: string | null;
  authors?: readonly string[];
  originUrl?: string | null;
  expiresAt?: string | null;
  revokedAt?: string | null;
  permissionGrant?: string | null;
}

export interface PublishGateInput {
  entityKind: 'audio_lesson' | 'audio_collection' | 'mission' | 'expression' | 'character' | 'visual_asset';
  currentState: ContentState;
  title: string | null | undefined;
  /** Target variety or language code; collections may use instruction language. */
  languageCode: string | null | undefined;
  asset?: {
    checksumVerified: boolean;
    disposition: 'active' | 'quarantined' | 'revoked' | 'deleted';
    /** A playable rendition or master exists and is readable. */
    accessible: boolean;
    byteLength: number | null;
  } | null;
  /** Speakers linked to the lesson; `null` when the entity has no speakers (e.g. visuals). `known` = someone recorded who speaks. */
  speakers?: { known: boolean; entries: ReadonlyArray<{ name: string | null; consentState: SpeakerConsentState }> } | null;
  chapterId?: string | null;
  rights: RightsRecord | null;
  nativeReviewed?: boolean;
  /** Required for visual assets only. */
  altTextPresent?: boolean;
  /** When true, native review becomes a blocker (per-language policy, §2.3). */
  requireNativeReview?: boolean;
}

export interface PublishGateResult {
  allowed: boolean;
  checklist: PublishChecklist;
  reasons: PublishBlockReason[];
  /** Codes of blocking reasons (what `ContentPublishResponse.blockedBy` carries). */
  blockedBy: PublishBlockCode[];
}

/** True when the rights record is currently in force (verified, not expired, not revoked). */
export function isRightsActive(rights: RightsRecord | null, now: Date): boolean {
  if (!rights || !rights.verified) return false;
  if (rights.revokedAt && Date.parse(rights.revokedAt) <= now.getTime()) return false;
  if (rights.expiresAt && Date.parse(rights.expiresAt) <= now.getTime()) return false;
  return true;
}

/**
 * Evaluate the publishing gate. Returns structured reasons so the admin UI can explain exactly
 * why public distribution is blocked (e.g. the founder's commercial MP3s without a verified licence).
 */
export function canPublish(input: PublishGateInput, now: Date = new Date()): PublishGateResult {
  const reasons: PublishBlockReason[] = [];
  const block = (code: PublishBlockCode, message: string, field: string, severity: 'blocker' | 'warning' = 'blocker') => reasons.push({ code, message, field, severity });

  if (!canTransitionContent(input.currentState, 'published') && input.currentState !== 'published') {
    block('invalid_state', `Content in state "${input.currentState}" cannot be published directly; it must be approved first`, 'status');
  }
  const titlePresent = typeof input.title === 'string' && input.title.trim().length > 0;
  if (!titlePresent) block('missing_title', 'A title is required', 'title');
  const languagePresent = typeof input.languageCode === 'string' && input.languageCode.trim().length > 0;
  if (!languagePresent) block('missing_language', 'The language / variety must be set', 'language');

  const needsAsset = input.entityKind === 'audio_lesson' || input.entityKind === 'visual_asset';
  let fileIntegrityVerified = true;
  let audioAccessible = true;
  if (needsAsset) {
    const asset = input.asset ?? null;
    fileIntegrityVerified = asset?.checksumVerified === true && (asset.byteLength ?? 0) > 0;
    audioAccessible = asset?.accessible === true && asset.disposition === 'active';
    if (!asset) {
      block('integrity_unverified', 'No verified media file is attached', 'media');
      block('audio_inaccessible', 'No playable media is available', 'media');
    } else {
      if (!fileIntegrityVerified) block('integrity_unverified', 'The media file checksum has not been verified', 'media');
      if (asset.disposition !== 'active') block('asset_revoked', `The media file is ${asset.disposition}`, 'media');
      else if (!asset.accessible) block('audio_inaccessible', 'The media file is not readable from storage', 'media');
    }
  }

  let speakerMetadataPresent = true;
  if (input.entityKind === 'audio_lesson' || input.entityKind === 'audio_collection') {
    const speakers = input.speakers ?? null;
    if (speakers && speakers.known) {
      const complete = speakers.entries.length > 0 && speakers.entries.every((s) => (s.name ?? '').trim().length > 0 && s.consentState !== 'unknown' && s.consentState !== 'revoked');
      speakerMetadataPresent = complete;
      if (!complete) block('speaker_metadata_missing', 'Speaker/instructor metadata (name and consent state) is incomplete for known speakers', 'speakers');
    }
  }

  let chapterLinked = true;
  if (input.entityKind === 'audio_lesson') {
    chapterLinked = typeof input.chapterId === 'string' && input.chapterId.length > 0;
    if (!chapterLinked) block('chapter_missing', 'The lesson must belong to a chapter', 'chapter');
  }

  const rights = input.rights;
  let rightsVerified = false;
  if (!rights) {
    block('rights_missing', 'No rights/licence record is attached. Owning a recording does not grant redistribution rights', 'rights');
  } else {
    if (!rights.verified) block('rights_unverified', 'The rights record has not been verified by a reviewer', 'rights');
    if (rights.revokedAt && Date.parse(rights.revokedAt) <= now.getTime()) block('rights_revoked', 'The licence was revoked', 'rights');
    else if (rights.expiresAt && Date.parse(rights.expiresAt) <= now.getTime()) block('rights_expired', 'The licence has expired', 'rights');
    if (!rights.commercialRedistribution) block('no_redistribution_right', 'The licence does not permit redistribution to learners; only owner-only staging is allowed', 'rights');
    if (rights.attributionRequired && !(rights.attributionText ?? '').trim() && !(rights.authors ?? []).length) {
      block('rights_unverified', 'Attribution is required by the licence but no attribution text or authors are recorded', 'rights');
    }
    rightsVerified = isRightsActive(rights, now) && rights.commercialRedistribution;
  }

  const nativeReviewed = input.nativeReviewed === true;
  if (!nativeReviewed) block('native_review_missing', 'Native-speaker review has not been recorded', 'review', input.requireNativeReview ? 'blocker' : 'warning');

  const altTextPresent = input.entityKind === 'visual_asset' ? input.altTextPresent === true : true;
  if (!altTextPresent) block('alt_text_missing', 'Alt text is required for visual assets', 'altText');

  const blockedBy = reasons.filter((r) => r.severity === 'blocker').map((r) => r.code);
  return {
    allowed: blockedBy.length === 0,
    checklist: { titlePresent, languagePresent, fileIntegrityVerified, audioAccessible, speakerMetadataPresent, chapterLinked, rightsVerified, nativeReviewed, altTextPresent },
    reasons,
    blockedBy: [...new Set(blockedBy)],
  };
}

/** Human-readable licence names for common identifiers (fallback: the id itself). */
export const LICENSE_NAMES: Readonly<Record<string, string>> = {
  'CC0-1.0': 'CC0 1.0',
  'CC-BY-4.0': 'CC BY 4.0',
  'CC-BY-SA-4.0': 'CC BY-SA 4.0',
  'CC-BY-NC-4.0': 'CC BY-NC 4.0',
  'CC-BY-NC-SA-4.0': 'CC BY-NC-SA 4.0',
  MIT: 'MIT',
  'Apache-2.0': 'Apache 2.0',
  proprietary: 'Proprietary licence',
  original: 'Original work',
};

export interface AttributionInput extends RightsRecord {
  title?: string | null;
  speakers?: readonly string[];
}

/**
 * Build attribution text. Uses the licence's own text when provided, otherwise
 * `"<Title>" by <authors> — <licence> (<url>)`. Returns `null` when the licence does not require it
 * and no text was recorded.
 */
export function buildAttributionText(input: AttributionInput): string | null {
  const explicit = (input.attributionText ?? '').trim();
  if (explicit) return explicit;
  if (!input.attributionRequired) return null;
  const people = [...(input.authors ?? []), ...(input.speakers ?? [])].map((s) => s.trim()).filter(Boolean);
  const licence = LICENSE_NAMES[input.licenseId] ?? input.licenseId;
  const version = input.licenseVersion ? ` ${input.licenseVersion}` : '';
  const parts: string[] = [];
  if (input.title) parts.push(`"${input.title.trim()}"`);
  if (people.length) parts.push(`${parts.length ? 'by ' : ''}${[...new Set(people)].join(', ')}`);
  let text = parts.join(' ');
  text += `${text ? ' — ' : ''}${licence}${version}`;
  if (input.originUrl) text += ` (${input.originUrl})`;
  return text;
}

export type TakedownReason = 'rights_revoked' | 'rights_expired' | 'takedown' | 'quality' | 'editorial' | 'other';

export interface TakedownInput {
  entity: { table: 'audio_lessons' | 'audio_course_collections' | 'missions' | 'visual_assets' | 'expressions' | 'characters'; id: string; state: ContentState };
  reason: TakedownReason;
  /** Manifests that embed this entity. */
  manifests: InvalidationInput[];
  /** Ids of download packs / offline manifests that include the entity's assets. */
  dependentPackIds?: readonly string[];
  /** Asset ids whose playback must be revoked immediately. */
  assetIds?: readonly string[];
}

export interface TakedownPlan {
  newState: ContentState;
  /** Whether the entity was actually live (a non-published entity still gets caches cleaned). */
  wasPublished: boolean;
  offlineEligibilityRevoked: boolean;
  /** Whether learners who already downloaded the content must purge it on next sync. */
  purgeRequired: boolean;
  cachePrefixesToPurge: string[];
  /** Payloads for `manifest.invalidated` events, one per affected manifest. */
  manifestInvalidations: Array<InvalidationInput & { reason: 'unpublished' | 'rights_revoked' }>;
  assetDisposition: 'active' | 'revoked';
  revokePlaybackForAssetIds: string[];
  dependentPackIds: string[];
}

/**
 * Plan a takedown/unpublish: state change, cache invalidations, offline ineligibility and playback
 * revocation. Rights-driven takedowns additionally revoke assets so they cannot be re-served or
 * re-uploaded (`decideDedupe` blocks re-uploads of revoked content).
 */
export function propagateTakedown(input: TakedownInput): TakedownPlan {
  const wasPublished = input.entity.state === 'published';
  const rightsDriven = input.reason === 'rights_revoked' || input.reason === 'rights_expired' || input.reason === 'takedown';
  const newState: ContentState = wasPublished ? 'unpublished' : input.entity.state === 'approved' && rightsDriven ? 'rights_unverified' : input.entity.state;
  const eventReason = rightsDriven ? 'rights_revoked' : 'unpublished';
  const manifestInvalidations = input.manifests.map((m) => ({ ...m, reason: eventReason as 'unpublished' | 'rights_revoked' }));
  const cachePrefixesToPurge = [...new Set(input.manifests.flatMap((m) => manifestInvalidationPrefixes(m)))];
  return {
    newState,
    wasPublished,
    offlineEligibilityRevoked: true,
    purgeRequired: rightsDriven,
    cachePrefixesToPurge,
    manifestInvalidations,
    assetDisposition: rightsDriven ? 'revoked' : 'active',
    revokePlaybackForAssetIds: rightsDriven ? [...(input.assetIds ?? [])] : [],
    dependentPackIds: [...(input.dependentPackIds ?? [])],
  };
}

/** Whether a lesson may be offered for offline download right now (§4.5 / §7.6). */
export function offlineEligible(input: { state: ContentState; rights: RightsRecord | null; assetDisposition: 'active' | 'quarantined' | 'revoked' | 'deleted' }, now: Date = new Date()): boolean {
  return input.state === 'published' && input.assetDisposition === 'active' && isRightsActive(input.rights, now) && input.rights!.commercialRedistribution;
}
