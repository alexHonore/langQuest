import json, sys, base64, urllib.parse
S = sys.argv[1]; port = sys.argv[2]; out = sys.argv[3]; prefix = sys.argv[4]; with_admin = sys.argv[5] == '1'
learner = json.load(open(f'{S}/session-LEARNER.json'))
admin = json.load(open(f'{S}/session-ADMIN.json'))
DEFAULT_PREFS = {"uiLocale": None, "scheme": "system", "highContrast": False, "reducedMotion": "system", "mascotEnabled": True, "textScale": 1, "hapticsEnabled": True, "captionsDefaultOn": False, "speakMode": "push_to_talk", "tapToTalk": False, "onboardingComplete": False, "pendingDefaultSourceLanguage": None, "pendingTrackId": None, "pendingScriptMode": None, "pendingRegionalOption": None, "pendingEnrollmentKey": None, "activeEnrollmentId": None, "fallbackOptIns": {}, "wifiOnlyDownloads": True, "autoDownload": False, "lanternsEnabled": True}
def prefs(scheme, **over):
    st = dict(DEFAULT_PREFS); st.update(over); st["scheme"] = scheme
    return json.dumps({"state": st, "version": 2})
base = f'http://127.0.0.1:{port}'
SB_KEY = 'sb-127-auth-token'
screens = [
  ("onboarding-welcome", "/onboarding/welcome", dict(onboardingComplete=False), False),
  ("onboarding-language", "/onboarding/language", dict(onboardingComplete=False), False),
  ("onboarding-target", "/onboarding/target", dict(onboardingComplete=False, pendingDefaultSourceLanguage="fr"), False),
  ("onboarding-confirm", "/onboarding/confirm", dict(onboardingComplete=False, pendingDefaultSourceLanguage="fr", pendingTrackId="arabic-moroccan"), False),
  ("catalog", "/catalog", dict(onboardingComplete=True), True),
  ("course-arabic-moroccan", "/catalog/arabic-moroccan", dict(onboardingComplete=True), True),
  ("home", "/", dict(onboardingComplete=True), True),
  ("missions", "/missions", dict(onboardingComplete=True), True),
  ("speak", "/speak", dict(onboardingComplete=True), True),
  ("progress", "/progress", dict(onboardingComplete=True), True),
  ("account", "/account", dict(onboardingComplete=True), True),
]
scenarios = []
for scheme in ("dark", "light"):
    for name, path, over, authed in screens:
        ls = {"langquest:prefs": prefs(scheme, **over)}
        if authed: ls[SB_KEY] = json.dumps(learner)
        scenarios.append({"name": f"{name}-{scheme}", "url": base + path, "colorScheme": scheme, "localStorage": ls, "loadingMarkers": ["Loading", "Chargement"]})
cfg = {"outDir": out, "tmpDir": S, "width": 430, "height": 932, "dsf": 2, "mobile": True, "prefix": prefix, "settleMs": 1200, "scenarios": scenarios}
json.dump(cfg, open(f'{S}/config-{prefix}mobile.json', 'w'), indent=1)
if with_admin:
    raw = json.dumps(admin, separators=(',', ':'))
    value = 'base64-' + base64.urlsafe_b64encode(raw.encode()).decode().rstrip('=')
    enc = urllib.parse.quote(value, safe="-_.!~*'()")
    assert enc == value
    chunks = [value[i:i+3180] for i in range(0, len(value), 3180)]
    cookies = [{"name": SB_KEY if len(chunks) == 1 else f"{SB_KEY}.{i}", "value": c, "domain": "127.0.0.1", "path": "/"} for i, c in enumerate(chunks)]
    abase = 'http://127.0.0.1:3011'
    ascen = [{"name": n, "url": abase + p, "colorScheme": cs, "cookies": cookies, "loadingMarkers": ["Loading"]} for (n, p, cs) in [("admin-dashboard-dark", "/", "dark"), ("admin-languages-dark", "/languages", "dark"), ("admin-dashboard-light", "/", "light"), ("admin-languages-light", "/languages", "light")]]
    acfg = {"outDir": out, "tmpDir": S, "width": 1440, "height": 900, "dsf": 1, "mobile": False, "prefix": prefix, "settleMs": 1500, "scenarios": ascen}
    json.dump(acfg, open(f'{S}/config-{prefix}admin.json', 'w'), indent=1)
print('ok', len(scenarios), 'chunks' if with_admin else '')
