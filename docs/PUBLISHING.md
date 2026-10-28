# Publishing WindowKeep

Publisher: **rithakith**. Repository target:
`https://github.com/rithakith/windowkeep`.

This guide prepares the first public release and a later GNOME Extensions
submission. The repository has not been created or pushed by this assistant,
and no extension has been submitted to GNOME.

## 1. Create the public repository

Sign in to [GitHub](https://github.com/new) as `rithakith` and create a **public**
repository named `windowkeep`. Leave the initial README, license and gitignore
options unchecked: this checkout already contains them.

Publish the contents of your WindowKeep checkout at the repository root.

Review the files for private data. The screenshots show isolated fixture apps;
do not commit personal profiles, logs, credentials or exports. Then run:

```bash
cd /path/to/windowkeep
git add .gitignore .github LICENSE Makefile README.md package.json metadata.json *.js schemas scripts tests docs po icons
git commit -m "Initial WindowKeep release"
git branch -M main
git remote add origin https://github.com/rithakith/windowkeep.git
git push -u origin main
```

These commands assume a new, empty GitHub repository and no existing `origin`.
GitHub may ask you to authenticate; use its supported browser/credential-manager
or token flow. Never paste a token into this repository or a chat message.

Confirm the public repository page loads while signed out. Its URL is already
set in `metadata.json`; update it if you choose a different repository name.

## 2. Finish release validation

The publisher UUID is `windowkeep@rithakith.github.io`. Keep it stable after
publication. Earlier local builds used `session-atlas@ritzy` and
`session-atlas@rithakith.github.io`; disable both before enabling WindowKeep. Profile data stays in its existing location; preferences migrate once to the
WindowKeep GSettings schema.

Before claiming a stable release:

- Run the physical-monitor, login, Flatpak/browser and workspace matrix in
  [TESTING.md](TESTING.md). Record failures and limitations rather than hide them.
- Review capture/restore matching, cleanup, subprocess fallback and the optional
  shutdown reminder. The reminder does not suspend GNOME's countdown.
- Test with only WindowKeep enabled to separate conflicts from its own bugs.
- Check readable error messages, accessibility and translated strings.
- Ensure the README, screenshots, metadata and tested behavior agree.

Build and inspect the final package:

```bash
make test
scripts/nested-smoke.sh
make pack
unzip -l dist/windowkeep@rithakith.github.io.shell-extension.zip
```

The isolated Shell test should exit 0 and print six PASS markers covering capture,
launch, state, preferences, D-Bus/lifecycle and the shutdown reminder. The ZIP
contains runtime JavaScript, metadata, license, schema XML, the symbolic icon and the GJS CLI. It does
not contain tests, build scripts, documentation images or design notes. Keep
those in the source repository. Install and test this exact ZIP before submitting.

## 3. Publish the first GitHub release

On the repository's **Releases** page, draft a release tagged `v1.0.0`, describe the supported environment and known limits, and
attach `windowkeep@rithakith.github.io.shell-extension.zip`.

Do not describe this as GNOME Extensions approval. A GitHub release and GNOME
Extensions review are separate distribution paths.

## 4. Submit to GNOME Extensions

1. Register or sign in at [extensions.gnome.org](https://extensions.gnome.org/).
2. Choose [Add yours](https://extensions.gnome.org/upload/).
3. Upload the tested runtime ZIP and complete the requested listing information.
4. Read reviewer feedback, fix requested changes, test again and upload the update.

Advertise GNOME 50 only until other versions are tested. Let extensions.gnome.org
assign its own extension version; the metadata intentionally omits `version`.
Keep the source repository accessible for reports and review.

Read the [current review guidelines](https://gjs.guide/extensions/review-guidelines/review-guidelines.html)
before submission. Relevant requirements include lifecycle cleanup, compatible
licensing, a real project URL and minimal package contents. The runtime helper
is now GJS: GNOME's rules generally require GJS when the functionality is
available in it, instead of shipping Python modules for review.

The guidelines also contain an **“Extensions must not be AI-generated”** rule.
AI assistance is permitted as a development aid, but you must understand, test
and explain the submitted code. This project was developed with AI assistance;
review it carefully and be candid with reviewers. Packaging checks do not
establish compliance or guarantee acceptance.

## 5. Maintain the release

Use the same UUID for updates, keep a changelog, investigate user reports and
retest supported Shell versions. Rebuild from the public source commit, attach
the matching ZIP to the GitHub release and submit that ZIP to GNOME Extensions.
Keep the native session-management migration path documented and avoid enabling
two login restorers at the same time.
