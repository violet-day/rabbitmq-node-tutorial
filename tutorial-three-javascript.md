## Publish/Subscribe

上一篇教程中我们创建了工作队列，这是假设每个任务都被分配到具体的一个worker。这节中，我们会一些完全不同的事情，我们会把消息发送给多个不同的消费者。这种模式叫`publish/subscribe`

为了说明这种模式，我们会构建一个简单的日志系统，它由两个小程序组成。第一个触法日志消息，第二个接受并打印它们。

在我们的日志系统里，每个运行中的接受者都会接受到消息，这样我们就可以运行一个接受消息并记录到磁盘，同时我们可以运行另外一个接受者并在屏幕中打印日志。

本质上来说，发布日志消息会给广播给所有的接受者。

## Exchanges

之前部分里面，我们通过队列发送和接受消息。是时候介绍Rabbit中完整的消息模型了。

让我们快速回顾一下之前的教程里面讲了什么：

* 生产者发送消息
* 队列本质上是buffer，它来存储消息
* 消费者接受消息

RabbitMQ的消息模型的核心理念是生产者不会直接发送消息给队列。实际上，大部分情况，生产者甚至不知道消息是否被发送给队列。

取而代之的是生产者只发送消息给exchange。exchange一边从生产者接受消息，一边发送消息给队列。exchange接受到消息之后，它必须确切的知道它该做什么。追加给一个队列？追加到多个队列？是否该丢弃？这些规则的定义通过exchange类型来决定。

有以下几种type：`direct`, `topic`, `headers`和`fanout`。我们会仅关注最后一个`fanout`，来创建这种类型的exchange
There are a few exchange types available:. We'll focus on the last one -- the fanout. Let's create an exchange of this type, and call it `logs`:

```js
ch.assertExchange('logs', 'fanout', {durable: false})
```

fanout exchange很简单，顾名思义，它就是把消息广播给所有它知道的队列，这也是我们的日志系统所需要的。

### Listing exchanges

服务器上如果可以通过`rabbitmqctl`列出所有的exchanges

```bash
$ sudo rabbitmqctl list_exchanges
Listing exchanges ...
        direct
amq.direct      direct
amq.fanout      fanout
amq.headers     headers
amq.match       headers
amq.rabbitmq.log        topic
amq.rabbitmq.trace      topic
amq.topic       topic
logs    fanout
...done.
```

查询结果中有一些形如`amq.*`的exchanges，这些都是默认创建的，此时你不需要太了解它们。

### Nameless exchange

之前的教程里面我们对exchanges一无所知，但是仍然可以发送消息给队列。这样可行的原因是因为我们使用了默认的被定义为空字符串("")的exchange。

```js
ch.sendToQueue('hello', new Buffer('Hello World!'));
```

这里我们使用了默认的exchange，消息通过传入的第一个参数被路由到相应的队列。

现在，我们可以发布消息到我们指定的exchange：

```js
ch.publish('logs', '', new Buffer('Hello World!'));
```

第二个空着的参数表示我们不想发送消息给任何一个具体的队列，仅发送给我们的'logs' exchange。

## Temporary queues

你可能还记得我们之前使用了一些带有具体名字的队列（hello和task_queue）。我们需要指定多个worker的相同的消费队列时，可以给队列命名就显得很关键。需要在生产者和消费者之间共享队列时，命名队列也会显得很重要。

但是我们的logger并不关心这个。我们想接受到所有的日志消息，并不是他们的子集。我们仅关心当前接受到的消息不在旧的里面。解决这个问题我们需要以下两件事情：

首先，当我们连接到Rabbit时，我们需要一个全新的队列。可以通过创建队列时随机命名，或者更好的，让服务器端为我们选择一个队列名。

其次，消费者一旦断开连接，队列应该被自动删除。

在amqp.node客户端中，当设置队列名为一个空字符串时，我们创建了一个非永久且自动命名的队列：

```js
ch.assertQueue('', {exclusive: true});
```

当函数返回时，队列实例会包含由RabbitMQ生成的队列名。比如看起来像这样`amq.gen-JzTY20BRgKO-HjmUJj0wLg`

当连接断开时，正如队列声明的唯一性，队列会被自动删除。

### Bindings

我们已经创建了一个fanout exchange和一个队列。现在我们需要告诉exchange发送消息给我们的队列，exchange和队列之前的关系，我们称之为binding。

```js
ch.bindQueue(queue_name, 'logs', '');
```

现在exchange会将消息追加我们指定的队列。

### Listing bindings

如你所猜的那样，可以通过`rabbitmqctl list_bindings`列出所有的binding

## Putting it all together

![](https://www.rabbitmq.com/img/tutorials/python-three-overall.png)

生产者程序发送消息，看起来和之前教程中的没什么区别。最大的不同点在于发送消息给logs exchange，而不是默认空字符串的那个。发送消息过程中需要提供一个路由key，但是对于fanout exchanges，这个不是必须的。`emit_log.js`代码如下：

```js
#!/usr/bin/env node

var amqp = require('amqplib/callback_api');

amqp.connect('amqp://localhost', function(err, conn) {
  conn.createChannel(function(err, ch) {
    var ex = 'logs';
    var msg = process.argv.slice(2).join(' ') || 'Hello World!';

    ch.assertExchange(ex, 'fanout', {durable: false});
    ch.publish(ex, '', new Buffer(msg));
    console.log(" [x] Sent %s", msg);
  });

  setTimeout(function() { conn.close(); process.exit(0) }, 500);
});
```

(emit_log.js source)

如你所见，在建立连接之后，我们声明了exchange。这个步骤是必须的，因为向一个不存在的exchange发送消息是禁止的。

如果还没有队列绑定到该exchange，发送的消息会丢失。这个例子里面这样没什么问题，没有消费者的情况下，我们可以安全的丢弃消息。`receive_logs.js`的代码如下：

```js
#!/usr/bin/env node

var amqp = require('amqplib/callback_api');

amqp.connect('amqp://localhost', function(err, conn) {
  conn.createChannel(function(err, ch) {
    var ex = 'logs';

    ch.assertExchange(ex, 'fanout', {durable: false});

    ch.assertQueue('', {exclusive: true}, function(err, q) {
      console.log(" [*] Waiting for messages in %s. To exit press CTRL+C", q.queue);
      ch.bindQueue(q.queue, ex, '');

      ch.consume(q.queue, function(msg) {
        console.log(" [x] %s", msg.content.toString());
      }, {noAck: true});
    });
  });
});
```

(receive_logs.js source)

如果你保存日志至某个文件，可以打开控制台输入：

```bash
$ ./receive_logs.js > logs_from_rabbit.log
```

如果你想在你的屏幕看到日志，新开一个窗口运行：

```bash
$ ./receive_logs.js
```

And of course, to emit logs type:

当然，需要打开：

```bash
$ ./emit_log.js
```


