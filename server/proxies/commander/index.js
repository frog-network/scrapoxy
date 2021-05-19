'use strict';

const Promise = require('bluebird'),
    Auth = require('./auth'),
    bodyParser = require('body-parser'),
    compression = require('compression'),
    cors = require('cors'),
    express = require('express'),
    morgan = require('morgan'),
    http = require('http'),
    path = require('path'),
    socketIO = require('socket.io'),
    winston = require('winston');

const  log_level = process.env.LOG_LEVEL || 'error'

winston.remove(winston.transports.Console);
winston.add(winston.transports.Console, {timestamp: true, level: log_level});

module.exports = class Commander {
    constructor(config, manager, stats) {
        this._config = config;

        // Configure Express framework
        const app = express();

        app.use(morgan('combined'));
        app.use(cors());
        app.use(compression());
        app.use(bodyParser.json());

        // Serve frontend
        app.use(express.static(path.join(__dirname, 'public')));

        // Define routes
        const router = express.Router();
        router.use('/config', require('./api/config')(this._config, manager));
        router.use('/instances', require('./api/instances')(manager));
        router.use('/scaling', require('./api/scaling')(this._config, manager));
        router.use('/stats', require('./api/stats')(stats));

        // Use auth
        const auth = new Auth(this._config.commander.password);
        app.use(
            '/api',
            (req, res, next) => auth.express(req, res, next),
            router
        );

        // Socket I.O
        this._httpServer = http.createServer(app);
        const io = socketIO(this._httpServer);
        io.use((socket, next) => auth.socketio(socket, next));

        manager.on('status:updated', (evStats) => {
            const payload = JSON.stringify({
                event: 'status:updated',
                payload: evStats,
            });

            io.emit('event', payload);
        });

        manager.on('alive:updated', (evStats) => {
            const payload = JSON.stringify({
                event: 'alive:updated',
                payload: evStats,
            });

            io.emit('event', payload);
        });

        manager.on('config:updated', (evConfig) => {
            const payload = JSON.stringify({
                event: 'config:updated',
                payload: evConfig,
            });

            io.emit('event', payload);
        });

        manager.on('scaling:updated', (evScaling) => {
            const payload = JSON.stringify({
                event: 'scaling:updated',
                payload: evScaling,
            });

            io.emit('event', payload);
        });

        manager.on('scaling:error', (evScaling) => {
            const payload = JSON.stringify({
                event: 'scaling:error',
                payload: evScaling.toString(),
            });

            io.emit('event', payload);
        });

        stats.on('stats', (evStats) => {
            const payload = JSON.stringify({
                event: 'stats',
                payload: evStats,
            });

            io.emit('event', payload);
        });
    }


    listen() {
        return new Promise((resolve, reject) => {
            // Start server
            this._server = this._httpServer.listen(this._config.commander.port, (err) => {
                if (err) {
                    return reject(
                        new Error(`[Commander] Cannot listen at port ${this._config.commander.port}:${err.toString()}`)
                    );
                }

                winston.info('[Commander] GUI is available at http://localhost:%d', this._config.commander.port);

                resolve();
            });
        });
    }


    shutdown() {
        this._server.close();
    }
};
