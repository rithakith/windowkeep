// SPDX-License-Identifier: GPL-3.0-or-later
import Gio from 'gi://Gio';

// One-time migration. Preserve explicit WindowKeep choices and leave old values
// intact so an earlier installation can still be used during the transition.
export function migrateSettings(settings, schemaDirectory) {
    if (settings.get_boolean('settings-migrated'))
        return;
    const source = Gio.SettingsSchemaSource.new_from_directory(
        schemaDirectory, Gio.SettingsSchemaSource.get_default(), false);
    const legacySchema = source.lookup('org.gnome.shell.extensions.session-atlas', false);
    if (legacySchema) {
        const legacy = new Gio.Settings({settings_schema: legacySchema});
        for (const key of legacySchema.list_keys()) {
            if (!settings.settings_schema.has_key(key) || settings.get_user_value(key) !== null)
                continue;
            const value = legacy.get_user_value(key);
            if (value !== null)
                settings.set_value(key, value);
        }
    }
    settings.set_boolean('settings-migrated', true);
}
