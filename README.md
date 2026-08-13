# deeplink-parity

[![npm](https://img.shields.io/npm/v/deeplink-parity.svg)](https://www.npmjs.com/package/deeplink-parity)
[![CI](https://github.com/camosss/deeplink-parity/actions/workflows/ci.yml/badge.svg)](https://github.com/camosss/deeplink-parity/actions/workflows/ci.yml)
![Node](https://img.shields.io/badge/Node-18%2B-brightgreen.svg)
![Platform](https://img.shields.io/badge/Platform-iOS%20%7C%20Android-lightgrey.svg)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Checks that what your app **declares** about deep links matches what is actually **hosted** — on both iOS and Android, from one command.

```bash
npx deeplink-parity .
```

```
deeplink-parity v0.6.4 · 3 domain(s) checked
routes: deeplink-parity.yml (iOS 74 · Android 73)

ERROR  links.example.com
       AASA responded with 404
       Universal Links fall through to the browser
       https://links.example.com/.well-known/apple-app-site-association

WARN   promo.example.com
       Declared on iOS but not on Android
       The same link opens the app on iOS and the browser on Android

WARN   route-gap
       /events is in the Android route table but not iOS's
       A /events link navigates on Android and goes nowhere on iOS.

1 error, 2 warn, 0 info
```

<br>

## Quick start

Nothing to configure. Domains are read from your app and the matching files are fetched
from them.

**One repository** — a monorepo, Flutter, or React Native:

```bash
npx deeplink-parity .
```

**Two repositories** — native iOS and Android, which is the case worth checking:

```bash
npx deeplink-parity ./my-app-ios ./my-app-android
```

**On GitHub Actions**, one line:

```yaml
- uses: actions/checkout@v4
- uses: camosss/deeplink-parity@v1
```

Findings show up as annotations on the run. Add `sha256` to include the Android signing
key in the check, and `fail-on: never` to report without failing while an existing backlog
is cleared.

Domains are checked with zero setup. To also compare the **screens behind the links**,
run `npx deeplink-parity init` once — see [Route parity](#route-parity).

<br>

## Contents

- [Why](#why)
- [What it checks](#what-it-checks)
- [Usage](#usage)
  - [GitHub Action](#github-action)
  - [In CI](#in-ci)
  - [Run it on a schedule](#run-it-on-a-schedule)
  - [Validate before deploying](#validate-before-deploying)
- [Route parity](#route-parity)
- [Native, Flutter and React Native](#native-flutter-and-react-native)
- [Hardened against real projects](#hardened-against-real-projects)
- [What it does not do](#what-it-does-not-do)
- [Development](#development)
- [License](#license)

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
- **A route is in one platform's route table but not the other's** (with [route parity](#route-parity) set up)
- An `https` intent-filter has no `autoVerify`
- A manifest host reference could not be resolved

**Info**

- The declared path sets differ between platforms
- The AASA file declares no paths or components

<br>

## Usage

```bash
npx deeplink-parity [path...] [options]        # check (default)
npx deeplink-parity init [path...]             # interactive setup for route comparison

  --sha256 <fingerprint>   Android signing fingerprint to look for in assetlinks.json
  --well-known <dir>       Read well-known files from <dir>/<domain>/ instead of the network
  --config <file>          Route config (default: deeplink-parity.yml in cwd or a root)
  --print-routes           Print the extracted route tables before the report
  --json                   Machine-readable output on stdout
  --output <file>          Also write the JSON result to a file
  --format github          GitHub Actions annotations (auto-detected on Actions)
  --yes                    init only: accept the top suggestion without prompting
  -v, --version            Print the version
  -h, --help               Show this message
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

### GitHub Action

```yaml
- uses: camosss/deeplink-parity@v1
  with:
    paths: ios android          # one per checkout; omit for a single repo
    sha256: ${{ secrets.ANDROID_SHA256 }}
```

Findings appear as annotations on the run, and counts are available to later steps:

```yaml
- uses: camosss/deeplink-parity@v1
  id: links
  with:
    fail-on: never              # report without blocking while a backlog is cleared
- run: echo "${{ steps.links.outputs.errors }} errors, ${{ steps.links.outputs.warnings }} warnings"
```

| Input | Default | |
|---|---|---|
| `paths` | `.` | Checkout paths, whitespace separated |
| `sha256` | — | Android signing fingerprint |
| `well-known` | — | Read from disk instead of the network |
| `config` | auto | Route config file (see [Route parity](#route-parity)) |
| `fail-on` | `error` | `never` to report without failing the step |
| `version` | pinned | npm version to run |

Outputs: `errors`, `warnings`, `notices`, `domains`, `report` (path to the JSON result).

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

### Run it on a schedule

Your deep-link configuration changes a few times a year. The things that break it do not live in your repo at all:

- the web team's deploy puts a redirect in front of `/.well-known/`
- a domain expires or its DNS moves
- the signing key is rotated, or the app moves to Play App Signing
- an attribution vendor changes their hosting

A pull-request check never sees any of this. **A daily scheduled run does.** See [`examples/scheduled.yml`](examples/scheduled.yml).

### Validate before deploying

`--well-known <dir>` reads the files from disk instead of the network, so the web team can
check staged files before they ship — and CI can run with no egress at all.

```
well-known/
└── links.example.com/
    ├── apple-app-site-association
    └── assetlinks.json
```

```bash
npx deeplink-parity . --well-known ./well-known
```

This answers a different question, though: whether the app matches the files you intend to
publish, not whether it matches what is live right now. The failures this tool exists to
catch — a deploy putting a redirect in front of `/.well-known/`, an expired domain, a
rotated key — only show up against the real host. Files hosted by an attribution vendor
cannot be checked offline at all.

<br>

## Route parity

Domains are only half the story. The other half is the screen behind the link: a route
registered on Android but never on iOS means `myapp://link/events` navigates on one
platform and goes nowhere on the other — and the person sending that link has no way
to know.

Route tables live in app code with no standard location, so this check is **opt-in via
one config file**. Run the interactive setup once:

```bash
npx deeplink-parity init ./my-app-ios ./my-app-android
```

It scans for likely route-table files, lets you pick one per platform (or type a path
yourself), recognises the table's shape, previews what it extracts, and writes
`deeplink-parity.yml`:

```yaml
routes:
  ios:
    file: App/Routing/DeepLinkRoutes.swift     # relative to whichever root it lives under
    match: 'case \w+ = "(/[a-z0-9/_-]+)"'      # capture group 1 = the path
  android:
    file: app/src/main/java/…/DeepLinks.kt
    match: '[A-Z_]+\("(/[a-z0-9/_-]+)"\)'
```

Commit it. From then on every check — CLI and Action alike — also diffs the two route
tables and reports the paths one platform has and the other does not. Verify the
extraction any time with `--print-routes`.

Accuracy guards, in keeping with the rest of the tool:

- A regex that matches nothing is an **error**, never a clean pass
- If only one platform extracts, no gaps are reported — a broken table is not a diff
- Routes handled dynamically (prefix or component matching) never appear in a table;
  gap findings carry that caveat

### What the tool touches

The **check never writes to the repositories it scans** — it reads files and GETs two
public well-known files per domain, nothing else. `init` writes exactly one file,
`deeplink-parity.yml`, in your working directory, after printing its content and asking.

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
- **It does not run your app.** Route parity compares the declared tables; whether a
  handler behind a route actually works, or a dynamically-matched route resolves, only
  shows up on a device.

<br>

## Development

```bash
npm install
npm test        # runs fully offline against fixtures/
npm run typecheck
```

`fixtures/` holds synthetic iOS and Android projects covering literal hosts, chained
`@string` references resolved through gradle `resValue` and `.properties`, flavor-specific
values, unresolvable references, and route tables in both platforms' shapes.

<br>

## License

`deeplink-parity` is released under an MIT license. See [License](LICENSE) for more information.
