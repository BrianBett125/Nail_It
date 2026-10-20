// The site picker: on a phone (768px and below) the sidebar becomes a drawer that slides down from
// under the site bar. One button, #sitePickerButton, shows the open site and opens and closes it.
// On a larger screen none of this shows: the sidebar is simply there, and this file only keeps the
// Add Site button in the right place.
//
// DOM code only. dashboard.js tells it which site is open (setSite) and when the site list has first
// arrived (sitesReady); the rest, Escape, the dimmed area, the Close button, is handled here.
//
// Site names are other people's text: textContent only.
const PHONE = "(max-width: 768px)";

const $ = (id) => document.getElementById(id);

export function createDrawer() {
    const bar = $("siteBar");
    const picker = $("sitePickerButton");
    const nameEl = $("sitePickerName");
    const roleEl = $("siteBarRole");
    const drawer = $("siteDrawer");
    const scrim = $("siteScrim");
    const closeButton = $("siteDrawerClose");
    const addButton = $("addSiteButton");
    const head = $("drawerHead");
    const phone = window.matchMedia(PHONE);

    let hasSite = false;
    let ready = false;   // the site list has arrived

    const isOpen = () => bar.classList.contains("is-open");

    // On a phone Add Site sits in the site bar, where it is reachable with the drawer shut; on a
    // desktop it is the first thing under the sidebar heading. It is one element, moved, so its
    // listeners and its id stay.
    function placeAddButton() {
        if (phone.matches) {
            if (addButton.parentElement !== bar) {
                bar.insertBefore(addButton, scrim);
            }
        } else if (addButton.parentElement !== drawer) {
            head.after(addButton);
        }
    }

    function open() {
        if (!phone.matches || isOpen()) {
            return;
        }
        bar.classList.add("is-open");
        picker.setAttribute("aria-expanded", "true");
    }

    // focus: true gives focus back to the picker (Escape, Close, the dimmed area, picking a site).
    function close({ focus = false } = {}) {
        if (!isOpen()) {
            return;
        }
        bar.classList.remove("is-open");
        picker.setAttribute("aria-expanded", "false");
        if (focus) {
            picker.focus({ preventScroll: true });
        }
    }

    picker.addEventListener("click", () => {
        if (!isOpen()) {
            open();
        } else if (hasSite) {
            close();
        }
        // With no site open the list is the only thing to do on the page: pressing the button again
        // leaves it where it is (Escape and Close still fold it away).
    });
    closeButton.addEventListener("click", () => close({ focus: true }));
    scrim.addEventListener("click", () => close({ focus: true }));
    document.addEventListener("keydown", (event) => {
        // A dialog handles its own Escape; the drawer and a dialog are never open together.
        if (event.key === "Escape" && isOpen() && !document.querySelector("dialog[open]")) {
            close({ focus: true });
        }
    });
    phone.addEventListener("change", () => {
        close();
        placeAddButton();
        if (ready && !hasSite) {
            open(); // narrowed to a phone with no site open: the list is the way in
        }
    });
    placeAddButton();

    return {
        open,
        close,
        isOpen,
        // The open site's name and the signed-in person's role in it, or null with no site open.
        setSite(label, roleText = "") {
            hasSite = Boolean(label);
            nameEl.textContent = label || "Choose a site";
            roleEl.textContent = hasSite ? roleText : "";
            roleEl.hidden = !hasSite || roleText === "";
        },
        // The site list has arrived. With no site open the drawer opens by itself: the first thing to
        // do is pick one.
        sitesReady() {
            ready = true;
            if (!hasSite) {
                open();
            }
        },
    };
}
