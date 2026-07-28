# Night Light Slider

A GNOME Shell extension that adds a night light colour-temperature slider to the
quick settings menu, directly under Brightness.

## Reason to be

Changing the night light on Ubuntu 26 is too many clicks:

Settings -> Displays -> Night Light -> you are finally at the slider.

## What it does

- Adjust the slider to warm or cool the screen.
- Click the icon to toggle night light on and off. Dragging while night light is off turns it back on.
- Hides on hardware that does not support night light.

## Requirements

GNOME Shell 50. The shell refuses to load the extension on anything else.

## Install

[tbd]

## Development

Watch for errors:

```sh
journalctl -f -o cat /usr/bin/gnome-shell
```

On Wayland there is no way to reload the shell in place -- `Alt+F2` `r` is
X11-only -- so log out and back in to pick up changes to `extension.js`. A
nested session is faster for iterating. GNOME Shell 50 dropped `--nested`;
nesting is now what you get unless you ask for `--display-server`:

```sh
dbus-run-session -- gnome-shell --wayland
```

To iterate without disturbing the real session, point the nested shell at a
throwaway data and config dir. It then loads only this extension, and its
`enabled-extensions` never touches your own dconf:

```sh
tmp=$(mktemp -d)
mkdir -p "$tmp/data/gnome-shell/extensions"
ln -s "$PWD" "$tmp/data/gnome-shell/extensions/nightlight-slider@almareq.github.io"

XDG_DATA_HOME="$tmp/data" XDG_CONFIG_HOME="$tmp/config" dbus-run-session -- sh -c '
  gsettings set org.gnome.shell disable-user-extensions false
  gsettings set org.gnome.shell enabled-extensions "[\"nightlight-slider@almareq.github.io\"]"
  gnome-shell --wayland --headless --virtual-monitor 1280x800
'
```

`--headless --virtual-monitor` keeps it off screen, which is handy for
checking startup behaviour -- the slider reaches its position by a different
route at login than on a manual enable, so that path is worth testing on its
own.

A loaded extension logs nothing, so do not read success from a quiet log. Ask
the shell instead, on the nested session's bus -- `state` is `1` for enabled,
`3` for error:

```sh
gdbus call --session --dest org.gnome.Shell.Extensions \
  --object-path /org/gnome/Shell/Extensions \
  --method org.gnome.Shell.Extensions.GetExtensionInfo \
  nightlight-slider@almareq.github.io
```

Two log lines that look alarming and are not: `unable to lock lockfile
/run/user/1000/wayland-0.lock` just means the outer compositor owns that name,
and `Failed to create file .../gnome-shell-disable-extensions: File exists` is
a crash-guard marker the shell itself calls harmless.

## Compatibility

Placing the slider under Brightness requires private shell internals
(`quickSettings._brightness`, `menu._grid`, `_indicators`). These are not
stable API, so a major GNOME Shell release may well need a fix here. The
slider widget itself uses only public API.

## License

GPL-2.0-or-later. See [LICENSE](LICENSE).
