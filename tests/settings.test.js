// SPDX-License-Identifier: GPL-3.0-or-later
import Gio from 'gi://Gio';
import {migrateSettings} from '../settings.js';
const path = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent().get_child('schemas').get_path();
const source = Gio.SettingsSchemaSource.new_from_directory(path, Gio.SettingsSchemaSource.get_default(), false);
const old = new Gio.Settings({settings_schema: source.lookup('org.gnome.shell.extensions.session-atlas', false)});
const current = new Gio.Settings({settings_schema: source.lookup('org.gnome.shell.extensions.windowkeep', false)});
function assert(value, message) { if (!value) throw new Error(message); }
old.set_boolean('restore-at-login', true);
old.set_boolean('ask-save-before-exit', false);
old.set_uint('restore-timeout', 60);
old.set_string('last-profile', 'saved-profile');
current.set_uint('restore-timeout', 15);
migrateSettings(current, path);
assert(current.get_boolean('restore-at-login'), 'login preference migrated');
assert(!current.get_boolean('ask-save-before-exit'), 'explicit false migrated');
assert(current.get_string('last-profile') === 'saved-profile', 'profile choice migrated');
assert(current.get_uint('restore-timeout') === 15, 'new preference preserved');
current.set_boolean('restore-at-login', false);
migrateSettings(current, path);
assert(!current.get_boolean('restore-at-login'), 'migration does not repeat');
assert(old.get_boolean('restore-at-login'), 'legacy settings remain intact');
print('Settings migration passed');
