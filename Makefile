UUID = nightlight-slider@almareq.github.io
EXTDIR = $(HOME)/.local/share/gnome-shell/extensions/$(UUID)

all: schemas/gschemas.compiled

schemas/gschemas.compiled: schemas/*.gschema.xml
	glib-compile-schemas schemas/

install: all
	ln -sfn "$(CURDIR)" "$(EXTDIR)"

clean:
	rm -f schemas/gschemas.compiled

.PHONY: all install clean
