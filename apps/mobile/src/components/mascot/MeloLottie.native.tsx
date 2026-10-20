/**
 * Lottie clips of Melo (native, `lottie-react-native`), generated from the same geometry as the
 * SVG (`assets/mascot/lottie/*.json`, `pnpm --filter @langquest/ui lottie`). The clip is recoloured
 * with the chameleon tint before it is handed to the player (`tintLottieClip`): every body-coloured
 * fill — tail, arms, feet, eye turrets, body, bands — follows the state × course tint, while the
 * belly, the crest and the outline strokes keep their own colours. Never mounted under reduced
 * motion (the caller shows the static pose instead).
 */
import LottieView, { type AnimationObject } from 'lottie-react-native';
import React, { useMemo } from 'react';
import { View } from 'react-native';
import { tintLottieClip } from './lottie-tint';
import type { MeloLottieProps } from './lottie-types';

const CLIPS: Record<MeloLottieProps['clip'], AnimationObject> = {
  idle: require('../../../../../assets/mascot/lottie/idle.json') as AnimationObject,
  reaction: require('../../../../../assets/mascot/lottie/reaction.json') as AnimationObject,
  celebrate_bounce: require('../../../../../assets/mascot/lottie/celebrate_bounce.json') as AnimationObject,
  thinking: require('../../../../../assets/mascot/lottie/thinking.json') as AnimationObject,
};

export function MeloLottie(props: MeloLottieProps): React.JSX.Element | null {
  const { clip, tint } = props;
  const body = tint?.body;
  const bodyShade = tint?.bodyShade;
  const crest = tint?.crest;
  // Memoised on the colours themselves: a new `tint` object with the same colours must not restart the clip.
  const source = useMemo(() => (body && bodyShade && crest ? tintLottieClip(CLIPS[clip], { body, bodyShade, crest }) : CLIPS[clip]), [clip, body, bodyShade, crest]);
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={props.accessibilityLabel} style={{ width: props.size, height: props.size }} testID={props.testID}>
      <LottieView
        source={source}
        autoPlay
        loop={props.loop ?? false}
        style={{ width: props.size, height: props.size }}
        onAnimationFinish={(cancelled) => {
          if (!cancelled) props.onFinish?.();
        }}
      />
    </View>
  );
}
