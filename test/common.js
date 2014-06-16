//global.sinon = require("sinon");
global.chai = require("chai");
global.t = require('chai').assert;

global.redisSettings = function() {
  return {
    redis: require('redis')
  };
};

var portCounter = 21042;
global.nextPort = function() {
  return ++portCounter;
};

global.buildOpts = function() {
  return {
    keepalive: 1000,
    clientId: 'mosca_' + require("crypto").randomBytes(8).toString('hex'),
    protocolId: 'MQIsdp',
    protocolVersion: 3
  };
};

global.donner = function(count, done) {
  return function() {
    count--;
    if (count === 0) {
      done();
    }
  };
};

var bunyan = require("bunyan");

global.globalLogger = bunyan.createLogger({
  name: "moscaTests",
  level: 60
});

//var sinonChai = require("sinon-chai");
//chai.use(sinonChai);

//global.mostel = require("../");
//global.mostel.cli = require("../lib/cli");
