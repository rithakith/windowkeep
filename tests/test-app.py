#!/usr/bin/python3
# SPDX-License-Identifier: GPL-3.0-or-later
import os
import gi
gi.require_version('Gtk', '4.0')
from gi.repository import Gio, Gtk
app = Gtk.Application(application_id=os.environ.get('WINDOWKEEP_TEST_APP_ID', 'org.example.WindowKeepTest'), flags=Gio.ApplicationFlags.NON_UNIQUE)
def activate(application):
    window = Gtk.ApplicationWindow(application=application, title='WindowKeep test window', default_width=640, default_height=480)
    if os.environ.get('WINDOWKEEP_DOC_SCREENSHOTS'):
        Gtk.Settings.get_default().set_property('gtk-application-prefer-dark-theme', True)
        window.set_title('Research notes — Demo project')
        box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=16,
                      margin_top=24, margin_bottom=24, margin_start=24, margin_end=24)
        heading = Gtk.Label(label='Research workspace', xalign=0)
        heading.add_css_class('title-1')
        box.append(heading)
        box.append(Gtk.Label(label='Sample project · Documentation demo', xalign=0))
        notes = Gtk.TextView(editable=False, cursor_visible=False, wrap_mode=Gtk.WrapMode.WORD_CHAR,
                            vexpand=True, top_margin=18, left_margin=18, right_margin=18)
        notes.get_buffer().set_text('PROJECT NOTES\n\nWindow layouts for focused work\n\n• Read the GNOME documentation\n• Compare workspace arrangements\n• Write up findings\n\nNext: save this workspace as a named layout.\n\nThese are sample notes for the screenshots.')
        box.append(notes)
        window.set_child(box)
    else:
        window.set_child(Gtk.Label(label='Isolated session restore test'))
    window.present()
app.connect('activate', activate)
app.run(None)
