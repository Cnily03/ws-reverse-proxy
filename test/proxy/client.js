const ProxyClient = require("../../components/proxy-client");

let client = new ProxyClient( "localhost:8081/register", {
    target: "ws://localhost:3001",
    token: "123456",
    heartbeat: 1000
})