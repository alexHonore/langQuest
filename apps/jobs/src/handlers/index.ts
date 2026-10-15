/**
 * Handler registry shared by every backend (ADR-005). Both `JOBS_BACKEND=postgres` and the Cloudflare
 * Queues consumer run exactly these handlers.
 */
import { HandlerRegistry } from '../queue/types';
import { alignHandler } from './align';
import { cleanupOrphanUploadsHandler } from './cleanup-orphan-uploads';
import { generateContentHandler } from './generate-content';
import { importManifestHandler } from './import-manifest';
import { importR2PrefixHandler } from './import-r2-prefix';
import { inferMetadataHandler } from './infer-metadata';
import { inspectAssetHandler } from './inspect-asset';
import { regenerateManifestHandler } from './regenerate-manifest';
import { createRenderCoverHandler, type RenderCoverDeps } from './render-cover';
import { transcodeHandler } from './transcode';
import { transcribeHandler } from './transcribe';
import { translateTranscriptHandler } from './translate-transcript';

export interface RegistryOptions {
  renderCover?: RenderCoverDeps;
}

/** Build the full registry (every handler the Node runner supports). */
export function buildRegistry(options: RegistryOptions = {}): HandlerRegistry {
  return new HandlerRegistry()
    .register(inspectAssetHandler)
    .register(transcodeHandler)
    .register(transcribeHandler)
    .register(alignHandler)
    .register(translateTranscriptHandler)
    .register(inferMetadataHandler)
    .register(importR2PrefixHandler)
    .register(importManifestHandler)
    .register(generateContentHandler)
    .register(regenerateManifestHandler)
    .register(createRenderCoverHandler(options.renderCover))
    .register(cleanupOrphanUploadsHandler);
}

export * from './align';
export * from './cleanup-orphan-uploads';
export * from './common';
export * from './generate-content';
export * from './import-manifest';
export * from './import-r2-prefix';
export * from './infer-metadata';
export * from './inspect-asset';
export * from './regenerate-manifest';
export * from './render-cover';
export * from './transcode';
export * from './transcribe';
export * from './translate-transcript';
