"use strict";

var chars = '0123456789abcdefghiklmnopqrstuvwxyz';

exports.string = function (length) {
    length = length ? length : 32;

    var s = '';

    for (var i = 0; i < length; i++) {
        var randomNumber = Math.floor(Math.random() * chars.length);
        s += chars.substring(randomNumber, randomNumber + 1);
    }

    return s;
};