 
/*!
 * kue - Worker
 * Copyright (c) 2011 LearnBoost <tj@learnboost.com>
 * MIT Licensed
 */

/**
 * Module dependencies.
 */

var EventEmitter = require('events').EventEmitter
  , redisFactory = require('../redisfactory')
  , Job = require('./job');

/**
 * Expose `Worker`.
 */

module.exports = Worker;

/**
 * Initialize a new `Worker` with the given Queue
 * targetting jobs of `type`.
 *
 * @param {Queue} queue
 * @param {String} type
 * @api private
 */

function Worker(queue, type, redisClient) {
  this.queue = queue;
  this.type = type;
  this.client = redisClient;
  this.interval = 1000;

}

/**
 * Inherit from `EventEmitter.prototype`.
 */

Worker.prototype.__proto__ = EventEmitter.prototype;

/**
 * Start processing jobs with the given `fn`
 *
 * @param {Function} fn
 * @return {Worker} for chaining
 * @api private
 */

Worker.prototype.start = function(fn, done){
  var self = this;
  self.getJob(function(err, job){
    if (err) self.error(err, job);
    if (!job || err) return process.nextTick(function(){ self.start(fn); });
    self.process(job, fn);
  }, done);
  return this;
};

/**
 * Error handler, currently does nothing.
 *
 * @param {Error} err
 * @param {Job} job
 * @return {Worker} for chaining
 * @api private
 */

Worker.prototype.error = function(err, job){
  // TODO: emit non "error"
  console.error(err.stack || err.message);
  return this;
};

/**
 * Process a failed `job`. Set's the job's state
 * to "failed" unless more attempts remain, in which
 * case the job is marked as "inactive" and remains
 * in the queue.
 *
 * @param {Function} fn
 * @return {Worker} for chaining
 * @api private
 */

Worker.prototype.failed = function(job, err, fn){
  var self = this;
  self.queue.events.emit(job.id, 'failed');
  job.failed().error(err);
  self.error(err, job);
  job.attempt(function(error, remaining, attempts, max){
    if (error) return self.error(error, job);
    if (remaining) {
      job.inactive();
    } else {
      job.failed();
    }

    self.start(fn);
  });
};

/**
 * Process `job`, marking it as active,
 * invoking the given callback `fn(job)`,
 * if the job fails `Worker#failed()` is invoked,
 * otherwise the job is marked as "complete".
 *
 * @param {Job} job
 * @param {Function} fn
 * @return {Worker} for chaining
 * @api public
 */

Worker.prototype.process = function(job, fn){
  var self = this
    , start = new Date();
  job.active();
  fn(job, function(err){
    if (err) return self.failed(job, err, fn);
    job.complete();
    job.set('duration', job.duration = new Date() - start);
    self.emit('job complete', job);
    console.log("Emiting complete event to job");
    self.queue.events.emit(job.id, 'complete');
    self.start(fn);
  });
  return this;
};

/**
 * Atomic ZPOP implementation.
 *
 * @param {String} key
 * @param {Function} fn
 * @api private
 */

Worker.prototype.zpop = function(key, fn){
  this.client
    .multi()
    .zrange(key, 0, 0)
    .zremrangebyrank(key, 0, 0)
    .exec(function(err, res){
      if (err) return fn(err);
      var id = res[0][0];
      fn(null, id);
    });
};

/**
 * Attempt to fetch the next job. 
 *
 * @param {Function} fn
 * @param {Function} done Called after this Worker has started to wait for a job
 * @api private
 */

Worker.prototype.getJob = function(fn, done){
  var self = this;

  // alloc a client for this job type
  var client = self.queue.workerClients[self.type];

  if (!client) {
    redisFactory.createClient("getJob " + self.type, function(err, redisClient) {
      client = self.queue.workerClients[self.type] =  redisClient;
      block();
    });
  } else {
    block();
  }

  function block() {
    // BLPOP indicates we have a new inactive job to process
    client.blpop('q:' + self.type + ':jobs', 0, function(err) {
      self.zpop('q:jobs:' + self.type + ':inactive', function(err, id){
        if (err) return fn(err);
        if (!id) return fn();
        Job.get(self.queue, id, fn);
      });
    });

    if (done) {
      done();
    }
  }

};
