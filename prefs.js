// SPDX-License-Identifier: GPL-3.0-or-later
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import {ProfileStore} from './store.js';
import {syncAutostart} from './login.js';
import {migrateSettings} from './settings.js';

export default class WindowKeepPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const _ = this.gettext.bind(this);
        const settings = this.getSettings();
        migrateSettings(settings, this.dir.get_child('schemas').get_path());
        const store = new ProfileStore();
        window.set_default_size(820, 720);
        const libraryPage = new Adw.PreferencesPage({name: 'layouts', title: _('Saved layouts'), icon_name: 'view-grid-symbolic'});
        const settingsPage = new Adw.PreferencesPage({name: 'settings', title: _('Settings'), icon_name: 'preferences-system-symbolic'});
        const advancedPage = new Adw.PreferencesPage({name: 'advanced', title: _('Advanced'), icon_name: 'applications-engineering-symbolic'});
        for (const page of [libraryPage, settingsPage, advancedPage]) window.add(page);
        window.set_visible_page_name(settings.get_string('preferences-page'));
        const options = new Adw.PreferencesGroup({title: _('Session behavior'), description: _('Layouts save window arrangements. Tabs, documents and terminal contents depend on each application’s restore support.')});
        settingsPage.add(options);
        const login = new Adw.ComboRow({title: _('At login'), subtitle: _('WindowKeep must be enabled in your desktop session.'), model: Gtk.StringList.new([_('Do nothing'), _('Ask which layout to load'), _('Restore last layout')])});
        let syncing = false;
        const syncLogin = () => {
            syncing = true;
            login.selected = settings.get_boolean('ask-at-login') ? 1 : settings.get_boolean('restore-at-login') ? 2 : 0;
            syncing = false;
        };
        syncLogin();
        login.connect('notify::selected', () => {
            if (syncing) return;
            const update = new Gio.Settings({settings_schema: settings.settings_schema});
            update.delay();
            update.set_boolean('ask-at-login', login.selected === 1);
            update.set_boolean('restore-at-login', login.selected === 2);
            update.apply();
        });
        options.add(login);
        const shutdown = new Adw.SwitchRow({title: _('Offer to save before leaving'), subtitle: _('Save and review cancels the pending logout or shutdown and opens review without a countdown. Forced shutdown and crashes cannot prompt.')});
        settings.bind('ask-save-before-exit', shutdown, 'active', Gio.SettingsBindFlags.DEFAULT);
        options.add(shutdown);
        const advanced = new Adw.PreferencesGroup({title: _('Application restoration')});
        advancedPage.add(advanced);
        const fallback = new Adw.SwitchRow({title: _('Use command fallback for apps without launchers'), subtitle: _('Runs saved process arguments when a desktop launcher is unavailable. Arguments may open files or perform actions. Imported layouts discard saved commands. The original environment and app contents cannot be recovered.')});
        settings.bind('allow-command-fallback', fallback, 'active', Gio.SettingsBindFlags.DEFAULT);
        advanced.add(fallback);
        const timeout = new Adw.SpinRow({title: _('Wait for applications (seconds)'), subtitle: _('Report missing windows after this time. Restoration starts immediately.'), adjustment: new Gtk.Adjustment({lower: 5, upper: 120, step_increment: 5})});
        settings.bind('restore-timeout', timeout, 'value', Gio.SettingsBindFlags.DEFAULT);
        advanced.add(timeout);
        const changed = settings.connect('changed', (_settings, key) => {
            if (!['ask-at-login', 'restore-at-login'].includes(key)) return;
            syncLogin();
            try { syncAutostart(settings.get_boolean('ask-at-login') || settings.get_boolean('restore-at-login'), this.path); }
            catch (error) { window.add_toast(new Adw.Toast({title: error.message})); }
        });
        let closed = false;
        window.connect('close-request', () => { closed = true; store.destroy(); settings.disconnect(changed); return false; });
        const tools = new Adw.PreferencesGroup({title: _('Find or import a layout')});
        libraryPage.add(tools);
        const search = new Gtk.SearchEntry({placeholder_text: _('Search saved layouts'), hexpand: true});
        const searchRow = new Adw.ActionRow({title: _('Search')});
        searchRow.add_suffix(search);
        tools.add(searchRow);
        const sort = new Adw.ComboRow({title: _('Sort by'), model: Gtk.StringList.new([_('Newest saved'), _('Oldest saved'), _('Last modified'), _('Name A–Z'), _('Name Z–A')])});
        settings.bind('layout-sort', sort, 'selected', Gio.SettingsBindFlags.DEFAULT);
        tools.add(sort);
        const profiles = new Adw.PreferencesGroup({title: _('Layout library'), description: _('Saved snapshots, not live status. See Active layouts in the panel for currently tracked windows.')});
        libraryPage.add(profiles);
        let rows = [];
        const guard = async fn => {
            try { await fn(); }
            catch (error) { if (!closed) window.add_toast(new Adw.Toast({title: error.message})); }
        };
        const chooser = (save, callback) => {
            const dialog = new Gtk.FileDialog({title: save ? _('Export layout') : _('Import layout')});
            if (save) dialog.set_initial_name('windowkeep.json');
            const finish = (_dialog, result) => {
                try {
                    const file = save ? dialog.save_finish(result) : dialog.open_finish(result);
                    if (file?.get_path()) guard(() => callback(file.get_path()));
                } catch (error) {
                    if (!error.matches(Gtk.DialogError, Gtk.DialogError.DISMISSED))
                        window.add_toast(new Adw.Toast({title: error.message}));
                }
            };
            if (save) dialog.save(window, null, finish);
            else dialog.open(window, null, finish);
        };
        let revision = 0;
        const rebuild = async () => {
            const current = ++revision;
            const result = await store.list();
            if (closed || current !== revision) return;
            for (const row of rows) profiles.remove(row);
            rows = [];
            const date = value => Date.parse(value) || 0;
            const ordered = [...result.profiles].sort((a, b) => {
                switch (sort.selected) {
                case 1: return date(a.createdAt) - date(b.createdAt);
                case 2: return date(b.modifiedAt ?? b.createdAt) - date(a.modifiedAt ?? a.createdAt);
                case 3: return a.name.localeCompare(b.name);
                case 4: return b.name.localeCompare(a.name);
                default: return date(b.createdAt) - date(a.createdAt);
                }
            });
            for (const p of ordered.filter(p => p.name.toLocaleLowerCase().includes(search.text.toLocaleLowerCase()))) {
                const row = new Adw.ExpanderRow({title: p.name, subtitle: `${p.windows.length} ${_('windows')} · ${sort.selected === 2 ? _('Modified') : _('Saved')} ${new Date(sort.selected === 2 ? (p.modifiedAt ?? p.createdAt) : p.createdAt).toLocaleString()}`});
                const name = new Adw.EntryRow({title: _('Layout name'), text: p.name});
                row.add_row(name);
                const actions = new Adw.ActionRow({title: _('Actions')});
                for (const [label, fn] of [
                    [_('Rename'), async () => { (await store.rename(p.id, name.text)); guard(rebuild); }],
                    [_('Duplicate'), async () => { (await store.duplicate(p.id, `${name.text} (${_('copy')})`)); guard(rebuild); }],
                    [_('Export'), () => chooser(true, async path => (await store.exportFile(p.id, path)))],
                    [_('Delete'), () => {
                        const dialog = new Adw.AlertDialog({heading: _('Delete saved layout?'), body: p.name});
                        dialog.add_response('cancel', _('Cancel'));
                        dialog.add_response('delete', _('Delete'));
                        dialog.set_response_appearance('delete', Adw.ResponseAppearance.DESTRUCTIVE);
                        dialog.connect('response', (_d, response) => guard(async () => {
                            if (response === 'delete') { (await store.remove(p.id)); guard(rebuild); }
                        }));
                        dialog.present(window);
                    }],
                ]) {
                    const button = new Gtk.Button({label, valign: Gtk.Align.CENTER});
                    button.connect('clicked', () => guard(fn));
                    actions.add_suffix(button);
                }
                row.add_row(actions);
                const details = new Adw.ExpanderRow({title: _('Technical details')});
                details.add_row(new Adw.ActionRow({title: _('Layout ID'), subtitle: p.id, subtitle_selectable: true}));
                row.add_row(details);
                profiles.add(row);
                rows.push(row);
            }
            if (!rows.length) {
                const empty = new Adw.ActionRow({title: search.text ? _('No matching layouts') : _('No saved layouts yet'), subtitle: _('Save a layout from the WindowKeep panel menu.')});
                profiles.add(empty);
                rows.push(empty);
            }
            if (result.errors.length)
                window.add_toast(new Adw.Toast({title: result.errors.join('; ')}));
        };
        const importRow = new Adw.ActionRow({title: _('Import saved layout (JSON)'), subtitle: _('Saved process commands are removed from imported layouts. Apps reopen through installed desktop launchers.')});
        const importButton = new Gtk.Button({label: _('Choose file'), valign: Gtk.Align.CENTER});
        importButton.connect('clicked', () => chooser(false, async path => { (await store.importFile(path)); guard(rebuild); }));
        importRow.add_suffix(importButton);
        tools.add(importRow);
        search.connect('search-changed', () => guard(rebuild));
        sort.connect('notify::selected', () => guard(rebuild));
        guard(rebuild);
    }
}
