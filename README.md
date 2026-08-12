# deeplink-parity

[![npm](https://img.shields.io/npm/v/deeplink-parity.svg)](https://www.npmjs.com/package/deeplink-parity)
[![CI](https://github.com/camosss/deeplink-parity/actions/workflows/ci.yml/badge.svg)](https://github.com/camosss/deeplink-parity/actions/workflows/ci.yml)
![Node](https://img.shields.io/badge/Node-18%2B-brightgreen.svg)
![Platform](https://img.shields.io/badge/Platform-iOS%20%7C%20Android-lightgrey.svg)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Checks that what your app **declares** about deep links matches what is actually **hosted** — on both iOS and Android, from one command.

```bash
# iOS and Android usually live in separate repositories — pass both
npx deeplink-parity ./my-app-ios ./my-app-android
```

```
deeplink-parity · 3 domain(s) checked

ERROR  links.example.com
       AASA responded with 404
       Universal Links fall through to the browser
       https://links.example.com/.well-known/apple-app-site-association

WARN   promo.example.com
       Declared on iOS but not on Android
       The same link opens the app on iOS and the browser on Android

1 error, 1 warn, 0 info
```

<br>

## Why

Deep links fail **silently**. There is no crash, no error log, no red test. A user taps a link, the browser opens instead of your app, and they shrug and move on. Nobody finds out for months.

And the configuration is split across places with **different owners**:

| | Owner |
|---|---|
| `*.entitlements` | iOS developer |
| `AndroidManifest.xml` | Android developer |
| `apple-app-site-association`, `assetlinks.json` | web / infra team, separate repo, separate deploy |
| SHA256 signing fingerprint | release manager / Play Console |

Each side is individually correct. Breakage happens **at the seams**, and no repo's CI covers a seam that spans two repos and a live domain.

Existing validators check one hosted file at a time. None of them start from your app's own configuration, and none of them compare the two platforms — so a domain that works on iOS and quietly fails on Android goes unnoticed.

<br>

## What it checks

No configuration file. Domains are discovered from your app, then the matching well-known files are fetched from those domains.

**Errors** — the link is broken today

- The AASA file is unreachable, redirects (iOS does not follow redirects), or does not parse
- The AASA file does not list your `TeamID.bundleID`
- `assetlinks.json` is unreachable, does not parse, or has no `handle_all_urls` statement
- `assetlinks.json` does not list your `applicationId`
- Your signing fingerprint is missing from `assetlinks.json` (with `--sha256`)

**Warnings** — one platform works and the other does not

- **A domain is declared on iOS but not Android, or the reverse**
- An `https` intent-filter has no `autoVerify`
- A manifest host reference could not be resolved

**Info**

- The declared path sets differ between platforms
- The AASA file declares no paths or components

<br>

## Usage

```bash
npx deeplink-parity [path...] [options]

  --sha256 <fingerprint>   Android signing fingerprint to look for in assetlinks.json
  --well-known <dir>       Read well-known files from <dir>/<domain>/ instead of the network
  --json                   Machine-readable output
```

Pass one path per checkout. A monorepo holding both platforms works as a single path,
two repositories work as two paths, and a directory of symlinks to each checkout works
too — the scan follows them.

```bash
npx deeplink-parity .                                  # one repo
npx deeplink-parity ../app-ios ../app-android          # two repos
npx deeplink-parity . --sha256 "AB:CD:…"               # include the fingerprint check
```

The Android signing fingerprint comes from Play Console → App integrity → App signing.
Without it the fingerprint check is skipped and reported as such.

### In CI

| Exit code | Meaning |
|---|---|
| `0` | No errors. Warnings and notices do not fail the run |
| `1` | At least one error — a link is broken today |
| `2` | Nothing to check, or the run itself failed |

Colour is emitted only to a terminal, so piped and captured output stays plain. `--json`
writes nothing but JSON to stdout; progress notes go to stderr. On GitHub Actions the
findings are also emitted as annotations, which appear on the run summary and against the
file when one is involved — set `--format github` to force it elsewhere.

### Run it on a schedule — this is the point

Your deep-link configuration changes a few times a year. The things that break it do not live in your repo at all:

- the web team's deploy puts a redirect in front of `/.well-known/`
- a domain expires or its DNS moves
- the signing key is rotated, or the app moves to Play App Signing
- an attribution vendor changes their hosting

A pull-request check never sees any of this. **A daily scheduled run does.** See [`examples/scheduled.yml`](examples/scheduled.yml).

### Validate before deploying

`--well-known <dir>` reads the files from disk instead of the network, so the web team can check staged files before they ship — and CI can run with no egress.

```bash
npx deeplink-parity . --well-known ./staging/well-known
```

<br>

## Native, Flutter and React Native

Whatever the app is written in, deep links are declared in the same two native files and
verified against the same two hosted files. The scan looks for those, so a Flutter or
React Native checkout works with no extra setup:

```bash
npx deeplink-parity .          # ios/ and android/ live in one repo
```

**Expo is the exception.** `expo prebuild` generates `ios/` and `android/` at build time
and they are normally gitignored, so there is nothing to scan. Run the check after a
prebuild, or on CI after the prebuild step. Pointed at an un-prebuilt Expo project the
scan says so rather than reporting a clean run — a static `app.json` also lists the
domains it found, though a JavaScript config is never evaluated.

<br>

## Hardened against real projects

Synthetic fixtures agree with whatever the author assumed. Real apps do not — so this was
run against open-source apps across all four stacks (Wikipedia, Mastodon, Bitwarden,
DuckDuckGo, Bluesky, Open Food Facts). Every one of these came from that exercise, and
none would have surfaced against fixtures alone:

- `applinks:*.example.com` is a valid wildcard declaration, and there is no such host to fetch
- `myapp://callback` carries a host too, but a custom scheme is not an App Link
- an entitlements file belongs to one target, so the app must not inherit the widget's bundle id
- a dev domain's assetlinks names the `applicationIdSuffix` variant, which is still our app
- an app can declare a domain per country, and firing every request at once caused the very
  timeouts it then reported — requests are now pooled
- an Expo checkout has no native project to scan, which read as a clean run

Each is a regression test. A browser's `http`/`https` filters with no host are correctly
read as browser registration rather than deep links.

<br>

## What it does not do

- **Deferred deep links are out of scope.** Install-then-open attribution is decided at runtime by your attribution SDK's servers. No static check can confirm it, and reporting a pass would be worse than saying nothing.
- **It does not prove path equivalence.** iOS and Android use different path-matching engines. Differing path sets are reported as `info` with both sides shown, for a human to judge — not asserted as a bug.
- **It does not run your app.** Route handling inside the app is not inspected.

<br>

## Development

```bash
npm install
npm test        # runs fully offline against fixtures/
npm run typecheck
```

`fixtures/` holds synthetic iOS and Android projects covering literal hosts, chained
`@string` references resolved through gradle `resValue` and `.properties`, flavor-specific
values, and unresolvable references.

<br>

## License

`deeplink-parity` is released under an MIT license. See [License](LICENSE) for more information.
