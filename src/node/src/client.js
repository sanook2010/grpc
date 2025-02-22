/*
 *
 * Copyright 2015, Google Inc.
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 *
 *     * Redistributions of source code must retain the above copyright
 * notice, this list of conditions and the following disclaimer.
 *     * Redistributions in binary form must reproduce the above
 * copyright notice, this list of conditions and the following disclaimer
 * in the documentation and/or other materials provided with the
 * distribution.
 *     * Neither the name of Google Inc. nor the names of its
 * contributors may be used to endorse or promote products derived from
 * this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
 * OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 *
 */

/**
 * Client module
 * @module
 */

'use strict';

var _ = require('lodash');

var grpc = require('bindings')('grpc_node');

var common = require('./common');

var Metadata = require('./metadata');

var EventEmitter = require('events').EventEmitter;

var stream = require('stream');

var Readable = stream.Readable;
var Writable = stream.Writable;
var Duplex = stream.Duplex;
var util = require('util');
var version = require('../../../package.json').version;

util.inherits(ClientWritableStream, Writable);

/**
 * A stream that the client can write to. Used for calls that are streaming from
 * the client side.
 * @constructor
 * @param {grpc.Call} call The call object to send data with
 * @param {function(*):Buffer=} serialize Serialization function for writes.
 */
function ClientWritableStream(call, serialize) {
  Writable.call(this, {objectMode: true});
  this.call = call;
  this.serialize = common.wrapIgnoreNull(serialize);
  this.on('finish', function() {
    var batch = {};
    batch[grpc.opType.SEND_CLOSE_FROM_CLIENT] = true;
    call.startBatch(batch, function() {});
  });
}

/**
 * Attempt to write the given chunk. Calls the callback when done. This is an
 * implementation of a method needed for implementing stream.Writable.
 * @access private
 * @param {Buffer} chunk The chunk to write
 * @param {string} encoding Used to pass write flags
 * @param {function(Error=)} callback Called when the write is complete
 */
function _write(chunk, encoding, callback) {
  /* jshint validthis: true */
  var batch = {};
  var message = this.serialize(chunk);
  if (_.isFinite(encoding)) {
    /* Attach the encoding if it is a finite number. This is the closest we
     * can get to checking that it is valid flags */
    message.grpcWriteFlags = encoding;
  }
  batch[grpc.opType.SEND_MESSAGE] = message;
  this.call.startBatch(batch, function(err, event) {
    if (err) {
      // Something has gone wrong. Stop writing by failing to call callback
      return;
    }
    callback();
  });
}

ClientWritableStream.prototype._write = _write;

util.inherits(ClientReadableStream, Readable);

/**
 * A stream that the client can read from. Used for calls that are streaming
 * from the server side.
 * @constructor
 * @param {grpc.Call} call The call object to read data with
 * @param {function(Buffer):*=} deserialize Deserialization function for reads
 */
function ClientReadableStream(call, deserialize) {
  Readable.call(this, {objectMode: true});
  this.call = call;
  this.finished = false;
  this.reading = false;
  this.deserialize = common.wrapIgnoreNull(deserialize);
}

/**
 * Read the next object from the stream.
 * @access private
 * @param {*} size Ignored because we use objectMode=true
 */
function _read(size) {
  /* jshint validthis: true */
  var self = this;
  /**
   * Callback to be called when a READ event is received. Pushes the data onto
   * the read queue and starts reading again if applicable
   * @param {grpc.Event} event READ event object
   */
  function readCallback(err, event) {
    if (err) {
      // Something has gone wrong. Stop reading and wait for status
      self.finished = true;
      return;
    }
    var data = event.read;
    var deserialized;
    try {
      deserialized = self.deserialize(data);
    } catch (e) {
      self.call.cancelWithStatus(grpc.status.INTERNAL,
                                 'Failed to parse server response');
    }
    if (self.push(deserialized) && data !== null) {
      var read_batch = {};
      read_batch[grpc.opType.RECV_MESSAGE] = true;
      self.call.startBatch(read_batch, readCallback);
    } else {
      self.reading = false;
    }
  }
  if (self.finished) {
    self.push(null);
  } else {
    if (!self.reading) {
      self.reading = true;
      var read_batch = {};
      read_batch[grpc.opType.RECV_MESSAGE] = true;
      self.call.startBatch(read_batch, readCallback);
    }
  }
}

ClientReadableStream.prototype._read = _read;

util.inherits(ClientDuplexStream, Duplex);

/**
 * A stream that the client can read from or write to. Used for calls with
 * duplex streaming.
 * @constructor
 * @param {grpc.Call} call Call object to proxy
 * @param {function(*):Buffer=} serialize Serialization function for requests
 * @param {function(Buffer):*=} deserialize Deserialization function for
 *     responses
 */
function ClientDuplexStream(call, serialize, deserialize) {
  Duplex.call(this, {objectMode: true});
  this.serialize = common.wrapIgnoreNull(serialize);
  this.deserialize = common.wrapIgnoreNull(deserialize);
  this.call = call;
  this.on('finish', function() {
    var batch = {};
    batch[grpc.opType.SEND_CLOSE_FROM_CLIENT] = true;
    call.startBatch(batch, function() {});
  });
}

ClientDuplexStream.prototype._read = _read;
ClientDuplexStream.prototype._write = _write;

/**
 * Cancel the ongoing call
 */
function cancel() {
  /* jshint validthis: true */
  this.call.cancel();
}

ClientReadableStream.prototype.cancel = cancel;
ClientWritableStream.prototype.cancel = cancel;
ClientDuplexStream.prototype.cancel = cancel;

/**
 * Get the endpoint this call/stream is connected to.
 * @return {string} The URI of the endpoint
 */
function getPeer() {
  /* jshint validthis: true */
  return this.call.getPeer();
}

ClientReadableStream.prototype.getPeer = getPeer;
ClientWritableStream.prototype.getPeer = getPeer;
ClientDuplexStream.prototype.getPeer = getPeer;

/**
 * Get a call object built with the provided options. Keys for options are
 * 'deadline', which takes a date or number, and 'host', which takes a string
 * and overrides the hostname to connect to.
 * @param {Object} options Options map.
 */
function getCall(channel, method, options) {
  var deadline;
  var host;
  var parent;
  var propagate_flags;
  var credentials;
  if (options) {
    deadline = options.deadline;
    host = options.host;
    parent = _.get(options, 'parent.call');
    propagate_flags = options.propagate_flags;
    credentials = options.credentials;
  }
  if (deadline === undefined) {
    deadline = Infinity;
  }
  var call = new grpc.Call(channel, method, deadline, host,
                           parent, propagate_flags);
  if (credentials) {
    call.setCredentials(credentials);
  }
  return call;
}

/**
 * Get a function that can make unary requests to the specified method.
 * @param {string} method The name of the method to request
 * @param {function(*):Buffer} serialize The serialization function for inputs
 * @param {function(Buffer)} deserialize The deserialization function for
 *     outputs
 * @return {Function} makeUnaryRequest
 */
function makeUnaryRequestFunction(method, serialize, deserialize) {
  /**
   * Make a unary request with this method on the given channel with the given
   * argument, callback, etc.
   * @this {Client} Client object. Must have a channel member.
   * @param {*} argument The argument to the call. Should be serializable with
   *     serialize
   * @param {function(?Error, value=)} callback The callback to for when the
   *     response is received
   * @param {Metadata=} metadata Metadata to add to the call
   * @param {Object=} options Options map
   * @return {EventEmitter} An event emitter for stream related events
   */
  function makeUnaryRequest(argument, callback, metadata, options) {
    /* jshint validthis: true */
    var emitter = new EventEmitter();
    var call = getCall(this.$channel, method, options);
    if (metadata === null || metadata === undefined) {
      metadata = new Metadata();
    } else {
      metadata = metadata.clone();
    }
    emitter.cancel = function cancel() {
      call.cancel();
    };
    emitter.getPeer = function getPeer() {
      return call.getPeer();
    };
    var client_batch = {};
    var message = serialize(argument);
    if (options) {
      message.grpcWriteFlags = options.flags;
    }
    client_batch[grpc.opType.SEND_INITIAL_METADATA] =
        metadata._getCoreRepresentation();
    client_batch[grpc.opType.SEND_MESSAGE] = message;
    client_batch[grpc.opType.SEND_CLOSE_FROM_CLIENT] = true;
    client_batch[grpc.opType.RECV_INITIAL_METADATA] = true;
    client_batch[grpc.opType.RECV_MESSAGE] = true;
    client_batch[grpc.opType.RECV_STATUS_ON_CLIENT] = true;
    call.startBatch(client_batch, function(err, response) {
      response.status.metadata = Metadata._fromCoreRepresentation(
          response.status.metadata);
      var status = response.status;
      var error;
      var deserialized;
      if (status.code === grpc.status.OK) {
        if (err) {
          // Got a batch error, but OK status. Something went wrong
          callback(err);
          return;
        } else {
          try {
            deserialized = deserialize(response.read);
          } catch (e) {
            /* Change status to indicate bad server response. This will result
             * in passing an error to the callback */
            status = {
              code: grpc.status.INTERNAL,
              details: 'Failed to parse server response'
            };
          }
        }
      }
      if (status.code !== grpc.status.OK) {
        error = new Error(response.status.details);
        error.code = status.code;
        error.metadata = status.metadata;
        callback(error);
      } else {
        callback(null, deserialized);
      }
      emitter.emit('status', status);
      emitter.emit('metadata', Metadata._fromCoreRepresentation(
          response.metadata));
    });
    return emitter;
  }
  return makeUnaryRequest;
}

/**
 * Get a function that can make client stream requests to the specified method.
 * @param {string} method The name of the method to request
 * @param {function(*):Buffer} serialize The serialization function for inputs
 * @param {function(Buffer)} deserialize The deserialization function for
 *     outputs
 * @return {Function} makeClientStreamRequest
 */
function makeClientStreamRequestFunction(method, serialize, deserialize) {
  /**
   * Make a client stream request with this method on the given channel with the
   * given callback, etc.
   * @this {Client} Client object. Must have a channel member.
   * @param {function(?Error, value=)} callback The callback to for when the
   *     response is received
   * @param {Metadata=} metadata Array of metadata key/value pairs to add to the
   *     call
   * @param {Object=} options Options map
   * @return {EventEmitter} An event emitter for stream related events
   */
  function makeClientStreamRequest(callback, metadata, options) {
    /* jshint validthis: true */
    var call = getCall(this.$channel, method, options);
    if (metadata === null || metadata === undefined) {
      metadata = new Metadata();
    } else {
      metadata = metadata.clone();
    }
    var stream = new ClientWritableStream(call, serialize);
    var metadata_batch = {};
    metadata_batch[grpc.opType.SEND_INITIAL_METADATA] =
        metadata._getCoreRepresentation();
    metadata_batch[grpc.opType.RECV_INITIAL_METADATA] = true;
    call.startBatch(metadata_batch, function(err, response) {
      if (err) {
        // The call has stopped for some reason. A non-OK status will arrive
        // in the other batch.
        return;
      }
      stream.emit('metadata', Metadata._fromCoreRepresentation(
          response.metadata));
    });
    var client_batch = {};
    client_batch[grpc.opType.RECV_MESSAGE] = true;
    client_batch[grpc.opType.RECV_STATUS_ON_CLIENT] = true;
    call.startBatch(client_batch, function(err, response) {
      response.status.metadata = Metadata._fromCoreRepresentation(
          response.status.metadata);
      var status = response.status;
      var error;
      var deserialized;
      if (status.code === grpc.status.OK) {
        if (err) {
          // Got a batch error, but OK status. Something went wrong
          callback(err);
          return;
        } else {
          try {
            deserialized = deserialize(response.read);
          } catch (e) {
            /* Change status to indicate bad server response. This will result
             * in passing an error to the callback */
            status = {
              code: grpc.status.INTERNAL,
              details: 'Failed to parse server response'
            };
          }
        }
      }
      if (status.code !== grpc.status.OK) {
        error = new Error(response.status.details);
        error.code = status.code;
        error.metadata = status.metadata;
        callback(error);
      } else {
        callback(null, deserialized);
      }
      stream.emit('status', status);
    });
    return stream;
  }
  return makeClientStreamRequest;
}

/**
 * Get a function that can make server stream requests to the specified method.
 * @param {string} method The name of the method to request
 * @param {function(*):Buffer} serialize The serialization function for inputs
 * @param {function(Buffer)} deserialize The deserialization function for
 *     outputs
 * @return {Function} makeServerStreamRequest
 */
function makeServerStreamRequestFunction(method, serialize, deserialize) {
  /**
   * Make a server stream request with this method on the given channel with the
   * given argument, etc.
   * @this {SurfaceClient} Client object. Must have a channel member.
   * @param {*} argument The argument to the call. Should be serializable with
   *     serialize
   * @param {Metadata=} metadata Array of metadata key/value pairs to add to the
   *     call
   * @param {Object} options Options map
   * @return {EventEmitter} An event emitter for stream related events
   */
  function makeServerStreamRequest(argument, metadata, options) {
    /* jshint validthis: true */
    var call = getCall(this.$channel, method, options);
    if (metadata === null || metadata === undefined) {
      metadata = new Metadata();
    } else {
      metadata = metadata.clone();
    }
    var stream = new ClientReadableStream(call, deserialize);
    var start_batch = {};
    var message = serialize(argument);
    if (options) {
      message.grpcWriteFlags = options.flags;
    }
    start_batch[grpc.opType.SEND_INITIAL_METADATA] =
        metadata._getCoreRepresentation();
    start_batch[grpc.opType.RECV_INITIAL_METADATA] = true;
    start_batch[grpc.opType.SEND_MESSAGE] = message;
    start_batch[grpc.opType.SEND_CLOSE_FROM_CLIENT] = true;
    call.startBatch(start_batch, function(err, response) {
      if (err) {
        // The call has stopped for some reason. A non-OK status will arrive
        // in the other batch.
        return;
      }
      stream.emit('metadata', Metadata._fromCoreRepresentation(
          response.metadata));
    });
    var status_batch = {};
    status_batch[grpc.opType.RECV_STATUS_ON_CLIENT] = true;
    call.startBatch(status_batch, function(err, response) {
      response.status.metadata = Metadata._fromCoreRepresentation(
          response.status.metadata);
      stream.emit('status', response.status);
      if (response.status.code !== grpc.status.OK) {
        var error = new Error(response.status.details);
        error.code = response.status.code;
        error.metadata = response.status.metadata;
        stream.emit('error', error);
        return;
      } else {
        if (err) {
          // Got a batch error, but OK status. Something went wrong
          stream.emit('error', err);
          return;
        }
      }
    });
    return stream;
  }
  return makeServerStreamRequest;
}

/**
 * Get a function that can make bidirectional stream requests to the specified
 * method.
 * @param {string} method The name of the method to request
 * @param {function(*):Buffer} serialize The serialization function for inputs
 * @param {function(Buffer)} deserialize The deserialization function for
 *     outputs
 * @return {Function} makeBidiStreamRequest
 */
function makeBidiStreamRequestFunction(method, serialize, deserialize) {
  /**
   * Make a bidirectional stream request with this method on the given channel.
   * @this {SurfaceClient} Client object. Must have a channel member.
   * @param {Metadata=} metadata Array of metadata key/value pairs to add to the
   *     call
   * @param {Options} options Options map
   * @return {EventEmitter} An event emitter for stream related events
   */
  function makeBidiStreamRequest(metadata, options) {
    /* jshint validthis: true */
    var call = getCall(this.$channel, method, options);
    if (metadata === null || metadata === undefined) {
      metadata = new Metadata();
    } else {
      metadata = metadata.clone();
    }
    var stream = new ClientDuplexStream(call, serialize, deserialize);
    var start_batch = {};
    start_batch[grpc.opType.SEND_INITIAL_METADATA] =
        metadata._getCoreRepresentation();
    start_batch[grpc.opType.RECV_INITIAL_METADATA] = true;
    call.startBatch(start_batch, function(err, response) {
      if (err) {
        // The call has stopped for some reason. A non-OK status will arrive
        // in the other batch.
        return;
      }
      stream.emit('metadata', Metadata._fromCoreRepresentation(
          response.metadata));
    });
    var status_batch = {};
    status_batch[grpc.opType.RECV_STATUS_ON_CLIENT] = true;
    call.startBatch(status_batch, function(err, response) {
      response.status.metadata = Metadata._fromCoreRepresentation(
          response.status.metadata);
      stream.emit('status', response.status);
      if (response.status.code !== grpc.status.OK) {
        var error = new Error(response.status.details);
        error.code = response.status.code;
        error.metadata = response.status.metadata;
        stream.emit('error', error);
        return;
      } else {
        if (err) {
          // Got a batch error, but OK status. Something went wrong
          stream.emit('error', err);
          return;
        }
      }
    });
    return stream;
  }
  return makeBidiStreamRequest;
}


/**
 * Map with short names for each of the requester maker functions. Used in
 * makeClientConstructor
 */
var requester_makers = {
  unary: makeUnaryRequestFunction,
  server_stream: makeServerStreamRequestFunction,
  client_stream: makeClientStreamRequestFunction,
  bidi: makeBidiStreamRequestFunction
};

/**
 * Creates a constructor for a client with the given methods. The methods object
 * maps method name to an object with the following keys:
 * path: The path on the server for accessing the method. For example, for
 *     protocol buffers, we use "/service_name/method_name"
 * requestStream: bool indicating whether the client sends a stream
 * resonseStream: bool indicating whether the server sends a stream
 * requestSerialize: function to serialize request objects
 * responseDeserialize: function to deserialize response objects
 * @param {Object} methods An object mapping method names to method attributes
 * @param {string} serviceName The fully qualified name of the service
 * @return {function(string, Object)} New client constructor
 */
exports.makeClientConstructor = function(methods, serviceName) {
  /**
   * Create a client with the given methods
   * @constructor
   * @param {string} address The address of the server to connect to
   * @param {grpc.Credentials} credentials Credentials to use to connect
   *     to the server
   * @param {Object} options Options to pass to the underlying channel
   */
  function Client(address, credentials, options) {
    if (!options) {
      options = {};
    }
    options['grpc.primary_user_agent'] = 'grpc-node/' + version;
    /* Private fields use $ as a prefix instead of _ because it is an invalid
     * prefix of a method name */
    this.$channel = new grpc.Channel(address, credentials, options);
  }

  _.each(methods, function(attrs, name) {
    var method_type;
    if (_.startsWith(name, '$')) {
      throw new Error('Method names cannot start with $');
    }
    if (attrs.requestStream) {
      if (attrs.responseStream) {
        method_type = 'bidi';
      } else {
        method_type = 'client_stream';
      }
    } else {
      if (attrs.responseStream) {
        method_type = 'server_stream';
      } else {
        method_type = 'unary';
      }
    }
    var serialize = attrs.requestSerialize;
    var deserialize = attrs.responseDeserialize;
    Client.prototype[name] = requester_makers[method_type](
        attrs.path, serialize, deserialize);
    Client.prototype[name].serialize = serialize;
    Client.prototype[name].deserialize = deserialize;
  });

  return Client;
};

/**
 * Return the underlying channel object for the specified client
 * @param {Client} client
 * @return {Channel} The channel
 */
exports.getClientChannel = function(client) {
  return client.$channel;
};

/**
 * Wait for the client to be ready. The callback will be called when the
 * client has successfully connected to the server, and it will be called
 * with an error if the attempt to connect to the server has unrecoverablly
 * failed or if the deadline expires. This function will make the channel
 * start connecting if it has not already done so.
 * @param {Client} client The client to wait on
 * @param {(Date|Number)} deadline When to stop waiting for a connection. Pass
 *     Infinity to wait forever.
 * @param {function(Error)} callback The callback to call when done attempting
 *     to connect.
 */
exports.waitForClientReady = function(client, deadline, callback) {
  var checkState = function(err) {
    if (err) {
      callback(new Error('Failed to connect before the deadline'));
    }
    var new_state = client.$channel.getConnectivityState(true);
    if (new_state === grpc.connectivityState.READY) {
      callback();
    } else if (new_state === grpc.connectivityState.FATAL_FAILURE) {
      callback(new Error('Failed to connect to server'));
    } else {
      client.$channel.watchConnectivityState(new_state, deadline, checkState);
    }
  };
  checkState();
};

/**
 * Creates a constructor for clients for the given service
 * @param {ProtoBuf.Reflect.Service} service The service to generate a client
 *     for
 * @return {function(string, Object)} New client constructor
 */
exports.makeProtobufClientConstructor =  function(service) {
  var method_attrs = common.getProtobufServiceAttrs(service, service.name);
  var Client = exports.makeClientConstructor(
      method_attrs, common.fullyQualifiedName(service));
  Client.service = service;
  return Client;
};

/**
 * Map of status code names to status codes
 */
exports.status = grpc.status;

/**
 * See docs for client.callError
 */
exports.callError = grpc.callError;
