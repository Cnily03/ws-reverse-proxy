const ws = require("ws")
const uuid = require("uuid")
const http = require('http');
const DataTransformer = require("./data-transformer")
const { fmtPath, isSafeWsCloseCode } = require("./utils");
const { create } = require("domain");

class ProxyClient {
    /**
     * Proxy Client
     * @param {string} serverURI - The URI of the proxy WebSocket server.
     * @param {Object} options - The options for the ProxyClient.
     * @param {string=} options.token - The token for authorization.
     * @param {string} options.target - The target WebSocket URI.
     * @param {number|boolean=} options.heartbeat - The heartbeat interval in milliseconds. Set to `false` to disable heartbeat. Default is `false`.
     * @param {number|boolean=} options.reconnect - The reconnect interval in milliseconds. Set to `false` to disable reconnect. Default is `10000`.
     */
    constructor(serverURI, options) {
        const opts = {}
        opts.token = options.token || null
        opts.server = /^wss?:\/\//.test(serverURI) ? serverURI : ("ws://" + serverURI)
        if (typeof options.target === "string") {
            opts.target = /^wss?:\/\//.test(options.target) ? options.target : ("ws://" + options.target)
        } else throw new Error("Invalid WebSocket URI: target")

        opts.heartbeat = 0;
        if (typeof options.heartbeat === "number") {
            opts.heartbeat = options.heartbeat <= 0 ? 0 : options.heartbeat
        } else if (typeof options.heartbeat === "boolean") {
            opts.heartbeat = options.heartbeat ? 3600 : 0
        } else if (typeof options.heartbeat !== "undefined") {
            throw new Error("Invalid value: heartbeat")
        }
        this.heartbeat = opts.heartbeat

        opts.reconnect = 10 * 1000
        if (typeof options.reconnect === "number") {
            opts.reconnect = options.reconnect <= 0 ? 0 : options.reconnect
        } else if (typeof options.reconnect === "boolean") {
            opts.reconnect = options.reconnect ? 10 * 1000 : 0
        } else if (typeof options.reconnect !== "undefined") {
            throw new Error("Invalid value: reconnect")
        }
        this.reconnect = opts.reconnect

        this.targetURI = opts.target
        this.serverURI = opts.server

        /**
         * @type {Object.<string, ws>}
         */
        this.client_map = {} // id: ws

        this.DT = new DataTransformer([0xc4, 0x11, 0x75, 0x03])

        this.createTransferWs(opts.token)
        // this.transfer_client = new ws(this.serverURI, { headers, autoPong: true })
        // this.initTransferWs(this.transfer_client)

        if (this.reconnect > 0) {
            setInterval(() => {
                if (this.transfer_client.readyState === ws.CLOSED) {
                    console.info("[ProxyClient]", "[Main]", `Reconnecting...`)
                    delete this.transfer_client
                    this.createTransferWs(opts.token)
                }
            }, this.reconnect)
        }
    }

    closeClientManually(id, code, reason) {
        if (this.client_map[id]) {
            this.client_map[id].dead = true
            if (isSafeWsCloseCode(code)) {
                this.client_map[id].close(code, reason)
            } else {
                this.client_map[id].terminate()
            }
            this.removeClientInfo(id)
        }
    }

    removeClientInfo(id) {
        delete this.client_map[id]
        console.info("[ProxyClient]", "[Client]", `Connection closed - #${id}`)
    }

    createTransferWs(auth_token) {
        let headers = typeof auth_token === "string" ? {
            "Authorization": "Bearer " + auth_token
        } : {}
        const _ws = new ws(this.serverURI, { headers, autoPong: true })
        this.initTransferWs(_ws)
        // return this.transfer_client = _ws
        return _ws
    }

    /**
     * @param {ws} ws
     */
    initTransferWs(ws) {
        this.transfer_client = ws

        ws.on("open", () => {
            console.info("[ProxyClient]", "[Main]", `Transfer connection established`)

            ws.on("close", (code, reason) => {
                console.info("[ProxyClient]", "[Main]", `Transfer connection closed`)
                for (let id of Object.keys(this.client_map)) {
                    this.closeClientManually(id, code, reason)
                }
            })
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
            // [R->L] deliver the message
            if (data.type === "message") {
                let id = data.id;
                if (this.client_map[id]) {
                    this.client_map[id].send(data.stream)
                }
            }
            // [R->L] close connection
            else if (data.type === "close") {
                let id = data.id;
                this.closeClientManually(id, data.code, data.reason)
            }
            // [R->L] ping
            else if (data.type === "ping") {
                let id = data.id;
                if (this.client_map[id]) {
                    this.client_map[id].ping(data.stream)
                }
            }
            // [R->L] pong
            else if (data.type === "pong") {
                let id = data.id;
                if (this.client_map[id]) {
                    this.client_map[id].pong(data.stream)
                }
            }
            // [R->L] setup connection
            else if (data.type === "connect") {
                let id = data.id;
                let fullpath = data.fullpath;
                let headers = data.headers;
                this.client_map[id] = this.createWs(id, fullpath, headers)
            }
            // Assign ID
            else if (data.type === "assign") {
                if (data.status === "new") {
                    let transfer_id = data.transfer_id;
                    ws.id = transfer_id
                    console.info("[ProxyClient]", "[Main]", `Assigned ID: #${transfer_id}`)
                    ws.send(this.DT.encode({
                        type: "assign",
                        status: "ok",
                        transfer_id: transfer_id
                    }))
                }
            }
        })

        ws.on("error", (err) => {
            console.error("[ProxyClient]", "[Main]", "Error:", err.message)
        })

        if (this.heartbeat > 0) {
            setInterval(() => {
                ws.ping(this.DT.encode({
                    type: "heartbeat",
                    ts: new Date().getTime()
                }))
            }, this.heartbeat)
        }
    }

    /**
     * @param {ws} ws
     */
    initWs(id, path, ws) {
        ws.id = id
        ws.dead = false // prevent multiple close

        ws.on("open", () => {
            console.info("[ProxyClient]", "[Client]", `Connection established - ${path} - #${ws.id}`)

            ws.on("close", (code, reason) => {
                if (ws.dead) return
                // [L->R] close connection
                this.transfer_client.send(this.DT.encode({
                    type: "close",
                    id: ws.id,
                    code: code,
                    reason: (reason || '').toString()
                }))
                this.removeClientInfo(ws.id)
            })
        })

        ws.on("ping", (buf) => {
            // [L->R] ping
            this.transfer_client.send(this.DT.encode({
                type: "ping",
                id: ws.id,
                stream: buf
            }))
        })

        ws.on("pong", (buf) => {
            // [L->R] pong
            this.transfer_client.send(this.DT.encode({
                type: "pong",
                id: ws.id,
                stream: buf
            }))
        })

        ws.on("message", (buf) => {
            // [L->R] deliver the message
            this.transfer_client.send(this.DT.encode({
                type: "message",
                id: ws.id,
                stream: buf
            }))
        })

        ws.on("error", (err) => {
            console.error("[ProxyClient]", "[Client]", `Error - ${path} - #${ws.id}`, err.message)
        })
    }

    createWs(id, fullpath, headers) {
        const _ws = new ws(`${this.targetURI}${fmtPath(fullpath)}`, { headers, autoPong: false })
        this.initWs(id, fullpath, _ws)
        return _ws
    }
}

module.exports = ProxyClient