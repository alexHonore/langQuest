/** §6.4 administrator routes (role-gated per route; every mutation audit-logged). */
import type { DefineRoute } from '../../app';
import { registerAnalyticsRoutes } from './analytics';
import { registerAssetRoutes } from './assets';
import { registerContentRoutes } from './content';
import { registerImportRoutes } from './imports';
import { registerModelRoutes } from './models';
import { registerRightsRoutes } from './rights';
import { registerSpeakerRoutes } from './speakers';
import { registerStructureRoutes } from './structure';
import { registerSuggestionRoutes } from './suggestions';
import { registerUploadRoutes } from './uploads';
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
}
