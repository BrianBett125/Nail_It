// Phase 6: the Reports dialog and the print view. DOM code only. What goes into a file or a message
// is decided in src/reports.js; the movements of a date range are read by data.fetchMovementsBetween.
//
// Four things, all for one site: a stock CSV, a movements CSV for a range of days, a summary to
// share (Web Share on a phone, copy where sharing does not exist), and print / Save as PDF.
// Everything that comes from the database goes in with textContent, never innerHTML.
import { openDialog, closeDialog, closeOnBackdrop } from "./dialog.js";
import {
    CSV_TYPE,
    stockCsv,
    movementsCsv,
    dayRange,
    presetDates,
    PRESETS,
    stockFileName,
    movementsFileName,
    shareText,
    printNote,
} from "./reports.js";

const $ = (id) => document.getElementById(id);

// `getContext()` gives { siteId, site, materials, view } at the moment of each action, never a copy.
export function createReportsUI({ data, getContext, showToast, reportError }) {
    const button = $("reportsButton");
    const dialog = $("reportsContainer");
    const fromInput = $("reportFrom");
    const toInput = $("reportTo");
    const errorEl = $("reportError");
    const statusEl = $("reportStatus");
    const movementsButton = $("exportMovements");
    const shareButton = $("reportShare");
    const presetBox = $("reportPresets");
    const canShare = typeof navigator.share === "function";

    closeOnBackdrop(dialog);
    shareButton.textContent = canShare ? "Share summary" : "Copy summary";

    const presetButtons = PRESETS.map(({ id, label }) => {
        const preset = document.createElement("button");
        preset.type = "button";
        preset.textContent = label;
        preset.dataset.preset = id;
        preset.setAttribute("aria-pressed", "false");
        preset.addEventListener("click", () => choosePreset(id));
        presetBox.append(preset);
        return preset;
    });

    function choosePreset(id) {
        const { from, to } = presetDates(id);
        fromInput.value = from;
        toInput.value = to;
        for (const preset of presetButtons) {
            preset.setAttribute("aria-pressed", String(preset.dataset.preset === id));
        }
        showError("");
    }

    function clearPresets() {
        for (const preset of presetButtons) {
            preset.setAttribute("aria-pressed", "false");
        }
        showError("");
    }

    function showError(message) {
        errorEl.textContent = message;
        errorEl.hidden = !message;
    }

    function say(message) {
        statusEl.textContent = message;
    }

    // A file the browser saves. The object URL is let go a moment later, once the download has started.
    function download(text, fileName) {
        const url = URL.createObjectURL(new Blob([text], { type: CSV_TYPE }));
        const link = document.createElement("a");
        link.href = url;
        link.download = fileName;
        link.hidden = true;
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
    }

    function open() {
        const { siteId, site } = getContext();
        if (!siteId || !site) {
            return;
        }
        $("reportsSite").textContent = site.name || "(unnamed site)";
        say("");
        showError("");
        choosePreset("this-month");
        openDialog(dialog, { focus: $("exportStock"), opener: button });
    }

    function exportStock() {
        const { siteId, site, materials } = getContext();
        if (!siteId) {
            return;
        }
        const count = Object.keys(materials || {}).length;
        download(stockCsv({ site, materials }), stockFileName(site));
        say("");
        showToast(count === 0 ? "Saved the stock list (no materials yet)" : `Saved the stock of ${count} ${count === 1 ? "material" : "materials"}`);
    }

    async function exportMovements() {
        const { siteId, site } = getContext();
        if (!siteId) {
            return;
        }
        const range = dayRange(fromInput.value, toInput.value);
        if (range.error) {
            showError(range.error);
            return;
        }
        showError("");
        movementsButton.disabled = true;
        say("Getting the movements...");
        try {
            const movements = await data.fetchMovementsBetween(siteId, range.from, range.to);
            if (getContext().siteId !== siteId) {
                return; // another site was opened meanwhile: this answer is for the wrong one
            }
            if (movements.length === 0) {
                say("");
                showError(`No movements from ${fromInput.value} to ${toInput.value}`);
                return;
            }
            download(movementsCsv({ site, movements }), movementsFileName(site, fromInput.value, toInput.value));
            say("");
            showToast(`Saved ${movements.length} ${movements.length === 1 ? "movement" : "movements"}`);
        } catch (error) {
            say("");
            reportError(error);
        } finally {
            movementsButton.disabled = false;
        }
    }

    async function share() {
        const { siteId, site, materials } = getContext();
        if (!siteId) {
            return;
        }
        const text = shareText({ site, materials });
        const title = `${site.name || "Site"} stock`;
        try {
            if (canShare) {
                await navigator.share({ title, text });
                say("");
            } else {
                await navigator.clipboard.writeText(text);
                say("");
                showToast("Summary copied. Paste it into WhatsApp or an email.");
            }
        } catch (error) {
            if (error && error.name === "AbortError") {
                return; // the person closed the share sheet
            }
            say("");
            reportError(new Error("Could not share. Download the CSV instead."));
        }
    }

    // The heading that only paper shows. Filled on beforeprint, so Ctrl+P works as well as the button.
    function fillPrintHeader() {
        const { siteId, site, view } = getContext();
        if (!siteId || !site) {
            return;
        }
        $("printSite").textContent = site.name || "(unnamed site)";
        $("printNote").textContent = printNote({ query: view.query, filter: view.filter });
    }

    function print() {
        closeDialog(dialog);
        setTimeout(() => window.print(), 50); // let the dialog leave the screen first
    }

    button.addEventListener("click", open);
    $("exportStock").addEventListener("click", exportStock);
    movementsButton.addEventListener("click", exportMovements);
    shareButton.addEventListener("click", share);
    $("reportPrint").addEventListener("click", print);
    $("reportsClose").addEventListener("click", () => closeDialog(dialog));
    fromInput.addEventListener("input", clearPresets);
    toInput.addEventListener("input", clearPresets);
    window.addEventListener("beforeprint", fillPrintHeader);

    return {
        // The button shows with a site open and hides without one.
        setSite(siteId) {
            button.hidden = !siteId;
            if (!siteId) {
                closeDialog(dialog, { restore: false });
            }
        },
    };
}
