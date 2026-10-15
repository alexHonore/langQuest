/** §6.4 administrator routes (role-gated per route; every mutation audit-logged). */
import type { DefineRoute } from '../../app';
import { registerAnalyticsRoutes } from './analytics';
import { registerAssetRoutes } from './assets';
import { registerContentRoutes } from './content';
import { registerImportRoutes } from './imports';
import { registerModelRoutes } from './models';
import { registerUploadRoutes } from './uploads';

export function registerAdminRoutes(define: DefineRoute): void {
  registerUploadRoutes(define);
  registerImportRoutes(define);
  registerAssetRoutes(define);
  registerContentRoutes(define);
  registerModelRoutes(define);
  registerAnalyticsRoutes(define);
}
