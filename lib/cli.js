"use strict";

var pkg = require("../package");
var util = require('util');
var async = require('async');
var commander = require("commander");
var path = require('path');
var fs = require('fs');
var mosca = require('mosca');
var persistence = mosca.persistence;
var Server = mosca.Server;
var Authorizer = require('./Authorizer');

function loadAuthorizer(file, cb) {
    if (file) {
        fs.readFile(file, function (err, data) {
            if (err) {
                cb(err);
                return;
            }

            var authorizer = new Authorizer();

            try {
                authorizer.data(JSON.parse(data));
                cb(null, authorizer);
            } catch (err) {
                cb(err);
            }
        });
    } else {
        cb(null, null);
    }
}

/**
 * Start a new server
 *
 * @api private
 * @param {commander.Command} program the parsed argument
 * @param {Function} callback the callback to call when finished
 */
function start(program, callback) {
    return function() {

        var server = null;

        var defopts = {
            backend: {},
            logger: {},
            stats: true,
            persistence: {
                factory: mosca.persistence.Memory
            }
        };

        var opts = defopts;

        opts.port = program.port;
        opts.host = program.host;

        if (program.parentPort || program.parentHost) {
            opts.backend.type = "mqtt";
            opts.backend.port = 1883;
        }

        if (program.parentHost) {
            opts.backend.host = program.parentHost;
        }

        if (program.parentPort) {
            opts.backend.port = program.parentPort;
        }

        opts.backend.prefix = program.parentPrefix;

        if (program.disableStats) {
            opts.stats = false;
        }

        opts.id = program.brokerId;

        if (program.cert || program.key) {
            if (program.cert && program.key) {
                opts.secure = {};
                opts.secure.port = program.securePort;
                opts.secure.keyPath = program.key;
                opts.secure.certPath = program.cert;
                opts.allowNonSecure = program.nonSecure;
            }
            else {
                throw new Error("Must supply both private key and signed certificate to create secure mosca server");
            }
        }

        if (program.httpPort || program.onlyHttp) {
            opts.http = {
                port: program.httpPort,
                static: program.httpStatic,
                bundle: program.httpBundle
            };
            opts.onlyHttp = program.onlyHttp;
        }

        if (program.httpsPort) {
            if(program.cert && program.key) {
                opts.https = {
                    port:   program.httpsPort,
                    static: program.httpsStatic,
                    bundle: program.httpsBundle
                };
            } else {
                throw new Error("Must supply both private key and signed certificate to create secure mosca websocket server");
            }
        }

        if (program.config) {
            opts = require(path.resolve(program.config));

            // merge any unspecified options into opts from defaults (defopts)
            Object.keys(defopts).forEach(function(key) {
                if(typeof opts[key] === 'undefined') {
                    opts[key] = defopts[key];
                }
            });
        }

        if (program.info) {
            opts.logger.level = 30;
        } else if (program.debug) {
            opts.logger.level = 20;
        }

        if (program.db) {
            opts.persistence.path = program.db;
            opts.persistence.factory = persistence.LevelUp;
        }

        var setupAuthorizer = function(cb) {
            process.on("SIGHUP", setupAuthorizer);
            server.on("closed", function() {
                process.removeListener("SIGHUP", setupAuthorizer);
            });

            loadAuthorizer(program.auth, function(err, authorizer) {
                if (err) {
                    callback(err);
                    return;
                }

                if (authorizer) {
                    server.authenticate = authorizer.authenticate;
                    server.authorizeSubscribe = authorizer.authorizeSubscribe;
                    server.authorizePublish = authorizer.authorizePublish;
                }

                if (cb) {
                    cb(null, server);
                }
            });

            return false;
        };

        async.series([
            function(cb) {
                server = new Server(opts);
                server.on("ready", cb);
            },
            setupAuthorizer
        ], function(err, results) {
            callback(err, results[1]);
        });

        return server;
    };
}

module.exports = function cli(argv, callback) {
    argv = argv || [];

    var program = new commander.Command();
    var server = null;
    var runned = false;

    callback = callback || function() {};

    program
        .version(pkg.version)
        .option("-p, --port <n>", "the port to listen to", parseInt)
        .option("--host <IP>", "the host to listen to")
        .option("--parent-port <n>", "the parent port to connect to", parseInt)
        .option("--parent-host <s>", "the parent host to connect to")
        .option("--parent-prefix <s>", "the prefix to use in the parent broker")
        .option("--auth <file>", "the file containing the credentials", null, "./auth.json")
        .option("--key <file>", "the server's private key")
        .option("--cert <file>", "the certificate issued to the server")
        .option("--secure-port <n>", "the TLS port to listen to", parseInt)
        .option("--non-secure", "start both a secure and non-secure server")
        .option("--http-port <n>", "start an mqtt-over-websocket server on the specified port", parseInt)
        .option("--https-port <n>", "start an mqtt-over-secure-websocket server on the specified port", parseInt)
        .option("--http-static <directory>", "serve some static files alongside the websocket client")
        .option("--https-static <directory>", "serve some static files alongside the secure websocket client")
        .option("--http-bundle", "serve a MQTT.js-based client at /mqtt.js on HTTP")
        .option("--https-bundle", "serve a MQTT.js-based client at /mqtt.js on HTTPS")
        .option("--only-http", "start only an mqtt-over-websocket server")
        .option("--disable-stats", "disable the publishing of stats under $SYS", null, true)
        .option("--broker-id <id>", "the id of the broker in the $SYS/<id> namespace")
        .option("-c, --config <c>", "the config file to use (override every other option)")
        .option("-d, --db <path>", "the path were to store the database")
        .option("-i, --info", "set the bunyan log to INFO")
        .option("--debug", "set the bunyan log to DEBUG");

    var loadAuthorizerAndSave = function (cb) {
        runned = true;

        loadAuthorizer(program.auth, function (err, authorizer) {
            if (err) {
                authorizer = new Authorizer();
            }

            cb(null, authorizer, function(err) {
                if (err) {
                    callback(err);
                    return;
                }
                fs.writeFile(program.auth, JSON.stringify(authorizer.data(), null, 2), callback);
            });
        });
    };

    var addapp = function (name, key, secret) {
        runned = true;
        loadAuthorizerAndSave(function(err, authorizer, done) {
            authorizer.addApp(name, key, secret, function (err, app) {
                if (!err) {
                    console.log('==========================================================');
                    console.log('created app [%s - %s]', app.name, app.key);
                    console.log('----------------------------------------------------------');
                    console.log(util.inspect(app, {colors: true}));
                    console.log('==========================================================');
                    console.log('');
                }
                done(err, app);
            });
        });
    };

    var rmapp = function (key) {
        runned = true;
        loadAuthorizerAndSave(function(err, authorizer, done) {
            authorizer.rmApp(key, function (err, app) {
                if (!err) {
                    if (app) console.log('[rmapp] removed app [%s - %s]', app.name, app.key);
                    else console.log('[rmapp] no app with key `%s` removed', key);
                    console.log('');
                }
                done(err);
            });
        });
    };

    program.
        command("addapp <name> [key] [secret]").
        description("Add a user to the given credentials file").
        action(addapp);

    program.
        command("rmapp <key>").
        description("Removes a user from the given credentials file").
        action(rmapp);

    var doStart = start(program, callback);

    program.
        command("start").
        description("start the server (optional)").
        action(doStart);

    program.parse(argv);

    if (!runned) {
        return doStart();
    }
};