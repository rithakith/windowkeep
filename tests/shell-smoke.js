// SPDX-License-Identifier: GPL-3.0-or-later
// Run only in an isolated Shell: scripts/nested-smoke.sh.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import GioUnix from 'gi://GioUnix';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';

export async function run() {
    await Scripting.disableHelperAutoExit();
    if (GLib.getenv('WINDOWKEEP_DOC_SCREENSHOTS')) {
        const wallpaper = GLib.getenv('WINDOWKEEP_DOC_WALLPAPER');
        if (wallpaper) {
            const background = new Gio.Settings({schema_id: 'org.gnome.desktop.background'});
            background.set_string('picture-uri', wallpaper);
            background.set_string('picture-uri-dark', wallpaper);
        }
        new Gio.Settings({schema_id: 'org.gnome.desktop.interface'}).set_string('color-scheme', 'prefer-dark');
        new Gio.Settings({schema_id: 'org.gnome.desktop.notifications'}).set_boolean('show-banners', false);
        await Scripting.sleep(5000);
    }
    const root = GLib.getenv('WINDOWKEEP_SOURCE');
    const uuid = 'windowkeep@rithakith.github.io';
    const {ExtensionType} = await import('resource:///org/gnome/shell/misc/extensionUtils.js');
    const ext = Main.extensionManager.lookup(uuid) ?? Main.extensionManager.createExtensionObject(uuid, Gio.File.new_for_path(root), ExtensionType.PER_USER);
    await Main.extensionManager.loadExtension(ext);
    await Main.extensionManager._callExtensionInit(uuid);
    await Main.extensionManager._callExtensionEnable(uuid);
    if (!ext.stateObj || ext.error)
        throw new Error(`Extension failed: ${ext.error}`);
    await Scripting.createTestWindow({width: 640, height: 480});
    await Scripting.waitTestWindows();
    const {capture, allWindows, commandLine, loginToken} = await import(`file://${root}/capture.js`);
    const {ProfileStore} = await import(`file://${root}/store.js`);
    const {RestoreManager} = await import(`file://${root}/restore.js`);
    const windows = allWindows();
    if (!windows.length) throw new Error('Test window was not captured');
    const w = windows[0];
    if (loginToken() !== loginToken()) throw new Error('Session identity changed');
    const argumentsSnapshot = await commandLine(w.get_pid(), '');
    if (!argumentsSnapshot?.length) throw new Error('Async process argument capture failed');
    const cancelledCapture = new Gio.Cancellable();
    cancelledCapture.cancel();
    let captureCancelled = false;
    try { await capture('Cancelled capture', null, cancelledCapture); }
    catch (_) { captureCancelled = true; }
    if (!captureCancelled) throw new Error('Capture ignored cancellation');
    print('WINDOWKEEP_ASYNC_CAPTURE_PASS');
    Main.wm.blockWorkspaceUpdates();
    try {
        while (global.workspace_manager.n_workspaces < 3)
            global.workspace_manager.append_new_workspace(false, global.get_current_time());
        w.change_workspace_by_index(2, false);
        w.move_resize_frame(true, 100, 100, 640, 480);
        await Scripting.waitLeisure();
        await waitFor(() => w.get_frame_rect().width > 0 && w.get_frame_rect().height > 0);
        const profile = await capture('Reference workspace');
        const saved = profile.windows.find(s => s.stableSequence === w.get_stable_sequence());
        if (saved.workspace !== 2) throw new Error('Inactive workspace not captured');
        const store = new ProfileStore();
        (await store.write(profile));
        w.change_workspace_by_index(0, false);
        let result;
        const restore = new RestoreManager(ext.stateObj._settings, r => { result = r; });
        const first = restore.start(profile);
        const second = restore.start(profile);
        if (first.id !== second.id) throw new Error('Restore lock failed');
        await Scripting.waitLeisure();
        if (!result) await Scripting.sleep(1000);
        if (result?.state !== 'complete' || w.get_workspace().index() !== 2)
            throw new Error(`Restore failed: ${JSON.stringify(result)}`);
        restore.destroy();
        // Exercise real DesktopAppInfo launch and mapping on two outputs.
        const appInfo = GioUnix.DesktopAppInfo.new('org.example.WindowKeepTest.desktop');
        const testWindows = () => allWindows().filter(win => win.get_gtk_application_id() === 'org.example.WindowKeepTest');
        appInfo.launch([], null);
        await waitFor(() => testWindows().filter(win => win.mapped).length === 1);
        appInfo.launch([], null);
        await waitFor(() => testWindows().filter(win => win.mapped).length === 2);
        const appWindows = testWindows();
        appWindows[0].move_to_monitor(0);
        appWindows[0].change_workspace_by_index(2, false);
        appWindows[1].move_to_monitor(1);
        await Scripting.waitLeisure();
        const fresh = await capture('Two monitors');
        fresh.windows = fresh.windows.filter(win => win.appId === 'org.example.WindowKeepTest.desktop');
        if (fresh.windows.length !== 2 || new Set(fresh.windows.map(win => win.monitor)).size !== 2)
            throw new Error(`Multi-monitor capture failed: ${JSON.stringify(fresh.windows)}`);
        for (const win of appWindows) win.delete(global.get_current_time());
        await waitFor(() => !testWindows().length);
        let launchedResult;
        const launcher = new RestoreManager(ext.stateObj._settings, r => { launchedResult = r; });
        launcher.start(fresh);
        launcher.start(fresh);
        await waitFor(() => launchedResult !== undefined, 35000);
        if (launchedResult.state !== 'complete' || testWindows().length !== 2)
            throw new Error(`Fresh launch failed: ${JSON.stringify(launchedResult)}`);
        launcher.destroy();
        const currentPrimary = testWindows().find(win => win.get_monitor() === 0);
        const states = {...fresh, windows: [{...fresh.windows.find(win => win.monitor === 0), stableSequence: currentPrimary.get_stable_sequence(), maximized: 3, above: true, sticky: true}]};
        let stateResult;
        const stateRestore = new RestoreManager(ext.stateObj._settings, r => { stateResult = r; });
        stateRestore.start(states);
        await waitFor(() => stateResult !== undefined, 35000);
        const stateWindow = testWindows().find(win => win.get_monitor() === 0);
        if (stateResult.state !== 'complete' || !stateWindow.is_above() || !stateWindow.is_on_all_workspaces() || stateWindow.get_maximize_flags() !== 3)
            throw new Error(`State restore failed: ${JSON.stringify(stateResult)} actual=${JSON.stringify({above: stateWindow.is_above(), sticky: stateWindow.is_on_all_workspaces(), flags: stateWindow.get_maximize_flags(), horizontal: stateWindow.maximized_horizontally, vertical: stateWindow.maximized_vertically})}`);
        stateRestore.destroy();
        let resetResult;
        const resetRestore = new RestoreManager(ext.stateObj._settings, r => { resetResult = r; });
        resetRestore.start(fresh);
        await waitFor(() => resetResult !== undefined, 35000);
        if (resetResult.state !== 'complete') throw new Error(`Unmaximize restore failed: ${JSON.stringify(resetResult)}`);
        resetRestore.destroy();
        print('WINDOWKEEP_STATE_PASS');
        const stageDemoWindows = async () => {
            if (!GLib.getenv('WINDOWKEEP_DOC_SCREENSHOTS')) return;
            for (const [index, win] of testWindows().entries()) {
                win.change_workspace(global.workspace_manager.get_active_workspace());
                win.move_to_monitor(0);
                win.unminimize();
                win.move_resize_frame(true, 55 + index * 330, 90 + index * 100, 620, 460);
                win.activate(global.get_current_time());
            }
            await Scripting.sleep(500);
        };
        await stageDemoWindows();
        fresh.windows = (await capture('Research workspace', new Set(testWindows()))).windows;
        fresh.name = 'Research workspace';
        (await store.write(fresh));
        Main.overview.hide();
        await Scripting.waitLeisure();
        ext.stateObj._indicator.menu.open();
        await ext.stateObj._refresh();
        ext.stateObj._indicator.menu._getMenuItems().find(item => item.label?.text.startsWith('Research workspace'))?.menu.open();
        await Scripting.sleep(400);
        await screenshot(`${GLib.getenv('WINDOWKEEP_REAL_SOURCE')}/docs/panel.png`);
        ext.stateObj._indicator.menu.close();
        if (GLib.getenv('WINDOWKEEP_DOC_SCREENSHOTS')) {
            for (const [type, filename] of [[0, 'logout-reminder'], [1, 'shutdown-reminder']]) {
                await Main.endSessionDialog.OpenAsync([type, global.get_current_time(), 60, []], {
                    return_value() {},
                    return_error_literal(_domain, _code, message) { throw new Error(message); },
                });
                await Scripting.sleep(400);
                await screenshot(`${GLib.getenv('WINDOWKEEP_REAL_SOURCE')}/docs/${filename}.png`);
                Main.endSessionDialog.cancel();
                await Scripting.sleep(400);
            }
        }
        const prefsProcess = Gio.Subprocess.new(['gjs', '-m', `${GLib.getenv('WINDOWKEEP_REAL_SOURCE')}/tests/prefs-smoke.js`], Gio.SubprocessFlags.NONE);
        await waitFor(() => allWindows().some(win => win.get_title() === 'WindowKeep Preferences' && win.mapped));
        const prefsWindow = allWindows().find(win => win.get_title() === 'WindowKeep Preferences');
        prefsWindow.change_workspace(global.workspace_manager.get_active_workspace());
        prefsWindow.activate(global.get_current_time());
        await Scripting.sleep(400);
        await Scripting.waitLeisure();
        await screenshot(`${GLib.getenv('WINDOWKEEP_REAL_SOURCE')}/docs/preferences.png`);
        if (GLib.getenv('WINDOWKEEP_DOC_SCREENSHOTS')) {
            await Scripting.sleep(3500);
            await screenshot(`${GLib.getenv('WINDOWKEEP_REAL_SOURCE')}/docs/settings.png`);
            await Scripting.sleep(4000);
            await screenshot(`${GLib.getenv('WINDOWKEEP_REAL_SOURCE')}/docs/advanced.png`);
        }
        await new Promise((resolve, reject) => prefsProcess.wait_check_async(null, (proc, result) => {
            try { proc.wait_check_finish(result); resolve(); } catch (error) { reject(error); }
        }));
        await stageDemoWindows();
        const cliSave = (await cli(root, 'save', 'D-Bus smoke')).trim();
        const listing = JSON.parse(await cli(root, 'list'));
        if (!listing.profiles.some(p => p.id === cliSave)) throw new Error('D-Bus save/list failed');
        await cli(root, 'rename', cliSave, 'D-Bus renamed');
        const copyId = (await cli(root, 'duplicate', cliSave, 'D-Bus copy')).trim();
        await cli(root, 'export', copyId, `${GLib.get_user_data_dir()}/export.json`);
        const importId = (await cli(root, 'import', `${GLib.get_user_data_dir()}/export.json`)).trim();
        const operation = JSON.parse(await cli(root, 'restore', cliSave));
        await waitFor(() => !ext.stateObj._restore.operation, 35000);
        const status = JSON.parse(await cli(root, 'status'));
        if (status.id !== operation.id || status.state !== 'complete') throw new Error(`D-Bus restore failed: ${JSON.stringify(status)}`);
        for (const id of [cliSave, copyId, importId]) await cli(root, 'delete', id);
        // Validate bounded timeout, launch suppression and cancellation cleanup.
        const missing = {...fresh, id: GLib.uuid_string_random(), windows: [{...fresh.windows[0], id: GLib.uuid_string_random(), appId: 'missing-windowkeep.desktop', wmClass: 'MissingWindowKeep', command: null}]};
        ext.stateObj._settings.set_uint('restore-timeout', 5);
        let missingResult;
        const missingRestore = new RestoreManager(ext.stateObj._settings, r => { missingResult = r; });
        const missingStart = missingRestore.start(missing);
        if (missingRestore.start(missing).id !== missingStart.id) throw new Error('Missing-app lock failed');
        await waitFor(() => missingResult !== undefined);
        if (missingResult.state !== 'partial' || missingResult.unresolved.length !== 1) throw new Error('Missing-app timeout failed');
        missingRestore.start(missing);
        if (!missingRestore.operation.warnings.size) throw new Error('Unresolved launch was not suppressed');
        const cancelOp = missingRestore.operation;
        missingRestore.destroy();
        if (missingRestore.operation || cancelOp.signals.items.length || cancelOp.workspaceUpdatesBlocked && Main.wm._blockCount < 1) throw new Error('Cancellation cleanup failed');
        const panelBefore = (await store.list()).profiles.length;
        await stageDemoWindows();
        await ext.stateObj._reviewSave('Research workspace');
        if (GLib.getenv('WINDOWKEEP_DOC_SCREENSHOTS')) {
            await Scripting.sleep(500);
            await screenshot(`${GLib.getenv('WINDOWKEEP_REAL_SOURCE')}/docs/save-review.png`);
        }
        if (!ext.stateObj._saveDialog || (await store.list()).profiles.length !== panelBefore) throw new Error('Panel save skipped review');
        ext.stateObj._saveDialog.buttonLayout.get_children()[0].emit('clicked', 1);
        if (ext.stateObj._saveDialog || (await store.list()).profiles.length !== panelBefore) throw new Error('Panel cancel wrote a profile');
        const prompt = ext.stateObj._shutdownPrompt;
        ext.stateObj._settings.set_boolean('ask-save-before-exit', false);
        if (prompt.actor.visible) throw new Error('Shutdown prompt toggle did not hide');
        ext.stateObj._settings.set_boolean('ask-save-before-exit', true);
        if (!prompt.actor.visible || prompt.actor.get_parent() !== Main.endSessionDialog.contentLayout) throw new Error('Shutdown prompt not attached');
        const {ShutdownPrompt} = await import(`file://${root}/shutdownPrompt.js`);
        const St = (await import('gi://St')).default;
        let cancelled = false;
        let reviewedAfterCancel = false;
        const callbacks = new Map();
        let signalId = 0;
        const fakeExit = {
            _type: 0, contentLayout: new St.BoxLayout(),
            connect(signal, callback) { callbacks.set(++signalId, {signal, callback}); return signalId; },
            disconnect(id) { callbacks.delete(id); },
            cancel() {
                cancelled = true;
                for (const value of [...callbacks.values()]) if (value.signal === 'closed') value.callback();
            },
        };
        const exitPrompt = new ShutdownPrompt(fakeExit, ext.stateObj._settings, () => { reviewedAfterCancel = cancelled; }, text => text);
        exitPrompt.button.emit('clicked', 1);
        if (!cancelled || !reviewedAfterCancel) throw new Error('Exit was not cancelled before review');
        exitPrompt.destroy();
        fakeExit.contentLayout.destroy();
        print('WINDOWKEEP_EXIT_REVIEW_FLOW_PASS');
        const beforeSave = (await store.list()).profiles.length;
        await ext.stateObj._reviewSave('My research project', false, 0);
        const reviewDialog = ext.stateObj._saveDialog;
        const review = reviewDialog._windowkeepReview;
        review.name.set_text('Reviewed research project');
        const beforeRemove = review.draft().windows.length;
        if (!review.rows.some(row => row.hasPreview)) throw new Error('No live window previews created');
        review.rows[0].button.checked = false;
        review.rows[0].button.emit('clicked', 1);
        if (review.draft().windows.length !== beforeRemove - 1) throw new Error('Review removal failed');
        print('WINDOWKEEP_LIVE_PREVIEWS_PASS');
        reviewDialog.buttonLayout.get_children()[1].emit('clicked', 1);
        await waitFor(() => !review.actor.visible);
        if ((await store.list()).profiles.length !== beforeSave + 1 || review.actor.visible) throw new Error('Exit review save failed');
        if (!(await store.list()).profiles.some(p => p.name === 'Reviewed research project')) throw new Error('Editable shutdown name not saved');
        reviewDialog.buttonLayout.get_children()[0].emit('clicked', 1);
        if (ext.stateObj._saveDialog) throw new Error('Saved confirmation did not close');
        ext.stateObj._settings.set_boolean('ask-at-login', true);
        ext.stateObj._settings.set_boolean('restore-at-login', true);
        const loginReply = await cli(root, 'login');
        if (GLib.getenv('WINDOWKEEP_DOC_SCREENSHOTS')) {
            await Scripting.sleep(500);
            await screenshot(`${GLib.getenv('WINDOWKEEP_REAL_SOURCE')}/docs/login-chooser.png`);
        }
        if (!ext.stateObj._loginDialog || !loginReply.includes('asking')) throw new Error('Login chooser did not take priority');
        if (ext.stateObj._restore.operation) throw new Error('Login chooser restored automatically');
        if (ext.stateObj._loginDialog.buttonLayout.get_children()[1].reactive) throw new Error('Load must require a selection');
        ext.stateObj._loginDialog.buttonLayout.get_children()[0].emit('clicked', 1);
        if (ext.stateObj._loginDialog || ext.stateObj._restore.operation) throw new Error('Keep desktop unchanged failed');
        print('WINDOWKEEP_LOGIN_CHOOSER_PASS');
        if (GLib.getenv('WINDOWKEEP_DOC_SCREENSHOTS')) {
            await store.remove(fresh.id);
            for (const saved of (await store.list()).profiles)
                if (saved.name === 'Reviewed research project') await store.remove(saved.id);
        }
        const project = await capture('Research workspace', new Set(testWindows()));
        (await store.write(project));
        const count = testWindows().length;
        if (!ext.stateObj._projects.state(project).active) throw new Error('Open saved layout is not active');
        await ext.stateObj._refresh();
        const savedDropdown = ext.stateObj._indicator.menu._getMenuItems().find(item => item.label?.text === 'Saved layouts');
        if (!savedDropdown || savedDropdown.menu.isOpen) throw new Error('Saved layouts must start collapsed');
        await ext.stateObj._projects.collapse(project.id);
        if (GLib.getenv('WINDOWKEEP_DOC_SCREENSHOTS')) {
            await ext.stateObj._refresh();
            ext.stateObj._indicator.menu.open();
            await ext.stateObj._refresh();
            ext.stateObj._indicator.menu._getMenuItems().find(item => item.label?.text.startsWith('Research workspace'))?.menu.open();
            await Scripting.sleep(400);
            await screenshot(`${GLib.getenv('WINDOWKEEP_REAL_SOURCE')}/docs/collapsed-layout.png`);
            ext.stateObj._indicator.menu.close();
            await ext.stateObj._projects.resume(project.id);
            await stageDemoWindows();
            await ext.stateObj._projectAction(project.id, true);
            await Scripting.sleep(400);
            await screenshot(`${GLib.getenv('WINDOWKEEP_REAL_SOURCE')}/docs/save-close.png`);
            ext.stateObj._closeDialog.buttonLayout.get_children()[0].emit('clicked', 1);
            await ext.stateObj._projects.collapse(project.id);
        }
        await waitFor(() => testWindows().every(win => win.minimized));
        await ext.stateObj._projects.collapse(project.id);
        if (!ext.stateObj._projects.state(project).collapsed) throw new Error('Collapsed status missing');
        await ext.stateObj._projects.resume(project.id);
        await waitFor(() => testWindows().every(win => !win.minimized));
        const oldLogin = {...project, id: GLib.uuid_string_random(), login: 'other-session'};
        (await store.write(oldLogin));
        let refused = false;
        try { await ext.stateObj._projects.collapse(oldLogin.id); } catch (_) { refused = true; }
        if (!refused) throw new Error('Older profile was allowed to hide windows');
        const {SaveReview} = await import(`file://${root}/saveReview.js`);
        const unrelatedLauncher = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.NONE});
        unrelatedLauncher.setenv('WINDOWKEEP_TEST_APP_ID', 'org.example.WindowKeepUnrelated', true);
        unrelatedLauncher.spawnv(['/usr/bin/python3', `${GLib.getenv('WINDOWKEEP_REAL_SOURCE')}/tests/test-app.py`]);
        await waitFor(() => allWindows().some(win => win.get_gtk_application_id() === 'org.example.WindowKeepUnrelated'));
        const closingReview = new SaveReview(project, message => message);
        const requests = await ext.stateObj._projects.close(project.id);
        if (requests !== count) throw new Error('Project close count mismatch');
        await waitFor(() => testWindows().length === 0);
        closingReview.destroy();
        if (ext.stateObj._projects.state(project).active) throw new Error('Closed layout still active');
        print('WINDOWKEEP_ACTIVE_LAYOUTS_PASS');
        if (!allWindows().some(win => win.get_gtk_application_id() === 'org.example.WindowKeepUnrelated')) throw new Error('Unrelated window was closed');
        (await store.remove(project.id));
        (await store.remove(oldLogin.id));
        print('WINDOWKEEP_PROJECT_ACTIONS_PASS');
        print('WINDOWKEEP_SHUTDOWN_PROMPT_PASS');
        print('WINDOWKEEP_DBUS_LIFECYCLE_PASS');
        print(`WINDOWKEEP_LAUNCH_PASS ${JSON.stringify(launchedResult)}`);
        if (!GLib.getenv('WINDOWKEEP_DOC_SCREENSHOTS')) (await store.remove(fresh.id));
        (await store.remove(profile.id));
        print(`WINDOWKEEP_SMOKE_PASS ${JSON.stringify(result)}`);
    } finally {
        Main.wm.unblockWorkspaceUpdates();
        const pendingRefresh = ext.stateObj._refresh();
        await Main.extensionManager._callExtensionDisable(ext);
        try { await pendingRefresh; } catch (error) {
            if (!error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) throw error;
        }
        if (Gio.File.new_for_path(`${GLib.get_user_config_dir()}/autostart/windowkeep.desktop`).query_exists(null))
            throw new Error('Autostart entry survived disable');
        if (ext.stateObj._settings || ext.stateObj._indicator || ext.stateObj._store)
            throw new Error('Extension resources survived disable');
        print('WINDOWKEEP_DISABLE_CLEANUP_PASS');
    }
}

async function waitFor(predicate, timeout = 10000) {
    const end = GLib.get_monotonic_time() + timeout * 1000;
    while (!predicate()) {
        if (GLib.get_monotonic_time() > end) throw new Error('Test condition deadline reached');
        await Scripting.sleep(50);
    }
}
async function screenshot(path) {
    if (!GLib.getenv('WINDOWKEEP_DOC_SCREENSHOTS')) return;
    const shot = new Shell.Screenshot();
    const stream = Gio.File.new_for_path(path).replace(null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
    try {
        await new Promise((resolve, reject) => shot.screenshot_area(Main.layoutManager.primaryMonitor.x, Main.layoutManager.primaryMonitor.y, Main.layoutManager.primaryMonitor.width, Main.layoutManager.primaryMonitor.height, stream, (object, result) => {
            try { object.screenshot_area_finish(result); resolve(); } catch (error) { reject(error); }
        }));
    } finally { stream.close(null); }
}

async function cli(root, ...args) {
    const process = Gio.Subprocess.new(['/usr/bin/gjs', '-m', `${root}/scripts/windowkeep`, ...args], Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
    return new Promise((resolve, reject) => process.communicate_utf8_async(null, null, (proc, result) => {
        try {
            const [, stdout, stderr] = proc.communicate_utf8_finish(result);
            if (!proc.get_successful()) throw new Error(stderr);
            resolve(stdout);
        } catch (error) { reject(error); }
    }));
}
