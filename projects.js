// SPDX-License-Identifier: GPL-3.0-or-later
import {allWindows, capture, loginToken} from './capture.js';

export class Projects {
    constructor(store) {
        this.store = store;
        this.collapsed = new Map();
        this.bindings = new Map();
    }

    members(profile) {
        const binding = this.bindings.get(profile.id);
        if (!binding && (!profile.login || profile.login !== loginToken()))
            throw new Error('Save this project again in the current session before hiding or closing its windows.');
        const ids = new Set(binding ? [...binding.values()] : profile.windows.map(w => w.stableSequence));
        return allWindows().filter(w => ids.has(w.get_stable_sequence()));
    }

    bind(id, members) {
        if (members.length)
            this.bindings.set(id, new Map(members.map(w => [w.id, w.stableSequence])));
    }

    state(profile) {
        let windows = [];
        try { windows = this.members(profile); } catch (_) { /* Older inactive layout. */ }
        return {windows, active: windows.length > 0, collapsed: windows.length > 0 && windows.every(w => w.minimized)};
    }

    shared(profile, profiles) {
        const own = new Set(this.state(profile).windows);
        return profiles.filter(p => p.id !== profile.id).map(p => ({name: p.name, count: this.state(p).windows.filter(w => own.has(w)).length})).filter(p => p.count > 0);
    }

    async update(id) {
        const profile = (await this.store.read(id));
        if (this.destroyed) throw new Error('WindowKeep disabled');
        const windows = this.members(profile);
        if (!windows.length)
            throw new Error('No original project windows remain open. Use Resume instead.');
        const snapshot = await capture(profile.name, new Set(windows), this.store.cancellable);
        if (this.destroyed) throw new Error('WindowKeep disabled');
        // Keep missing entries for future restore; update only known live members.
        const live = new Map(snapshot.windows.map(w => [w.stableSequence, w]));
        snapshot.windows = profile.windows.map(old => {
            const current = live.get(this.bindings.get(id)?.get(old.id) ?? old.stableSequence);
            if (current) {
                const wasCollapsed = this.collapsed.get(id)?.has(current?.stableSequence);
                return {...current, id: old.id, minimized: wasCollapsed ? old.minimized : current.minimized};
            }
            return {...old, absolute: {...old.absolute, [snapshot.layout]: old.absolute[profile.layout]}};
        });
        // Missing entries retain their original layout-keyed geometry/relative data.
        (await this.store.write({...snapshot, id: profile.id, createdAt: profile.createdAt}));
        if (this.destroyed) throw new Error('WindowKeep disabled');
        return windows;
    }

    async collapse(id) {
        const windows = await this.update(id); // Disk save must succeed before minimizing.
        const hidden = this.collapsed.get(id) ?? new Set();
        for (const w of windows) {
            if (!w.minimized) {
                w.minimize();
                hidden.add(w.get_stable_sequence());
            }
        }
        this.collapsed.set(id, hidden);
        return windows.length;
    }

    async resume(id) {
        const profile = (await this.store.read(id));
        if (this.destroyed) throw new Error('WindowKeep disabled');
        const hidden = this.collapsed.get(id);
        if (!hidden)
            return false;
        for (const w of this.members(profile)) {
            if (hidden.has(w.get_stable_sequence()))
                w.unminimize();
        }
        this.collapsed.delete(id);
        return true;
    }

    async close(id) {
        const windows = await this.update(id); // Never send close requests after a failed save.
        let requested = 0;
        for (const w of windows) {
            // Parent applications handle their dialogs and unsaved-work prompts.
            if (!w.get_transient_for() && w.can_close()) {
                w.delete(global.get_current_time());
                requested++;
            }
        }
        this.collapsed.delete(id);
        return requested;
    }

    destroy() {
        this.destroyed = true;
        this.collapsed.clear();
        this.bindings.clear();
    }
}
