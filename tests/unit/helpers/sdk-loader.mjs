// Node loader hook: any import of the Firebase CDN resolves to the local recording stub,
// so src/data.js can be imported and exercised in Node without a network or a database.
export async function resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("https://www.gstatic.com/firebasejs/")) {
        return { url: new URL("./sdk-stub.js", import.meta.url).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
}
