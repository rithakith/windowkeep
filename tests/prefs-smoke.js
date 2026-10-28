// SPDX-License-Identifier: GPL-3.0-or-later
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
const resource = Gio.Resource.load('/usr/share/gnome-shell/org.gnome.Shell.Extensions.src.gresource');
Gio.resources_register(resource);
const root = GLib.getenv('WINDOWKEEP_SOURCE');
const {default: Preferences} = await import(`file://${root}/prefs.js`);
const [, bytes] = GLib.file_get_contents(`${root}/metadata.json`);
const metadata = JSON.parse(new TextDecoder().decode(bytes));
const app = new Adw.Application({application_id: 'org.example.WindowKeepPreferencesSmoke'});
app.connect('activate', () => {
    if (GLib.getenv('WINDOWKEEP_DOC_SCREENSHOTS'))
        Adw.StyleManager.get_default().set_color_scheme(Adw.ColorScheme.FORCE_DARK);
    const window = new Adw.PreferencesWindow({application: app, title: 'WindowKeep Preferences', default_width: 900, default_height: 700});
    const preferences = new Preferences({...metadata, path: root, dir: Gio.File.new_for_path(root)});
    preferences.fillPreferencesWindow(window);
    window.present();
    const settings = preferences.getSettings();
    const find = (widget, predicate) => {
        if (predicate(widget)) return widget;
        for (let child = widget.get_first_child(); child; child = child.get_next_sibling()) {
            const match = find(child, predicate);
            if (match) return match;
        }
        return null;
    };
    window.set_visible_page_name('settings');
    const login = find(window, widget => widget instanceof Adw.ComboRow && widget.title === 'At login');
    if (!login) throw new Error('At login dropdown missing');
    for (const choice of [0, 2, 1]) {
        login.selected = choice;
        if (settings.get_boolean('ask-at-login') !== (choice === 1) || settings.get_boolean('restore-at-login') !== (choice === 2))
            throw new Error('Login dropdown persistence failed');
    }
    const shutdown = find(window, widget => widget instanceof Adw.SwitchRow && widget.title === 'Offer to save before leaving');
    shutdown.active = false;
    if (settings.get_boolean('ask-save-before-exit')) throw new Error('Bound settings stopped persisting after dropdown use');
    shutdown.active = true;
    for (const page of ['layouts', 'settings', 'advanced']) {
        window.set_visible_page_name(page);
        if (window.get_visible_page_name() !== page) throw new Error('Preferences page missing');
    }
    window.set_visible_page_name('layouts');
    print('WINDOWKEEP_PREFS_PASS');
    if (GLib.getenv('WINDOWKEEP_DOC_SCREENSHOTS')) {
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
            const row = find(window, widget => widget instanceof Adw.ExpanderRow && widget.title === 'Research workspace');
            if (!row) return GLib.SOURCE_CONTINUE;
            row.expanded = true;
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 400, () => {
                GLib.file_set_contents(`${GLib.get_user_runtime_dir()}/windowkeep-prefs-ready`, 'ready');
                return GLib.SOURCE_REMOVE;
            });
            return GLib.SOURCE_REMOVE;
        });
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 3000, () => { window.set_visible_page_name('settings'); return GLib.SOURCE_REMOVE; });
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 7000, () => { window.set_visible_page_name('advanced'); return GLib.SOURCE_REMOVE; });
    }
    GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, GLib.getenv('WINDOWKEEP_DOC_SCREENSHOTS') ? 12 : 4, () => {
        window.close();
        return GLib.SOURCE_REMOVE;
    });
});
await app.runAsync([]);
