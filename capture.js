// SPDX-License-Identifier: GPL-3.0-or-later
import GioUnix from 'gi://GioUnix';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {normalized, signature} from './model.js';

export function frame(r) {
    return {x: r.x, y: r.y, width: r.width, height: r.height};
}
export function monitors() {
    return Main.layoutManager.monitors.map(m => ({
        index: m.index,
        connector: global.backend.get_monitor_manager().get_monitors().find(output => global.backend.get_monitor_manager().get_monitor_for_connector(output.get_connector()) === m.index)?.get_connector() ?? `${m.index}`,
        geometry: frame(m),
        scale: global.display.get_monitor_scale(m.index),
        workArea: frame(global.workspace_manager.get_active_workspace().get_work_area_for_monitor(m.index)),
    }));
}
export function allWindows() {
    const windows = new Set(global.get_window_actors().map(a => a.meta_window));
    for (let i = 0; i < global.workspace_manager.n_workspaces; i++) {
        for (const w of global.workspace_manager.get_workspace_by_index(i).list_windows())
            windows.add(w);
    }
    return global.display.sort_windows_by_stacking([...windows].filter(w => w && !w.is_override_redirect() && [Meta.WindowType.NORMAL, Meta.WindowType.DIALOG, Meta.WindowType.MODAL_DIALOG, Meta.WindowType.UTILITY].includes(w.get_window_type())));
}
export function windowIdentity(w) {
    const id = Shell.WindowTracker.get_default().get_window_app(w)?.get_id() ?? '';
    return {
        appId: id.endsWith('.desktop') ? id : '',
        wmClass: w.get_wm_class() ?? '',
        wmClassInstance: w.get_wm_class_instance() ?? '',
        title: w.get_title() ?? '',
        type: w.get_window_type(),
        stableSequence: w.get_stable_sequence(),
        transient: Boolean(w.get_transient_for()),
    };
}
// Static identity for this Shell's module lifetime. It survives enable/disable,
// but a new compositor process gets a fresh token without reading /proc.
const SESSION_TOKEN = GLib.uuid_string_random();
export function loginToken() {
    return SESSION_TOKEN;
}
export async function commandLine(pid, appId, cancellable = null) {
    if (appId && GioUnix.DesktopAppInfo.new(appId))
        return null;
    try {
        const file = Gio.File.new_for_path(`/proc/${pid}/cmdline`);
        const bytes = await new Promise((resolve, reject) => {
            file.load_contents_async(cancellable, (source, result) => {
                try { resolve(source.load_contents_finish(result)[1]); }
                catch (error) { reject(error); }
            });
        });
        const args = new TextDecoder().decode(bytes).split('\0').filter(Boolean);
        return args.length ? args : null;
    } catch (error) {
        if (cancellable?.is_cancelled()) throw error;
        // A window's process may exit or disallow access while being captured.
        return null;
    }
}
export async function capture(name, selected = null, cancellable = null) {
    if (!(Meta.is_wayland_compositor?.() ?? true))
        throw new Error('WindowKeep requires a Wayland session');
    const outputs = monitors();
    const layout = signature(outputs);
    const windows = allWindows().filter(w => !selected || selected.has(w)).map((w, stacking) => {
        const identity = windowIdentity(w);
        const r = frame(w.get_frame_rect());
        if (r.width <= 0 || r.height <= 0)
            throw new Error(`Window is not ready for capture; retry after it maps: ${identity.title}`);
        const area = frame(w.get_work_area_for_monitor(w.get_monitor()));
        const relative = normalized(r, area);
        const half = Math.abs(relative.width - 0.5) < 0.025 && Math.abs(relative.height - 1) < 0.025;
        return {
            id: GLib.uuid_string_random(), ...identity, type: w.get_window_type(), pid: w.get_pid(),
            command: null, workspace: w.get_workspace()?.index() ?? 0,
            monitor: w.get_monitor(), absolute: {[layout]: r}, relative,
            maximized: w.get_maximize_flags?.() ?? w.get_maximized?.() ?? 0,
            tile: half && Math.abs(relative.x) < 0.025 ? 'left' : half && Math.abs(relative.x - 0.5) < 0.025 ? 'right' : 'normal',
            above: w.is_above(), sticky: w.is_on_all_workspaces(), skipTaskbar: w.is_skip_taskbar(),
            fullscreen: w.is_fullscreen(), minimized: w.minimized, stacking,
        };
    });
    const profile = {
        schemaVersion: 1, provider: 'shell-heuristic-v1', id: GLib.uuid_string_random(),
        name: name.trim(), createdAt: new Date().toISOString(), login: loginToken(), layout,
        monitors: outputs, workspaceCount: global.workspace_manager.n_workspaces,
        activeWorkspace: global.workspace_manager.get_active_workspace_index(), windows,
    };
    // Snapshot geometry and identity before yielding; only process arguments need IO.
    await Promise.all(windows.map(async saved => {
        saved.command = await commandLine(saved.pid, saved.appId, cancellable);
    }));
    if (cancellable?.is_cancelled())
        throw new Error('WindowKeep capture cancelled');
    return profile;
}
