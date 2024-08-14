function fmtPath(p) {
    if (typeof p === "undefined" || p === null) p = "/"
    if (typeof p !== "string") p = p.toString()
    if (!p.startsWith("/")) p = "/" + p
    let { href, origin, pathname, search } = new URL("http://localhost" + p, "http://localhost")
    p = href.startsWith(origin) ? href.substring(origin.length) : (pathname + search)
    return p = p.startsWith("/") ? p : ("/" + p)
}

function copyHeader(src) {
    let dst = {}
    let blacklist = [
        "host"
    ]
    for (let key in src) {
        if (Object.prototype.hasOwnProperty.call(src, key)) {
            if (blacklist.includes(key)) continue
            dst[key] = src[key]
        }
    }
    return dst
}

function isSafeWsCloseCode(code) {
    const DEFINED_CODES = [
        1000, 1001, 1002, 1003, 1007, 1008, 1009, 1010, 1011, 1012, 1013
    ]
    if (DEFINED_CODES.includes(code)) return true
    if (code >= 3000 && code <= 3999) return true
    if (code >= 4000 && code <= 4999) return true
    return false
}

module.exports = {
    fmtPath,
    copyHeader,
    isSafeWsCloseCode
}