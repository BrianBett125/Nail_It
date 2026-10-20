// The few icons the app draws, as inline SVG: no icon font to download, nothing to block rendering, and
// they take the text colour (currentColor) so they follow every theme and every contrast fix.
// Built with createElementNS, never innerHTML.
const SVG_NS = "http://www.w3.org/2000/svg";

// Stroke paths on a 24 x 24 grid.
const PATHS = {
    trash: ["M4 7h16", "M9 7V4h6v3", "M6 7l1 13h10l1-13", "M10 11v6", "M14 11v6"],
    pen: ["M4 20h4L19.5 8.5l-4-4L4 16z", "M13.5 6.5l4 4"],
};

export const ICON_NAMES = Object.keys(PATHS);

// The icon is decoration: the button around it carries the accessible name.
export function icon(name) {
    if (!PATHS[name]) {
        throw new Error(`Unknown icon: ${name}`);
    }
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("class", `icon icon-${name}`);
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    for (const d of PATHS[name]) {
        const path = document.createElementNS(SVG_NS, "path");
        path.setAttribute("d", d);
        svg.appendChild(path);
    }
    return svg;
}
