/**
 * Rive-rendered Melo (native). Mounted only when `ENV.mascotRive` is on AND a `.riv` is bundled
 * (`MELO_RIVE_SOURCE`); otherwise it returns `null` so `Melo` draws the SVG. Inputs follow
 * docs/design/mascot-rive-spec.md §1: `state` (index into MASCOT_STATE_VALUES), `courseFamily`
 * (index into COURSE_FAMILY_IDS, −1 = none) and `reducedMotion`.
 */
import { MASCOT_STATE_VALUES } from '@langquest/contracts';
import React, { useEffect, useRef } from 'react';
import { View } from 'react-native';
import Rive, { Fit, type RiveRef } from 'rive-react-native';
import { MELO_INPUTS, MELO_RIVE_SOURCE, MELO_STATE_MACHINE } from './rive-source';
import type { MeloRiveProps } from './rive-types';

export function MeloRive(props: MeloRiveProps): React.JSX.Element | null {
  const ref = useRef<RiveRef>(null);
  const stateIndex = MASCOT_STATE_VALUES.indexOf(props.state);
  useEffect(() => {
    if (!MELO_RIVE_SOURCE) return;
    try {
      ref.current?.setInputState(MELO_STATE_MACHINE, MELO_INPUTS.state, stateIndex);
      ref.current?.setInputState(MELO_STATE_MACHINE, MELO_INPUTS.courseFamily, props.courseFamilyIndex);
      ref.current?.setInputState(MELO_STATE_MACHINE, MELO_INPUTS.reducedMotion, props.reducedMotion);
    } catch {
      /* the rig may not expose every input yet; the pose still follows `state` on the next tick */
    }
  }, [stateIndex, props.courseFamilyIndex, props.reducedMotion]);
  if (!MELO_RIVE_SOURCE) return null;
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={props.accessibilityLabel} style={{ width: props.size, height: props.size }} testID={props.testID}>
      <Rive ref={ref} source={MELO_RIVE_SOURCE} stateMachineName={MELO_STATE_MACHINE} autoplay={!props.reducedMotion} fit={Fit.Contain} style={{ width: props.size, height: props.size }} onError={() => props.onError?.()} />
    </View>
  );
}
