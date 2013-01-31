/*!
 * kue - RedisClient factory
 * Copyright (c) 2011 LearnBoost <tj@learnboost.com>
 * MIT Licensed
 * Author: bitprobe@gmail.com
 */

/**
 * Module dependencies.
 */

var redis = require('redis');

/**
 * Create a RedisClient.
 *
 * @return {RedisClient}
 * @api private
 */

exports.createClient = function(name, callback) {
  var client = redis.createClient();
  callback(client);
};

/**
 * Return the pubsub-specific redis client. 
 *
 * @return {RedisClient}
 * @api private
 */

exports.pubsubClient = function(callback) {
  exports.createClient("pubsub", function (err, client) {
    callback(null, client);
  });
};
