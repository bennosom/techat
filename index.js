'use strict';

process.title = 'techat';


/**
 * Globals
 */

var port = process.env.PORT;


/*
 * Modules
 */

var WebSocketServer = require('websocket').server;
var http = require('http');
var express = require('express');
var techat = require('./techat');


/**
 * Helper functions
 */

var uniqueIdCounter = 100;

function uniqueId() {
	return ++uniqueIdCounter + '';
}

function idForConnection(connection) {
	for (var id in clients) {
		if (clients[id] === connection) {
			return id;
		}
	}
	console.error('Error: Unknown connection');
	return null;
}


/**
 * HTTP
 */

var router = express();
var server = http.createServer(router);
server.listen(port, function() {
	console.info('Listening on %s:%s', server.address().address, server.address().port);
});

router.get('/stats', function(req, res) {
	res.writeHead(200, {
		'Content-Type': 'application/json'
	});
	res.end(JSON.stringify(techat.stats()));
});

router.use(express.static(__dirname + '/html'));


/**
 * WebSocket
 */

var wsServer = new WebSocketServer({
	httpServer: server
});

var clients = {};

function send(peers, message) {
	var connections = [];

	for (var i = 0; i < peers.length; i++) {
		connections.push(clients[peers[i]]);
	}
	
	if (connections.length === 0) {
		for (var client in clients) {
			connections.push(clients[client]);
		}	
	}

	for (var i = 0; i < connections.length; i++) {
		connections[i].sendUTF(JSON.stringify(message));
	}
}

techat.onPush(send);

wsServer.on('request', function(req) {
	var connection = req.accept(null, req.origin);

	clients[uniqueId()] = connection;
	console.log('Peer %s connected', connection.remoteAddress);

	connection.on('message', function(message) {
		if (message.type === 'utf8') {
			var tc_request = {
				peer: idForConnection(connection),
				context: null
			};
			try {
				var data = JSON.parse(message.utf8Data);
				tc_request.cmd = data.cmd;
				tc_request.context = data.context;
			}
			catch (err) {
				console.error('Parser error: Invalid JSON data %s\nReason: %s', message.utf8Data, err);
				return;
			}
			techat.process(tc_request);
		}
		else if (message.type === 'binary') {
			console.warn('Got %d bytes of binary data. WTF?', message.binaryData.length);
		}
	});

	connection.on('close', function() {
		var clientID = idForConnection(connection);
		clients[clientID] = null;
		delete clients[clientID];
		console.log('Peer %s disconnected', connection.remoteAddress);
	});
});