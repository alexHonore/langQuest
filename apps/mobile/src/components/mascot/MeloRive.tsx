/**
 * Rive-rendered Melo (web, `@rive-app/react-canvas`). Mounted only when `ENV.mascotRive` is on
 * AND `MELO_RIVE_WEB_SRC` is set; otherwise returns `null` so `Melo` draws the SVG.
 */
import { MASCOT_STATE_VALUES } from '@langquest/contracts';
import { useRive } from '@rive-app/react-canvas';
import React, { useEffect } from 'react';
import { View } from 'react-native';
import { MELO_INPUTS, MELO_RIVE_WEB_SRC, MELO_STATE_MACHINE } from './rive-source';
import type { MeloRiveProps } from './rive-types';

type RiveInstance = NonNullable<ReturnType<typeof useRive>['rive']>;

/** Push the three inputs of the `Melo` state machine (spec §1) through the runtime's imperative API. */
function applyInputs(rive: RiveInstance, values: { state: number; courseFamily: number; reducedMotion: boolean }): void {
  const inputs = rive.stateMachineInputs(MELO_STATE_MACHINE) ?? [];
  for (const input of inputs) {
    if (input.name === MELO_INPUTS.state) input.value = values.state;
    else if (input.name === MELO_INPUTS.courseFamily) input.value = values.courseFamily;
    else if (input.name === MELO_INPUTS.reducedMotion) input.value = values.reducedMotion;
  }
}

function RiveCanvas(props: MeloRiveProps & { src: string }): React.JSX.Element {
  const { rive, RiveComponent } = useRive({ src: props.src, stateMachines: MELO_STATE_MACHINE, autoplay: !props.reducedMotion });
  const stateIndex = MASCOT_STATE_VALUES.indexOf(props.state);
  useEffect(() => {
    if (!rive) return;
    try {
      applyInputs(rive, { state: stateIndex, courseFamily: props.courseFamilyIndex, reducedMotion: props.reducedMotion });
    } catch {
      /* the rig may not expose every input yet */
    }
  }, [rive, stateIndex, props.courseFamilyIndex, props.reducedMotion]);
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={props.accessibilityLabel} style={{ width: props.size, height: props.size }} testID={props.testID}>
      <RiveComponent style={{ width: props.size, height: props.size }} />
    </View>
  );
}

export function MeloRive(props: MeloRiveProps): React.JSX.Element | null {
  if (!MELO_RIVE_WEB_SRC) return null;
  return <RiveCanvas {...props} src={MELO_RIVE_WEB_SRC} />;
}
