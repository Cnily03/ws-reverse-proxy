const ws = require("ws")

let client = new ws("ws://localhost:8081/endpoint")

client.on("open", function () {
    console.log("[Client] Connection established")

    setTimeout(() => {
        this.ping("World")
    }, 5000)

    setTimeout(() => {
        this.send("Data 2")
    }, 6000)

    setTimeout(() => {
        this.close()
    }, 8000)
})

client.on("message", (message) => {
    console.log(`[Client] Received message => ${message}`)
})

client.on("error", (err) => {
    console.log(`[Client] Error: ${err}`)
})

client.on("close", () => {
    console.log("[Client] Connection closed")
})

client.on("ping", (data) => {
    console.log(`[Client] Received ping => ${data}`)
})

client.on("pong", (data) => {
    console.log(`[Client] Received pong => ${data}`)
})

module.exports = client