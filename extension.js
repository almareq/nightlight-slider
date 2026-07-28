// Night Light Slider -- a night light slider for the GNOME quick settings menu.
// Copyright (C) 2026 Alvaro Martin
//
// This program is free software; you can redistribute it and/or modify it
// under the terms of the GNU General Public License as published by the Free
// Software Foundation; either version 2 of the License, or (at your option)
// any later version.
//
// This program is distributed in the hope that it will be useful, but WITHOUT
// ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or
// FITNESS FOR A PARTICULAR PURPOSE.  See the GNU General Public License for
// more details.
//
// You should have received a copy of the GNU General Public License along with
// this program; if not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: GPL-2.0-or-later

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {QuickSlider, SystemIndicator} from 'resource:///org/gnome/shell/ui/quickSettings.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const SCHEMA = 'org.gnome.settings-daemon.plugins.color';
const TEMP_KEY = 'night-light-temperature';
const ENABLED_KEY = 'night-light-enabled';

// Matches the range and inverted direction of the Colour Temperature slider in
// Settings, so both show the same position for a given value. Nothing enforces
// this: the GSettings key is a plain uint with no range, and gnome-settings-
// daemon clamps to a much wider band. A value set outside it by other means
// just pins the slider at one end.
const MIN_KELVIN = 1700;
const MAX_KELVIN = 4700;

const ICON_ON = 'night-light-symbolic';
const ICON_OFF = 'night-light-disabled-symbolic';

const COLOR_BUS_NAME = 'org.gnome.SettingsDaemon.Color';
const COLOR_OBJECT_PATH = '/org/gnome/SettingsDaemon/Color';
const COLOR_IFACE = `
<node>
  <interface name="org.gnome.SettingsDaemon.Color">
    <method name="NightLightPreview">
      <arg type="u" name="duration" direction="in"/>
    </method>
  </interface>
</node>`;

// night-light-enabled being true does not mean the screen is actually tinted:
// a schedule (automatic by default) or DisabledUntilTomorrow can hold it off.
// Preview so dragging always shows an effect, as Settings does, with the same
// duration it uses.
const PREVIEW_SECONDS = 5;

const NightLightSlider = GObject.registerClass(
class NightLightSlider extends QuickSlider {
    _init() {
        super._init({
            iconName: ICON_ON,
            iconReactive: true,
            iconLabel: 'Toggle Night Light',
        });

        this.slider.accessible_name = 'Night Light Temperature';

        this._settings = new Gio.Settings({schema_id: SCHEMA});
        this._settingsIds = [
            this._settings.connect(`changed::${TEMP_KEY}`, () => this._syncSlider()),
            this._settings.connect(`changed::${ENABLED_KEY}`, () => this._syncIcon()),
        ];

        this.slider.connect('notify::value', () => this._onSliderChanged());
        this.connect('icon-clicked', () => {
            this._settings.set_boolean(ENABLED_KEY, !this._settings.get_boolean(ENABLED_KEY));
        });

        global.backend.get_monitor_manager().bind_property(
            'night-light-supported', this, 'visible',
            GObject.BindingFlags.SYNC_CREATE);

        const colorInfo = Gio.DBusInterfaceInfo.new_for_xml(COLOR_IFACE);
        this._cancellable = new Gio.Cancellable();
        this._colorProxy = new Gio.DBusProxy({
            g_connection: Gio.DBus.session,
            g_name: COLOR_BUS_NAME,
            g_object_path: COLOR_OBJECT_PATH,
            g_interface_name: colorInfo.name,
            g_interface_info: colorInfo,
        });
        this._colorProxy.init_async(GLib.PRIORITY_DEFAULT, this._cancellable)
            .catch(e => {
                if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                    console.error(`Night Light Slider: ${e.message}`);
            });

        this._syncSlider();
        this._syncIcon();
    }

    _toValue(kelvin) {
        return (MAX_KELVIN - kelvin) / (MAX_KELVIN - MIN_KELVIN);
    }

    _toKelvin(value) {
        return Math.round(MAX_KELVIN - value * (MAX_KELVIN - MIN_KELVIN));
    }

    _syncSlider() {
        const kelvin = this._settings.get_uint(TEMP_KEY);
        if (this._toKelvin(this.slider.value) === kelvin)
            return;

        this._blockWrite = true;
        this.slider.value = this._toValue(kelvin);
        this._blockWrite = false;
    }

    _syncIcon() {
        this.iconName = this._settings.get_boolean(ENABLED_KEY)
            ? ICON_ON : ICON_OFF;
    }

    _onSliderChanged() {
        if (this._blockWrite)
            return;

        if (!this._settings.get_boolean(ENABLED_KEY))
            this._settings.set_boolean(ENABLED_KEY, true);

        this._colorProxy?.NightLightPreviewAsync(PREVIEW_SECONDS).catch(() => {});

        this._settings.set_uint(TEMP_KEY, this._toKelvin(this.slider.value));
    }

    destroy() {
        this._cancellable?.cancel();
        this._cancellable = null;
        this._colorProxy = null;

        this._settingsIds?.forEach(id => this._settings.disconnect(id));
        this._settingsIds = null;
        this._settings = null;

        this.menu?.destroy();
        super.destroy();
    }
});

export default class NightLightSliderExtension extends Extension {
    enable() {
        this._indicator = new SystemIndicator();
        this._slider = new NightLightSlider();
        this._indicator.quickSettingsItems.push(this._slider);

        const quickSettings = Main.panel.statusArea.quickSettings;

        // Public entry point: adds the panel indicator and puts the slider in
        // the slot reserved for external items, ahead of the background apps.
        quickSettings.addExternalIndicator(this._indicator, 2);

        // Then move it under Brightness. At login the shell is still filling
        // the grid from its async _setupIndicators(), so the brightness item
        // is not a child yet and there is nothing to anchor to. Retry when the
        // menu is first opened -- by then the grid is always populated, and the
        // user cannot have seen the menu before that.
        this._placed = false;
        if (!this._placeUnderBrightness(quickSettings)) {
            this._openStateId = quickSettings.menu.connect('open-state-changed',
                (_, isOpen) => {
                    if (isOpen)
                        this._placeUnderBrightness(quickSettings);
                });
        }
    }

    // Reordering needs private internals, so it stays best effort: if the shell
    // renames them the slider simply keeps the position addExternalIndicator()
    // gave it, which is where external items are meant to go anyway.
    _placeUnderBrightness(quickSettings) {
        if (this._placed)
            return true;

        const grid = quickSettings.menu._grid;
        const brightness = quickSettings._brightness?.quickSettingsItems?.[0];
        if (!grid || !brightness || brightness.get_parent() !== grid)
            return false;

        grid.set_child_above_sibling(this._slider, brightness);
        this._placed = true;
        return true;
    }

    disable() {
        if (this._openStateId) {
            Main.panel.statusArea.quickSettings?.menu.disconnect(this._openStateId);
            this._openStateId = null;
        }
        this._placed = false;

        this._slider?.destroy();
        this._slider = null;

        this._indicator?.destroy();
        this._indicator = null;
    }
}
