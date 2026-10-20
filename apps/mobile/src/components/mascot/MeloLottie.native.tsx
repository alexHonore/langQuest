/**
 * Lottie clips of Melo (native, `lottie-react-native`), generated from the same geometry as the
 * SVG (`assets/mascot/lottie/*.json`, `pnpm --filter @langquest/ui lottie`). The clip's `body` and
 * `bands` layers are recoloured with the chameleon tint so a celebration wears the course colour.
 * Never mounted under reduced motion (the caller shows the static pose instead).
 */
import LottieView from 'lottie-react-native';
import React from 'react';
import { View } from 'react-native';
import type { MeloLottieProps } from './lottie-types';

const CLIPS = {
  idle: require('../../../../../assets/mascot/lottie/idle.json'),
  reaction: require('../../../../../assets/mascot/lottie/reaction.json'),
  celebrate_bounce: require('../../../../../assets/mascot/lottie/celebrate_bounce.json'),
  thinking: require('../../../../../assets/mascot/lottie/thinking.json'),
} as const;

export function MeloLottie(props: MeloLottieProps): React.JSX.Element | null {
  const source = CLIPS[props.clip];
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={props.accessibilityLabel} style={{ width: props.size, height: props.size }} testID={props.testID}>
      <LottieView
        source={source}
        autoPlay
        loop={props.loop ?? false}
        style={{ width: props.size, height: props.size }}
        colorFilters={props.tint ? [{ keypath: 'body', color: props.tint.body }, { keypath: 'bands', color: props.tint.crest }] : undefined}
        onAnimationFinish={(cancelled) => {
          if (!cancelled) props.onFinish?.();
        }}
      />
    </View>
  );
}
