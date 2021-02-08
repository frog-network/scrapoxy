'use strict';

const http = require('http'),
    net = require('net');

    
const config = {
    port: process.env.port || 3128,
};


// Create server
const server = http.createServer();

// Accept client via CONNECT method
server.on('connect', (req, socket, head) => {

    // Decrypt target
    parseTarget(req.url, (err, target) => {
        if (err) {
            console.error('Error (parsing): ', err);
            return socket.end();
        }

        // Connect to target
        console.log('connect to %s, port %d', target.hostname, target.port);
        const proxy_socket = net.Socket();
        proxy_socket.connect(target.port, target.hostname);

        socket.on('error', (err) => {
            console.error('Error (socket): ', err);
            proxy_socket.end();
        });

        proxy_socket.on('error', (err) => {
            console.error('Error (proxy_socket): ', err);
            socket.end();
        });

        // Send hello
        socket.write('HTTP/1.1 200 Connection established\r\n\r\n');
        proxy_socket.write(head);

        // Pipe data
        socket.pipe(proxy_socket).pipe(socket);
    });
});

// Response to PING on GET /ping
server.on('request', (req, res) => {
    if (req.method === 'GET' && req.url === '/ping') {
        setTimeout(() => {
            res.statusCode = 200;
            res.end();
        }, 1000);
    }
    else {
        res.statusCode = 404;
        res.end();
    }
});

server.listen(config.port, (err) => {
    if (err) {
        return console.error('cannot start proxy');
    }

    console.log('proxy listening at port %d', config.port);
});


////////////

function parseTarget(url, callback) {
    if (!url) return callback('No URL found');

    const part = url.split(':');
    if (part.length !== 2) {
        return callback(`Cannot parse target: ${url}`);
    }

    const hostname = part[0],
        port = parseInt(part[1]);

    if (!hostname || !port) {
        return callback(`Cannot parse target (2): ${url}`);
    }

    callback(null, {hostname, port});
}
