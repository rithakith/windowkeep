.PHONY: all check test pack clean
all: pack
check:
	python3 scripts/check.py
	glib-compile-schemas --strict --dry-run schemas
	node --check scripts/windowkeep

test: check
	glib-compile-schemas --strict schemas
	GSETTINGS_BACKEND=memory gjs -m tests/settings.test.js
	node --test tests/model.test.js
	gjs -m tests/store.test.js

pack: test
	glib-compile-schemas --strict schemas
	mkdir -p dist
	python3 scripts/pack.py

clean:
	python3 -c "import shutil; shutil.rmtree('dist', ignore_errors=True)"

.PHONY: pot
pot:
	xgettext --language=JavaScript --from-code=UTF-8 --keyword=gettext --keyword=_ --output=po/windowkeep.pot --files-from=po/POTFILES.in
