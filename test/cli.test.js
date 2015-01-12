var async = require("async");
var tmp = require('tmp');
var fs = require("fs");
var mqtt = require("mqtt");
var os = require("os");
var mosca = require('mosca');

var musherd = require('../');

var SECURE_KEY = __dirname + '/secure/tls-key.pem';
var SECURE_CERT = __dirname + '/secure/tls-cert.pem';

describe("musherd.cli", function () {

    var servers = null,
        args = null;

    beforeEach(function (done) {
        args = ["node", "musherd"];
        servers = [new mosca.Server({
            port: 3833
        }, done)];
    });

    afterEach(function (done) {
        async.parallel(servers.map(function (s) {
            return function (cb) {
                s.close(cb);
            };
        }), function () {
            done();
        });
    });

    var startServer = function (done, callback) {
        return musherd.cli(args, function (err, server) {
            if (server) {
                servers.unshift(server);
                callback(server);
            }
            done(err);
        });
    };

    it("must be a function", function () {
        t.typeOf(musherd.cli, "function");
    });

    it("should start a mosca.Server", function (done) {
        startServer(done, function (server) {
            t.instanceOf(server, mosca.Server);
        });
    });

    it("should create a bunyan logger", function (done) {
        args.push("-i");
        var s = startServer(done, function (server) {
            t.ok(server.logger);
        });

        if (s.logger) {
            s.logger.streams.pop();
        }
    });

    it("should set the logging level to 40", function (done) {
        startServer(done, function (server) {
            t.equal(server.logger.level(), 40);
        });
    });

    it("should support a `info` option by setting the bunyan level to 30", function (done) {
        args.push("-i");
        var s = startServer(done, function (server) {
            t.equal(server.logger.level(), 30);
        });

        if (s.logger) {
            s.logger.streams.pop();
        }
    });

    it("should support a `debug` option by setting the bunyan level to 20", function (done) {
        args.push("--debug");
        var s = startServer(done, function (server) {
            t.equal(server.logger.level(), 20);
        });

        if (s.logger) {
            s.logger.streams.pop();
        }
    });


    it("should support a port flag", function(done) {
        args.push("-p");
        args.push("2883");
        startServer(done, function(server) {
            t.equal(server.opts.port, 2883);
        });
    });

    it("should support a port flag (bis)", function(done) {
        args.push("--port");
        args.push("2883");
        startServer(done, function(server) {
            t.equal(server.opts.port, 2883);
        });
    });

    it("should support a parent port", function(done) {
        args.push("--parent-port");
        args.push("3833");
        startServer(done, function(server) {
            t.equal(server.opts.backend.type, "mqtt");
            t.equal(server.opts.backend.port, 3833);
        });
    });

    it("should support a parent host", function(done) {
        args.push("--parent-host");
        args.push("localhost");
        args.push("--parent-port");
        args.push("3833");
        startServer(done, function(server) {
            t.equal(server.opts.backend.type, "mqtt");
            t.equal(server.opts.backend.host, "localhost");
        });
    });

    it("should support a parent prefix", function(done) {
        args.push("--parent-port");
        args.push("3833");
        args.push("--parent-prefix");
        args.push("/ahaha");
        startServer(done, function(server) {
            t.equal(server.opts.backend.prefix, "/ahaha");
        });
    });

    it("should support a config option", function (done) {
        args.push("--config");
        args.push("test/sample_config.js");
        startServer(done, function (server) {
            t.propertyVal(server.opts, "port", 2883);
            t.deepPropertyVal(server.opts, "backend.port", 3833);
        });
    });

    it("should support a config option with an absolute path", function (done) {
        args.push("-c");
        args.push(process.cwd() + "/test/sample_config.js");
        startServer(done, function (server) {
            t.propertyVal(server.opts, "port", 2883);
            t.deepPropertyVal(server.opts, "backend.port", 3833);
        });
    });

    it("should create necessary default options even if not specified in config file", function (done) {
        args.push("-c");
        args.push(process.cwd() + "/test/sample_config.js");
        args.push("-i");

        var s = startServer(done, function (server) {
            t.deepPropertyVal(server.opts, "logger.name", "mosca");
        });

        if (s.logger) {
            s.logger.streams.pop();
        }
    });

    it("should create an app to an authorization file", function (done) {
        args.push("addapp");
        args.push("myapp");
        args.push("mykey");
        args.push("--creds");

        tmp.file(function (err, path) {
            if (err) {
                done(err);
                return;
            }

            args.push(path);
            musherd.cli(args, function () {
                var content = JSON.parse(fs.readFileSync(path));
                t.property(content, "idx");
                t.property(content, "apps");
                t.deepProperty(content, "apps.mykey");
                done();
            });
        });
    });

    it("should remove an app from an authorization file", function (done) {
        args.push("addapp");
        args.push("myapp");
        args.push("mykey");
        args.push("--creds");

        tmp.file(function (err, path) {
            if (err) {
                done(err);
                return;
            }

            args.push(path);
            var cloned = [].concat(args);
            cloned[2] = "rmapp";
            cloned.splice(3, 1);

            musherd.cli(args, function () {
                musherd.cli(cloned, function () {
                    var content = JSON.parse(fs.readFileSync(path));
                    t.notDeepProperty(content, "apps.mykey");
                    done();
                });
            });
        });
    });

    it("should support authorizing an authorized client", function (done) {
        args.push("--creds");
        args.push("test/creds.json");
        async.waterfall([
            function (cb) {
                musherd.cli(args, cb);
            },
            function (server, cb) {
                servers.unshift(server);

                var options = { username: "test_key", password: "kyte7mewy230faey2use" };
                var client = mqtt.createClient(1883, "localhost", options);
                client.on("error", cb);
                client.on("connect", function () {
                    cb(null, client);
                });
            },
            function (client, cb) {
                client.once("close", cb);
                client.end();
            }
        ], function (err) {
            if (err instanceof Error) {
                done(err);
                return;
            }
            done();
        });
    });

    it("should support negating an unauthorized client", function (done) {
        args.push("--creds");
        args.push("test/creds.json");
        async.waterfall([
            function (cb) {
                musherd.cli(args, cb);
            },
            function (server, cb) {
                servers.unshift(server);
                var options = { username: "bad", password: "bad" };
                var client = mqtt.createClient(1883, "localhost", options);
                client.on("error", cb);
                client.on("connect", function () {
                    cb(null, client);
                });
            },
            function (client, cb) {
                client.once("close", cb);
                client.end();
            }
        ], function (err) {
            if (err) {
                done();
                return;
            }
            done(new Error("No error thrown"));
        });
    });

    it("should reload the current config if killed with SIGHUP on a Linux-based OS", function (done) {

        if (os.platform() === "win32") return done();

        args.push("addapp");
        args.push("myapp");
        args.push("mykey");
        args.push("mysecret");
        args.push("--creds");

        var cloned = null;

        async.waterfall([
            function (cb) {
                tmp.file(cb);
            },
            function (path, fd, removeCallback, cb) {
                args.push(path);
                cloned = [].concat(args);
                cloned[2] = "rmapp";
                cloned.splice(3, 1);

                musherd.cli(args, cb);
            },
            function (cb) {
                musherd.cli(["node", "musherd", "--creds", cloned[cloned.length - 1]], cb);
            },
            function (server, cb) {
                servers.unshift(server);

                setTimeout(function () {
                    musherd.cli(cloned, cb);
                }, 300);
            },
            function (cb) {
                process.kill(process.pid, 'SIGHUP');
                setTimeout(cb, 50);
            },
            function (cb) {
                var options = { username: "mykey", password: "mysecret" };
                var client = mqtt.createClient(1883, "localhost", options);
                client.once("error", cb);
                client.once("connect", function () {
                    client.once("close", cb);
                    client.end();
                });
            }
        ], function (err) {
            if (err) {
                done();
                return;
            }
            done(new Error("should have errored"));
        });
    });

    it("should save the creds.json as a formatted JSON when adding", function (done) {
        args.push("addapp");
        args.push("myapp");
        args.push("mykey");
        args.push("--creds");

        tmp.file(function (err, path) {
            if (err) {
                done(err);
                return;
            }

            args.push(path);
            musherd.cli(args, function () {
                var content = fs.readFileSync(path);
                t.equal(JSON.stringify(JSON.parse(content), null, 2), content.toString('utf8'));
                done();
            });
        });
    });

    it("should save the creds.json as a formatted JSON when removing", function (done) {
        args.push("addapp");
        args.push("myapp");
        args.push("mykey");
        args.push("--creds");

        tmp.file(function (err, path) {
            if (err) {
                done(err);
                return;
            }

            args.push(path);
            var cloned = [].concat(args);
            cloned[2] = "rmapp";
            cloned[3] = "anotherkey";

            musherd.cli(args, function () {
                musherd.cli(cloned, function () {
                    var content = fs.readFileSync(path);
                    t.equal(JSON.stringify(JSON.parse(content), null, 2), content.toString('utf8'));
                    done();
                });
            });
        });
    });

    it("should create a leveldb with the --db flag", function(done) {

        tmp.dir(function (err, path, fd) {
            if (err) {
                done(err);
                return;
            }

            args.push("--db");
            args.push(path);

            startServer(done, function(server) {
                t.instanceOf(server.persistence, mosca.persistence.LevelUp);
                t.equal(server.persistence.options.path, path);
            });
        });
    });

    describe("with --key and --cert", function() {

        beforeEach(function() {
            args.push("--key");
            args.push(SECURE_KEY);
            args.push("--cert");
            args.push(SECURE_CERT);
        });

        it("should pass key and cert to the server", function(done) {
            startServer(done, function(server) {
                t.equal(server.opts.secure.keyPath, SECURE_KEY);
                t.equal(server.opts.secure.certPath, SECURE_CERT);
            });
        });

        it("should support the --secure-port flag", function(done) {
            var port = nextPort();
            args.push("--secure-port");
            args.push(port);
            startServer(done, function(server) {
                t.equal(server.opts.secure.port, port);
            });
        });

        it("should set the secure port by default at 8883", function(done) {
            startServer(done, function(server) {
                t.equal(server.opts.secure.port, 8883);
            });
        });

        it("should pass the --non-secure flag to the server", function(done) {
            args.push("--non-secure");
            startServer(done, function(server) {
                t.equal(server.opts.allowNonSecure, true);
            });
        });

        it("should allow to set the https port", function(done) {

            args.push("--https-port");
            args.push("3000");
            startServer(done, function(server) {
                t.equal(server.opts.https.port, 3000);
            });
        });

        it("should serve a HTTPS static directory", function(done) {
            args.push("--https-port");
            args.push("3000");
            args.push("--https-static");
            args.push("/path/to/nowhere");
            startServer(done, function(server) {
                t.equal(server.opts.https.static, "/path/to/nowhere");
            });
        });

        it("should serve a HTTPS browserify bundle", function(done) {
            args.push("--https-port");
            args.push("3000");
            args.push("--https-bundle");
            startServer(done, function(server) {
                t.equal(server.opts.https.bundle, true);
            });
        });

    });

    it("should allow to set the http port", function(done) {
        args.push("--http-port");
        args.push("3000");
        startServer(done, function(server) {
            t.equal(server.opts.http.port, 3000);
        });
    });

    it("should allow to limit the server only to http", function(done) {
        args.push("--http-port");
        args.push("3000");
        args.push("--only-http");
        startServer(done, function(server) {
            t.equal(server.opts.http.port, 3000);
        });
    });

    it("should serve a HTTP static directory", function(done) {
        args.push("--http-port");
        args.push("3000");
        args.push("--http-static");
        args.push("/path/to/nowhere");
        startServer(done, function(server) {
            t.equal(server.opts.http.static, "/path/to/nowhere");
        });
    });

    it("should serve a HTTP browserify bundle", function(done) {
        args.push("--http-port");
        args.push("3000");
        args.push("--http-bundle");
        startServer(done, function(server) {
            t.equal(server.opts.http.bundle, true);
        });
    });

    it("should have stats enabled by default", function(done) {
        var s = startServer(done, function(server) {
            t.equal(server.opts.stats, true);
        });
    });

    it("should allow to disable stats", function(done) {
        args.push("--disable-stats");
        var s = startServer(done, function(server) {
            t.equal(server.opts.stats, false);
        });
    });

    it("should allow to specify a broker id", function(done) {
        args.push("--broker-id");
        args.push("44cats");
        var s = startServer(done, function(server) {
            t.equal(server.id, "44cats");
        });
    });

    it("should specify an interface to bind to", function(done) {
        args.push("--host");
        args.push("127.0.0.1");
        startServer(done, function(server) {
            t.equal(server.opts.host, "127.0.0.1");
        });
    });
});
