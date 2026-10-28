# Milestones and acceptance procedure

Run commands from the repository root. Never test recovery using unsaved work.
This checklist distinguishes verified automation from pending real-app acceptance.

## 1. Research and model

Read [ARCHITECTURE.md](ARCHITECTURE.md) before changing APIs. Run `make test`. Success: syntax/metadata
checks, GLib schema validation, Node test pass, and `GJS store tests passed`.
Tests cover negative monitor origins, resolution changes, geometry clamping,
matching hints, untrusted input, JSON roundtrips, UUID imports and file permissions.

## 2. Shell capture and placement

Run `scripts/nested-smoke.sh`. It creates an isolated headless GNOME 50 Shell with
two virtual outputs and separate XDG directories. Success: all checks print PASS markers and the test exits 0. The test moves a window onto inactive workspace 3, captures it, moves it
away and restores it. It asserts that concurrent restore requests have one ID.
It then captures two GTK app windows across outputs, closes them, launches them
from a real desktop entry and restores both. It also verifies maximize/always-on-top/sticky state and its reversal, exercises
D-Bus operations, timeout and cancellation cleanup, renders preferences and writes
README screenshots. Test-only fixture apps and profiles stay in temporary storage.

## 3. Physical monitors and existing windows (manual)

Build/install as in README and log in again. Open editor and terminal on workspace
1, browser/documents on workspace 2. Put at least one window on each eDP-1, DP-1
and HDMI-A-1 output. Open the panel, name a profile, save. Success: notification
count equals the actual windows (including secondary-output windows exactly once).
`gjs -m scripts/windowkeep list` must show every workspace and output record.
Move/resize the windows and change workspace assignments. Click the profile.
Success: `status` becomes `complete`, each window returns to its saved location,
and no unrelated window closes. Repeat twice; the window count must not increase.
Inspect the JSON's relative and absolute rectangles and monitor connectors.

## 4. Missing windows and ambiguity (manual)

Close saved test editor/terminal/browser windows after saving work. Restore. Check
`status` and launch counts. A browser may restore its own content; WindowKeep
must not claim responsibility for tabs. Test two same-app windows with identical
and changed titles. Ambiguous mapping must be documented, with no endless launch
loop. Test a Flatpak desktop launcher; count the launched windows and verify the
correct app, workspace and output. Remove a launcher: default behavior must warn
and not run its saved argv. Enable process fallback only with a harmless test app;
status must warn that fallback is unreliable. Disable fallback after the test.

## 5. Workspace, geometry and state matrix (manual)

Test dynamic workspaces with a gap before the highest saved workspace. During
restore, indices must not collapse. Empty workspaces may collapse after completion.
Test fixed mode with fewer workspaces: status must warn and clamp destinations;
the configured workspace count must not change. Test workspaces-only-on-primary
true and false, confirming secondary windows are always captured. When true,
secondary windows remain visible across workspaces by GNOME policy.
Test negative output origins, resolution changes, scaling changes and an unplugged
output. Windows must remain reachable; fallback uses primary and reports a warning.
Hotplug during restore must cancel. Test normal/maximized/partial-maximized,
fullscreen/minimized, always-on-top/sticky and left/right half-screen geometry.
Native tiling linkage and skip-taskbar changes must be reported as limitations.
Test size-constrained apps: no false successful geometry confirmation.

## 6. Profiles, preferences, scripting and login (manual)

Rename and duplicate in preferences. Edit the duplicate; original must be unchanged.
Export, delete duplicate, import: new UUID, equivalent window data. Try malformed,
large and unsupported JSON: error, no overwrite or execution. Delete requires
confirmation in preferences. `gjs -m scripts/windowkeep status` must match panel action
results. Toggle login restore; verify only the dedicated XDG autostart entry is
created/removed. Enable it, save a harmless layout, log out and back in: one
restore request, no duplicate apps. Toggle off afterward if undesired.

## 7. Lifecycle and release (manual)

Disable while waiting for a missing app and during placement. No subsequent launch
or geometry update may occur. Enable/disable repeatedly and inspect
`journalctl --user -b -f` for errors referencing WindowKeep. D-Bus methods must
be unavailable while disabled. Check schema preferences and screen reader labels.
Review translation extraction and every user-visible message. Confirm maintainer
UUID/repository URL; add verified versions only. Run `make pack`; inspect ZIP
contents and install that exact ZIP. Complete extensions.gnome.org review under
the maintainer's account. Site submission is not automated by this project.

## Project actions

Save one workspace as a named project, with unrelated windows elsewhere. Collapse
must save first, minimize only original members, and explain that apps keep
running. Repeat Collapse then Resume: originally visible windows should return.
Save and close must show a confirmation; Cancel must change nothing. Confirm with
a harmless app, then with an unsaved document: its own save prompt must remain
under user control. Unrelated windows must stay open. Older-session profiles must
refuse hide/close rather than use heuristic matches. Reopened/new windows require
fresh project capture. Force a profile write failure: no close requests may occur.
