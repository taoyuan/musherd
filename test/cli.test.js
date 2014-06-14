var async = require("async");
var tmp = require('tmp');
var fs = require("fs");
var mqtt = require("mqtt");
var os = require("os");
var mosca = require('mosca');

var mush = require('../');

describe("mush.cli", function () {

    var servers = null,
        args = null;

    beforeEach(function (done) {
        args = ["node", "mush"];
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
        return mush.cli(args, function (err, server) {
            if (server) {
                servers.unshift(server);
                callback(server);
            }
            done(err);
        });
    };

    it("must be a function", function () {
        t.typeOf(mush.cli, "function");
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
        args.push("--auth");

        tmp.file(function (err, path) {
            if (err) {
                done(err);
                return;
            }

            args.push(path);
            mush.cli(args, function () {
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
        args.push("--auth");

        tmp.file(function (err, path) {
            if (err) {
                done(err);
                return;
            }

            args.push(path);
            var cloned = [].concat(args);
            cloned[2] = "rmapp";
            cloned.splice(3, 1);

            mush.cli(args, function () {
                mush.cli(cloned, function () {
                    var content = JSON.parse(fs.readFileSync(path));
                    t.notDeepProperty(content, "apps.mykey");
                    done();
                });
            });
        });
    });

    it("should support authorizing an authorized client", function (done) {
        args.push("--auth");
        args.push("test/auth.json");
        async.waterfall([
            function (cb) {
                mush.cli(args, cb);
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
        args.push("--auth");
        args.push("test/auth.json");
        async.waterfall([
            function (cb) {
                mush.cli(args, cb);
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
        args.push("--auth");

        var cloned = null;

        async.waterfall([
            function (cb) {
                tmp.file(cb);
            },
            function (path, fd, cb) {
                args.push(path);
                cloned = [].concat(args);
                cloned[2] = "rmapp";
                cloned.splice(3, 1);

                mush.cli(args, cb);
            },
            function (cb) {
                mush.cli(["node", "mush", "--auth", cloned[cloned.length - 1]], cb);
            },
            function (server, cb) {
                servers.unshift(server);

                setTimeout(function () {
                    mush.cli(cloned, cb);
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

    it("should save the auth.json as a formatted JSON when adding", function (done) {
        args.push("addapp");
        args.push("myapp");
        args.push("mykey");
        args.push("--auth");

        tmp.file(function (err, path) {
            if (err) {
                done(err);
                return;
            }

            args.push(path);
            mush.cli(args, function () {
                var content = fs.readFileSync(path);
                t.equal(JSON.stringify(JSON.parse(content), null, 2), content.toString('utf8'));
                done();
            });
        });
    });

    it("should save the auth.json as a formatted JSON when removing", function (done) {
        args.push("addapp");
        args.push("myapp");
        args.push("mykey");
        args.push("--auth");

        tmp.file(function (err, path) {
            if (err) {
                done(err);
                return;
            }

            args.push(path);
            var cloned = [].concat(args);
            cloned[2] = "rmapp";
            cloned[3] = "anotherkey";

            mush.cli(args, function () {
                mush.cli(cloned, function () {
                    var content = fs.readFileSync(path);
                    t.equal(JSON.stringify(JSON.parse(content), null, 2), content.toString('utf8'));
                    done();
                });
            });
        });
    });

});
