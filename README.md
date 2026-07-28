# Night Light Slider

A GNOME Shell extension that adds a night light colour-temperature slider to the
quick settings menu, directly under Brightness.

## Reason to be

Changing the night light on Ubuntu 26 is too many clicks:

Settings -> Displays -> Night Light -> you are finally at the slider.

## What it does

- Drag or scroll the slider to warm or cool the screen (1700 K - 4700 K, the
  range enforced by gnome-settings-daemon).
- Click the icon to toggle night light on and off.
- Dragging while night light is off turns it back on, so one gesture both
  enables it and picks a temperature.
- The off state is shown by dimming the icon; the slider itself stays live.
- The whole item hides on hardware that does not support night light.

It writes the stock GNOME keys (`night-light-temperature` and
`night-light-enabled` in `org.gnome.settings-daemon.plugins.color`), the same
ones Settings -> Displays uses. Changes made here show up there and vice versa.

## Requirements

- GNOME Shell 50. `metadata.json` pins `shell-version` to `["50"]`, and the
  shell refuses to load the extension on anything else.
- `glib-compile-schemas`, from `libglib2.0-bin` on Debian/Ubuntu
  (`glib2-devel` on Fedora), to build the settings schema.

## Install

The compiled schema is a build artifact and is not in the repository, so build
it before installing:

```sh
make
ln -s "$PWD" ~/.local/share/gnome-shell/extensions/nightlight-slider@almareq.github.io
```

Then log out and back in (see [Development](#development)) and enable it:

```sh
gnome-extensions enable nightlight-slider@almareq.github.io
```

Use `cp -r` instead of `ln -s` if you would rather not have the installed
extension track your working tree.

## Configuration

There is no preferences dialog, so the Extensions app shows no settings button.
The two icon keys are set from the command line. The schema is not installed
system-wide, so `--schemadir` is required:

```sh
SCHEMADIR=~/.local/share/gnome-shell/extensions/nightlight-slider@almareq.github.io/schemas

# icon shown while night light is on
gsettings --schemadir "$SCHEMADIR" set \
  org.gnome.shell.extensions.nightlight-slider icon-on weather-clear-night-symbolic

# icon shown while night light is off
gsettings --schemadir "$SCHEMADIR" set \
  org.gnome.shell.extensions.nightlight-slider icon-off night-light-disabled-symbolic
```

Both default to `weather-clear-night-symbolic`, since the off state is already
conveyed by dimming. Any symbolic icon name from the active icon theme works.
Changes apply immediately, without restarting the session.

## Development

Rebuild the schema after editing `schemas/*.gschema.xml`:

```sh
make
```

Watch for errors:

```sh
journalctl -f -o cat /usr/bin/gnome-shell
```

On Wayland there is no way to reload the shell in place -- `Alt+F2` `r` is
X11-only -- so log out and back in to pick up changes to `extension.js`. A
nested session is faster for iterating:

```sh
dbus-run-session -- gnome-shell --nested --wayland
```

## Compatibility

Placing the slider under Brightness requires private shell internals
(`quickSettings._brightness`, `menu._grid`, `_indicators`). These are not
stable API, so a major GNOME Shell release may well need a fix here.

## License

GPL-2.0-or-later. See [LICENSE](LICENSE).
