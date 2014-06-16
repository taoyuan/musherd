"use strict";

var utils = require('./utils');

module.exports = Authorizer;

/**
 * mostel.Authorizer's responsibility is to give an implementation
 * of mosca.Server callback of authorizations, against a JSON file.
 *
 * @param {Object} apps The app hash, as created by this class
 *  (optional)
 * @api public
 */
function Authorizer(apps) {
    this.idx = 1000;
    this.apps = apps || {};
}

/**
 * It returns the authenticate function to plug into mosca.Server.
 *
 * @api public
 */
Authorizer.prototype.__defineGetter__("authenticate", function() {
    var that = this;
    return function(client, app, pass, cb) {
        that._authenticate(client, app, pass, cb);
    };
});

/**
 * It returns the authorizePublish function to plug into mosca.Server.
 *
 * @api public
 */
Authorizer.prototype.__defineGetter__("authorizePublish", function() {
    return function(client, topic, payload, cb) {
        cb(null, !!client.app && topic.indexOf('$' + client.key + ':') === 0);
    };
});

/**
 * It returns the authorizeSubscribe function to plug into mosca.Server.
 *
 * @api public
 */
Authorizer.prototype.__defineGetter__("authorizeSubscribe", function() {
    return function(client, topic, cb) {
        cb(null, !!client.key);
    };
});

/**
 * The real authentication function
 *
 * @api private
 */
Authorizer.prototype._authenticate = function(client, user, pass, cb) {

    if (!user) {
        return cb(null, false);
    }

    user = user.toString();

    var app = this.apps[user];
    if (!app) {
        return cb(null, false);
    }
    client.key = user.toString();

    if (!pass) {
        return cb(null, true);
    }

    if (app.secret === pass.toString()) {
        client.app = app.key;
        return cb(null, true);
    }

    cb(null, false);

};

Authorizer.prototype.data = function(data) {
    if (data) {
        this.idx = data.idx || 1000;
        this.apps = data.apps;
    } else {
        return {
            idx: this.idx,
            apps: this.apps
        }
    }
};

/**
 * An utility function to add an app.
 *
 * @api public
 * @param {String} name The app name
 * @param {String|Function} key The app key
 * @param {String|Function} secret The app secret
 * @param {Function} cb The callback that will be called after the
 *   insertion.
 */
Authorizer.prototype.addApp = function(name, key, secret, cb) {
    var that = this;

    if (typeof secret === 'function') {
        cb = secret;
        secret = null;
    } else if (typeof key === 'function') {
        cb = key;
        key = null;
        secret = null;
    }

    if (key && this.apps[key]) {
        cb(new Error('An app named `'+name+'` with key `'+key+'` already exists'));
        return this;
    }

    while (!key || this.apps[key]) {
        key = utils.string(20);
    }
    secret = secret || utils.string(20);
    var app = that.apps[key] = {
        name: name,
        id: this.idx++,
        key: key,
        secret: secret
    };

    cb(null, app);
    return this;
};


/**
 * An utility function to delete a app.
 *
 * @api public
 * @param {String} key The app key
 * @param {Function} cb The callback that will be called after the
 *   deletion.
 */
Authorizer.prototype.rmApp = function(key, cb) {
    var app = this.apps[key];
    delete this.apps[key];
    cb(null, app);
    return this;
};
