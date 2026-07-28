import Gio from 'gi://Gio';
import GObject from 'gi://GObject';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {QuickSlider, SystemIndicator} from 'resource:///org/gnome/shell/ui/quickSettings.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const SCHEMA = 'org.gnome.settings-daemon.plugins.color';
const TEMP_KEY = 'night-light-temperature';
const ENABLED_KEY = 'night-light-enabled';

// Range enforced by gnome-settings-daemon's colour plugin.
const MIN_KELVIN = 1700;
const MAX_KELVIN = 4700;

// Matches the shell's own ~50% treatment for insensitive widgets.
const DIM_OPACITY = 128;

const NightLightSlider = GObject.registerClass(
class NightLightSlider extends QuickSlider {
    // iconSettings holds this extension's own icon-on / icon-off keys, so the
    // icons can be changed with `gsettings set` without a session restart.
    _init(iconSettings) {
        super._init({
            // Placeholder so the St.Icon is built with a valid name;
            // _syncState() below picks the right one for the current state.
            iconName: iconSettings.get_string('icon-on'),
            iconReactive: true,
            iconLabel: 'Toggle Night Light',
        });

        this.slider.accessible_name = 'Night Light Temperature';

        this._iconSettings = iconSettings;
        this._iconIds = [
            iconSettings.connect('changed::icon-on', () => this._syncState()),
            iconSettings.connect('changed::icon-off', () => this._syncState()),
        ];

        this._settings = new Gio.Settings({schema_id: SCHEMA});
        this._settingsIds = [
            this._settings.connect(`changed::${TEMP_KEY}`, () => this._syncSlider()),
            this._settings.connect(`changed::${ENABLED_KEY}`, () => this._syncState()),
        ];

        this.slider.connect('notify::value', () => this._onSliderChanged());
        this.connect('icon-clicked', () => {
            this._settings.set_boolean(ENABLED_KEY,
                !this._settings.get_boolean(ENABLED_KEY));
        });

        // Hide the whole item on hardware that can't do night light at all.
        global.backend.get_monitor_manager().bind_property(
            'night-light-supported', this, 'visible',
            GObject.BindingFlags.SYNC_CREATE);

        this._syncSlider();
        this._syncState();
    }

    // Slider runs cool -> warm, so 1.0 is the *lowest* colour temperature.
    _toValue(kelvin) {
        return (MAX_KELVIN - kelvin) / (MAX_KELVIN - MIN_KELVIN);
    }

    _toKelvin(value) {
        return Math.round(MAX_KELVIN - value * (MAX_KELVIN - MIN_KELVIN));
    }

    _syncSlider() {
        const kelvin = this._settings.get_uint(TEMP_KEY);
        if (this._toKelvin(this.slider.value) === kelvin)
            return; // already in sync; avoids fighting our own write

        this._blockWrite = true;
        this.slider.value = this._toValue(kelvin);
        this._blockWrite = false;
    }

    _syncState() {
        const on = this._settings.get_boolean(ENABLED_KEY);

        this.iconName = this._iconSettings.get_string(on ? 'icon-on' : 'icon-off');

        // Dim only the icon, never the slider. The slider stays fully live while
        // night light is off so that dragging it both re-enables night light and
        // sets the temperature in one gesture -- see _onSliderChanged().
        const iconButton = this._iconButton ?? this.get_child()?.get_first_child();
        if (iconButton)
            iconButton.opacity = on ? 255 : DIM_OPACITY;
    }

    _onSliderChanged() {
        if (this._blockWrite)
            return;

        // Touching the slider means you want to see the effect, so bring night
        // light back on rather than silently storing a temperature that does
        // nothing. This also un-dims the icon via the changed:: handler.
        if (!this._settings.get_boolean(ENABLED_KEY))
            this._settings.set_boolean(ENABLED_KEY, true);

        this._settings.set_uint(TEMP_KEY, this._toKelvin(this.slider.value));
    }

    destroy() {
        this._settingsIds?.forEach(id => this._settings.disconnect(id));
        this._settingsIds = null;
        this._settings = null;

        this._iconIds?.forEach(id => this._iconSettings.disconnect(id));
        this._iconIds = null;
        this._iconSettings = null;

        this.menu?.destroy();
        super.destroy();
    }
});

export default class NightLightSliderExtension extends Extension {
    enable() {
        this._indicator = new SystemIndicator();
        this._slider = new NightLightSlider(this.getSettings());
        this._indicator.quickSettingsItems.push(this._slider);

        const quickSettings = Main.panel.statusArea.quickSettings;
        quickSettings._indicators.add_child(this._indicator);

        // Sit directly below the Brightness slider rather than at the bottom.
        const brightness = quickSettings._brightness?.quickSettingsItems?.[0];
        const children = quickSettings.menu._grid.get_children();
        const index = brightness ? children.indexOf(brightness) : -1;
        const sibling = index >= 0 ? children[index + 1] ?? null : null;

        // colSpan 2 matches the other full-width sliders.
        quickSettings.menu.insertItemBefore(this._slider, sibling, 2);
    }

    disable() {
        this._slider?.destroy();
        this._slider = null;

        this._indicator?.destroy();
        this._indicator = null;
    }
}
