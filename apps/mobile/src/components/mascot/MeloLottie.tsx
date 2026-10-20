/**
 * Web stand-in for the Lottie clips: `lottie-react-native` has no web renderer in this build, so
 * the clip resolves to its static pose (the SVG `Melo` draws) and finishes immediately. Keeps
 * the celebration flow identical on web without a second animation runtime.
 */
import React, { useEffect } from 'react';
import type { MeloLottieProps } from './lottie-types';

export function MeloLottie(props: MeloLottieProps): React.JSX.Element | null {
  const { onFinish } = props;
  useEffect(() => {
    const handle = setTimeout(() => onFinish?.(), 0);
    return () => clearTimeout(handle);
  }, [onFinish]);
  return null;
}
