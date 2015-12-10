## 简介
RabbitMQ是一个消息代理系统。本质上，它从生产者接受消息，并且传递给消费者。同时，还可以根据你提供的规则实现路由、缓冲、持久化。

生产等同于发送。发送消息的程序即为生产者。我们通过"P"来标注：

![生产者](https://www.rabbitmq.com/img/tutorials/producer.png)

虽然消费通过RabbitMQ在你的程序中流转，但是他们可以仅被存储于队列中。队列不受任何限制的约束，它可以存储尽可能多的消息。它本质上是无限buffer。生产者可以向一个队列里面发送消息，消费者可以从一个队列里面读取消息。队列可以画成这样：

![队列](https://www.rabbitmq.com/img/tutorials/queue.png)

消费等同于接受。一直接受消息的程序即为消费者。我们通过"C"来标注：

![消费者](https://www.rabbitmq.com/img/tutorials/consumer.png)

注意：生产者，消费者，消息代理没有必要被部署在同一台机器上面。实际上，大部分情况就是这样。

##"Hello World"(使用amqp.node client)

这部分教程中，我们会用Javascript写两个小程序。
一个生产者发送消息，另外一个消费者接受并打印消息。
我们会不会回太细致关注[amqp.node](http://www.squaremobius.net/amqp.node/)的具体API。

下面这幅图中，"P"是我们的生产者，"C"是消费者。中间的部分为一个消息buffer，它由RabbitMQ为消费者准备

![](https://www.rabbitmq.com/img/tutorials/python-one.png)

### 安装amqp.node

RabbitM使用AMQP 0.9.1这一开源、广泛使用的消息协议。有很多不同语言的[客户端](https://www.rabbitmq.com/devtools.html)。本次教程我们使用amqp.node

```
$ npm install amqplib
```

### 发送消息

定义`send.js`为发送者，`receive.js`为接受者。发送者会连接到RabbitMQ,发送一条发消息并退出

在`send.js`, 我们先引入库:

```javascript
var amqp = require('amqplib/callback_api');
```

然后连接到RabbitMQ服务器

```js
amqp.connect('amqp://localhost', function(err, conn) {});
```

然后我们创建一个channel， which is where most of the API for getting things done resides:

```js
amqp.connect('amqp://localhost', function(err, conn) {
  conn.createChannel(function(err, ch) {});
});
```

发送消息之前，必须先声明一个queue，然后再通过queue来发送消息。

```js
amqp.connect('amqp://localhost', function(err, conn) {
  conn.createChannel(function(err, ch) {
    var q = 'hello';

    ch.assertQueue(q, {durable: false});
    ch.sendToQueue(q, new Buffer('Hello World!'));
    console.log(" [x] Sent 'Hello World!'");
  });
});
```

声明queue是幂等的，仅会在不存在的时候创建。消息体是一个byte array，这样你可以按照你的需求编码。
最后，关闭连接并退出。

```js
setTimeout(function() { conn.close(); process.exit(0) }, 500);
```

Here's the whole send.js script.

####发送失败？

如果这事你第一次使用RabbitMQ并且你并没有能看到"Sent"信息，你可能会抓破脑皮想知道哪里出错了。原因可能是代理没有足够的硬盘空间（默认需要1GB）导致拒绝接受消息。如果有必要的话，检查代理的日志文件减少需求限制。[配置文档会](http://www.rabbitmq.com/configure.html#config-items)说明如何设置`disk_free_limit`

### 接受消息
发送者从RabbitMQ发送消息，与发送者不同，我门会让接受者一直监听并打印消息。

![receiving](https://www.rabbitmq.com/img/tutorials/receiving.png)

代码和send的require相同：

```js
var amqp = require('amqplib/callback_api');
```

配置和sender相同，我们打开一个connection和channel，声明我们需要消费的queue。注意：queue的名称需要和发送者声明的一致。

```js
amqp.connect('amqp://localhost', function(err, conn) {
  conn.createChannel(function(err, ch) {
    var q = 'hello';

    ch.assertQueue(q, {durable: false});
  });
});
```

注意：我们在此声明了queue。因为接受者启动可能在发送者之前，所以当尝试去消费队列的时候，我们需要确保队列已经存在。

我们要告诉服务器把消息通过队列传输过来。因为它会异步的推送过来，所以我们提供了一个callback会在RabbitMQ发送给消费者的时候执行。Channel.consume如下：

```js
console.log(" [*] Waiting for messages in %s. To exit press CTRL+C", q);
ch.consume(q, function(msg) {
  console.log(" [x] Received %s", msg.content.toString());
}, {noAck: true});
```

Here's the whole receive.js script.

```
$ ./send.js
```
```
$ ./receive.js
```

接受者会打印出RabbitMQ发送的消息。接受者会持续运行，等待消息。

