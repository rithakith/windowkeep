// SPDX-License-Identifier: GPL-3.0-or-later
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import Pango from 'gi://Pango';
import * as CheckBox from 'resource:///org/gnome/shell/ui/checkBox.js';
import {allWindows, loginToken} from './capture.js';

// Shared editor for a captured draft. Removing a row never closes a live window.
export class SaveReview {
    constructor(profile, translate) {
        this.profile = profile;
        this._ = translate;
        this.excluded = new Set();
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        this.width = Math.max(280, Math.min(760, Main.layoutManager.primaryMonitor.width / scale - 96));
        this.actor = new St.BoxLayout({vertical: true, style: `spacing: 8px; width: ${this.width}px;`});
        this.name = new St.Entry({text: profile.name, hint_text: this._('Layout name'), can_focus: true, accessible_name: this._('Layout name')});
        this.actor.add_child(this.name);
        this.count = new St.Label();
        this.actor.add_child(this.count);
        const note = new St.Label({text: this._('Choose windows to save. Unchecking leaves the window open.')});
        note.clutter_text.line_wrap = true;
        this.actor.add_child(note);
        const info = new St.Button({label: this._('About these previews ▸'), can_focus: true});
        const infoText = new St.Label({text: this._('Live previews are not stored as screenshots. Individual browser tabs cannot be listed.'), visible: false});
        infoText.clutter_text.line_wrap = true;
        info.connect('clicked', () => { infoText.visible = !infoText.visible; });
        this.actor.add_child(info);
        this.actor.add_child(infoText);
        const columns = this.width >= 600 ? 2 : 1;
        const cardWidth = Math.floor((this.width - 44 - (columns - 1) * 12) / columns);
        const previewWidth = cardWidth - 20;
        const scroll = new St.ScrollView({style: 'max-height: 340px;'});
        const list = new St.BoxLayout({vertical: true, style: 'spacing: 12px;'});
        scroll.set_child(list);
        this.actor.add_child(scroll);
        this.rows = [];
        const live = profile.login === loginToken() ? new Map(allWindows().map(w => [w.get_stable_sequence(), w])) : new Map();
        const workspaces = [...new Set(profile.windows.map(w => w.workspace))].sort((a, b) => a - b);
        for (const workspace of workspaces) {
            list.add_child(new St.Label({text: `${this._('Workspace')} ${workspace + 1}`, style: 'font-weight: bold;'}));
            let line;
            const windows = profile.windows.filter(w => w.workspace === workspace);
            windows.forEach((w, index) => {
                if (index % columns === 0) {
                    line = new St.BoxLayout({style: 'spacing: 12px;'});
                    list.add_child(line);
                }
                const card = new St.BoxLayout({vertical: true, style: `width: ${cardWidth}px; padding: 10px; spacing: 6px; border-radius: 10px; background-color: rgba(128,128,128,0.12);`});
                const preview = new St.Bin({width: previewWidth, height: 140, style: 'background-color: rgba(0,0,0,0.25); border-radius: 6px;'});
                const window = live.get(w.stableSequence);
                const source = window?.get_compositor_private();
                const app = window ? Shell.WindowTracker.get_default().get_window_app(window) : null;
                const fallback = () => {
                    const box = new St.BoxLayout({vertical: true});
                    box.add_child(app ? app.create_icon_texture(48) : new St.Icon({icon_name: 'application-x-executable-symbolic', icon_size: 48}));
                    box.add_child(new St.Label({text: this._('Preview unavailable')}));
                    preview.set_child(box);
                };
                let sourceSignal = 0;
                if (source && source.width > 0 && source.height > 0) {
                    const scale = Math.min(previewWidth / source.width, 140 / source.height, 1);
                    const clone = new Clutter.Clone({source, width: source.width * scale, height: source.height * scale, x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER});
                    preview.set_child(clone);
                    sourceSignal = source.connect('destroy', () => {
                        sourceSignal = 0;
                        clone.set_source(null);
                        fallback();
                    });
                } else {
                    fallback();
                }
                card.connect('destroy', () => {
                    if (sourceSignal) source.disconnect(sourceSignal);
                    sourceSignal = 0;
                });
                card.add_child(preview);
                const title = w.title || w.appId || w.wmClass || this._('Untitled window');
                const button = new CheckBox.CheckBox(title);
                button.getLabelActor().width = previewWidth - 35;
                button.getLabelActor().clutter_text.set_line_wrap(true);
                button.getLabelActor().clutter_text.set_ellipsize(Pango.EllipsizeMode.END);
                button.checked = true;
                button.accessible_name = `${this._('Include window')}: ${title}`;
                button.connect('clicked', () => {
                    if (button.checked) this.excluded.delete(w.id);
                    else this.excluded.add(w.id);
                    preview.opacity = button.checked ? 255 : 90;
                    this.updateCount();
                });
                card.add_child(button);
                const detail = new St.BoxLayout({style: 'spacing: 6px;'});
                if (app) detail.add_child(app.create_icon_texture(16));
                const label = new St.Label({text: `${app?.get_name() || w.wmClass || this._('Application')} · ${this._('Monitor')} ${w.monitor + 1}`, style: 'font-size: 0.85em;'});
                label.width = previewWidth - (app ? 22 : 0);
                detail.add_child(label);
                card.add_child(detail);
                line.add_child(card);
                this.rows.push({button, window: w, preview, hasPreview: Boolean(source && source.width > 0 && source.height > 0)});
            });
        }
        this.updateCount();
    }

    updateCount() {
        this.count.text = `${this.profile.windows.length - this.excluded.size}/${this.profile.windows.length} ${this._('windows included')}`;
    }

    draft() {
        const name = this.name.get_text().trim();
        if (!name) throw new Error(this._('Enter a layout name.'));
        const windows = this.profile.windows.filter(w => !this.excluded.has(w.id));
        if (!windows.length) throw new Error(this._('Keep at least one window in the layout.'));
        return {...this.profile, name, windows};
    }

    destroy() {
        this.actor.destroy();
        this.rows = [];
        this.excluded.clear();
    }
}
