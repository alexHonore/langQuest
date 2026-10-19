/** Repository factories bundled per client. */
import type { DbClient } from '../client';
import { accountLifecycleRepository } from './account-lifecycle';
import { aiProfilesRepository } from './ai-profiles';
import { assetSuggestionsRepository } from './asset-suggestions';
import { auditLogRepository } from './audit-log';
import { audioLibraryRepository } from './audio-library';
import { catalogRepository } from './catalog';
import { curriculumRepository } from './curriculum';
import { enrollmentsRepository } from './enrollments';
import { manifestsRepository } from './manifests';
import { profilesRepository } from './profiles';
import { progressRepository } from './progress';
import { rightsRepository } from './rights';
import { speakersRepository } from './speakers';
import { processingJobsRepository, uploadsRepository } from './uploads-jobs';
import { visualAssetsRepository } from './visual-assets';

export * from './account-lifecycle';
export * from './ai-profiles';
export * from './asset-suggestions';
export * from './audit-log';
export * from './audio-library';
export * from './catalog';
export * from './curriculum';
export * from './enrollments';
export * from './manifests';
export * from './profiles';
export * from './progress';
export * from './rights';
export * from './speakers';
export * from './uploads-jobs';
export * from './visual-assets';

/** All repositories bound to one client (service, user or anon). */
export function createRepositories(db: DbClient) {
  return {
    profiles: profilesRepository(db),
    enrollments: enrollmentsRepository(db),
    catalog: catalogRepository(db),
    curriculum: curriculumRepository(db),
    progress: progressRepository(db),
    audioLibrary: audioLibraryRepository(db),
    uploads: uploadsRepository(db),
    processingJobs: processingJobsRepository(db),
    aiProfiles: aiProfilesRepository(db),
    rights: rightsRepository(db),
    visualAssets: visualAssetsRepository(db),
    auditLog: auditLogRepository(db),
    // added 2026-10-15 (migration 100)
    manifests: manifestsRepository(db),
    assetSuggestions: assetSuggestionsRepository(db),
    accountLifecycle: accountLifecycleRepository(db),
    // added 2026-10-19 (migration 120, admin structure routes)
    speakers: speakersRepository(db),
  };
}
export type Repositories = ReturnType<typeof createRepositories>;
