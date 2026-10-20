/** §6.4 administrator routes (role-gated per route; every mutation audit-logged). */
import type { DefineRoute } from '../../app';
import { registerAnalyticsRoutes } from './analytics';
import { registerAssetRoutes } from './assets';
import { registerContentRoutes } from './content';
import { registerEditorialRoutes } from './editorial';
import { registerImportRoutes } from './imports';
import { registerJobRoutes } from './jobs';
import { registerModelTestRoutes } from './model-test';
import { registerModelRoutes } from './models';
import { registerRightsRoutes } from './rights';
import { registerSpeakerRoutes } from './speakers';
import { registerStructureRoutes } from './structure';
import { registerSuggestionRoutes } from './suggestions';
import { registerUploadRoutes } from './uploads';
import { registerUserRoutes } from './users';
import { registerVisualAssetRoutes } from './visual-assets';

export function registerAdminRoutes(define: DefineRoute): void {
  registerUploadRoutes(define);
  registerImportRoutes(define);
  registerAssetRoutes(define);
  registerContentRoutes(define);
  registerModelRoutes(define);
  registerAnalyticsRoutes(define);
  registerSpeakerRoutes(define);
  registerStructureRoutes(define);
  registerRightsRoutes(define);
  registerVisualAssetRoutes(define);
  registerSuggestionRoutes(define);
  // §7 Studio writes formerly served by local Next route handlers in apps/admin (R-4.3-01)
  registerEditorialRoutes(define);
  registerJobRoutes(define);
  registerUserRoutes(define);
  registerModelTestRoutes(define);
}
