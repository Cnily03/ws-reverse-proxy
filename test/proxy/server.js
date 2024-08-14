const ProxyServer = require('../../src/proxy-server');

let server = new ProxyServer({
    register_path: "/register",
    register_token: "123456",
    // path: [],
    port: 8081
})