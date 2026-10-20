// The Phase 3 user interface: the Received / Used sheet, the material history sheet and the site
// activity feed. DOM code only. What the numbers mean (validation, running balance, wording) comes
// from src/movements.js, and every write goes through the data layer passed in, so this file has
// no Firebase in it and runs against the in-memory fake in the browser tests.
//
// Everything that comes from the database (material names, notes, emails) is put in the page
// with textContent, never innerHTML.
import {
    planMovement,
    parseAmount,
    withRunningBalance,
    describeMovement,
    timeAgo,
    formatQuantity,
    formatDelta,
    formatDateTime,
    whoLabel,
    TYPE_LABELS,
} from "./movements.js";
import { canWriteMaterials } from "./roles.js";
import { openDialog, closeDialog, closeOnBackdrop } from "./dialog.js";

const FEED_LIMIT = 30;
const CLOCK_MS = 60_000;          // "2h ago" is re-worded once a minute
const ACTION_VERB = { received: "Receive", used: "Use" };
const SIGN = { positive: "+", negative: "−" }; // a real minus sign, easier to see than a hyphen

const $ = (id) => document.getElementById(id);

// `getContext()` answers "where are we now": { siteId, materials, role, user }. It is read at the
// moment of each action, so nothing here caches a site, a role or a material that has moved on.
export function createMovementsUI({ data, getContext, showToast, reportError }) {
    const recordBox = $("movementContainer");
    const recordForm = $("movementForm");
    const titleEl = $("movementTitle");
    const stockEl = $("movementStock");
    const unitsEl = $("movementUnits");
    const amountInput = $("movementAmount");
    const noteInput = $("movementNote");
    const afterEl = $("movementAfter");
    const errorEl = $("movementError");
    const submitBtn = $("movementSubmit");
    const cancelBtn = $("movementCancel");
    const allChip = $("movementAll");

    const historyBox = $("historyContainer");
    const historyTitle = $("historyTitle");
    const historySummary = $("historySummary");
    const historyBody = $("historyBody");
    const historyStatus = $("historyStatus");
    const historyBefore = $("historyBefore");
    const historyEmpty = $("historyEmpty");
    const historyList = $("historyList");
    const historyClose = $("historyClose");

    const activityPanel = $("activityPanel");
    const activityList = $("activityList");
    const activityEmpty = $("activityEmpty");
    const activityToggle = $("activityToggle");

    // record: the sheet is open for this material and action, or null.
    // history: the history sheet is open for this material, with the movements heard so far.
    // feed: the subscription behind the activity panel.
    let record = null;
    let history = null;
    let feed = { siteId: null, stop: null, movements: null };

    // ---- the buttons in each table row -----------------------------------------------------

    // Received and Used for those who may record stock, History for every member.
    function buildStockActions(materialId, material, canRecord) {
        const cell = document.createDocumentFragment();
        const name = material.name ?? "";
        if (canRecord) {
            cell.append(
                makeRowButton("btn-receive", "row-btn-receive", SIGN.positive, "Receive", `Receive ${name}`,
                    () => openRecord(materialId, "received", "btn-receive")),
                makeRowButton("btn-use", "row-btn-use", SIGN.negative, "Use", `Use ${name}`,
                    () => openRecord(materialId, "used", "btn-use")),
            );
        }
        cell.append(
            makeRowButton("btn-history", "row-btn-history", "", "History", `History of ${name}`,
                () => openHistory(materialId, "btn-history")),
        );
        return cell;
    }

    function makeRowButton(className, tone, sign, text, label, onClick) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `row-btn ${tone} ${className}`;
        button.setAttribute("aria-label", label);
        if (sign) {
            const mark = document.createElement("span");
            mark.className = "row-btn-sign";
            mark.setAttribute("aria-hidden", "true");
            mark.textContent = sign;
            button.append(mark);
        }
        button.append(text);
        button.addEventListener("click", onClick);
        return button;
    }

    // ---- shared dialog behaviour ------------------------------------------------------------

    // Both sheets are native <dialog>s (src/dialog.js): the browser traps Tab, closes on Escape and
    // keeps the page behind inert. What is left here is state and focus. Whatever closes a sheet
    // (Escape, a button, a tap on the dimmed area, a site change) ends in its "close" event, and the
    // event is ignored if the sheet has been opened again since.
    closeOnBackdrop(recordBox);
    closeOnBackdrop(historyBox);
    recordBox.addEventListener("close", () => {
        if (!recordBox.open) {
            endRecord();
        }
    });
    historyBox.addEventListener("close", () => {
        if (!historyBox.open) {
            endHistory();
        }
    });

    // After a sheet closes, focus goes back to the button that opened it. The table is rebuilt on
    // every update, so the old button may be gone: look the same button up again by row and class.
    function findOpener(opener) {
        const row = document.querySelector(`#materialTableBody tr[data-material-id="${CSS.escape(opener.materialId)}"]`);
        return (row && row.querySelector(`.${opener.className}`))
            || (row && row.querySelector("button"))
            || document.getElementById("addMaterialButton");
    }

    // ---- Received / Used --------------------------------------------------------------------

    function openRecord(materialId, action, openerClass) {
        const { siteId, materials, role } = getContext();
        const material = materials[materialId];
        if (!siteId || !material || !canWriteMaterials(role)) {
            return;
        }
        record = { siteId, materialId, action, opener: { materialId, className: openerClass }, sending: false };
        recordForm.className = `sheet sheet-record sheet-${action}`;
        titleEl.textContent = `${ACTION_VERB[action]} ${material.name}`;
        amountInput.value = "";
        noteInput.value = "";
        hideError();
        renderRecord(material);
        const { opener } = record;
        openDialog(recordBox, { focus: amountInput, opener: () => findOpener(opener) });
    }

    // Everything on the sheet that depends on the material or on what is typed: the live stock,
    // the units, the label on the button, and the "after" line.
    function renderRecord(material) {
        const units = material.units ?? "";
        stockEl.textContent = `In stock: ${formatQuantity(material.quantity)} ${units}`.trim();
        unitsEl.textContent = units;
        const verb = TYPE_LABELS[record.action];
        const value = parseAmount(amountInput.value);
        const stock = typeof material.quantity === "number" ? material.quantity : 0;

        // More than is in stock: the button says so instead of looking ready to record it. It stays
        // pressable, because pressing it is how the full refusal appears.
        const over = record.action === "used" && value !== null && value > stock;
        submitBtn.classList.toggle("sheet-submit-over", over);
        if (over) {
            submitBtn.textContent = `Only ${formatQuantity(stock)} ${units} in stock`.trim();
        } else {
            submitBtn.textContent = value === null ? `Record ${verb}` : `Record ${verb}: ${formatQuantity(value)} ${units}`.trim();
        }

        afterEl.classList.remove("sheet-after-bad");
        if (over) {
            // Say what to do, not only that it is refused: the "All" chip is one tap away.
            afterEl.textContent = stock > 0 ? `Tap All ${formatQuantity(stock)} to use what is left.` : "";
        } else if (value === null) {
            afterEl.textContent = "";
        } else {
            const left = record.action === "used" ? stock - value : stock + value;
            afterEl.textContent = `Stock after: ${formatQuantity(left)} ${units}`.trim();
        }

        // "All" fills in everything that is in stock: the usual end of a job.
        allChip.hidden = !(record.action === "used" && stock > 0);
        allChip.textContent = `All ${formatQuantity(stock)}`;
        allChip.dataset.set = String(stock);
    }

    function showError(message) {
        errorEl.textContent = message;
        errorEl.hidden = false;
        afterEl.textContent = ""; // the message is the answer now; the live line comes back when the amount changes
    }

    function hideError() {
        errorEl.textContent = "";
        errorEl.hidden = true;
    }

    // focus: false when the thing the sheet was about is gone, so there is nothing to give focus back to.
    function closeRecord({ focus = true } = {}) {
        closeDialog(recordBox, { restore: focus });
        endRecord();
    }

    function endRecord() {
        record = null;
    }

    function refreshRecordFromContext() {
        const { siteId, materials, role } = getContext();
        const material = materials[record.materialId];
        if (siteId !== record.siteId || !material || !canWriteMaterials(role)) {
            // Deleted by someone else, the user moved site, or the role dropped to viewer: a write
            // from this sheet would be wrong or refused. Close it.
            closeRecord({ focus: Boolean(material) });
            return;
        }
        renderRecord(material);
    }

    function submitRecord() {
        if (!record || record.sending) {
            return;
        }
        const { siteId, materials, role, user } = getContext();
        const material = materials[record.materialId];
        if (siteId !== record.siteId || !material || !canWriteMaterials(role)) {
            refreshRecordFromContext();
            return;
        }
        const plan = planMovement(
            { action: record.action, amount: amountInput.value, note: noteInput.value },
            material,
        );
        if (!plan.ok) {
            showError(plan.error);
            amountInput.focus();
            return;
        }
        record.sending = true; // a second tap before the sheet is gone does nothing
        let sent;
        try {
            sent = data.recordMovement(siteId, record.materialId, material, plan.value, user);
        } catch (error) {
            record.sending = false;
            showError(error && error.message ? error.message : String(error));
            return;
        }
        // The write is applied locally first, so the table shows the new stock at once, with or
        // without signal, and the sheet closes without waiting for the server. It closes one tick
        // later so the table has already caught up when the sheet goes (no flash of the old figure).
        // A refusal by the database comes back as an error toast.
        const summary = `${TYPE_LABELS[plan.value.type]} ${formatQuantity(Math.abs(plan.value.delta))} ${material.units} of ${material.name}`;
        const sending = record;
        setTimeout(() => {
            if (record === sending) {
                closeRecord();
            }
        }, 0);
        showToast(summary);
        Promise.resolve(sent.done).catch(() => {
            showToast(`Could not record "${summary}". The stock may have changed, check it and try again.`, { kind: "error" });
        });
    }

    recordForm.addEventListener("submit", (event) => {
        event.preventDefault();
        submitRecord();
    });
    cancelBtn.addEventListener("click", () => closeRecord());
    amountInput.addEventListener("input", () => {
        hideError();
        if (record) {
            refreshRecordFromContext();
        }
    });
    recordForm.querySelectorAll(".chip[data-add]").forEach((chip) => {
        chip.addEventListener("click", () => {
            const current = parseAmount(amountInput.value) ?? 0;
            setAmount(current + Number(chip.dataset.add));
        });
    });
    allChip.addEventListener("click", () => setAmount(Number(allChip.dataset.set)));

    function setAmount(value) {
        amountInput.value = formatQuantity(value);
        hideError();
        refreshRecordFromContext();
        amountInput.focus({ preventScroll: true });
    }

    // ---- History of one material --------------------------------------------------------------

    function openHistory(materialId, openerClass) {
        const { siteId, materials } = getContext();
        const material = materials[materialId];
        if (!siteId || !material) {
            return;
        }
        stopHistory();
        const token = {};
        history = {
            token, siteId, materialId, opener: { materialId, className: openerClass },
            name: material.name ?? "", units: material.units ?? "", movements: null, error: false, stop: null,
        };
        historyTitle.textContent = `${history.name} history`;
        historyList.replaceChildren();
        renderHistory(true);
        const { opener } = history;
        openDialog(historyBox, { focus: historyClose, opener: () => findOpener(opener) });
        history.stop = data.subscribeMovements(siteId, { materialId }, (movements) => {
            if (history && history.token === token) { // ignore a late callback from a sheet we closed
                history.movements = movements;
                history.error = false;
                renderHistory(false);
            }
        }, () => {
            if (history && history.token === token) {
                history.error = true;
                renderHistory(false);
            }
        });
    }

    function stopHistory() {
        if (history && history.stop) {
            history.stop();
            history.stop = null;
        }
    }

    function closeHistory({ focus = true } = {}) {
        closeDialog(historyBox, { restore: focus });
        endHistory();
    }

    function endHistory() {
        stopHistory();
        history = null;
    }

    // Oldest first, so the list reads as a story and its last line is today's stock.
    function renderHistory(first) {
        const { materials } = getContext();
        const material = materials[history.materialId];
        // A deleted material has a "removed" movement that took its stock to zero, so 0 keeps the sums right.
        const quantity = material && typeof material.quantity === "number" ? material.quantity : 0;
        if (material) {
            history.name = material.name ?? history.name;
            history.units = material.units ?? history.units;
            historyTitle.textContent = `${history.name} history`;
        }
        historySummary.textContent = material
            ? `In stock: ${formatQuantity(quantity)} ${history.units}. Oldest first, newest at the bottom.`
            : "This material was deleted";

        historyStatus.textContent = history.error ? "Could not load the history." : history.movements ? "" : "Loading history...";
        historyStatus.hidden = historyStatus.textContent === "";
        if (!history.movements) {
            historyBefore.hidden = true;
            historyEmpty.hidden = true;
            return;
        }

        const stickToEnd = first || historyBody.scrollHeight - historyBody.scrollTop - historyBody.clientHeight < 40;
        const { rows, before } = withRunningBalance(history.movements, quantity);
        historyBefore.replaceChildren();
        historyBefore.hidden = before === 0;
        if (before !== 0) {
            const line = document.createElement("strong");
            line.textContent = `Before history: ${formatQuantity(before)} ${history.units}`.trim();
            const hint = document.createElement("span");
            hint.textContent = "Stock counted before movements were recorded.";
            historyBefore.append(line, hint);
        }
        historyEmpty.hidden = rows.length > 0;
        historyList.replaceChildren(...rows.map((row) => buildHistoryRow(row)));
        if (stickToEnd) {
            historyBody.scrollTop = historyBody.scrollHeight;
        }
    }

    function buildHistoryRow(movement) {
        const item = document.createElement("li");
        item.className = `history-row history-${movement.type} ${movement.delta >= 0 ? "history-in" : "history-out"}`;

        const type = document.createElement("span");
        type.className = "history-type";
        type.textContent = TYPE_LABELS[movement.type] || movement.type;

        const delta = document.createElement("span");
        delta.className = "history-delta";
        delta.textContent = `${formatDelta(movement.delta)} ${movement.units}`.trim();

        const who = document.createElement("span");
        who.className = "history-who";
        who.textContent = whoLabel(movement);

        const balance = document.createElement("span");
        balance.className = "history-balance";
        balance.textContent = `Balance ${formatQuantity(movement.balance)}`;

        const when = document.createElement("span");
        when.className = "history-when";
        const ago = timeAgo(movement.at);
        const stamp = formatDateTime(movement.at);
        when.textContent = /^\d{4}-/.test(ago) ? stamp : `${ago}, ${stamp}`; // older than a week: timeAgo is already a date
        when.title = stamp;

        item.append(type, delta, who, balance, when);
        if (movement.note) {
            const note = document.createElement("span");
            note.className = "history-note";
            note.textContent = movement.note;
            item.append(note);
        }
        return item;
    }

    historyClose.addEventListener("click", () => closeHistory());

    // ---- The activity feed ----------------------------------------------------------------------

    // Called whenever the selected site changes (or is cleared with null). One subscription at a time.
    function setSite(siteId) {
        if (feed.siteId === siteId && (siteId === null || feed.stop)) {
            return;
        }
        if (feed.stop) {
            feed.stop();
        }
        activityList.replaceChildren();
        activityEmpty.hidden = true;
        activityPanel.hidden = !siteId;
        feed = { siteId, stop: null, movements: null };
        if (!siteId) {
            return;
        }
        const mine = feed;
        mine.stop = data.subscribeMovements(siteId, { limit: FEED_LIMIT }, (movements) => {
            if (feed === mine) {
                mine.movements = movements;
                renderFeed();
            }
        }, () => {
            if (feed === mine) {
                activityEmpty.textContent = "Could not load activity.";
                activityEmpty.hidden = false;
            }
        });
    }

    // On a phone the feed is one line until it is opened (CSS does the folding, this is the switch).
    activityToggle.addEventListener("click", () => {
        const open = activityPanel.classList.toggle("activity-open");
        activityToggle.setAttribute("aria-expanded", String(open));
        activityToggle.textContent = open ? "Show less" : "Show all";
    });

    // Newest first, one line each. The sign is a second cue next to the colour.
    function renderFeed() {
        if (!feed.movements) {
            return;
        }
        const newestFirst = [...feed.movements].reverse();
        activityEmpty.textContent = "No activity yet. Stock that is received or used shows up here.";
        activityEmpty.hidden = newestFirst.length > 0;
        activityList.replaceChildren(...newestFirst.map((movement) => {
            const item = document.createElement("li");
            item.className = `activity-item activity-${movement.delta >= 0 ? "in" : "out"}`;
            const sign = document.createElement("span");
            sign.className = "activity-sign";
            sign.setAttribute("aria-hidden", "true");
            sign.textContent = movement.delta >= 0 ? SIGN.positive : SIGN.negative;
            const text = document.createElement("span");
            text.className = "activity-text";
            text.textContent = describeMovement(movement);
            const time = document.createElement("span");
            time.className = "activity-time";
            time.textContent = timeAgo(movement.at);
            time.title = formatDateTime(movement.at);
            item.append(sign, text, time);
            return item;
        }));
    }

    // "2h ago" goes stale on a screen that stays open on site all day.
    setInterval(() => {
        renderFeed();
        if (history && history.movements) {
            renderHistory(false);
        }
    }, CLOCK_MS);

    // ---- what dashboard.js calls --------------------------------------------------------------

    return {
        buildStockActions,
        setSite,
        // The materials or the role changed: keep the open sheets true to them.
        refresh() {
            if (record) {
                refreshRecordFromContext();
            }
            if (history) {
                renderHistory(false);
            }
        },
        // The site changed or was cleared: nothing open may keep pointing at the old one.
        closeDialogs() {
            closeRecord({ focus: false });
            closeHistory({ focus: false });
        },
    };
}
