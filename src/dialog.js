// Helpers around the native <dialog> element. Every form and sheet in the app is a <dialog> opened
// with showModal(), so the browser itself provides the focus trap, Escape to close, the inert page
// behind it and the modal semantics for screen readers. What is left for us to do is small:
//   - one dialog at a time,
//   - give focus back to what opened it (the table is redrawn all the time, so the opener may be
//     a new element by then: the caller can pass a function that finds it again),
//   - a tap on the dimmed area closes the sheets,
//   - on a phone, keep the dialog above the on-screen keyboard.
// DOM code only; no data, no Firebase.

const openers = new WeakMap(); // dialog -> the element (or a function finding it) to focus on close
const KEYBOARD_GAP = 120;      // a viewport this much shorter than the window means a keyboard is up

// Opens `dialog` as a modal. Any other open dialog is closed first.
//   focus:  the element that gets focus (default: the browser's choice, the first control)
//   opener: what gets focus when the dialog closes, an element or a function returning one;
//           default is the element that has focus now
export function openDialog(dialog, { focus, opener } = {}) {
    for (const other of document.querySelectorAll("dialog[open]")) {
        if (other !== dialog) {
            closeDialog(other, { restore: false });
        }
    }
    if (!dialog.open) {
        openers.set(dialog, opener === undefined ? document.activeElement : opener);
        dialog.showModal();
    }
    fitToKeyboard();
    if (focus) {
        focus.focus({ preventScroll: true });
    }
}

// Closes `dialog`. restore: false skips giving focus back (the thing it was about is gone).
export function closeDialog(dialog, { restore = true } = {}) {
    if (!dialog.open) {
        return;
    }
    if (!restore) {
        openers.delete(dialog);
    }
    dialog.close();
    giveFocusBack(dialog); // now, not when the "close" event arrives a moment later
}

// Focus goes back to what opened the dialog, if it is still on the page and can take it.
function giveFocusBack(dialog) {
    if (!openers.has(dialog)) {
        return;
    }
    const opener = openers.get(dialog);
    openers.delete(dialog);
    const target = typeof opener === "function" ? opener() : opener;
    if (target && target.isConnected && (!target.checkVisibility || target.checkVisibility())) {
        target.focus({ preventScroll: true });
    }
}

// Escape and the like close a dialog without going through closeDialog: the event covers them.
document.addEventListener("close", (event) => {
    if (event.target instanceof HTMLDialogElement) {
        giveFocusBack(event.target);
    }
}, true);

// A tap on the dimmed area (the ::backdrop, which reports the dialog itself as its target) closes
// the dialog. The press must also have started there, so dragging out of a text field does not.
export function closeOnBackdrop(dialog) {
    let pressedOnBackdrop = false;
    dialog.addEventListener("pointerdown", (event) => {
        pressedOnBackdrop = event.target === dialog;
    });
    dialog.addEventListener("click", (event) => {
        if (event.target === dialog && pressedOnBackdrop) {
            dialog.close();
        }
        pressedOnBackdrop = false;
    });
}

// An on-screen keyboard covers the bottom of the screen, and a sheet anchored to the bottom would sit
// behind it. The visual viewport is what is really visible: lift open dialogs by the keyboard's height.
function fitToKeyboard() {
    const viewport = window.visualViewport;
    for (const dialog of document.querySelectorAll("dialog[open]")) {
        const keyboard = viewport ? window.innerHeight - viewport.height - viewport.offsetTop : 0;
        if (viewport && window.innerHeight - viewport.height > KEYBOARD_GAP) {
            dialog.style.setProperty("--kb", `${Math.max(0, keyboard)}px`);
            dialog.style.setProperty("--vh", `${viewport.height}px`);
        } else {
            dialog.style.removeProperty("--kb");
            dialog.style.removeProperty("--vh");
        }
    }
}

if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", fitToKeyboard);
    window.visualViewport.addEventListener("scroll", fitToKeyboard);
}

// A modal dialog keeps the page behind it inert, but Tab from its last control still leaves the page for
// the browser's own toolbar. Wrap it instead, so Tab and Shift+Tab cycle inside the dialog.
const TABBABLE = "button, input, select, textarea, a[href], [tabindex]";

document.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") {
        return;
    }
    const dialog = document.querySelector("dialog[open]");
    if (!dialog) {
        return;
    }
    const items = [...dialog.querySelectorAll(TABBABLE)].filter((el) =>
        !el.disabled && el.tabIndex >= 0 && el.checkVisibility());
    if (items.length === 0) {
        return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault();
        last.focus();
    } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
        event.preventDefault();
        first.focus();
    }
});
