var async = require('async');
/*!
 * kue
 * Copyright (c) 2011 LearnBoost <tj@learnboost.com>
 * MIT Licensed
 */

/**
 * Module dependencies.
 */

var EventEmitter = require('events').EventEmitter
  , Worker = require('./queue/worker')
  , Events = require('./queue/events')
  , Job = require('./queue/job')
  , redisFactory = require('./redisfactory');

/**
 * Expose `Queue`.
 */

exports = module.exports = Queue;

/**
 * Library version.
 */

exports.version = '0.4.0';

/**
 * Expose `Job`.
 */

exports.Job = Job;

/**
 * Server instance (that is lazily required)
 */

var app;

/**
 * Expose the server.
 */

Object.defineProperty(exports, 'app', {
  get: function() {
    return app || (app = require('./http'));
  }
});

/**
 * Expose the RedisClient factory.
 */

exports.redisFactory = redisFactory;

/**
 * Create a new `Queue`.
 *
 * @return {Queue}
 * @api public
 */

exports.createQueue = function(name, callback){
  var queue = new Queue(name);

  queue.init(function(err) {
    callback(err, queue);
  });
};

/**
 * Initialize a new job `Queue`.
 *
 * @api public
 */

function Queue(name) {
  this.name = name;
  this.workerClients = {};

  this.client = null;
  this.pubsubClient = null;
  this.events = null;
}

/**
 * Starts two redis clients: One for pubsub for events and one for all other operations
 * @param done
 */
Queue.prototype.init = function(done) {
  var self = this;
  redisFactory.createClient("Queue:" + this.name, function (err, client) {
    self.client = client;

    redisFactory.pubsubClient(function (err, pubsub) {
      self.pubsubClient = pubsub;
      self.events = new Events(self);
      done();
    });

  });
};

Queue.prototype.subscribeToEvents = function(done) {
  var self = this;

  self.events.subscribe(function() {
    done();
  });


};

/**
 * Inherit from `EventEmitter.prototype`.
 */
Queue.prototype.__proto__ = EventEmitter.prototype;

/**
 * Create a `Job` with the given `type` and `data`.
 *
 * @param {String} type
 * @param {Object} data
 * @return {Job}
 * @api public
 */
Queue.prototype.create =
Queue.prototype.createJob = function(type, data){
  return new Job(this, type, data);
};

/**
 * Close this queue and the redis connection it contains
 */
Queue.prototype.close = function (callback) {
  var self = this;
  for (var type in self.workerClients) {
    if (self.workerClients.hasOwnProperty(type)) {
      // This will close without caring that there's a blocking blpop operation under way
      self.workerClients[type].end();
    }
  }

  async.series([
    function closeClient(cb) {
      self.client.once('end', function () {
        self.client.removeAllListeners();
        self.removeAllListeners();
        cb();
      });
      self.client.quit();
    },
    function closePubSubClient(cb) {
      self.pubsubClient.once('end', function () {
        self.pubsubClient.removeAllListeners();
        cb();
      });
      self.pubsubClient.quit();
    }
  ], callback);


};

/**
 * Proxy to auto-subscribe to events.
 *
 * @api public
 */

var on = EventEmitter.prototype.on;
Queue.prototype.on = function(event){
  if (0 === event.indexOf('job')) events.subscribe();
  return on.apply(this, arguments);
};

/**
 * Promote delayed jobs, checking every `ms`,
 * defaulting to 5 seconds.
 *
 * @params {Number} ms
 * @api public
 */

Queue.prototype.promote = function(ms){
  var client = this.client
    , limit = 20;

  if (ms === undefined) {
    ms = 5000;
  }

  setInterval(function(){
    client.sort('q:jobs:delayed'
      , 'by', 'q:job:*->delay'
      , 'get', '#'
      , 'get', 'q:job:*->delay'
      , 'get', 'q:job:*->created_at'
      , 'limit', 0, limit, function(err, jobs){
      if (err || !jobs.length) return;

      // iterate jobs with [id, delay, created_at]
      while (jobs.length) {
        var job = jobs.slice(0, 3)
          , id = parseInt(job[0], 10)
          , delay = parseInt(job[1], 10)
          , creation = parseInt(job[2], 10)
          , promote = ! Math.max(creation + delay - Date.now(), 0);

        // if it's due for activity
        // "promote" the job by marking
        // it as inactive.
        if (promote) {
          Job.get(id, function(err, job){
            if (err) return;
            events.emit(id, 'promotion');
            job.inactive();
          });
        }

        jobs = jobs.slice(3);
      }
    });
  }, ms);
};

/**
 * Get setting `name` and invoke `fn(err, res)`.
 *
 * @param {String} name
 * @param {Function} fn
 * @return {Queue} for chaining
 * @api public
 */

Queue.prototype.setting = function(name, fn){
  this.client.hget('q:settings', name, fn);
  return this;
};

/**
 * Process jobs with the given `type`, invoking `fn(job)`.
 *
 * @param {String} type
 * @param {Number} n Number of workers
 * @param {Function} fn
 * @param {Function} done Called once the process has started to wait for incoming jobs
 * @api public
 */

Queue.prototype.process = function(type, n, fn, done){
  var self = this;

  if ('function' == typeof n) {
    throw new Error("This function requires that the number of workers is specified (2nd parameter)");
  }

  (function next(n) {
    if (n > 0) {
      (function(worker){
        worker.on('error', function(err){
          self.emit('error', err);
        });

        worker.on('job complete', function(job){
          self.client.incrby('q:stats:work-time', job.duration);
        });
      })(new Worker(self, type, self.client).start(fn, function() {
        next(n - 1);
      }));
    } else {
      if (done) {
        done();
      }
    }
  })(n);
};

/**
 * Get the job types present and callback `fn(err, types)`.
 *
 * @param {Function} fn
 * @return {Queue} for chaining
 * @api public
 */

Queue.prototype.types = function(fn){
  this.client.smembers('q:job:types', fn);
  return this;
};

/**
 * Return job ids with the given `state`, and callback `fn(err, ids)`.
 *
 * @param {String} state
 * @param {Function} fn
 * @return {Queue} for chaining
 * @api public
 */

Queue.prototype.state = function(state, fn){
  this.client.zrange('q:jobs:' + state, 0, -1, fn);
  return this;
};

/**
 * Get queue work time in milliseconds and invoke `fn(err, ms)`.
 *
 * @param {Function} fn
 * @return {Queue} for chaining
 * @api public
 */

Queue.prototype.workTime = function(fn){
  this.client.get('q:stats:work-time', function(err, n){
    if (err) return fn(err);
    fn(null, parseInt(n, 10));
  });
  return this;
};

/**
 * Get cardinality of `state` and callback `fn(err, n)`.
 *
 * @param {String} state
 * @param {Function} fn
 * @return {Queue} for chaining
 * @api public
 */

Queue.prototype.card = function(state, fn){
  this.client.zcard('q:jobs:' + state, fn);
  return this;
};

/**
 * Completed jobs.
 */

Queue.prototype.complete = function(fn){
  return this.state('complete', fn);
};

/**
 * Failed jobs.
 */

Queue.prototype.failed = function(fn){
  return this.state('failed', fn);
};

/**
 * Inactive jobs (queued).
 */

Queue.prototype.inactive = function(fn){
  return this.state('inactive', fn);
};

/**
 * Active jobs (mid-process).
 */

Queue.prototype.active = function(fn){
  return this.state('active', fn);
};

/**
 * Completed jobs count.
 */

Queue.prototype.completeCount = function(fn){
  return this.card('complete', fn);
};

/**
 * Failed jobs count.
 */

Queue.prototype.failedCount = function(fn){
  return this.card('failed', fn);
};

/**
 * Inactive jobs (queued) count.
 */

Queue.prototype.inactiveCount = function(fn){
  return this.card('inactive', fn);
};

/**
 * Active jobs (mid-process).
 */

Queue.prototype.activeCount = function(fn){
  return this.card('active', fn);
};

/**
 * Delayed jobs.
 */

Queue.prototype.delayedCount = function(fn){
  return this.card('delayed', fn);
};
