#!/usr/bin/python3
# SPDX-License-Identifier: GPL-3.0-or-later
import os
import gi
gi.require_version('Gtk', '4.0')
from gi.repository import Gio, Gtk
app = Gtk.Application(application_id=os.environ.get('WINDOWKEEP_TEST_APP_ID', 'org.example.WindowKeepTest'), flags=Gio.ApplicationFlags.NON_UNIQUE)
def activate(application):
    window = Gtk.ApplicationWindow(application=application, title='WindowKeep test window', default_width=640, default_height=480)
    window.set_child(Gtk.Label(label='Isolated session restore test'))
    window.present()
app.connect('activate', activate)
app.run(None)
