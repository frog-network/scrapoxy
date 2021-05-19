const winston = require('winston')

module.exports = winston.createLogger({
    level: process.env.LOG_LEVEL || 'error',
    format: winston.format.json(),
    defaultMeta: {service: 'user-service'},
    transports: [
        new winston.transports.Console( {timestamp: true, level: process.env.LOG_LEVEL || 'error'})
        // loggingWinston,
    ]
})
