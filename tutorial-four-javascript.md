## Routing

上一篇教程中，我们构建了一个简单的日志系统。可以广播消息给多个接受者。

这边教程中，我们打算添加在上面添加一些功能：可以让接受者接受所有消息的子集。比如，我们仅将文件保存至磁盘，同时在控制台打印所有的消息。

## Bindings

上一篇教程中，我们已经创建了bindings，你可以像这样调用：

```js
ch.bindQueue(q.queue, ex, '');
```

binding是exchange和queue之前的一种关系。可以简单的理解为：这个queue对来自于这个exchange的消息很感兴趣。

Bindings可以传入一个binding key参数（上一个例子中，我们传入了空值）。创建key像这样：

```js
ch.bindQueue(queue_name, exchange_name, 'black');
```

binding key的含义依赖于exchange的类型。我们之前使用的fanout exchanges忽略了这个值。

## Direct exchange

上一个教程中我们构建的日志系统广播所有的消息给消费者。我们想对它做些扩展，可以根据日志的严重级别做过滤。比如，仅出现严重错误的时候，我们将日志写入磁盘，对于warning或者info的信息不需要浪费磁盘空间。

之前使用的fanout exchange并没有这样的灵活性，它只能无脑的广播信息。

direct exchange的路由算法很简单。队列只会接受和路由key匹配一直的消息。

可以参考下图：
![](https://www.rabbitmq.com/img/tutorials/direct-exchange.png)

上图中，我们可以看到direct exchange `X` 有两个队列与之绑定。第一个队列key为`orange`，第二个队列`black`和`green`

这样设置的话，route key 为`orange`的会被路由给`Q1`，`balck`和`green`会路由给`Q2`，其他所有的消息会被丢弃。

## Multiple bindings

![](https://www.rabbitmq.com/img/tutorials/direct-exchange-multiple.png)

对多个队列绑定同样的key是完全允许的。在我们的例子中可以在`X`和`Q1`之间添加绑定key`black`。这种情况下，`direct`会表现的和`fanout`一样，广播所有的消息给匹配的路由。`balck`都会分配给`Q1`和`Q2`

## Emitting logs

我们将在日志系统里面使用这种模式。用`direct`替代`fanout`之后，使用日志严重级别作为路由key。这样的话，接受的脚本可以根据严重级别选择过滤。

和往常一样，需要先创建exchange

```js
var ex = 'direct_logs';

ch.assertExchange(ex, 'direct', {durable: false});
```

这样就可以发送消息了：

```js
var ex = 'direct_logs';

ch.assertExchange(ex, 'direct', {durable: false});
ch.publish(ex, severity, new Buffer(msg));
```

可以将日志的严重级别简单定义为'info', 'warning', 'error'

## Subscribing


Receiving messages will work just like in the previous tutorial, with one exception - we're going to create a new binding for each severity we're interested in.

args.forEach(function(severity) {
  ch.bindQueue(q.queue, ex, severity);
});

## Putting it all together

![](https://www.rabbitmq.com/img/tutorials/python-four.png)

`emit_log_direct.js`代码如下：

```js
#!/usr/bin/env node

var amqp = require('amqplib/callback_api');

amqp.connect('amqp://localhost', function(err, conn) {
  conn.createChannel(function(err, ch) {
    var ex = 'direct_logs';
    var args = process.argv.slice(2);
    var msg = args.slice(1).join(' ') || 'Hello World!';
    var severity = (args.length > 0) ? args[0] : 'info';

    ch.assertExchange(ex, 'direct', {durable: false});
    ch.publish(ex, severity, new Buffer(msg));
    console.log(" [x] Sent %s: '%s'", severity, msg);
  });

  setTimeout(function() { conn.close(); process.exit(0) }, 500);
});
```

`receive_logs_direct.js`代码如下：

```js
#!/usr/bin/env node

var amqp = require('amqplib/callback_api');

var args = process.argv.slice(2);

if (args.length == 0) {
  console.log("Usage: receive_logs_direct.js [info] [warning] [error]");
  process.exit(1);
}

amqp.connect('amqp://localhost', function(err, conn) {
  conn.createChannel(function(err, ch) {
    var ex = 'direct_logs';

    ch.assertExchange(ex, 'direct', {durable: false});

    ch.assertQueue('', {exclusive: true}, function(err, q) {
      console.log(' [*] Waiting for logs. To exit press CTRL+C');

      args.forEach(function(severity) {
        ch.bindQueue(q.queue, ex, severity);
      });

      ch.consume(q.queue, function(msg) {
        console.log(" [x] %s: '%s'", msg.fields.routingKey, msg.content.toString());
      }, {noAck: true});
    });
  });
});
```

如果你仅仅是想将'warning' and 'error' (除去'info')的日志信息的打印打印至文件，打开控制台输入：

```bash
$ ./receive_logs_direct.js warning error > logs_from_rabbit.log
```

如果你想在屏幕中看到所有的日志信息，可以输入：

```bash
$ ./receive_logs_direct.js info warning error
 [*] Waiting for logs. To exit press CTRL+C
```

发消息一个`error`级别的消息输入：

```bash
$ ./emit_log_direct.js error "Run. Run. Or it will explode."
 [x] Sent 'error':'Run. Run. Or it will explode.'
```

