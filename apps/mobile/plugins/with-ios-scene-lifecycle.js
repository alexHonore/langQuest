/**
 * iOS 27 scene life cycle (UIScene adoption) for the generated native project.
 *
 * iOS 27 asserts at launch (`_UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption`, SIGTRAP)
 * when an app has no `UIApplicationSceneManifest`. Expo SDK 57 ships `ExpoAppSceneDelegate`
 * (`@objc(EXExpoAppSceneDelegate)`, expo/ios/AppDelegates) but its app template (57.0.29 and 57.0.30)
 * still creates the window in the AppDelegate and declares no scene, so the dev client and every
 * release build crash before the first frame on iOS 27. This plugin wires Expo's scene delegate:
 *
 * 1. Info.plist gets a single-window scene manifest whose delegate is `EXExpoAppSceneDelegate`.
 * 2. AppDelegate conforms to `ExpoReactNativeFactoryProvider` (it already declares `window` and
 *    `reactNativeFactory`) and no longer creates a window or starts React Native itself: the scene
 *    delegate creates the window from the connecting `UIWindowScene` and starts React Native into it.
 *
 * `ios/` is generated (Continuous Native Generation), so this is the only place the change lives.
 * Remove the plugin once the Expo template adopts scenes itself. The transforms throw when the
 * template no longer matches, so a template change is noticed at prebuild instead of at launch.
 */
const { createRunOncePlugin, withAppDelegate, withInfoPlist } = require('expo/config-plugins');

const SCENE_DELEGATE_CLASS = 'EXExpoAppSceneDelegate';
const PROVIDER = 'ExpoReactNativeFactoryProvider';
const MARKER = '// [langquest] window + React Native start are owned by EXExpoAppSceneDelegate (iOS 27 scene life cycle).';

/** Info.plist: declare one window scene driven by Expo's scene delegate. */
function addSceneManifest(infoPlist) {
  return {
    ...infoPlist,
    UIApplicationSceneManifest: {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: 'Default Configuration',
            UISceneDelegateClassName: SCENE_DELEGATE_CLASS,
          },
        ],
      },
    },
  };
}

const CLASS_LINE = /class AppDelegate: ExpoAppDelegate(?<rest>[^{]*)\{/;
const WINDOW_BLOCK = /\n[ \t]*#if os\(iOS\) \|\| os\(tvOS\)\n[ \t]*window = UIWindow\(frame: UIScreen\.main\.bounds\)\n[ \t]*factory\.startReactNative\(\n[^)]*\)\n[ \t]*#endif\n/;

/** AppDelegate.swift (Swift template): provide the factory to the scene delegate instead of owning a window. */
function adoptSceneAppDelegate(contents) {
  if (contents.includes(MARKER)) return contents;
  const cls = CLASS_LINE.exec(contents);
  if (!cls) throw new Error('[with-ios-scene-lifecycle] AppDelegate.swift: `class AppDelegate: ExpoAppDelegate` not found (template changed?)');
  if (!WINDOW_BLOCK.test(contents)) throw new Error('[with-ios-scene-lifecycle] AppDelegate.swift: window creation block not found (template changed?)');
  const rest = cls.groups?.rest ?? '';
  const conformance = rest.includes(PROVIDER) ? rest : `${rest.trimEnd()}, ${PROVIDER} `;
  let out = contents.replace(CLASS_LINE, `class AppDelegate: ExpoAppDelegate${conformance}{`);
  out = out.replace(WINDOW_BLOCK, (block) => {
    const indent = /\n([ \t]*)#if/.exec(block)?.[1] ?? '    ';
    return `\n${indent}${MARKER}\n`;
  });
  return out;
}

function withIosSceneLifecycle(config) {
  config = withInfoPlist(config, (c) => {
    c.modResults = addSceneManifest(c.modResults);
    return c;
  });
  config = withAppDelegate(config, (c) => {
    if (c.modResults.language !== 'swift') throw new Error('[with-ios-scene-lifecycle] only the Swift AppDelegate is supported');
    c.modResults.contents = adoptSceneAppDelegate(c.modResults.contents);
    return c;
  });
  return config;
}

module.exports = createRunOncePlugin(withIosSceneLifecycle, 'langquest-ios-scene-lifecycle', '1.0.0');
module.exports.addSceneManifest = addSceneManifest;
module.exports.adoptSceneAppDelegate = adoptSceneAppDelegate;
module.exports.SCENE_DELEGATE_CLASS = SCENE_DELEGATE_CLASS;
