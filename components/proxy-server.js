const ws = require("ws")
const uuid = require("uuid")
const http = require('http');
const DataTransformer = require("./data-transformer")
const { fmtPath, copyHeader, isSafeWsCloseCode } = require("./utils")

class ProxyServer {
    /**
     * Proxy Server
     * @param {Object} options - The options for the proxy server.
     * @param {string|string[]} options.path - The path or paths that the proxy server should handle.
     * @param {number|boolean} options.heartbeat - The heartbeat interval in seconds. Set to 0 to disable heartbeat. Set to true to use a default interval of 3600 seconds. Set to false to disable heartbeat.
     * @param {string} options.register_path - The path for registering transfer clients.
     * @param {string|null} options.register_token - The registration token for transfer clients. Set to null for no token.
     * @param {string} [options.host] - The host address to bind the proxy server to. If not provided, the server will bind to all available network interfaces.
     * @param {number} options.port - The port number to listen on.
     * @throws {Error} Throws an error if the options are invalid.
     */
    constructor(options) {
        const opts = {}

        if (typeof options.path === "undefined") {
            opts.path = []
        } else if (typeof options.path === "string") {
            opts.path = [fmtPath(options.path)]
        } else if (Array.isArray(options.path)) {
            opts.path = options.path.map(fmtPath)
        } else {
            throw new Error("Invalid path")
        }

        opts.heartbeat = 0;
        if (typeof options.heartbeat === "number") {
            opts.heartbeat = options.heartbeat <= 0 ? 0 : options.heartbeat
        } else if (typeof options.heartbeat === "boolean") {
            opts.heartbeat = options.heartbeat ? 3600 : 0
        } else if (typeof options.heartbeat !== "undefined") {
            throw new Error("Invalid value: heartbeat")
        }
        this.heartbeat = opts.heartbeat

        opts.register_path = fmtPath(options.register_path)
        opts.register_token = options.register_token || null
        opts.host = typeof options.host === "string" ? options.host : undefined
        opts.port = options.port

        this.DT = new DataTransformer([0xc4, 0x11, 0x75, 0x03])

        this.main_server = http.createServer((req, res) => {
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end("");
        })

        this.transfer_server = new ws.Server({ noServer: true, autoPong: true })
        this.initTransferWsServer(this.transfer_server)
        /**
         * @type {Object.<string, ws.Server>}
         */
        this.server_map = {} // path: ws.Server
        /**
         * @type {Object.<string, ws>}
         */
        this.transfer_client_map = {} // transfer_client_id: ws
        /**
         * @type {Object.<string, ws>}
         */
        this.client_map = {} // client_ws_id: ws
        /**
         * @type {Object.<string, string>}
         */
        this.connect_map = {} // client_ws_id: transfer_client_id

        // for (let p of opts.path) {
        //     this.createWsServer(p)
        // }

        this.main_server.on("upgrade", (req, socket, head) => {
            let { pathname } = new URL(req.url, `http://${req.headers.host}`)

            if (opts.register_path === pathname) {
                // transfer client
                if (this.authRegister(pathname, req, opts.register_token)) {
                    this.transfer_server.handleUpgrade(req, socket, head, (ws) => {
                        this.transfer_server.emit("connection", ws, req)
                    })
                } else {
                    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n")
                    return socket.end()
                }

            } else if (opts.path.length === 0 || opts.path.includes(pathname)) {
                // ensure at least one transfer client exists
                if (Object.keys(this.transfer_client_map).length === 0) {
                    socket.write("HTTP/1.1 503 Service Unavailable\r\n\r\n")
                    return socket.end()
                }
                this.createWsServer(pathname)
                this.server_map[pathname].handleUpgrade(req, socket, head, (ws) => {
                    this.server_map[pathname].emit("connection", ws, req)
                })
            } else {
                return socket.destroy()
            }
        })

        this.main_server.listen(opts.port, opts.host, () => {
            let protocol = "ws://"
            console.info("[ProxyServer]", "[Main]", `Server is listening on ${protocol}${opts.host || "0.0.0.0"}:${opts.port}`)
        })
    }

    /**
     * @param {string} path
     * @param {http.IncomingMessage} req
     * @param {string | null} correct_token
     * @returns {boolean}
     */
    authRegister(path, req, correct_token) {
        if (!(correct_token || '')) return true

        let correct_auth = "Bearer " + correct_token
        let req_auth = req.headers.authorization

        if (typeof req_auth === "string") {
            return req_auth === correct_auth
        }

        return false
    }

    getTransferClient(ws_id) {
        if (Object.prototype.hasOwnProperty.call(this.connect_map, ws_id)) {
            return this.transfer_client_map[this.connect_map[ws_id]]
        } else {
            let keys = Object.keys(this.transfer_client_map)
            let count_map = {}
            for (let k of keys) { count_map[k] = 0 }
            for (let k of Object.values(this.connect_map)) { count_map[k]++ }
            let min_count = Math.min(...Object.values(count_map))
            let min_keys = keys.filter(k => count_map[k] === min_count)
            let transfer_client_id = min_keys[Math.floor(Math.random() * keys.length)]
            this.connect_map[ws_id] = transfer_client_id
            return this.transfer_client_map[transfer_client_id]
        }
    }

    closeTransferClient(transfer_client_id, code, reason) {
        console.info("[ProxyServer]", "[Main]", `Transfer client ${transfer_client_id} closed`)
        delete this.transfer_client_map[transfer_client_id]
        for (let ws_id of Object.keys(this.connect_map)) {
            if (this.connect_map[ws_id] === transfer_client_id) {
                this.closeClientManually(ws_id, code, reason)
            }
        }
    }

    closeClientManually(ws_id, code, reason) {
        if (this.client_map[ws_id]) {
            this.client_map[ws_id].dead = true
            if (isSafeWsCloseCode(code)) {
                this.client_map[ws_id].close(code, reason)
            } else {
                this.client_map[ws_id].terminate()
            }
            this.removeClientInfo(ws_id)
        }
    }

    removeClientInfo(ws_id) {
        delete this.client_map[ws_id]
        delete this.connect_map[ws_id]
        console.info("[ProxyServer]", "[Client]", `Client closed - #${ws_id}`)
    }

    /**
     * @param {ws.Server} wss
     */
    initTransferWsServer(wss) {
        wss.on("connection", (ws, req) => {
            let _id = "i_" + uuid.v1({
                msecs: new Date().getTime() ^ 0xf1dc4,
            })
            ws.id = _id
            this.transfer_client_map[_id] = ws
            console.info("[ProxyServer]", "[Main]", `Transfer client established #${_id} (remote ${req.socket.remoteAddress}) - `)

            ws.on("close", (code, reason) => {
                this.closeTransferClient(ws.id, code, reason)
            })

            ws.on("ping", (buf) => {
                if (this.DT.isThis(buf)) {
                    const data = this.DT.decode(buf)
                    if (data.type === "heartbeat") {
                        return
                    }
                }
            })

            ws.on("pong", (buf) => {
                if (this.DT.isThis(buf)) {
                    const data = this.DT.decode(buf)
                    if (data.type === "heartbeat") {
                        return
                    }
                }
            })

            ws.on("message", (buf) => {
                if (!this.DT.isThis(buf)) return

                const data = this.DT.decode(buf)
                // [L->R] deliver the message
                if (data.type === "message") {
                    let id = data.id
                    if (this.client_map[id]) {
                        this.client_map[id].send(data.stream)
                    }
                }
                // [L->R] ping
                else if (data.type === "ping") {
                    let id = data.id
                    if (this.client_map[id]) {
                        this.client_map[id].ping(data.stream)
                    }
                }
                // [L->R] pong
                else if (data.type === "pong") {
                    let id = data.id
                    if (this.client_map[id]) {
                        this.client_map[id].pong(data.stream)
                    }
                }
                // [L->R] close connection
                else if (data.type === "close") {
                    let id = data.id
                    this.closeClientManually(id, data.code, data.reason)
                }
            })
        })

        if (this.heartbeat > 0) {
            setInterval(() => {
                for (let id of Object.keys(this.transfer_client_map)) {
                    this.transfer_client_map[id].ping(this.DT.encode({
                        type: "heartbeat",
                        ts: new Date().getTime()
                    }))
                }
            }, this.heartbeat)
        }
    }

    createWsServer(path, norepeat = true) {
        if (norepeat && this.server_map[path]) return this.server_map[path]
        const _ws = new ws.Server({ noServer: true, autoPong: false })
        this.initWsServer(path, _ws)
        // return this.server_map[path] = _ws
        return _ws
    }

    /**
     * @param {string} path
     * @param {ws.Server} wss
     */
    initWsServer(path, wss) {
        this.server_map[path] = wss

        wss.on("connection", (ws, req) => {
            let id = "c_" + uuid.v1({
                msecs: new Date().getTime() ^ 0x4c1fd,
            })
            ws.id = id
            ws.dead = false // prevent multiple close
            this.client_map[id] = ws
            console.info("[ProxyServer]", "[Client]", `Client established - ${path} - ${req.socket.remoteAddress} - #${id}`)

            // [R->L] setup connection
            this.getTransferClient(ws.id).send(this.DT.encode({
                type: "connect",
                id: ws.id,
                path: path,
                headers: copyHeader(req.headers)
            }))

            ws.on("close", (code, reason) => {
                if (ws.dead) return
                // [R->L] close connection
                this.getTransferClient(ws.id).send(this.DT.encode({
                    type: "close",
                    id: ws.id,
                    code: code,
                    reason: (reason || '').toString()
                }))
                this.removeClientInfo(ws.id)
            })

            ws.on("ping", (buf) => {
                // [R->L] ping
                this.getTransferClient(ws.id).send(this.DT.encode({
                    type: "ping",
                    id: ws.id,
                    stream: buf
                }))
            })

            ws.on("pong", (buf) => {
                // [R->L] pong
                this.getTransferClient(ws.id).send(this.DT.encode({
                    type: "pong",
                    id: ws.id,
                    stream: buf
                }))
            })

            ws.on("message", (buf) => {
                // [R->L] deliver the message
                this.getTransferClient(ws.id).send(this.DT.encode({
                    type: "message",
                    id: ws.id,
                    stream: buf
                }))
            })
        })
    }
}

module.exports = ProxyServer