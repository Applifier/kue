var assert = require('assert');
var redis = require('redis');
var kue = require('../lib/kue');
var async = require('async');

//redis.debug_mode = 1;

describe("kue cleanup", function () {
  var createNamedRedisClient = function (name, callback) {
    var client = redis.createClient();

    client.once('ready', function() {
      next();
    });
    client.once('error', function(message) {
      next(err);
    });

    function next(err) {
      if (name) {
        client.send_command("name", [name], function (err) {
          client.select(14, function () {
            callback && callback(err, client);
          });
        });
      } else {
        client.send_command("name", ["unknown " + (++id)], function (err) {
          client.select(14, function () {
            callback && callback(err, client);
          });
        });
      }
    }

  };

  kue.redisFactory.createClient = function (name, callback) {
    return createNamedRedisClient(name, callback);
  };


  it("should open and close listener client correctly with one and only one active connection to redis server", function (done) {
    createNamedRedisClient('inspector1', function (err, client) {


      var connected_clients, blocked_clients;

      client.info(function (err, res) {
        //console.log("Connected clients", client.server_info.connected_clients);
        //console.log("Blocked clients", client.server_info.blocked_clients);
        connected_clients = Number(client.server_info.connected_clients);
        blocked_clients = Number(client.server_info.blocked_clients);

        //console.log("*** creating listener2 kue");
        kue.createQueue("listener2", function (err, listener2) {
          client.info(function (err, res) {
            client.on_info_cmd(err, res); // This prints an annoying "Redis server ready." if debug_mode is on

            // The listening kue client should create two connections: one pubsub and one for other
            assert.equal(client.server_info.connected_clients, connected_clients + 2);
            assert.equal(client.server_info.blocked_clients, blocked_clients);

            listener2.close(function () {
              client.info(function (err, res) {
                client.on_info_cmd(err, res); // This prints an annoying "Redis server ready." if debug_mode is on
                assert.equal(client.server_info.connected_clients, connected_clients);
                client.end();
                process.nextTick(done);


              });
            });

          });
        });
      });
    });
  });


  it("should open and close listener client correctly with one processor listening", function (done) {

    createNamedRedisClient('inspector2', function (err, client) {


      var connected_clients, blocked_clients;

      client.info(function (err, res) {
        //console.log("Connected clients", client.server_info.connected_clients);
        //console.log("Blocked clients", client.server_info.blocked_clients);
        connected_clients = Number(client.server_info.connected_clients);
        blocked_clients = Number(client.server_info.blocked_clients);

        //console.log("*** creating listener2 kue");
        kue.createQueue("listener2", function (err, listener2) {
          listener2.process('testjob2', 1, function (job, testjob_done) {
            console.log("processing testjob2", job.data);
            testjob_done();
          }, function () {
            client.info(function (err, res) {
              client.on_info_cmd(err, res); // This prints an annoying "Redis server ready." if debug_mode is on
              //console.log("Connected clients", client.server_info.connected_clients);
              //console.log("Blocked clients", client.server_info.blocked_clients);

              // The listening kue client should create two connections: one pubsub and one for other
              setTimeout(function(){}, 10000);

              assert.equal(client.server_info.connected_clients, connected_clients + 3);
              assert.equal(client.server_info.blocked_clients, blocked_clients + 1);

              listener2.close(function () {
                client.info(function (err, res) {
                  client.on_info_cmd(err, res); // This prints an annoying "Redis server ready." if debug_mode is on
                  assert.equal(client.server_info.connected_clients, connected_clients);
                  assert.equal(client.server_info.blocked_clients, blocked_clients);
                  client.end();
                  done();

                });
              });

            });

          });

        });
      });
    });

  });

  it("should open and close listener client correctly with five processor listening", function (done) {
     createNamedRedisClient('inspector3', function (err, client) {

       var connected_clients, blocked_clients;

       client.info(function (err, res) {
         connected_clients = Number(client.server_info.connected_clients);
         blocked_clients = Number(client.server_info.blocked_clients);

         //console.log("*** creating listener2 kue");
         kue.createQueue("listener2", function (err, listener2) {
           listener2.process('testjob2', 5, function (job, testjob_done) {
             console.log("processing testjob2", job.data);
             testjob_done();
           }, function () {
             client.info(function (err, res) {
               client.on_info_cmd(err, res);

               // Connections to redis: 2 for the queue, 1 per worker type which will block with blpop command
               assert.equal(client.server_info.connected_clients, connected_clients + 3);
               assert.equal(client.server_info.blocked_clients, blocked_clients + 1);

               listener2.close(function () {
                 client.info(function (err, res) {
                   client.on_info_cmd(err, res);
                   assert.equal(client.server_info.connected_clients, connected_clients);
                   assert.equal(client.server_info.blocked_clients, blocked_clients);
                   client.quit();
                   done();

                 });
               });

             });

           });

         });
       });
     });

   });

});

