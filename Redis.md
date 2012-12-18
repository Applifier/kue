
Numeric counters:
 q:ids  -- Unique job instance id sequence

Sets:
 q:job:types -- set of all possible job names

Hashes:
 q:job:<job instance id>  -- Contains parameters for a job instance. Set from Job.save
      type                -- Name of the job type, like "testjob"
      created_ad          -- unix timestamp in milliseconds
      updated_ad          -- unix timestamp in milliseconds
      priority            -- Seems to default to "0"
      data                -- JSON encoded data of job parameters
      state               -- job state. can be "inactive"

Sorted Sets:
  q:jobs                     -- Set of all job instance ids regardless of state. score is job priority
  q:jobs:inactive            -- Set of all inactive job instance ids. score is job priority
  q:jobs:active              -- Set of all inactive job instance ids. score is job priority
  q:jobs:<job type>:inactive -- Set of all inactive job instance ids for job type <type>. score is job priority
  q:jobs:<job type>:active   -- Set of all active job instance ids for job type <type>. score is job priority

Lists:
  q:<job type>:jobs          -- List of inactive job sequence ids



What happens on Job.save()

[testjob ] "incr" "q:ids"                                  -- Job.save()
[testjob ] "sadd" "q:job:types" "testjob"                  -- Job.save()
[testjob ] "hset" "q:job:1" "type" "testjob"               -- Job.save()
[testjob ] "hset" "q:job:1" "created_at" "1355821307856"   -- Job.save()
[testjob ] "hset" "q:job:1" "updated_at" "1355821307857"   -- Job.update()
[testjob ] "hset" "q:job:1" "priority" "0"                 -- Job.set() from Job.update()
[testjob ] "hset" "q:job:1" "data" "{\"kissa\":\"ismo\"}"  -- Job.set() from Job.update()
[testjob ] "zrem" "q:jobs" "1"                             -- Job.removeState() from .state() from .update()
[testjob ] "zrem" "q:jobs:inactive" "1"                    -- Job.removeState() from .state() from .update()
[testjob ] "zrem" "q:jobs:testjob:inactive" "1"            -- Job.removeState() from .state() from .update()
[testjob ] "hset" "q:job:1" "state" "inactive"             -- Job.removeState() from .state() from .update()
[testjob ] "zadd" "q:jobs" "0" "1"                         -- Job.state() from .update()
[testjob ] "zadd" "q:jobs:inactive" "0" "1"                -- Job.state() from .update()
[testjob ] "zadd" "q:jobs:testjob:inactive" "0" "1"        -- Job.state() from .update()
[testjob ] "lpush" "q:testjob:jobs" "1"                    -- Job.state() from .update()

[pubsub] "subscribe" "q:events"


What happens when a job processing is started

[getJob testjob] "blpop" "q:testjob:jobs" "0"              -- Worker.getJob() from .start(). blocks until there's a job waiting to be processed
[Worker testjob] "MULTI"                                   -- .zpop() from .getJob()
[Worker testjob] "zrange" "q:jobs:testjob:inactive" "0" "0"
[Worker testjob] "zremrangebyrank" "q:jobs:testjob:inactive" "0" "0"
[Worker testjob] "EXEC"                                    -- .zpop() ends
[testjob] "hgetall" "q:job:1"                              -- Job.get()
[testjob] "zrem" "q:jobs" "1"                              -- Job.removeState() from .state() from .active() Job.Worker.process
[testjob] "zrem" "q:jobs:inactive" "1"                     -- Job.removeState() from .state() from .active() Job.Worker.process
[testjob] "zrem" "q:jobs:testjob:inactive" "1"             -- Job.removeState() from .state() from .active() Job.Worker.process
[testjob] "hset" "q:job:1" "state" "active"                -- Job.set() from .state() from .active() Job.Worker.process
[testjob] "zadd" "q:jobs" "42" "1"                         -- Job.state() from .active() Job.Worker.process
[testjob] "zadd" "q:jobs:active" "42" "1"                  -- Job.state() from .active() Job.Worker.process
[testjob] "zadd" "q:jobs:testjob:active" "42" "1"          -- Job.state() from .active() Job.Worker.process
