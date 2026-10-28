// SPDX-License-Identifier: GPL-3.0-or-later
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

export function syncAutostart(enabled, extensionPath) {
    const directory = GLib.build_filenamev([GLib.get_user_config_dir(), 'autostart']);
    const file = Gio.File.new_for_path(GLib.build_filenamev([directory, 'windowkeep.desktop']));
    // Remove the previous helper so login restoration is not requested twice.
    const legacy = Gio.File.new_for_path(GLib.build_filenamev([directory, 'session-atlas.desktop']));
    if (legacy.query_exists(null)) legacy.delete(null);
    if (!enabled) {
        if (file.query_exists(null)) file.delete(null);
        return;
    }
    GLib.mkdir_with_parents(directory, 0o700);
    // Desktop Entry quoting is distinct from shell quoting. Percent is a field code.
    const script = `${extensionPath}/scripts/windowkeep`;
    const quoted = `"${script.replace(/([\\"`$])/g, '\\$1').replace(/%/g, '%%')}"`;
    const content = `[Desktop Entry]\nType=Application\nName=WindowKeep\nComment=Restore the last WindowKeep profile\nExec=/usr/bin/gjs -m ${quoted} login\nOnlyShowIn=GNOME;\nX-GNOME-Autostart-enabled=true\n`;
    file.replace_contents(new TextEncoder().encode(content), null, false, Gio.FileCreateFlags.PRIVATE | Gio.FileCreateFlags.REPLACE_DESTINATION, null);
}
