// SPDX-License-Identifier: GPL-3.0-or-later
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GioUnix from 'gi://GioUnix';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {allWindows, monitors, windowIdentity, loginToken, frame} from './capture.js';
import {destination, matchScore, signature, validateProfile} from './model.js';

class Connections {
    constructor() {
        this.items = [];
    }
    connect(object, signal, callback) {
        this.items.push([object, object.connect(signal, callback)]);
    }
    clear() {
        for (const [object, id] of this.items)
            object.disconnect(id);
        this.items = [];
    }
}

export class RestoreManager {
    constructor(settings, complete, translate = message => message) {
        this._ = translate;
        this.settings = settings;
        this.complete = complete;
        this.operation = null;
        this.lastResult = null;
        // A timed-out launch may still map later: don't relaunch it on a second click.
        this.launchLedger = new Map();
    }

    start(profile) {
        if (this.operation)
            return this.status();
        validateProfile(profile);
        const seconds = this.settings.get_uint('restore-timeout');
        const op = {
            id: GLib.uuid_string_random(), profile, state: 'preparing',
            warnings: new Set(), failures: [], placed: [], claimed: new Set(),
            existing: new Set(allWindows()),
            pending: [...profile.windows].sort((a, b) => a.stacking - b.stacking),
            signals: new Connections(), candidates: new Map(), placements: new Map(),
            launched: new Set(), sources: new Set(), outputs: monitors(),
            deadline: GLib.get_monotonic_time() + seconds * 1000000,
        };
        this.operation = op;
        try {
            this.prepareWorkspaces(op);
            op.signals.connect(global.display, 'window-created', (_d, w) => this.watch(op, w));
            op.signals.connect(Main.layoutManager, 'monitors-changed', () => this.finish('cancelled', this._('Monitor configuration changed; restore cancelled')));
            const timeout = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, seconds, () => {
                op.sources.delete(timeout);
                this.finish('partial', this._('Restore deadline reached; unresolved windows were not relaunched'));
                return GLib.SOURCE_REMOVE;
            });
            op.sources.add(timeout);
            for (const w of allWindows())
                this.watch(op, w);
            op.state = 'matching';
            this.advance(op);
        } catch (error) {
            this.finish('partial', error.message);
        }
        return this.status();
    }

    prepareWorkspaces(op) {
        const manager = global.workspace_manager;
        const dynamic = new Gio.Settings({schema_id: 'org.gnome.mutter'}).get_boolean('dynamic-workspaces');
        const required = Math.max(1, ...op.pending.map(w => w.workspace + 1));
        if (!dynamic) {
            if (required > manager.n_workspaces)
                op.warnings.add(this._('Fixed workspace count: out-of-range destinations use the last workspace'));
        } else {
            if (typeof Main.wm.blockWorkspaceUpdates !== 'function' || typeof Main.wm.unblockWorkspaceUpdates !== 'function')
                throw new Error(this._('Shell workspace update API unavailable; cannot preserve dynamic workspace destinations'));
            Main.wm.blockWorkspaceUpdates();
            op.workspaceUpdatesBlocked = true;
            for (let i = 0; i < required; i++) {
                if (i >= manager.n_workspaces)
                    manager.append_new_workspace(false, global.get_current_time());
            }
        }
        op.workspaces = Array.from({length: manager.n_workspaces}, (_v, i) => manager.get_workspace_by_index(i));
        if (Meta.prefs_get_workspaces_only_on_primary() && op.pending.some(w => w.monitor !== Main.layoutManager.primaryIndex))
            op.warnings.add(this._('Secondary-monitor windows remain visible on all workspaces under your GNOME workspace policy'));
    }

    watch(op, w) {
        if (op.candidates.has(w))
            return;
        const signals = new Connections();
        op.candidates.set(w, signals);
        const changed = () => {
            if (this.operation === op && op.state !== 'preparing')
                this.advance(op);
        };
        for (const signal of ['shown', 'notify::mapped', 'notify::title', 'notify::wm-class', 'notify::gtk-application-id'])
            signals.connect(w, signal, changed);
        signals.connect(w, 'unmanaged', () => {
            const placement = op.placements.get(w);
            placement?.signals.clear();
            op.placements.delete(w);
            if (placement) {
                op.placed = op.placed.filter(item => item.w !== w);
                op.failures.push(`${placement.saved.title}: window closed during restore`);
            }
            signals.clear();
            op.candidates.delete(w);
            if (this.operation === op)
                this.advance(op);
        });
        changed();
    }

    advance(op) {
        if (this.operation !== op || op.advancing)
            return;
        op.advancing = true;
        try {
            const sameLogin = Boolean(op.profile.login) && op.profile.login === loginToken();
            // Existing windows are always consumed before issuing any new launch.
            for (const saved of [...op.pending]) {
                let best = null;
                let score = -1;
                for (const w of op.candidates.keys()) {
                    if (op.claimed.has(w) || (!w.mapped && !op.existing.has(w)))
                        continue;
                    const candidateScore = matchScore(saved, windowIdentity(w), sameLogin);
                    if (candidateScore > score) {
                        score = candidateScore;
                        best = w;
                    }
                }
                if (best) {
                    op.claimed.add(best);
                    op.pending.splice(op.pending.indexOf(saved), 1);
                    this.launchLedger.delete(`${op.profile.id}:${saved.id}`);
                    this.place(op, best, saved);
                }
            }
            if (!op.pending.length && [...op.placements.values()].every(p => p.settled)) {
                // Placement corrections remain active until a compositor redraw.
                if (!op.settle) {
                    op.settle = global.compositor.get_laters().add(Meta.LaterType.BEFORE_REDRAW, () => {
                        op.settle = 0;
                        if (this.operation === op)
                            this.finish(op.failures.length ? 'partial' : 'complete');
                        return GLib.SOURCE_REMOVE;
                    });
                }
                return;
            }
            op.state = 'waiting';
            const waitingApps = new Set(op.pending.filter(w => op.launched.has(w.id)).map(w => w.appId || w.wmClass));
            for (const saved of op.pending) {
                const key = saved.appId || saved.wmClass;
                if (saved.transient || op.launched.has(saved.id) || waitingApps.has(key))
                    continue;
                const ledgerKey = `${op.profile.id}:${saved.id}`;
                if (this.launchLedger.has(ledgerKey)) {
                    op.warnings.add(this._('A previous launch is unresolved; duplicate launch suppressed. Disable and enable the extension to clear launch history'));
                    op.launched.add(saved.id);
                    waitingApps.add(key);
                    continue;
                }
                op.launched.add(saved.id);
                waitingApps.add(key);
                this.launchLedger.set(ledgerKey, true);
                try {
                    const app = saved.appId ? Shell.AppSystem.get_default().lookup_app(saved.appId) : null;
                    const info = saved.appId ? GioUnix.DesktopAppInfo.new(saved.appId) : null;
                    if (app)
                        app.open_new_window(Math.min(saved.workspace, op.workspaces.length - 1));
                    else if (info)
                        info.launch([], global.create_app_launch_context(global.get_current_time(), saved.workspace));
                    else if (saved.command && this.settings.get_boolean('allow-command-fallback')) {
                        op.warnings.add(this._('Process command fallback is unreliable and may run saved arguments; application content is not reconstructed'));
                        Gio.Subprocess.new(saved.command, Gio.SubprocessFlags.NONE);
                    } else {
                        op.failures.push(`${saved.appId || saved.wmClass || saved.title}: no desktop launcher; command fallback disabled or unavailable`);
                    }
                } catch (error) {
                    op.failures.push(`${saved.appId || saved.wmClass}: ${error.message}`);
                }
            }
        } catch (error) {
            this.finish('partial', error.message);
        } finally {
            op.advancing = false;
        }
    }

    place(op, w, saved) {
        const signals = new Connections();
        const item = {signals, corrections: 0, correcting: false, saved, settled: false};
        op.placements.set(w, item);
        try {
            const original = op.profile.monitors.find(m => m.index === saved.monitor);
            let monitor = op.outputs.find(m => m.connector === original?.connector);
            if (!monitor) {
                monitor = op.outputs.find(m => m.index === Main.layoutManager.primaryIndex) ?? op.outputs[0];
                op.warnings.add(this._('Saved monitor unavailable; using primary monitor with relative geometry'));
            }
            w.unminimize();
            w.unmake_fullscreen();
            if (typeof w.set_unmaximize_flags === 'function') {
                w.set_unmaximize_flags(Meta.MaximizeFlags.BOTH);
                w.unmaximize();
            } else {
                w.unmaximize(Meta.MaximizeFlags.BOTH);
            }
            w.unstick();
            w.move_to_monitor(monitor.index);
            const workspace = op.workspaces[Math.min(saved.workspace, op.workspaces.length - 1)];
            w.change_workspace(workspace);
            const area = frame(workspace.get_work_area_for_monitor(monitor.index));
            const r = destination(saved, signature(op.outputs), area);
            const apply = () => {
                if (item.correcting || item.corrections >= 3)
                    return;
                item.correcting = true;
                item.corrections++;
                try {
                    w.move_frame(true, r.x, r.y);
                    w.move_resize_frame(true, r.x, r.y, r.width, r.height);
                } finally {
                    item.correcting = false;
                }
            };
            const verify = () => {
                const current = w.get_frame_rect();
                const flags = w.get_maximize_flags?.() ?? w.get_maximized?.() ?? 0;
                const geometrySettled = saved.fullscreen ? w.is_fullscreen() : saved.maximized ? flags === saved.maximized :
                    Math.abs(current.x - r.x) <= 2 && Math.abs(current.y - r.y) <= 2 && Math.abs(current.width - r.width) <= 2 && Math.abs(current.height - r.height) <= 2;
                item.settled = geometrySettled && w.is_above() === saved.above && w.is_fullscreen() === saved.fullscreen;
                if (item.settled && !op.advancing)
                    this.advance(op);
            };
            signals.connect(w, 'size-changed', () => {
                if (!saved.maximized && !saved.fullscreen)
                    apply();
                verify();
            });
            signals.connect(w, 'position-changed', verify);
            for (const property of ['above', 'on-all-workspaces', 'fullscreen', 'maximized-horizontally', 'maximized-vertically'])
                signals.connect(w, `notify::${property}`, verify);
            apply();
            if (saved.above) w.make_above();
            else w.unmake_above();
            if (saved.sticky) w.stick();
            if (saved.maximized) {
                if (typeof w.set_maximize_flags === 'function') {
                    w.set_maximize_flags(saved.maximized);
                    w.maximize();
                } else {
                    w.maximize(saved.maximized);
                }
            }
            if (saved.fullscreen) w.make_fullscreen();
            if (saved.minimized) w.minimize();
            if (saved.tile !== 'normal')
                op.warnings.add(this._('Half-screen geometry restored; native tile linkage is unavailable through public Mutter APIs'));
            if (saved.skipTaskbar !== w.is_skip_taskbar())
                op.warnings.add(this._('Application-controlled skip-taskbar state cannot be changed reliably'));
            verify();
            op.placed.push({w, saved});
        } catch (error) {
            op.failures.push(`${saved.title}: ${error.message}`);
        }
    }

    finish(state, warning = null) {
        const op = this.operation;
        if (!op)
            return;
        this.operation = null;
        if (warning)
            op.warnings.add(warning);
        if (state !== 'cancelled') {
            for (const item of op.placements.values()) {
                if (!item.settled) op.failures.push(`${item.saved.title}: compositor did not confirm requested geometry/state`);
            }
        }
        if (op.settle)
            global.compositor.get_laters().remove(op.settle);
        if (state !== 'cancelled')
            op.workspaces?.[Math.min(op.profile.activeWorkspace, op.workspaces.length - 1)]?.activate(global.get_current_time());
        if (op.workspaceUpdatesBlocked)
            Main.wm.unblockWorkspaceUpdates();
        op.signals.clear();
        for (const signals of op.candidates.values())
            signals.clear();
        for (const item of op.placements.values())
            item.signals.clear();
        for (const source of op.sources)
            GLib.Source.remove(source);
        if (state !== 'cancelled') {
            for (const {w} of op.placed.sort((a, b) => a.saved.stacking - b.saved.stacking)) {
                try {
                    if (op.candidates.has(w)) w.raise();
                } catch (error) {
                    op.failures.push(error.message);
                }
            }
        }
        this.lastResult = {
            id: op.id, profile: op.profile.id, state: op.failures.length && state === 'complete' ? 'partial' : state,
            restored: op.placed.length, total: op.profile.windows.length,
            members: op.placed.filter(({w}) => op.candidates.has(w)).map(({w, saved}) => ({id: saved.id, stableSequence: w.get_stable_sequence()})),
            unresolvedWindows: op.pending.map(w => ({id: w.id, appId: w.appId, title: w.title, reason: w.transient ? 'Waiting for the application to recreate its dialog' : 'No matching window appeared before completion'})),
            unresolved: op.pending.map(w => w.id), warnings: [...op.warnings], failures: op.failures,
        };
        this.complete(this.lastResult);
    }

    status() {
        const op = this.operation;
        return op ? {id: op.id, profile: op.profile.id, state: op.state, restored: op.placed.length, total: op.profile.windows.length} : this.lastResult ?? {state: 'idle'};
    }

    destroy() {
        this.finish('cancelled');
        this.launchLedger.clear();
    }
}
