/** Repository factories bundled per client. */
import type { DbClient } from '../client';
import { aiProfilesRepository } from './ai-profiles';
import { auditLogRepository } from './audit-log';
import { audioLibraryRepository } from './audio-library';
import { catalogRepository } from './catalog';
import { curriculumRepository } from './curriculum';
import { enrollmentsRepository } from './enrollments';
import { profilesRepository } from './profiles';
import { progressRepository } from './progress';
import { rightsRepository } from './rights';
import { processingJobsRepository, uploadsRepository } from './uploads-jobs';
import { visualAssetsRepository } from './visual-assets';

export * from './ai-profiles';
export * from './audit-log';
export * from './audio-library';
export * from './catalog';
export * from './curriculum';
export * from './enrollments';
export * from './profiles';
export * from './progress';
export * from './rights';
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
  };
}
export type Repositories = ReturnType<typeof createRepositories>;
