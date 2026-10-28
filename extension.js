// SPDX-License-Identifier: GPL-3.0-or-later
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as SystemActions from 'resource:///org/gnome/shell/misc/systemActions.js';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {capture} from './capture.js';
import {Projects} from './projects.js';
import {SaveReview} from './saveReview.js';
import {ProfileStore} from './store.js';
import {RestoreManager} from './restore.js';
import {syncAutostart} from './login.js';
import {migrateSettings} from './settings.js';
import {ShutdownPrompt} from './shutdownPrompt.js';

const INTERFACE = `<node><interface name="org.gnome.Shell.Extensions.WindowKeep">
<method name="List"><arg type="s" direction="out"/></method>
<method name="Save"><arg type="s" direction="in"/><arg type="s" direction="out"/></method>
<method name="Restore"><arg type="s" direction="in"/><arg type="s" direction="out"/></method>
<method name="Login"><arg type="s" direction="out"/></method>
<method name="Status"><arg type="s" direction="out"/></method>
<method name="Rename"><arg type="s" direction="in"/><arg type="s" direction="in"/></method>
<method name="Delete"><arg type="s" direction="in"/></method>
<method name="Duplicate"><arg type="s" direction="in"/><arg type="s" direction="in"/><arg type="s" direction="out"/></method>
<method name="Import"><arg type="s" direction="in"/><arg type="s" direction="out"/></method>
<method name="Export"><arg type="s" direction="in"/><arg type="s" direction="in"/></method>
</interface></node>`;

export default class WindowKeep extends Extension {
    enable() {
        this._settings = this.getSettings();
        migrateSettings(this._settings, this.dir.get_child('schemas').get_path());
        this._store = new ProfileStore();
        this._projects = new Projects(this._store);
        this._closeDialog = null;
        this._loginDialog = null;
        this._saveDialog = null;
        this._restore = new RestoreManager(this._settings, result => {
            if (result.state !== 'cancelled') {
                this._projects.bind(result.profile, result.members ?? []);
                Main.notify(this.gettext('WindowKeep'), `${this.gettext('Restore finished')}: ${result.restored}/${result.total}\n${[...(result.unresolvedWindows ?? []).map(w => `${this.gettext('Not restored')}: ${w.title || w.appId}`), ...result.warnings, ...result.failures].join('\n')}`);
            }
        }, this.gettext.bind(this));
        this._indicator = new PanelMenu.Button(0.0, this.gettext('WindowKeep'));
        this._indicator.add_child(new St.Icon({gicon: Gio.FileIcon.new(this.dir.get_child('icons').get_child('windowkeep-symbolic.svg')), style_class: 'system-status-icon'}));
        this._menuSignal = this._indicator.menu.connect('open-state-changed', (_menu, open) => {
            if (open) this._guard(() => this._refresh());
        });
        Main.panel.addToStatusArea(this.uuid, this._indicator);
        const handlers = {
            Login: async () => this._handleLogin(),
            List: async () => JSON.stringify(await this._store.list()),
            Save: async name => (await this._save(name)).id,
            Restore: async id => JSON.stringify(await this._start(id)),
            Status: async () => JSON.stringify(this._restore.status()),
            Rename: async (id, name) => { await this._store.rename(id, name); },
            Delete: async id => { await this._store.remove(id); },
            Duplicate: async (id, name) => (await this._store.duplicate(id, name)).id,
            Import: async path => (await this._store.importFile(path)).id,
            Export: async (id, path) => { await this._store.exportFile(id, path); },
        };
        const methods = {};
        for (const [name, handler] of Object.entries(handlers)) {
            methods[`${name}Async`] = async (args, invocation) => {
                try {
                    const value = await handler(...args);
                    invocation.return_value(new GLib.Variant(value === undefined ? '()' : '(s)', value === undefined ? [] : [value]));
                } catch (error) {
                    invocation.return_dbus_error('org.gnome.Shell.Extensions.WindowKeep.Error', error.message);
                }
            };
        }
        this._dbus = Gio.DBusExportedObject.wrapJSObject(INTERFACE, methods);
        this._dbus.export(Gio.DBus.session, '/org/gnome/Shell/Extensions/WindowKeep');
        this._loginSignal = this._settings.connect('changed', () => this._syncLogin());
        this._syncLogin();
        this._shutdownPrompt = new ShutdownPrompt(Main.endSessionDialog, this._settings, type => this._guard(async () => {
            let name = '';
            try { name = (await this._store.read(this._settings.get_string('last-profile'))).name; } catch (_) { /* New layout. */ }
            if (!this._settings) return;
            this._reviewSave(name.startsWith('Before shutdown ') ? '' : name, false, type);
        }), this.gettext.bind(this));
        this._guard(() => this._refresh());
    }

    _syncLogin() {
        try {
            syncAutostart(this._settings.get_boolean('ask-at-login') || this._settings.get_boolean('restore-at-login'), this.path);
        } catch (error) {
            Main.notifyError(this.gettext('WindowKeep'), error.message);
        }
    }

    async _handleLogin() {
        if (!this._settings.get_boolean('ask-at-login')) {
            const id = this._settings.get_string('last-profile');
            if (this._settings.get_boolean('restore-at-login') && id)
                return JSON.stringify(await this._start(id));
            return 'unchanged';
        }
        if (this._loginDialog)
            return 'asking';
        const {profiles} = (await this._store.list());
        if (!this._settings) return 'unchanged';
        if (!profiles.length)
            return 'unchanged';
        const dialog = new ModalDialog.ModalDialog();
        this._loginDialog = dialog;
        dialog.dialogLayout.set_style('width: 600px; padding: 28px;');
        const heading = new St.Label({text: this.gettext('Start with a saved layout?'), style: 'font-size: 1.3em; font-weight: bold;'});
        dialog.contentLayout.add_child(heading);
        const explanation = new St.Label({text: this.gettext('Select a layout to reopen apps and arrange windows, or continue with your current desktop.')});
        explanation.clutter_text.line_wrap = true;
        dialog.contentLayout.add_child(explanation);
        const list = new St.BoxLayout({vertical: true, style: 'spacing: 10px; padding-top: 12px; padding-bottom: 12px;'});
        const scroll = new St.ScrollView({style: 'max-height: 320px;'});
        scroll.set_child(list);
        dialog.contentLayout.add_child(scroll);
        const dismiss = () => { dialog.destroy(); this._loginDialog = null; };
        let selected = null;
        const choices = [];
        let loadButton;
        for (const profile of profiles) {
            const button = new St.Button({can_focus: true, x_expand: true});
            const content = new St.BoxLayout({vertical: true, style: 'spacing: 5px;'});
            const name = new St.Label({text: profile.name, style: 'font-weight: bold;', x_align: 1});
            name.clutter_text.line_wrap = true;
            content.add_child(name);
            content.add_child(new St.Label({text: `${profile.windows.length} ${this.gettext('windows')} · ${this.gettext('Saved')} ${new Date(profile.createdAt).toLocaleString()}`, style: 'font-size: 0.9em; color: #b8b8bd;', x_align: 1}));
            button.set_child(content);
            const paint = () => button.set_style(`padding: 14px; border-radius: 10px; border: 2px solid ${selected === profile.id ? '#78aeed' : 'transparent'}; background-color: rgba(128,128,128,0.12);`);
            choices.push(paint);
            paint();
            button.connect('clicked', () => {
                selected = profile.id;
                choices.forEach(update => update());
                loadButton.reactive = true;
                loadButton.can_focus = true;
            });
            list.add_child(button);
        }
        dialog.setButtons([
            {label: this.gettext('Keep desktop as it is'), action: dismiss},
            {label: this.gettext('Load layout'), action: () => {
                if (!selected) return;
                dismiss();
                this._guard(() => this._start(selected));
            }},
        ]);
        loadButton = dialog.buttonLayout.get_children()[1];
        loadButton.reactive = false;
        loadButton.can_focus = false;
        dialog.open();
        return 'asking';
    }

    async _guard(callback) {
        try {
            await callback();
        } catch (error) {
            if (this._settings) Main.notifyError(this.gettext('WindowKeep'), error.message);
        }
    }

    _save(name, workspaceOnly = false) {
        return this._commitSave(capture(name, workspaceOnly ? new Set(global.workspace_manager.get_active_workspace().list_windows()) : null));
    }

    async _commitSave(draft) {
        const profile = (await this._store.write(draft));
        if (!this._settings) throw new Error('WindowKeep disabled');
        this._settings.set_string('last-profile', profile.id);
        Main.notify(this.gettext('WindowKeep'), `${this.gettext('Saved windows')}: ${profile.windows.length} — ${profile.name}`);
        return profile;
    }

    _reviewSave(name, workspaceOnly = false, exitType = null) {
        if (this._saveDialog) return;
        const draft = capture(name || this.gettext('My workspace'), workspaceOnly ? new Set(global.workspace_manager.get_active_workspace().list_windows()) : null);
        const dialog = new ModalDialog.ModalDialog();
        this._saveDialog = dialog;
        const review = new SaveReview(draft, this.gettext.bind(this));
        dialog._windowkeepReview = review;
        dialog.dialogLayout.set_style(`width: ${review.width}px; padding: 24px;`);
        dialog.contentLayout.add_child(new St.Label({text: this.gettext('Review saved layout')}));
        dialog.contentLayout.add_child(review.actor);
        const errorLabel = new St.Label();
        errorLabel.clutter_text.line_wrap = true;
        dialog.contentLayout.add_child(errorLabel);
        const dismiss = () => { review.destroy(); dialog.destroy(); this._saveDialog = null; };
        dialog.setButtons([
            {label: this.gettext('Cancel'), action: dismiss},
            {label: this.gettext('Save layout'), action: async () => {
                if (dialog._saving) return;
                dialog._saving = true;
                try {
                    const profile = await this._commitSave(review.draft());
                    if (!this._settings || this._saveDialog !== dialog) return;
                    if (exitType === null) { dismiss(); return; }
                    review.actor.hide();
                    errorLabel.text = `${this.gettext('Layout saved')} — ${profile.name}
${this.gettext('Your windows are still open. Continue when you are ready.')}`;
                    const actions = SystemActions.getDefault();
                    const next = exitType === 0 ? [this.gettext('Log Out…'), () => actions.activateLogout()] :
                        exitType === 1 ? [this.gettext('Shut Down…'), () => actions.activatePowerOff()] :
                            [this.gettext('Restart…'), () => actions.activateRestart()];
                    dialog.setButtons([
                        {label: this.gettext('Done'), action: dismiss},
                        {label: next[0], action: () => { dismiss(); this._shutdownPrompt.skipNext = true; next[1](); }},
                    ]);
                }
                catch (error) { if (this._saveDialog === dialog) errorLabel.text = error.message; }
                finally { dialog._saving = false; }
            }},
        ]);
        this._indicator.menu.close();
        dialog.open();
    }

    async _start(id) {
        if (this._restore.operation)
            return this._restore.status();
        const profile = (await this._store.read(id));
        if (!this._settings) throw new Error('WindowKeep disabled');
        this._settings.set_string('last-profile', id);
        return this._restore.start(profile);
    }

    async _projectAction(id, close) {
        if (this._restore.operation)
            throw new Error(this.gettext('Wait for the current restore to finish.'));
        if (!close) {
            const count = await this._projects.collapse(id);
            if (!this._settings) return;
            Main.notify(this.gettext('WindowKeep'), `${count} ${this.gettext('windows minimized. Apps keep running and using resources.')}`);
            return;
        }
        if (this._closeDialog)
            return;
        const profile = (await this._store.read(id));
        if (!this._settings) throw new Error('WindowKeep disabled');
        const members = this._projects.members(profile);
        const profiles = (await this._store.list()).profiles;
        if (!this._settings) return;
        const shared = this._projects.shared(profile, profiles);
        const dialog = new ModalDialog.ModalDialog();
        this._closeDialog = dialog;
        dialog.contentLayout.add_child(new St.Label({text: `${this.gettext('Save and close this layout?')}
${profile.name} — ${members.length} ${this.gettext('windows')}`}));
        const explanation = new St.Label({text: this.gettext('Your layout will be saved before closing the windows. Apps may ask you to save unfinished work.')});
        explanation.clutter_text.line_wrap = true;
        dialog.contentLayout.add_child(explanation);
        if (shared.length) {
            const warning = new St.Label({text: `${this.gettext('Shared with other active layouts:')} ${shared.map(p => `${p.name} (${p.count})`).join(', ')}
${this.gettext('Closing these windows affects those layouts too.')}`});
            warning.clutter_text.line_wrap = true;
            dialog.contentLayout.add_child(warning);
        }
        const dismiss = () => { dialog.destroy(); this._closeDialog = null; };
        dialog.setButtons([
            {label: this.gettext('Cancel'), action: dismiss},
            {label: this.gettext('Save and close'), action: () => {
                dismiss();
                this._guard(async () => {
                    if (this._restore.operation)
                        throw new Error(this.gettext('Wait for the current restore to finish.'));
                    const requested = await this._projects.close(id);
                    if (!this._settings) return;
                    Main.notify(this.gettext('WindowKeep'), `${requested} ${this.gettext('close requests sent. Windows with unsaved-work prompts may remain open; check them before leaving.')}`);
                });
            }},
        ]);
        dialog.open();
    }

    async _refresh() {
        const store = this._store;
        const revision = this._menuRevision = (this._menuRevision ?? 0) + 1;
        const {profiles, errors} = await store.list();
        if (!this._settings || this._store !== store || this._menuRevision !== revision) return;
        const menu = this._indicator.menu;
        menu.removeAll();
        for (const [label, workspace] of [
            [this.gettext('Save entire desktop…'), false],
            [this.gettext('Save this workspace…'), true],
        ]) {
            const item = new PopupMenu.PopupMenuItem(label);
            item.connect('activate', () => this._guard(() => this._reviewSave('', workspace)));
            menu.addMenuItem(item);
        }
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const states = profiles.map(profile => ({profile, ...this._projects.state(profile)}));
        menu.addMenuItem(new PopupMenu.PopupMenuItem(this.gettext('Active layouts'), {reactive: false}));
        for (const state of states.filter(s => s.active)) {
            const {profile, windows, collapsed} = state;
            const status = collapsed ? this.gettext('Collapsed') : `${windows.length} ${this.gettext('windows')}`;
            const item = new PopupMenu.PopupSubMenuMenuItem(`${profile.name} · ${status}`);
            const shared = this._projects.shared(profile, profiles);
            if (shared.length)
                item.menu.addMenuItem(new PopupMenu.PopupMenuItem(`${this.gettext('Shared windows')}: ${shared.map(p => `${p.name} (${p.count})`).join(', ')}`, {reactive: false}));
            if (!collapsed)
                item.menu.addMenuItem(new PopupMenu.PopupMenuItem(this.gettext('Collapse hides windows; apps keep running.'), {reactive: false}));
            const actions = [
                collapsed
                    ? [this.gettext('Resume'), async () => { await this._projects.resume(profile.id); if (this._settings) await this._start(profile.id); }]
                    : [this.gettext('Collapse'), () => this._projectAction(profile.id, false)],
                [this.gettext('Save and close…'), () => this._projectAction(profile.id, true)],
            ];
            for (const [label, action] of actions) {
                const button = new PopupMenu.PopupMenuItem(label);
                button.connect('activate', () => this._guard(action));
                item.menu.addMenuItem(button);
            }
            menu.addMenuItem(item);
        }
        if (!states.some(s => s.active))
            menu.addMenuItem(new PopupMenu.PopupMenuItem(this.gettext('No active layouts'), {reactive: false}));
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const saved = new PopupMenu.PopupSubMenuMenuItem(this.gettext('Saved layouts'));
        for (const {profile} of states.filter(s => !s.active)) {
            const item = new PopupMenu.PopupMenuItem(`${profile.name} · ${profile.windows.length} ${this.gettext('windows')}`);
            item.connect('activate', () => this._guard(() => this._start(profile.id)));
            saved.menu.addMenuItem(item);
        }
        if (!states.some(s => !s.active))
            saved.menu.addMenuItem(new PopupMenu.PopupMenuItem(this.gettext('No inactive saved layouts'), {reactive: false}));
        menu.addMenuItem(saved);
        // Rebuilt on every menu opening: saved layouts always begin collapsed.
        saved.menu.close();
        if (errors.length)
            menu.addMenuItem(new PopupMenu.PopupMenuItem(this.gettext('Unreadable layouts; see CLI list'), {reactive: false}));
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        for (const [label, page] of [[this.gettext('Manage saved layouts…'), 'layouts'], [this.gettext('Settings…'), 'settings']]) {
            const item = new PopupMenu.PopupMenuItem(label);
            item.connect('activate', () => { this._settings.set_string('preferences-page', page); this.openPreferences(); });
            menu.addMenuItem(item);
        }
    }

    disable() {
        try { syncAutostart(false, this.path); }
        catch (error) { console.error(`WindowKeep: unable to remove login helper: ${error.message}`); }
        this._store.destroy();
        this._saveDialog?.destroy();
        this._saveDialog = null;
        this._loginDialog?.destroy();
        this._loginDialog = null;
        this._closeDialog?.destroy();
        this._closeDialog = null;
        this._projects.destroy();
        this._projects = null;
        this._shutdownPrompt.destroy();
        this._shutdownPrompt = null;
        this._settings.disconnect(this._loginSignal);
        this._dbus.unexport();
        this._dbus = null;
        this._restore.destroy();
        this._restore = null;
        this._indicator.menu.disconnect(this._menuSignal);
        this._indicator.destroy();
        this._indicator = null;
        this._store = null;
        this._settings = null;
    }
}
