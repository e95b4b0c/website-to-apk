// ==UserScript==
// @name         ttyd-fit
// @match        *://*/*
// @run-at       document-start
// ==/UserScript==

/*
 * Fill the screen with ttyd's terminal.
 *
 * The ttyd page has no <meta name="viewport">, so WebView falls back to a 980 CSS px layout and
 * zooms the whole thing out: on a phone a 15px terminal font ends up around 4px tall.  On top of
 * that the terminal never reaches the right edge, which is what the empty strip on the right is:
 *
 *  - xterm's FitAddon measures the container once, while the page is still settling, and only
 *    fits again on a window resize — a WebView of a fixed size never sends one;
 *  - it also subtracts 15px for a scrollbar (`offsetWidth - scrollArea.offsetWidth || 15`) that
 *    WebView never draws, because its scrollbars are overlays and take no space.
 *
 * So: lay the page out at the real device width, then hand the terminal the pixels it left over by
 * widening its container until the canvas reaches the right edge.  Whatever is left after the last
 * whole column (less than one character cell) is painted in the terminal's own background colour,
 * so the seam is invisible whatever the theme is.
 */

(function () {
    'use strict';

    var STEP_MS = 150;      // polling interval while fitting
    var SETTLE_TICKS = 3;   // ticks without a size change before the next widening
    var MAX_WIDENINGS = 5;
    var MAX_TICKS = 40;     // give up after ~6s: the page has no terminal to fit (an error page)

    var extra = 0;          // CSS px added to the container width, on top of 100%
    var widens = 0;
    var lastWidth = -1;     // last seen canvas width, in CSS px
    var settled = 0;
    var notBefore = 0;      // tick before which the canvas is still reacting
    var tick = 0;
    var timer = null;
    var nudging = false;

    /* ---- 1. lay the page out at the device width instead of WebView's 980px fallback ---- */

    function setViewport() {
        var head = document.head;
        if (!head) return false;
        var meta = head.querySelector('meta[name="viewport"]');
        if (!meta) {
            meta = document.createElement('meta');
            meta.setAttribute('name', 'viewport');
            head.appendChild(meta);
        }
        meta.setAttribute('content', 'width=device-width, initial-scale=1');
        return true;
    }

    if (!setViewport()) document.addEventListener('DOMContentLoaded', setViewport);

    /* ---- 2. make the terminal fill that width ---- */

    function container() { return document.getElementById('terminal-container'); }
    function canvas() { return document.querySelector('.xterm-screen'); }
    function xtermElement() { return document.querySelector('.xterm'); }

    /* Columns are whole characters, so the strip left over is repainted in the colour the terminal
       paints its own background with. */
    function paintSeam() {
        var viewport = document.querySelector('.xterm-viewport');
        var background = viewport && getComputedStyle(viewport).backgroundColor;
        if (!background || background === 'rgba(0, 0, 0, 0)' || background === 'transparent') return;
        document.documentElement.style.backgroundColor = background;
        if (document.body) document.body.style.backgroundColor = background;
    }

    function refit() {
        // xterm (ttyd) refits on this event and on nothing else
        nudging = true;
        window.dispatchEvent(new Event('resize'));
        nudging = false;
    }

    /* One poll. Returns true once the canvas is where it should be. */
    function step() {
        // Nothing to fit (an error page, another site): stop looking after a few seconds
        if (++tick > MAX_TICKS) return true;

        var box = container(), screen = canvas(), xterm = xtermElement();
        if (!box || !screen || !xterm) return false;

        paintSeam();

        var width = Math.round(screen.getBoundingClientRect().width);
        if (width !== lastWidth) { lastWidth = width; settled = 0; } else settled++;

        // The container keeps ttyd's own padding around the terminal; the canvas should end there,
        // not at the very edge of the screen. `over` is a canvas that is past the screen edge (its
        // last column is cut off), `under` one that stops short of the right edge.
        var padding = parseFloat(getComputedStyle(xterm).paddingRight) || 0;
        var right = screen.getBoundingClientRect().right;
        var over = Math.round(right - window.innerWidth);
        var under = Math.round(window.innerWidth - padding - right);

        // The canvas has to hold still first: right after a rotation (or right after the width
        // below was reset) it still has yesterday's size, and measuring that would move the
        // container the wrong way.
        if (tick < notBefore || settled < SETTLE_TICKS) return false;
        if (over <= 0 && under <= 1) return true;
        if (widens >= MAX_WIDENINGS) return true;

        widens++;
        extra += over > 0 ? -over : under;
        box.style.width = 'calc(100% + ' + extra + 'px)';
        refit();
        notBefore = tick + SETTLE_TICKS + 1;
        return false;
    }

    function start() {
        // A resize (rotation, split screen, keyboard) moves the 100% under the container but not the
        // correction, which is a constant: keep it and let the poll below top it up. Only the
        // measurement has to start over, because the canvas is stale until xterm has caught up.
        tick = 0;
        widens = 0;
        lastWidth = -1;
        settled = 0;
        notBefore = 0;
        if (timer) clearInterval(timer);
        if (step()) return;
        timer = setInterval(function () {
            if (step()) clearInterval(timer);
        }, STEP_MS);
    }

    window.addEventListener('load', start);
    document.addEventListener('DOMContentLoaded', start);
    // The app repaints the page after it knows the system bar insets; the WebView has its final
    // size by then, which is exactly what the fit above needs.
    document.addEventListener('WebToApkInsetsApplied', start);
    document.addEventListener('visibilitychange', function () {
        if (!document.hidden) start();
    });
    window.addEventListener('resize', function () {
        if (!nudging) start();
    });
})();
