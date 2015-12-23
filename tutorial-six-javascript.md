
## Remote procedure call (RPC)

第二节教程中，我们学习了如何通过`Work Queues`在多个work之间分发耗时任务。

但是，如果是我们需要在远端执行一个函数并且等待它的返回值呢？这是另一方面的事情，也就是`Remote Procedure Call or RPC`

这节中，我们将使用RabbitMQ构建一个RPC系统，一个客户端和可扩展的RPC服务端。考虑到没有耗时的任务，我们将创建一个假的server返回Fibonacci数字。

## Callback queue

通常来说，通过RabbitMQ执行RPC很简单。客户端发送消息，服务端回复相应消息。为了能接受到相应消息，我们需要发送给一个`callback`队列。可以使用默认队列：

```js
ch.assertQueue('', {exclusive: true});

ch.sendToQueue('rpc_queue',new Buffer('10'), { replyTo: queue_name });

# ... then code to read a response message from the callback queue ...
```

## Message properties

AMQP协议，消息预定义了14种属性，大部分属性很少用到，除了以下这些：

* persistent: 确保消息是否持久化，第二节中有用到。
* content_type: 用来表示编码的MINE类型。比如经常使用的JSON编码，可以设置为`application/json`
* reply_to: 一般用来设置回调队列的队列名
* correlation_id: 用来设置请求和RPC相应的关联。

## Correlation Id

上面的方法中，我们建议为每个RPC请求创建一个回调队列。但是这样太低效了，幸好有一个更好的办法，为每个client创建回调队列。

这样还会带来一个问题，接受回调消息的队列不能明确知道相应属于哪个队列。这种情况下就是`correlation_id`有用的时候了。我们将会为每个请求设置一个唯一值，这样的话，我们就可以匹配响应和请求。如果没有看到已知`correlation_id`，我们就可以安全的丢弃信息，因为它不属于我们的请求。

你可能会问，为什么我们在回调队列里面忽略未知消息而不是抛出错误？这是由于服务端可能会存在的竞态问题。RPC服务可能会在发送响应之后挂掉，但是此时还有确认消息。如果这样情况发生，重新启动的RPC服务会重新处理请求。这就是为什么，客户端必须优雅的处理重复的响应，并且RPC调用必须为幂等。

## Summary

![](https://www.rabbitmq.com/img/tutorials/python-six.png)

我们的RPC大致这样工作：

1. 当客户端启动的时候，它创建匿名唯一回调队列
2. 对于每一个RPC请求，客户端发送消息的时候会携带两个属性。`reply_to`表示回调队列，`correlation_id`表示每个请求的唯一值
3. 请求发送给`rpc_queue`队列
4. RPC workder（服务端）在`rpc_queue`中等待请求。当请求出现时，它执行任务，通过`reply_to`字段回传消息给客户端。
5. 客户端等待回调队列。当消息出现时，它检查`correlation_id`，如果和请求中的`correlation_id`一致，则返回给程序。

## Putting it all together

Fibonacci函数:

```js
function fibonacci(n) {
  if (n == 0 || n == 1)
    return n;
  else
    return fibonacci(n - 1) + fibonacci(n - 2);
}
```

我们生命了fibonacci函数，并假设只会传入有效整数。（不要期望这个可以传入很大的整数，这个可能是最慢的递归实现了）。

`rpc_server.js`代码如下:

```js
#!/usr/bin/env node

var amqp = require('amqplib/callback_api');

amqp.connect('amqp://localhost', function(err, conn) {
  conn.createChannel(function(err, ch) {
    var q = 'rpc_queue';

    ch.assertQueue(q, {durable: false});
    ch.prefetch(1);
    console.log(' [x] Awaiting RPC requests');
    ch.consume(q, function reply(msg) {
      var n = parseInt(msg.content.toString());

      console.log(" [.] fib(%d)", n);

      var r = fibonacci(n);

      ch.sendToQueue(msg.properties.replyTo,
        new Buffer(r.toString()),
        {correlationId: msg.properties.correlationId});

      ch.ack(msg);
    });
  });
});

function fibonacci(n) {
  if (n == 0 || n == 1)
    return n;
  else
    return fibonacci(n - 1) + fibonacci(n - 2);
}
```

服务端的代码很简单：

* 和往常一样，我们建立了一个connection, channel，声明queue
* 服务端可能会运行多个实力，为了实现负载均衡，我们需要设置在channel上设置`prefetch`
* 使用`Channel.consume`从队列中消费队列，在回调函数中执行计算并且发送响应

`rpc_client.js`代码如下:

```js
#!/usr/bin/env node

var amqp = require('amqplib/callback_api');

var args = process.argv.slice(2);

if (args.length == 0) {
  console.log("Usage: rpc_client.js num");
  process.exit(1);
}

amqp.connect('amqp://localhost', function(err, conn) {
  conn.createChannel(function(err, ch) {
    ch.assertQueue('', {exclusive: true}, function(err, q) {
      var corr = generateUuid();
      var num = parseInt(args[0]);

      console.log(' [x] Requesting fib(%d)', num);

      ch.consume(q.queue, function(msg) {
        if (msg.properties.correlationId == corr) {
          console.log(' [.] Got %s', msg.content.toString());
          setTimeout(function() { conn.close(); process.exit(0) }, 500);
        }
      }, {noAck: true});

      ch.sendToQueue('rpc_queue',
      new Buffer(num.toString()),
      { correlationId: corr, replyTo: q.queue });
    });
  });
});

function generateUuid() {
  return Math.random().toString() +
         Math.random().toString() +
         Math.random().toString();
}
```

启动服务：

```bash
$ ./rpc_server.js
 [x] Awaiting RPC requests
```

启动客户端发送fibonacci数字：

```bash
$ ./rpc_client.js 30
 [x] Requesting fib(30)
``` 
 
这种设计不是RPC服务的唯一实现方式。但是这样做有以下一些优点：

* 如果RPC服务很慢，你可以通过新开一个节点来扩展
* 客户端那边，RPC通讯仅需要发送和接受一个消息，这样的话，一次RPC请求只需要一次网络往返

