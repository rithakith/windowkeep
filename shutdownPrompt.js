// SPDX-License-Identifier: GPL-3.0-or-later
import St from 'gi://St';

// Keep GNOME's timed confirmation compact. Cancel the pending exit before review.
export class ShutdownPrompt {
    constructor(dialog, settings, review, translate) {
        this.dialog = dialog;
        this.settings = settings;
        this.review = review;
        this._ = translate;
        this.actor = new St.BoxLayout({vertical: true, style: 'spacing: 12px; padding-top: 16px;'});
        const label = new St.Label({text: this._('Save your layout before leaving?')});
        label.clutter_text.line_wrap = true;
        this.actor.add_child(label);
        this.button = new St.Button({label: this._('Review and save…'), style_class: 'button', can_focus: true});
        this.actor.add_child(this.button);
        dialog.contentLayout.add_child(this.actor);
        this.skipNext = false;
        this.openedSignal = dialog.connect('opened', () => {
            if (this.skipNext) { this.actor.hide(); this.skipNext = false; }
            else this.sync();
        });
        this.closedSignal = 0;
        this.button.connect('clicked', () => {
            if (this.closedSignal) return;
            const type = dialog._type;
            // GNOME's own closed signal fires once the modal grab is released.
            this.closedSignal = dialog.connect('closed', () => {
                dialog.disconnect(this.closedSignal);
                this.closedSignal = 0;
                this.review(type);
            });
            dialog.cancel();
        });
        this.settingSignal = settings.connect('changed::ask-save-before-exit', () => this.sync());
        this.sync();
    }

    sync() {
        this.actor.visible = this.settings.get_boolean('ask-save-before-exit');
    }

    destroy() {
        if (this.closedSignal) this.dialog.disconnect(this.closedSignal);
        this.dialog.disconnect(this.openedSignal);
        this.settings.disconnect(this.settingSignal);
        this.actor.destroy();
        this.review = null;
        this.dialog = null;
        this.settings = null;
    }
}
