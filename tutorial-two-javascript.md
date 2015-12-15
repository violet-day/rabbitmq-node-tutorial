## 工作队列

在第一篇教程中我们写了一个程序通过队列发送接受消息。本章教程中我们会创建一个任务队列分发耗时任务给多个worker。

工作队列（任务的队列）的主要思想是避免立即执行资源密集型操作并一致等待它完成。想腐案，我们会安排这些任务稍后执行。我们把任务封装称消息发送给队列，同时worker在后台运行，接受到消息之后就会执行任务。

这个概念在http请求中处理复杂任务时特别有用。

## 前置准备

上一篇教程中，我们发送的消息为： "Hello World!"。现在我们发送一串字符来表示复杂的任务。然而我们并没有像转换图片为pdf这样实际的任务，所以通过`setTimout`方法来假装我们很忙。通过`.`来区分任务复杂度，每一个`.`算1秒，模拟的任务`Hello...`需要消耗3秒。

为了能在命令行中修改发送的消息，我们需要简单的修改上一篇教程中的`send.js`，它会把任务传给我们的工作队列，命名为`new_task.js`:

```js
var msg = process.argv.slice(2).join(' ') || "Hello World!";

ch.assertQueue(q, {durable: true});
ch.sendToQueue(q, new Buffer(msg), {persistent: true});
console.log(" [x] Sent '%s'", msg);
```

我们旧的`receive.js`同样也需要一些修改，根据`.`来模拟描述。因为它会从队列中弹出消息同时执行任务，所以我们命名为`worker.js`:

```js
ch.consume(q, function(msg) {
  var secs = msg.content.toString().split('.').length - 1;

  console.log(" [x] Received %s", msg.content.toString());
  setTimeout(function() {
    console.log(" [x] Done");
    ch.ack(msg);
  }, secs * 1000);
}, {noAck: false});
```

```bash
shell1$ ./worker.js
shell2$ ./new_task.js
```

## 轮转分配

用任务的队列有一个好处是可以并行处理任务。如果正在构建一个很容易积压的工作，仅仅通过添加worker就可以很容易实现扩展。

首先，我们尝试同时运行两个`worker.js`，他们会从队列中获取信息，但是实际情况呢？

开启三个控制台，两个运行`worker.js`，他们是我们两个消费者C1和C2

```bash
shell1$ ./worker.js
 [*] Waiting for messages. To exit press CTRL+C
shell2$ ./worker.js
 [*] Waiting for messages. To exit press CTRL+C
```

第三个控制台我们一直发布任务。一旦你启动消费者，你就可以发送消息：

```bash
shell3$ ./new_task.js First message.
shell3$ ./new_task.js Second message..
shell3$ ./new_task.js Third message...
shell3$ ./new_task.js Fourth message....
shell3$ ./new_task.js Fifth message.....
```

让我们看看worker接受到了什么：

```bash
shell1$ ./worker.js
 [*] Waiting for messages. To exit press CTRL+C
 [x] Received 'First message.'
 [x] Received 'Third message...'
 [x] Received 'Fifth message.....'
```

```bash
shell2$ ./worker.js
 [*] Waiting for messages. To exit press CTRL+C
 [x] Received 'Second message..'
 [x] Received 'Fourth message....'
```

RabbitMQ默认会串行依次发送消息给消费者。每个消费者会得到相对平均的消息数量，这种分配方式叫做`round-robin`。

## 消息确认

处理一个任务会消耗一定时间。你可能会想，如果其中的一个消费者开始处理了一部分耗时很长的任务之后进程死了会发生什么。就目前的代码而言，一旦RabbitMQ将消息发送给消费者，它会立马从内存中清楚消息。这种情况下，如果你杀死一个worker，我们就会丢失刚刚开始执行的消息，可能还会丢失我们分配给特定worker的消息。

但是我们并不想丢失任务任务，如果一个worker挂了，我们需要将任务分配给另外一个worker。

为了确保消息不丢失，RabbitMQ提供了消息确认机制。消息确认会被消费者发送给RabbitMQ通知消息被接受到，被处理，这样RabbitMQ就能删除了。

如果一个消费者挂了（channel被关闭、连接被关闭、TCP连接丢失）且没有发送ack，RabbitMQ就会明白这个消息没有被完全处理掉，并把它重新分配。如果同一时间有另外一个消费者在西安，它会被快速的分配给另外一个消费者。这样的话，即便worker不时的话了，你仍可以确保消息不会丢失。

RabbitMQ没有消息超时的情况。即使是处理一个很长很长时间的任务，只有当worker连接丢失的时候，RabbitMQ才会重新分配消息。

消息确认默认是关闭的。通过`{noAck: false}`打开了ack，在完成任务之后，worker会发送一个确认消息

```js
ch.consume(q, function(msg) {
  var secs = msg.content.toString().split('.').length - 1;

  console.log(" [x] Received %s", msg.content.toString());
  setTimeout(function() {
    console.log(" [x] Done");
    ch.ack(msg);
  }, secs * 1000);
}, {noAck: false});
```

用上面的代码，我们可以确保，即便通过`CTRL+C`杀死了正在处理消息的worker，消息不会丢失。不久之后，所有没有被确定的消息会被重新分配。

## 消息永久化

我们已经知道如何在消费者已经挂了的情况下不丢失任务。但是我们的任务仍然会在RabbitMQ服务停止的时候丢失。

除非你告诉RabbitMQ别这么做，否则RabbitMQ会在退出或者崩溃的时候忘记队列和消息。为了确保消息不丢失，我们需要确保队列和消息durable

首先，我们需要确保RabbitMQ永远不会丢失队列，需要声明队列为*durable*

```js
ch.assertQueue('hello', {durable: true});
```

尽管这个命令是正确的，目前的步骤里面仍然不会有效。因为我们已经定义了不永久的`hello`队列。RabbitMQ不允许通过不同的参数重复定义队列，否则程序会报错。有一个快速解决方案，我们定义一个不通的队列名称，比如*task_queue*

```js
ch.assertQueue('task_queue', {durable: true});
```

durable参数需要同时在生产者和消费者中配置。

此刻我们确信task_queue队列在RabbitMQ重启时不会丢失。现在需要通过`Channel.sendToQueue`的`persistent`参数将我们的消息标记为持久化。

```js
ch.sendToQueue(q, new Buffer(msg), {persistent: true});
```

## 平均分配

你可能已经注意到，分配并不是我们想要的那样。比如有一种情况下，有两个worker，所有的奇数消息信息量很大，偶数的却很小，一个worker可能会很忙，另外一个则没什么事情。然后，RabbitMQ并不知道这一切，并且仍然会继续这样分配消息。

这样发生的原因是RabbitMQ当消息进入队列的时候才会去分配。它不会去查看消费者还没有确认的消息数量，仅仅就是盲目的分配消息给消费者。

![](https://www.rabbitmq.com/img/tutorials/prefetch-count.png)

为了避免这种情况，我们使用调用`prefetch`方法设值为1。它告诉RabbitMQ别同时分配给一个worker超过一个的任务。也就是，在worker还没有处理并且确定之前的任务之前，不要再分配给它。
取而代之的是，RabbitMQ会分配另外一个不是那么忙的worker。

```js
ch.prefetch(1);
```

### 注意队列大小

如果所有的worker都很忙，你的队列可能会被填满。你应该需要关注这一点，可能添加多个worker，或者采取其他策略。

