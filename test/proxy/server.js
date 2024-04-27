const ProxyServer = require('../../components/proxy-server');

let server = new ProxyServer({
    register_path: "/register",
    register_token: "Hello",
    // path: [],
    port: 8081
})