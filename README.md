# Night Light Slider

A GNOME Shell extension that adds a night light colour-temperature slider to the
quick settings menu, directly under Brightness.

## Reason to be

Changing the night light on Ubuntu 26 is too many clicks:

Settings -> Displays -> Night Light -> you are finally at the slider.

## What it does

- Adjust the slider to warm or cool the screen.
- Click the icon to toggle night light on and off. Dragging while night light is off turns it back on.
- Dragging always shows the effect, even when the schedule has night light off
  for now -- otherwise adjusting it during the day would appear to do nothing.
- Hides on hardware that does not support night light.

## Requirements

GNOME Shell 48, 49 or 50. The shell refuses to load the extension on anything
outside the `shell-version` list in `metadata.json`.

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

## Translating

The two user-facing strings are both accessible names, read out by screen
readers. The template is `po/nightlight-slider.pot`; refresh it after touching
a string:

```sh
xgettext --from-code=UTF-8 --language=JavaScript --keyword=_ \
  -o po/nightlight-slider.pot extension.js
```

To add a language and compile it where the shell will look:

```sh
msginit -i po/nightlight-slider.pot -l es -o po/es.po
msgfmt -o locale/es/LC_MESSAGES/nightlight-slider.mo po/es.po
```

`locale/` is compiled output, but it is not disposable: the shell binds the
gettext domain to that directory, so a release archive has to contain it or
translations silently do nothing. Test one with `LANGUAGE=es` on a nested
session.

## Compatibility

The slider gets into the menu through `addExternalIndicator()`, which is the
supported entry point, and the widget itself uses only public API.

Moving it from there to just under Brightness is the one part that reaches into
private internals (`quickSettings._brightness`, `menu._grid`). That step is
best effort: it checks that the brightness item is really in the grid, and if
anything does not line up the slider simply stays where
`addExternalIndicator()` put it, which is the slot external items are meant to
occupy anyway. So a shell release that renames those can move the slider, but
it will not break it.

Every API used is present unchanged in GNOME Shell 45 through 50, including
`NightLightPreview` on gnome-settings-daemon's colour interface. The declared
`shell-version` is narrower than that on purpose -- it lists what has actually
been exercised, not everything that should work.

## License

GPL-2.0-or-later. See [LICENSE](LICENSE).
