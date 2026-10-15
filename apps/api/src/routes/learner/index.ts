/** §6.1 learner account & catalog routes. */
import type { DefineRoute } from '../../app';
import { registerAccountLifecycleRoutes, registerAccountRoutes } from './account';
import { registerCatalogRoutes } from './catalog';
import { registerEnrollmentRoutes } from './enrollments';
import { registerManifestRoutes } from './manifest';
import { registerMissionRoutes } from './missions';
import { registerProgressRoutes } from './progress';
import { registerReviewRoutes } from './reviews';

export function registerLearnerRoutes(define: DefineRoute): void {
  registerAccountRoutes(define);
  registerAccountLifecycleRoutes(define);
  registerCatalogRoutes(define);
  registerEnrollmentRoutes(define);
  registerManifestRoutes(define);
  registerMissionRoutes(define);
  registerReviewRoutes(define);
  registerProgressRoutes(define);
}
