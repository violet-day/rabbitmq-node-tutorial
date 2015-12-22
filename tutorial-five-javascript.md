## Topics

上一篇中，我们提升了我们的日志系统。使用`direct`来替换`fanout`的无脑广播，使我们有能力选择性的获取日志。

尽管使用`direct`exchange提升了我们的系统，但是它还是有一些缺陷，不能基于多个标准路由。

日志系统中，我们可能不仅想根据日志级别获取日志，还想通过日志的的数据触发源。你可能知道这个概念来自于[syslog](http://en.wikipedia.org/wiki/Syslog)，它根据日志级别(info/warn/crit...)和来源(auth/cron/kern...)

这样可以给我们极大的灵活性，因为可能会获取来自于`cron`的严重日志和来自`kern`的所有日志。

为了扩展我们的日志系统，我们需要学习更加复杂的topic exchange.


## Topic exchange

发送给`topic` exchange的信息不能包含一个随意的路由key，它必须是通过`.`的单词。单词可以是任意的，但是他们表示了消息的功能。一些有用的key比如："stock.usd.nyse", "nyse.vmw", "quick.orange.rabbit"。key中的单词可以有很多，上限为255 bytes

binding key必须和发送的一样，topic exchange背后的逻辑和direct比较类似，发给一个特定的key的消息会分发给绑定key的所有的队列。binding key中有两个比较重要的情况：

* * (star) 表示一个单词
* # (hash) 表示零或多个单词

在例子中很容易解释这样道理：

![](https://www.rabbitmq.com/img/tutorials/python-five.png)

这个例子中，我们将发送一些表示动物的消息。这些消息的route key由三个单词(2个点)组成，第一个单词表示速度，第二个表示颜色，第三个表示种类："<speed>.<colour>.<species>"

我们创建了3个绑定，`Q1`绑定`"*.orange.*"`，`Q2`绑定`*.*.rabbit`和`lazy.#`

这些绑定可以总结为：
* `Q1`对所有颜色为orange的动物感兴趣
* `Q2`关心所有和rabbit相关的和所有lazy的动物。

route key为`quick.orange.rabbit`的消息会发送给所有的队列，`lazy.orange.elephant`也是。另一方面`quick.orange.fox`仅会被路由至`Q1`，`lazy.brown.fox`会路由至`Q2`。`lazy.pink.rabbit`仅会被路由至`Q2`一次，即便它匹配了两个不同的bind。`quick.brown.fox`不会匹配任何bing，所以它会被丢弃。

如果我们打破了我们的协议，发送了1个或4个单词的消息，比如`orange`或`quick.orange.male.rabbit`会如何？这些消息并没有匹配任何bind，所有都会丢失。

另一方面，`lazy.orange.male.rabbit`，即便它有4个单词，但是它匹配第二个bind，所有会被分配给第二个队列。

### Putting it all together

我们将在日志系统中使用`topic` exchange。假设所有的日志都会是形如这样： "<facility>.<severity>"。

代码和上一节很相似。

`emit_log_topic.js`代码如下:

```js
#!/usr/bin/env node

var amqp = require('amqplib/callback_api');

amqp.connect('amqp://localhost', function(err, conn) {
  conn.createChannel(function(err, ch) {
    var ex = 'topic_logs';
    var args = process.argv.slice(2);
    var key = (args.length > 0) ? args[0] : 'anonymous.info';
    var msg = args.slice(1).join(' ') || 'Hello World!';

    ch.assertExchange(ex, 'topic', {durable: false});
    ch.publish(ex, key, new Buffer(msg));
    console.log(" [x] Sent %s:'%s'", key, msg);
  });

  setTimeout(function() { conn.close(); process.exit(0) }, 500);
});
```

`receive_logs_topic.js`的代码如下：

```js
#!/usr/bin/env node

var amqp = require('amqplib/callback_api');

var args = process.argv.slice(2);

if (args.length == 0) {
  console.log("Usage: receive_logs_topic.js <facility>.<severity>");
  process.exit(1);
}

amqp.connect('amqp://localhost', function(err, conn) {
  conn.createChannel(function(err, ch) {
    var ex = 'topic_logs';

    ch.assertExchange(ex, 'topic', {durable: false});

    ch.assertQueue('', {exclusive: true}, function(err, q) {
      console.log(' [*] Waiting for logs. To exit press CTRL+C');

      args.forEach(function(key) {
        ch.bindQueue(q.queue, ex, key);
      });

      ch.consume(q.queue, function(msg) {
        console.log(" [x] %s:'%s'", msg.fields.routingKey, msg.content.toString());
      }, {noAck: true});
    });
  });
});
```

接受所有的日志：

```bash
$ ./receive_logs_topic.js "#"
```

接受来自"kern"的所有日志：

```bash
$ ./receive_logs_topic.js "kern.*"
```

或者仅是`critical`级别的日志

```bash
$ ./receive_logs_topic.js "*.critical"
```

你可以同时创建多个bind

```bash
$ ./receive_logs_topic.js "kern.*" "*.critical"
```

发送`kern.critical`的消息：

```bash
$ ./emit_log_topic.js "kern.critical" "A critical kernel error"
```

