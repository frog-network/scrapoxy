'use strict';

const _ = require('lodash'),
    Promise = require('bluebird'),
    EventEmitter = require('events').EventEmitter,
    Instance = require('./instance'),
    ScalingError = require('../../common/error/scaling'),
    log = require('../../common/logger')
    // winston = require('winston');


module.exports = class Manager extends EventEmitter {
    constructor(config, stats, providers) {
        super();

        this._config = config;
        this._stats = stats;
        this._providers = providers;

        this._managedInstances = new Map();
        this._aliveInstances = [];
        this._aliveInstancesMap = new Map();

        this._domains = new Map();

        this._config.scaling.required = this._config.scaling.required || this._config.scaling.min;
    }


    get instances() {
        return Array.from(this._managedInstances.values());
    }


    get aliveInstances() {
        return this._aliveInstances;
    }


    get stats() {
        return this.instances.map((i) => i.stats);
    }


    waitForAliveInstances(count) {
        log.debug('[Manager] waitForAliveInstances: count=%d', count);

        if (this._aliveInstances.length === count) {
            return Promise.resolve();
        }
        else {
            return Promise
                .delay(2000)
                .then(() => this.waitForAliveInstances(count));
        }
    }


    start() {
        const self = this;

        log.debug('[Manager] start');

        self._checkIntervalTimeout = setInterval(checkInstances, self._config.checkDelay);


        ////////////

        function checkInstances() {
            log.debug('[Manager] checkInstances');

            Promise.map(self._providers,
                (provider) => provider.models
                    .then((models) => assignProviderToModels(models, provider))
            )
                .then((modelsByProvider) => _.flatten(modelsByProvider))
                .then(updateInstances)
                .then(adjustInstances)
                .catch((err) => {
                    if (err instanceof ScalingError) {
                        self.emit('scaling:error', err);
                    }

                    log.error('[Manager] Error: Cannot update or adjust instances:', err);
                });


            ////////////

            function assignProviderToModels(models, provider) {
                models.forEach((model) => {
                    model.provider = provider;
                });

                provider.instancesCount = models.length;

                return models;
            }

            function updateInstances(models) {
                const existingNames = Array.from(self._managedInstances.keys());

                models.forEach((model) => {
                    const name = model.name;

                    // Get provider
                    const provider = model.provider;
                    delete model.provider;

                    let instance = self._managedInstances.get(name);
                    if (instance) {
                        // Modify
                        instance.model = model;

                        const idx = existingNames.indexOf(name);
                        if (idx >= 0) {
                            existingNames.splice(idx, 1);
                        }
                    }
                    else {
                        // Add
                        log.debug('[Manager] checkInstances: add:', model.toString());

                        instance = new Instance(self, self._stats, provider, self._config);
                        self._managedInstances.set(name, instance);

                        registerEvents(instance);

                        instance.model = model;
                    }
                });

                // Remove
                existingNames.forEach((name) => {
                    const instance = self._managedInstances.get(name);

                    log.debug('[Manager] checkInstances: remove:', instance.model.toString());

                    self._managedInstances.delete(name);

                    instance.removedFromManager();
                });


                ////////////

                function registerEvents(inst) {
                    inst.on('status:updated', () => self.emit('status:updated', inst.stats));

                    inst.on('alive:updated', (alive) => {
                        const name = inst.name;
                        if (alive && !inst.removing) {
                            self._aliveInstances.push(inst);
                            self._aliveInstancesMap.set(name, inst);
                        }
                        else {
                            // If instance is not alive OR instance is alived but is asked to be removed
                            // we remove the instance from the alive pool
                            const idx = self._aliveInstances.indexOf(inst);
                            if (idx >= 0) {
                                self._aliveInstances.splice(idx, 1);
                            }

                            self._aliveInstancesMap.delete(name);
                        }

                        self.emit('alive:updated', inst.stats);
                    });
                }
            }


            function adjustInstances() {
                const managedCount = self._managedInstances.size;
                log.debug('[Manager] adjustInstances: required:%d / actual:%d', self._config.scaling.required, managedCount);

                if (managedCount > self._config.scaling.required) {
                    // Too much
                    const count = managedCount - self._config.scaling.required;

                    log.debug('[Manager] adjustInstances: remove %d instances', count);

                    const instances = _(Array.from(self._managedInstances.values()))
                        .sampleSize(count)
                        .filter((instance) => !instance.model.locked) // only unlocked instance can be removed
                        .value();
                    return Promise.map(instances, (instance) => instance.remove());
                }
                else if (managedCount < self._config.scaling.required) {
                    // Not enough
                    const count = self._config.scaling.required - managedCount;

                    log.debug('[Manager] adjustInstances: add %d instances', count);

                    return createInstances(count);
                }


                ////////////

                function createInstances(cnt) {
                    const counters = buildCounters();

                    // Split the count
                    const countersAvailable = counters.slice(0);
                    let i = 0;
                    while (i < cnt && countersAvailable.length > 0) {
                        const
                            counterIdx = Math.floor(Math.random() * countersAvailable.length),
                            counter = countersAvailable[counterIdx];

                        if (counter.max >= 0 && counter.count >= counter.max) {
                            countersAvailable.splice(counterIdx, 1);
                        }
                        else {
                            counter.count++;
                            i++;
                        }
                    }

                    const countersFilled = counters.filter((counter) => counter.count > 0);
                    if (countersFilled.length <= 0) {
                        throw new ScalingError(cnt, false);
                    }

                    return Promise.map(countersFilled,
                        (counter) => counter.provider.createInstances(counter.count)
                    );


                    ////////////

                    function buildCounters() {
                        return self._providers.map((provider) => {
                            const counter = {
                                count: 0,
                                provider,
                            };

                            if (provider._config.max) {
                                counter.max = Math.max(0, provider._config.max - provider.instancesCount);
                            }

                            return counter;
                        });
                    }
                }
            }
        }
    }


    /**
     * For testing purpose
     */
    crashRandomInstance() {
        const names = Array.from(this._managedInstances.keys());

        const randomName = names[Math.floor(Math.random() * names.length)];

        log.debug('[Manager] crashRandomInstance: name=%s', randomName);

        const instance = this._managedInstances.get(randomName);
        return instance.remove();
    }


    stop() {
        const self = this;

        log.debug('[Manager] stop');

        self._config.scaling.required = 0;
        self.emit('scaling:updated', self._config.scaling);

        return waitForNoInstance()
            .then(() => {
                if (self._checkIntervalTimeout) {
                    clearInterval(self._checkIntervalTimeout);
                }
            });


        ////////////

        function waitForNoInstance() {
            return new Promise((resolve) => {
                checkNoInstance();


                ////////////

                function checkNoInstance() {
                    const managedCount = self._managedInstances.size;
                    if (managedCount <= 0) {
                        resolve();
                    }
                    else {
                        setTimeout(checkNoInstance, self._config.checkDelay);
                    }
                }
            });
        }
    }


    getNextRunningInstanceForDomain(domain, forceName) {
        const self = this;

        if (self._aliveInstances.length <= 0) {
            return;
        }

        domain = domain || '';

        let nextInstance;
        if (forceName) {
            nextInstance = self._aliveInstancesMap.get(forceName);
        }

        if (!nextInstance) {
            const actualInstance = self._domains.get(domain);

            nextInstance = getNextRunningInstance(actualInstance);
        }

        self._domains.set(domain, nextInstance);

        return nextInstance;


        ////////////

        function getNextRunningInstance(instance) {
            if (self._aliveInstances.length <= 0) {
                return;
            }

            let idx;
            if (instance) {
                idx = self._aliveInstances.indexOf(instance);
                if (idx >= 0) {
                    ++idx;
                    if (idx >= self._aliveInstances.length) {
                        idx = 0;
                    }
                }
                else {
                    idx = 0;
                }
            }
            else {
                idx = 0;
            }

            if (idx >= self._aliveInstances.length) {
                return;
            }

            return self._aliveInstances[idx];
        }
    }


    /*
    getFirstInstance(forceName) {
        if (this._aliveInstances.length <= 0) {
            return;
        }

        let nextInstance;
        if (forceName) {
            nextInstance = this._aliveInstancesMap.get(forceName);
        }

        if (!nextInstance) {
            nextInstance = this._aliveInstances[0];
        }

        return nextInstance;
    }
    */


    requestReceived() {
        if (this._config.scaling.required <= 0) {
            // Shutdown
            return;
        }

        if (this._config.scaling.required !== this._config.scaling.max) {
            this._config.scaling.required = this._config.scaling.max;
            this.emit('scaling:updated', this._config.scaling);
        }

        if (this._scaleDownTimeout) {
            clearTimeout(this._scaleDownTimeout);
        }

        this._scaleDownTimeout = setTimeout(() => {
            this._config.scaling.required = this._config.scaling.min;
            this.emit('scaling:updated', this._config.scaling);
        }, this._config.scaling.downscaleDelay);
    }


    removeInstance(name) {
        const instance = this._managedInstances.get(name);
        if (!instance) {
            return;
        }

        return instance.remove();
    }
};
