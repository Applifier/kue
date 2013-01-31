
/*!
 * kue - events
 * Copyright (c) 2011 LearnBoost <tj@learnboost.com>
 * MIT Licensed
 */

/**
 * Module dependencies.
 */

/**
 *
 * @param queue {Queue} Parent Queue object
 * @param pubsubClient {Redis} Dedicated redis client instance for pub/sub usage
 * @param key String
 */
function Events(queue, key) {
  this.queue = queue;

  // Job map
  this.jobs = {};

  // Pub/sub key.
  this.key = key || 'q:events';

  this.client = queue.client;

  // The pubsub client can't be used to any other redis command
  this.pubsubClient = queue.pubsubClient;

  // Have we already subscribed
  this.subscribed = false;

  console.log("New Events created");
}

module.exports = Events;



/**
 * Add `job` to the jobs map, used
 * to grab the in-process object
 * so we can emit relative events.
 *
 * @param {Job} job
 * @api private
 */

Events.prototype.add = function(job){
  console.log("Adding job", job.id, "to jobs map");
  if (job.id) {
    this.jobs[job.id] = job;
  }
};

/**
 * Subscribe to the selected events channel
 *
 * @api private
 */

Events.prototype.subscribe = function(done){
  if (this.subscribed) return;
  this.pubsubClient.subscribe(this.key);
  this.pubsubClient.on('message', this.onMessage.bind(this));
  this.subscribed = true;
  done();
};

/**
 * Message handler.
 *
 * @api private
 */

Events.prototype.onMessage = function(channel, msg){
  // TODO: only subscribe on {Queue,Job}#on()
  try {
    msg = JSON.parse(msg);
  } catch(err) {
    console.error("Invalid JSON message", msg);
    return;
  }

  console.log("onMessage", msg, "from", channel);

  // map to Job when in-process
  var job = this.jobs[msg.id];
  if (job) {
    job.emit.apply(job, msg.args);
    // TODO: abstract this out
    if ('progress' != msg.event) delete this.jobs[job.id];
  }

  // emit args on Queues
  msg.args[0] = 'job ' + msg.args[0];
  msg.args.push(msg.id);
  this.queue.emit.apply(this.queue, msg.args);
};

/**
 * Emit `event` for job `id` with variable args.
 *
 * @param {Number} id
 * @param {String} event
 * @param {Mixed} ...
 * @api private
 */

Events.prototype.emit = function(id, event, client) {
  var msg = JSON.stringify({
      id: id
    , event: event
    , args: [].slice.call(arguments, 1)
  });
  console.log("emit", msg);
  this.client.publish(this.key, msg);
};
