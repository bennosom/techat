/*!
 * techat
 * https://github.com/bennosom/techat
 *
 * Copyright 2010-2014 Benjamin Engst <benjos@online.de>
 * Released under the MIT license
 */
(function(scope) {
	'use strict';

	var techat = {};

	var redis = require('redis');
	var store = redis.createClient();
	var lock = require('redis-lock')(store);

	store.on("error", function(err) {
		console.log("Redis: " + err);
	});

	/*
		var client = require("redis").createClient();
		var util = require("util");

		client.monitor(function(err, res) {
			console.log("Entering monitoring mode.");
		});

		client.on("monitor", function(time, args) {
			console.log(time + ": " + util.inspect(args));
		});
	*/


	/**
	 * tc_request: {
	 * 	peer: <id>
	 * 	data: {
	 *			op: <cmd>,
	 *			context: {
	 *				...
	 *			}
	 *		}
	 * }
	 *
	 * tc_response: {
	 * 	peer: <id>
	 * 	data: {
	 *			op: <cmd>,
	 *			result: {
	 *				...
	 *			}
	 *		}
	 * }
	 *
	 * tc_notify: {
	 * 	peer: <id>
	 * 	event: <event>,
	 *		context: {
	 *			...
	 *		}
	 * }
	 */

	var dispatcher = {
		login: function(tc_request) {
			var username = tc_request.context.username;
			var challenge = tc_request.context.password;

			lock('login:' + username, function(done) {
				store.hget('user:', username, function(err, user_id) {
					if (user_id) {
						store.hget('user:' + user_id, 'password', function(err, secret) {
							if (challenge === secret) {
								store.hset('user:' + user_id, 'idle', new Date().valueOf(), function(err, reply) {
									done(function() {
										console.log('Login successful for user: %s', username);

										// notify clients
										techat.send([], {
											event: 'user_state_changed',
											context: {
												user: username,
												state: 'online'
											}
										});

									});
								});
							}
							else {
								done(function() {
									console.log('Invalid credentials for user: %s', username);
									techat.send([tc_request.peer], {
										event: 'error_invalid_credentials'
									});

								});
							}
						});
					}
					else {
						done(function() {
							console.log('Invalid credentials for user: %s', username);
							techat.send([tc_request.peer], {
								event: 'error_invalid_credentials'
							});
						});
					}
				});
			});
		},
		logout: function(tc_request) {
			var username = tc_request.context.username;

			lock('logout:' + username, function(done) {
				store.hget('user:', username, function(err, user_id) {
					if (user_id) {
						store.hset('user:' + user_id, 'idle', -1, function(err, reply) {
							done(function() {
								console.log('Logout successful for user: %s', username);

								// notify clients
								techat.send([], {
									event: 'user_state_changed',
									context: {
										user: username,
										state: 'offline'
									}
								});
							});
						});
					}
					else {
						done(function() {
							console.log('Logout failed for unkown user: %s', username);
							techat.send([tc_request.peer], {
								event: 'error_invalid_credentials'
							});

						});
					}
				});
			});
		},
		user_add: function(tc_request) {
			var username = tc_request.context.username + '';
			var password = tc_request.context.password + '';
			if (username.length === 0) {
				techat.send([tc_request.peer], {
					event: 'error_invalid_username'
				});
				return;
			}

			lock('user_add:' + username, function(done) {
				store.hget('user:', username, function(err, user_id) {
					if (!user_id) {
						store.incr('user:latest_id', function(err, next_user_id) {
							store.hmset('user:' + next_user_id, 'id', next_user_id, 'username', username, 'password', password, function(err, reply) {
								store.hset('user:', username, next_user_id, function(err, reply) {
									done(function() {
										console.log('User added: %s', username);

										// notify clients
										techat.send([], {
											event: 'user_list_changed'
										});

									});
								});
							});
						});
					}
					else {
						done(function() {
							console.log('User already exists: %s', username);
							techat.send([tc_request.peer], {
								event: 'user_already_exists'
							});
						});
					}
				});
			});
		},
		user_list: function(tc_request) {
			store.hgetall('user:list', function(err, replies) {
				var multi = store.multi();
				for (var name in replies) {
					multi.hgetall('user:' + replies[name]);
				}
				multi.exec(function(err, users) {
					var list = [],
						user;
					for (var i = 0; i < users.length; i++) {
						user = users[i];
						list.push({
							id: user.id,
							userName: user.username,
							online: (user.idle >= 0)
						});
					}

					techat.send([tc_request.peer], {
						event: tc_request.cmd,
						context: list
					});
				});
			});
		},
		message_add: function(tc_request) {
			console.error('message_add not implemented yet')
		},
		room_list: function(tc_request) {
			store.hgetall('room:list', function(err, replies) {
				var multi = store.multi();
				for (var name in replies) {
					multi.hgetall('room:' + replies[name]);
				}
				multi.exec(function(err, rooms) {
					var list = [],
						room;
					for (var i = 0; i < rooms.length; i++) {
						room = rooms[i];
						list.push({
							id: room.id,
							roomName: room.name
						});
					}

					techat.send([tc_request.peer], {
						event: tc_request.cmd,
						context: list
					});
				});
			});
		},
		room_add: function(tc_request) {
			console.error(tc_request);
			
			var roomName = tc_request.context.roomName + '';
			if (roomName.length === 0) {
				techat.send([tc_request.peer], {
					event: 'error_invalid_roomName'
				});
				return;
			}

			lock('room_add:' + roomName, function(done) {
				store.hget('room:list', roomName, function(err, room_id) {
					if (!room_id) {
						store.incr('user:latest_id', function(err, next_user_id) {
							store.hmset('user:' + next_user_id, 'id', next_user_id, 'username', username, 'password', password, function(err, reply) {
								store.hset('user:', username, next_user_id, function(err, reply) {
									done(function() {
										console.log('User added: %s', username);

										// notify clients
										techat.send([], {
											event: 'user_list_changed'
										});

									});
								});
							});
						});
					}
					else {
						done(function() {
							console.log('Room already exists: %s', roomName);
							techat.send([tc_request.peer], {
								event: 'room_already_exists'
							});
						});
					}
				});
			});
		}
	};

	/*
	 * tc_response: {
	 * 	peer: <id>
	 * 	data: {
	 *			op: <cmd>,
	 *			result: {
	 *				...
	 *			}
	 *		}
	 * }
	 */

	var secret = function() {
		return {
			answer: 42
		};
	};


	/*
	 * exported module functions
	 */

	techat.onPush = function(callback) {
		techat.send = callback;
	};

	techat.process = function(tc_request) {
		if (dispatcher[tc_request.cmd]) {
			dispatcher[tc_request.cmd].call(null, tc_request);
		}
		else {
			console.error('Unkown command: %s', tc_request.cmd);
		}
	};

	techat.stats = function() {
		return secret();
	};


	/*
	 * export module
	 */

	module.exports = techat;

})();