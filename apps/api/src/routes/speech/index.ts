/** §6.2 speaking & AI routes. */
import type { DefineRoute } from '../../app';
import { registerConversationRoutes } from './conversation';
import { registerSpeechRoutes as registerSpeechEndpoints } from './speech';

export function registerSpeechRoutes(define: DefineRoute): void {
  registerConversationRoutes(define);
  registerSpeechEndpoints(define);
}
