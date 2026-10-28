// SPDX-License-Identifier: GPL-3.0-or-later
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import {ProfileStore} from '../store.js';
import {signature, validateProfile} from '../model.js';
const directory = GLib.dir_make_tmp('windowkeep-test-XXXXXX');
const store = new ProfileStore(directory);
const monitors = [{index: 0, connector: 'eDP-1', geometry: {x: 0, y: 0, width: 1920, height: 1080}, workArea: {x: 0, y: 32, width: 1920, height: 1048}, scale: 1}];
const layout = signature(monitors);
const p = {schemaVersion: 1, provider: 'shell-heuristic-v1', id: GLib.uuid_string_random(), name: 'test', createdAt: new Date().toISOString(), login: 'test', monitors, layout, workspaceCount: 1, activeWorkspace: 0, windows: [{id: GLib.uuid_string_random(), appId: 'test.desktop', wmClass: 'test', wmClassInstance: 'test', title: 'test', stableSequence: 1, pid: 1, transient: false, type: 0, workspace: 0, monitor: 0, stacking: 0, absolute: {[layout]: {x: 20, y: 32, width: 400, height: 600}}, relative: {x: 0.1, y: 0.1, width: 0.3, height: 0.4}, maximized: 0, tile: 'normal', above: false, sticky: false, skipTaskbar: false, fullscreen: false, minimized: false, command: ['/bin/sh', '-c', 'touch /tmp/windowkeep-untrusted']}]};
function assert(test, message) { if (!test) throw new Error(message); }
try {
    (await store.write(p));
    assert((await store.read(p.id)).name === 'test', 'roundtrip');
    const mode = store.file(p.id).query_info('unix::mode', Gio.FileQueryInfoFlags.NONE, null).get_attribute_uint32('unix::mode');
    assert((mode & 0o777) === 0o600, 'private file mode');
    const copy = (await store.duplicate(p.id, 'copy'));
    (await store.rename(copy.id, 'renamed'));
    assert((await store.list()).profiles.length === 2, 'duplicate');
    const path = `${directory}/export.json`;
    (await store.exportFile(copy.id, path));
    const imported = (await store.importFile(path));
    assert(imported.id !== copy.id, 'import assigns fresh identity');
    assert(imported.windows.every(w => w.command === null), 'import strips executable commands');
    assert((await store.read(copy.id)).windows[0].command !== null, 'export does not strip local commands');
    const cancelled = new ProfileStore(directory);
    cancelled.destroy();
    let cancelledRead = false;
    try { await cancelled.list(); } catch (error) { cancelledRead = error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED); }
    assert(cancelledRead, 'disabled store cancels pending IO');
    let rejected = false;
    try { validateProfile({...p, windows: [{...p.windows[0], relative: {x: NaN}}]}); }
    catch (_) { rejected = true; }
    assert(rejected, 'invalid geometry rejected');
    rejected = false;
    try { (await store.read('../outside')); } catch (_) { rejected = true; }
    assert(rejected, 'path traversal rejected');
    print('GJS store tests passed: atomic roundtrip, mode, rename, duplicate, export/import, validation');
} finally {
    const dir = Gio.File.new_for_path(directory);
    const enumerator = dir.enumerate_children('standard::name', 0, null);
    let info;
    while ((info = enumerator.next_file(null))) dir.get_child(info.get_name()).delete(null);
    enumerator.close(null);
    dir.delete(null);
}
