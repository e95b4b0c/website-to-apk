// ==UserScript==
// @name         ttyd-nerd-font
// @match        *://*/*
// @run-at       document-start
// ==/UserScript==

/*
 * Draw the terminal with a Nerd Font, so Powerline / devicon / prompt icons are real glyphs.
 *
 * ttyd asks the terminal for `Consolas, Liberation Mono, Menlo, Courier, monospace`.  Android has
 * none of the first four, and the monospace it falls back to has no glyphs in the Private Use Area,
 * which is where every Nerd Font icon lives: the prompt shows tofu boxes (or nothing at all).
 *
 * The font itself ships inside the APK (`assets = fonts/...` in webapk.conf, see README "Bundled
 * Asset Files") and is served from https://app.local/files/ — local, so it also works when the
 * phone is on a tailnet with no internet.
 *
 * Two things have to happen, in this order:
 *   1. the faces have to be registered and *loaded* — until then a canvas draws and measures with
 *      the fallback font;
 *   2. xterm's own `fontFamily` option has to be changed — it paints into a canvas, so no CSS rule
 *      reaches it.  Changing the option re-measures the cell and repaints; the resize event after
 *      it makes fit.js refit the container to the new cell width.
 */

(function () {
    'use strict';

    var FAMILY = 'WebToApkNerdMono';
    var STACK = '"' + FAMILY + '", monospace';
    var FILES = 'https://app.local/files/';
    var FACES = [
        { file: 'JetBrainsMonoNerdFontMono-Regular.woff2', weight: '400' },
        { file: 'JetBrainsMonoNerdFontMono-Bold.woff2', weight: '700' }
    ];
    var POLL_MS = 250;
    var RELAX_MS = 1000;    // once the terminal has the font, only watch for reconnects
    var POLL_LIMIT = 240;   // ~60s; a page without `window.term` is not ttyd

    function noop() {}

    function injectFaces() {
        // document-start can run before <head> exists; documentElement is there by then
        var parent = document.head || document.documentElement;
        if (!parent) return false;
        if (document.getElementById('webtoapk-nerd-font')) return true;

        var style = document.createElement('style');
        style.id = 'webtoapk-nerd-font';
        var css = '';
        FACES.forEach(function (face) {
            css += '@font-face { font-family: "' + FAMILY + '"; font-style: normal; ' +
                   'font-weight: ' + face.weight + '; font-display: block; ' +
                   'src: url("' + FILES + face.file + '") format("woff2"); }\n';
        });
        // The IME composition box, the char-measure element and the accessibility layer are DOM,
        // not canvas: xterm names the family on them itself, so this only keeps the two in step.
        css += '.xterm, .xterm-helper-textarea, .xterm-screen, .xterm-char-measure-element ' +
               '{ font-family: ' + STACK + ' !important; }\n';
        style.textContent = css;
        parent.appendChild(style);
        return true;
    }

    /* xterm is reachable as `window.term` (ttyd sets it in open(), before it connects). */
    function apply() {
        var term = window.term;
        if (!term || !term.options) return false;
        if (term.options.fontFamily !== STACK) {
            term.options.fontFamily = STACK;
            // The option re-measures the cell and repaints by itself; the event is for the
            // *container*: fit.js listens for it and re-runs its own fit.
            if (typeof term.fit === 'function') term.fit();
            window.dispatchEvent(new Event('resize'));
        }
        return true;
    }

    function loadFaces() {
        if (!document.fonts || !document.fonts.load) return Promise.resolve();
        // A face that was never loaded is not used by a canvas, however it is named in CSS
        return Promise.all(FACES.map(function (face) {
            return document.fonts.load(face.weight + ' 16px "' + FAMILY + '"').catch(noop);
        }));
    }

    function start() {
        if (!injectFaces()) {
            // The document was not there yet: run again once it is
            document.addEventListener('DOMContentLoaded', start);
            return;
        }

        loadFaces().then(function () {
            var ticks = 0;
            var applied = false;
            var timer = setInterval(poll, POLL_MS);

            function poll() {
                ticks++;
                if (apply()) {
                    if (!applied) {
                        applied = true;
                        // ttyd sends its client options (`Consolas, …`) again on every reconnect,
                        // which would put the old stack back: keep watching, just slowly
                        clearInterval(timer);
                        timer = setInterval(poll, RELAX_MS);
                    }
                } else if (ticks > POLL_LIMIT) {
                    clearInterval(timer);
                }
            }

            poll();
        }).catch(noop);
    }

    start();
})();
