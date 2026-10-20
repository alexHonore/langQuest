import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const plugin = require('./with-ios-scene-lifecycle.js') as {
  addSceneManifest: (plist: Record<string, unknown>) => Record<string, unknown>;
  adoptSceneAppDelegate: (contents: string) => string;
  SCENE_DELEGATE_CLASS: string;
};

/** The AppDelegate the Expo SDK 57 template generates (57.0.29 and 57.0.30 are identical here). */
const TEMPLATE = `internal import Expo
import React
import ReactAppDependencyProvider

@main
class AppDelegate: ExpoAppDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ExpoReactNativeFactoryDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let delegate = ReactNativeDelegate()
    let factory = ExpoReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }
}
`;

describe('with-ios-scene-lifecycle (iOS 27 launch assertion)', () => {
  it('declares a single window scene driven by Expo’s scene delegate, keeping existing keys', () => {
    const plist = plugin.addSceneManifest({ CFBundleName: 'LangQuest' });
    expect(plist.CFBundleName).toBe('LangQuest');
    expect(plist.UIApplicationSceneManifest).toEqual({
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [{ UISceneConfigurationName: 'Default Configuration', UISceneDelegateClassName: 'EXExpoAppSceneDelegate' }],
      },
    });
    expect(plugin.SCENE_DELEGATE_CLASS).toBe('EXExpoAppSceneDelegate');
  });

  it('makes the AppDelegate a factory provider and leaves window + React Native start to the scene delegate', () => {
    const out = plugin.adoptSceneAppDelegate(TEMPLATE);
    expect(out).toContain('class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {');
    expect(out).not.toContain('UIWindow(frame: UIScreen.main.bounds)');
    expect(out).not.toContain('factory.startReactNative(');
    // The factory is still created and kept for the scene delegate; the provider requirements stay declared.
    expect(out).toContain('reactNativeFactory = factory');
    expect(out).toContain('var window: UIWindow?');
    expect(out).toContain('return super.application(application, didFinishLaunchingWithOptions: launchOptions)');
  });

  it('is idempotent across repeated prebuilds', () => {
    const once = plugin.adoptSceneAppDelegate(TEMPLATE);
    expect(plugin.adoptSceneAppDelegate(once)).toBe(once);
  });

  it('fails the prebuild loudly when the template no longer matches', () => {
    expect(() => plugin.adoptSceneAppDelegate('class Other {}')).toThrow(/template changed/);
    expect(() => plugin.adoptSceneAppDelegate(TEMPLATE.replace('window = UIWindow(frame: UIScreen.main.bounds)', 'window = makeWindow()'))).toThrow(/window creation block/);
  });
});
