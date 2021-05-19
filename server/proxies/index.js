'use strict';

const Commander = require('./commander'),
    Manager = require('./manager'),
    Master = require('./master'),
    Stats = require('./stats'),
    winston = require('winston');

const  log_level = process.env.LOG_LEVEL || 'error'

winston.remove(winston.transports.Console);
winston.add(winston.transports.Console, {timestamp: true, level: log_level});

module.exports = class Proxies {
    constructor(config, providers) {
        this._config = config;
        this._providers = providers;

        // Show provider name
        const providersName = this._providers.map((provider) => `${provider.name}/${provider.region}`);
        winston.info('[Main] The selected providers are', providersName.join(', '));

        // Stats
        this._stats = new Stats(this._config.stats);

        // Init Manager
        this._manager = new Manager(
            this._config.instance,
            this._stats,
            this._providers
        );

        // Init Master
        this._master = new Master(
            this._config.proxy,
            this._manager,
            this._stats
        );

        // Init Commander
        this._commander = new Commander(
            this._config,
            this._manager,
            this._stats
        );
    }


    get manager() {
        return this._manager;
    }


    listen() {
        winston.debug('[Main] listen');

        // Start Commander
        return this._commander
            .listen()
            .then(() => {
                // Start Manager
                this._manager.start();

                // Start Master
                return this._master.listen();
            });
    }


    listenAndWait() {
        winston.debug('[Main] listenAndWait');

        return this
            .listen()
            .then(() => this._manager.waitForAliveInstances(this._config.instance.scaling.min));
    }


    shutdown() {
        winston.debug('[Main] shutdown');

        this._master.shutdown();
        this._commander.shutdown();

        return this._manager
            .stop()
            .then(() => winston.info('[Main] All instances are stopped.'));
    }
};
