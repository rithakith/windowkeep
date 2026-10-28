# Command-line interface

From the checkout, invoke the helper with `gjs -m scripts/windowkeep`. The packaged helper also has an executable interpreter header.
The extension must be enabled in the same session bus as the command.

```sh
gjs -m scripts/windowkeep save 'Project A'       # prints a UUID
gjs -m scripts/windowkeep list                   # profiles plus unreadable-file errors
gjs -m scripts/windowkeep restore PROFILE_UUID   # operation ID and initial state
gjs -m scripts/windowkeep status                 # completion, warnings, failures
gjs -m scripts/windowkeep rename PROFILE_UUID 'New name'
gjs -m scripts/windowkeep duplicate PROFILE_UUID 'Copy'
gjs -m scripts/windowkeep export PROFILE_UUID /absolute/path/profile.json
gjs -m scripts/windowkeep import /absolute/path/profile.json
gjs -m scripts/windowkeep delete PROFILE_UUID
```

The D-Bus destination is `org.gnome.Shell`, object path
`/org/gnome/Shell/Extensions/WindowKeep`, interface
`org.gnome.Shell.Extensions.WindowKeep`. `Restore` starts an operation; poll
`Status` for `complete`, `partial` or `cancelled`. JSON reports counts, unresolved
record IDs and diagnostic messages. CLI errors exit nonzero. JSON import creates
a new UUID and validates input; it does not overwrite existing profiles.


Imported layouts discard saved process commands, even when command fallback is enabled. Installed desktop launchers remain available for restoring their applications.
