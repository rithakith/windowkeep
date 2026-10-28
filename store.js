// SPDX-License-Identifier: GPL-3.0-or-later
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {MAX_BYTES, validateProfile, validId} from './model.js';

function io(object, method, finish, args = []) {
    return new Promise((resolve, reject) => object[method](...args, (source, result) => {
        try { resolve(source[finish](result)); } catch (error) { reject(error); }
    }));
}

export class ProfileStore {
    // Legacy storage path intentionally preserves existing saved profiles.
    constructor(directory = GLib.build_filenamev([GLib.get_user_data_dir(), 'session-atlas', 'profiles'])) {
        this.directory = directory;
        this.cancellable = new Gio.Cancellable();
        GLib.mkdir_with_parents(directory, 0o700);
    }

    destroy() {
        this.cancellable.cancel();
    }

    file(id) {
        if (!validId(id))
            throw new Error('Invalid profile ID');
        return Gio.File.new_for_path(GLib.build_filenamev([this.directory, `${id}.json`]));
    }

    async readFile(file) {
        const info = await io(file, 'query_info_async', 'query_info_finish', ['standard::size', Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT, this.cancellable]);
        if (info.get_size() > MAX_BYTES)
            throw new Error('Profile exceeds 4 MiB');
        const [, bytes] = await io(file, 'load_contents_async', 'load_contents_finish', [this.cancellable]);
        if (bytes.length > MAX_BYTES)
            throw new Error('Profile exceeds 4 MiB');
        return validateProfile(JSON.parse(new TextDecoder().decode(bytes)));
    }

    async read(id) {
        return this.readFile(this.file(id));
    }

    async write(profile) {
        profile = {...profile, modifiedAt: new Date().toISOString()};
        validateProfile(profile);
        const bytes = new TextEncoder().encode(`${JSON.stringify(profile, null, 2)}\n`);
        if (bytes.length > MAX_BYTES)
            throw new Error('Profile exceeds 4 MiB');
        await io(this.file(profile.id), 'replace_contents_async', 'replace_contents_finish', [bytes, null, false, Gio.FileCreateFlags.PRIVATE | Gio.FileCreateFlags.REPLACE_DESTINATION, this.cancellable]);
        return profile;
    }

    async list() {
        const result = [];
        const errors = [];
        const enumerator = await io(Gio.File.new_for_path(this.directory), 'enumerate_children_async', 'enumerate_children_finish', ['standard::name', Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT, this.cancellable]);
        try {
            while (true) {
                const batch = await io(enumerator, 'next_files_async', 'next_files_finish', [1, GLib.PRIORITY_DEFAULT, this.cancellable]);
                if (!batch.length) break;
                const [info] = batch;
                const name = info.get_name();
                if (!name.endsWith('.json'))
                    continue;
                const id = name.slice(0, -5);
                try {
                    result.push(await this.read(id));
                } catch (error) {
                    errors.push(`${name}: ${error.message}`);
                }
            }
        } finally {
            await io(enumerator, 'close_async', 'close_finish', [GLib.PRIORITY_DEFAULT, null]);
        }
        return {profiles: result.sort((a, b) => ((Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0)) || a.name.localeCompare(b.name)), errors};
    }

    async rename(id, name) {
        return this.write({...await this.read(id), name: name.trim()});
    }

    async duplicate(id, name) {
        return this.write({...await this.read(id), id: GLib.uuid_string_random(), name: name.trim(), createdAt: new Date().toISOString()});
    }

    async remove(id) {
        await io(this.file(id), 'delete_async', 'delete_finish', [GLib.PRIORITY_DEFAULT, this.cancellable]);
    }

    async importFile(path) {
        const p = await this.readFile(Gio.File.new_for_path(path));
        return this.write({...p, windows: p.windows.map(w => ({...w, command: null})), id: GLib.uuid_string_random(), createdAt: new Date().toISOString()});
    }

    async exportFile(id, path) {
        await io(Gio.File.new_for_path(path), 'replace_contents_async', 'replace_contents_finish', [new TextEncoder().encode(`${JSON.stringify(await this.read(id), null, 2)}\n`), null, false, Gio.FileCreateFlags.PRIVATE | Gio.FileCreateFlags.REPLACE_DESTINATION, this.cancellable]);
    }
}
