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
// Preview so dragging always shows an effect, as Settings does. Every write
// restarts the preview, so this only governs how long the tint lingers after
// the drag stops.
const PREVIEW_SECONDS = 2;

// Upper bound on how often a drag is allowed to write. 10Hz still looks smooth.
const WRITE_INTERVAL_MS = 100;

const NightLightSlider = GObject.registerClass(
class NightLightSlider extends QuickSlider {
    _init() {
        super._init({
            iconName: ICON_ON,
            iconReactive: true,
        });

        // Drag bookkeeping. _blockWrite marks a handle move this slider caused
        // itself, so the change echoing back from GSettings is not read as the
        // user dragging; the other two bound how often that write happens.
        this._blockWrite = false;
        this._throttleId = null;
        this._pendingWrite = false;

        this._settings = new Gio.Settings({schema_id: SCHEMA});
        this._settingsIds = [
            this._settings.connect(`changed::${TEMP_KEY}`, () => this._syncSlider()),
            this._settings.connect(`changed::${ENABLED_KEY}`, () => this._syncIcon()),
        ];

        this.slider.connect('notify::value', () => this._onSliderChanged());
        this.connect('icon-clicked', () => {
            this._settings.set_boolean(ENABLED_KEY, !this._settings.get_boolean(ENABLED_KEY));
        });

        // The monitor manager outlives this slider, and a binding keeps writing
        // to its target for as long as that target is referenced -- which, after
        // destroy(), is until the collector gets to it. Hold on to the binding
        // so it can be dropped deterministically instead.
        this._supportedBinding = global.backend.get_monitor_manager().bind_property(
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
        // While a drag is being throttled the key trails the handle, so acting
        // on a change here would drag the handle back to a value the user has
        // already moved past. The drag wins; the final write reconciles them.
        if (this._throttleId)
            return;

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

    // A drag emits a notify::value per motion event -- around 60 for one sweep
    // of the bar. Writing each one rewrites the dconf database and broadcasts
    // changed:: to every listener on the schema. Write on the first movement so
    // the response is immediate, then at most once per interval, and always
    // flush the value the drag came to rest on.
    _onSliderChanged() {
        if (this._blockWrite)
            return;

        if (this._throttleId) {
            this._pendingWrite = true;
            return;
        }

        this._write();
        this._throttleId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, WRITE_INTERVAL_MS, () => {
            this._throttleId = null;
            if (this._pendingWrite) {
                this._pendingWrite = false;
                this._onSliderChanged();
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    _write() {
        if (!this._settings.get_boolean(ENABLED_KEY))
            this._settings.set_boolean(ENABLED_KEY, true);

        this._colorProxy?.NightLightPreviewAsync(PREVIEW_SECONDS).catch(() => {});

        this._settings.set_uint(TEMP_KEY, this._toKelvin(this.slider.value));
    }

    destroy() {
        if (this._throttleId)
            GLib.source_remove(this._throttleId);
        this._throttleId = null;
        this._pendingWrite = false;

        this._supportedBinding?.unbind();
        this._supportedBinding = null;

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
                (_menu, isOpen) => {
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
