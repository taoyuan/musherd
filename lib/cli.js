"use strict";

var pkg = require("../package");
var util = require('util');
var async = require('async');
var commander = require("commander");
var path = require('path');
var fs = require('fs');
var mosca = require('mosca');
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
        .option("--auth <file>", "the file containing the credentials", null, "./auth.json")
        .option("-c, --config <c>", "the config file to use (override every other option)")
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