const ws = require("ws")


let server = new ws.Server({
    path: "/endpoint",
    port: 3001
})

server.on("connection", (ws) => {
    console.log("[Server] Connection established")

    setTimeout(() => {
        ws.ping("Hello")
    }, 1000)

    setTimeout(() => {
        ws.send("Data 1")
    }, 2000)

    ws.on("message", (message) => {
        console.log(`[Server] Received message => ${message}`)
    })

    ws.on("close", () => {
        console.log("[Server] Connection closed")
    })

    ws.on("ping", (data) => {
        console.log(`[Server] Received ping => ${data}`)
    })

    ws.on("pong", (data) => {
        console.log(`[Server] Received pong => ${data}`)
    })
})