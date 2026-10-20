/**
 * Where the Rive rig of Melo lives when it is bundled (docs/design/mascot-rive-spec.md).
 *
 * No `.riv` is committed yet, so both sources are `null` and `Melo` renders the SVG even when
 * the `EXPO_PUBLIC_MASCOT_RIVE` flag is on. To enable the rig:
 *   1. export `melo.riv` to `assets/mascot/rive/melo.riv` (state machine `Melo`, inputs per the spec);
 *   2. native: set `MELO_RIVE_SOURCE = require('../../../../assets/mascot/rive/melo.riv')`
 *      (metro treats `.riv` as an asset, see `metro.config.js`);
 *   3. web: set `MELO_RIVE_WEB_SRC` to the served URL of the same file;
 *   4. run with `EXPO_PUBLIC_MASCOT_RIVE=1`.
 * The accessibility label and every fallback keep working without the rig (spec §5.6).
 */
export const MELO_RIVE_SOURCE: number | { uri: string } | null = null;
export const MELO_RIVE_WEB_SRC: string | null = null;
export const MELO_STATE_MACHINE = 'Melo';
/** Input names of the `Melo` state machine (mascot-rive-spec §1). */
export const MELO_INPUTS = { state: 'state', courseFamily: 'courseFamily', reducedMotion: 'reducedMotion', blink: 'blink' } as const;
