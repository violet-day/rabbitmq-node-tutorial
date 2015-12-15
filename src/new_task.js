/**
 * Created by Nemo on 15/12/10.
 */

var amqp = require('amqplib/callback_api');
var msg = process.argv.slice(2).join(' ') || "Hello World!";

amqp.connect('amqp://localhost', function (err, conn) {
  conn.createChannel(function (err, ch) {
    var q = 'task_queue';

    ch.assertQueue(q, {durable: true});
    ch.sendToQueue(q, new Buffer(msg), {persistent: true});
    console.log(" [x] Sent '%s'", msg);

    setTimeout(function () {
      conn.close();
      process.exit(0);
    }, 500);
  });
});