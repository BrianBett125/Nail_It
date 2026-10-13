// Non-blocking messages, replacing alert(). No Firebase, no page state: dashboard.js
// decides what to say, this file only shows it.
//
// An error toast uses role="alert" (read out at once), the rest role="status" (polite),
// so a screen reader hears a failed save without being interrupted by every success.

const DEFAULT_MS = { info: 3500, error: 7000 };

function container() {
    let box = document.getElementById("toasts");
    if (!box) {
        box = document.createElement("div");
        box.id = "toasts";
        box.className = "toasts";
        document.body.appendChild(box);
    }
    return box;
}

// options.kind: "info" (default) or "error"
// options.actionLabel + options.onAction: one button, for example Undo. It fires at most once.
// options.duration: ms before it goes away on its own.
// Returns { dismiss } so the caller can take the toast back.
export function showToast(message, options = {}) {
    const { kind = "info", actionLabel, onAction, duration = DEFAULT_MS[kind] ?? DEFAULT_MS.info } = options;

    const toast = document.createElement("div");
    toast.className = `toast toast-${kind}`;
    toast.setAttribute("role", kind === "error" ? "alert" : "status");

    const text = document.createElement("span");
    text.className = "toast-text";
    text.textContent = message; // user text (material names) goes through textContent only
    toast.appendChild(text);

    let timer = null;
    function dismiss() {
        clearTimeout(timer);
        toast.remove();
    }

    if (actionLabel && typeof onAction === "function") {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "toast-action";
        button.textContent = actionLabel;
        button.addEventListener("click", () => {
            button.disabled = true; // a second tap must not run the action again
            dismiss();
            onAction();
        });
        toast.appendChild(button);
    }

    container().appendChild(toast);
    timer = setTimeout(dismiss, duration);
    return { dismiss };
}
