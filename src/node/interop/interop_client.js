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

'use strict';

var fs = require('fs');
var path = require('path');
var _ = require('lodash');
var grpc = require('..');
var testProto = grpc.load({
  root: __dirname + '/../../..',
  file: 'test/proto/test.proto'}).grpc.testing;
var GoogleAuth = require('google-auth-library');

var assert = require('assert');

var AUTH_SCOPE = 'https://www.googleapis.com/auth/xapi.zoo';
var AUTH_SCOPE_RESPONSE = 'xapi.zoo';
var AUTH_USER = ('155450119199-vefjjaekcc6cmsd5914v6lqufunmh9ue' +
    '@developer.gserviceaccount.com');
var COMPUTE_ENGINE_USER = ('155450119199-r5aaqa2vqoa9g5mv2m6s3m1l293rlmel' +
    '@developer.gserviceaccount.com');

var ECHO_INITIAL_KEY = 'x-grpc-test-echo-initial';
var ECHO_TRAILING_KEY = 'x-grpc-test-echo-trailing-bin';

/**
 * Create a buffer filled with size zeroes
 * @param {number} size The length of the buffer
 * @return {Buffer} The new buffer
 */
function zeroBuffer(size) {
  var zeros = new Buffer(size);
  zeros.fill(0);
  return zeros;
}

/**
 * This is used for testing functions with multiple asynchronous calls that
 * can happen in different orders. This should be passed the number of async
 * function invocations that can occur last, and each of those should call this
 * function's return value
 * @param {function()} done The function that should be called when a test is
 *     complete.
 * @param {number} count The number of calls to the resulting function if the
 *     test passes.
 * @return {function()} The function that should be called at the end of each
 *     sequence of asynchronous functions.
 */
function multiDone(done, count) {
  return function() {
    count -= 1;
    if (count <= 0) {
      done();
    }
  };
}

/**
 * Run the empty_unary test
 * @param {Client} client The client to test against
 * @param {function} done Callback to call when the test is completed. Included
 *     primarily for use with mocha
 */
function emptyUnary(client, done) {
  client.emptyCall({}, function(err, resp) {
    assert.ifError(err);
    if (done) {
      done();
    }
  });
}

/**
 * Run the large_unary test
 * @param {Client} client The client to test against
 * @param {function} done Callback to call when the test is completed. Included
 *     primarily for use with mocha
 */
function largeUnary(client, done) {
  var arg = {
    response_type: 'COMPRESSABLE',
    response_size: 314159,
    payload: {
      body: zeroBuffer(271828)
    }
  };
  client.unaryCall(arg, function(err, resp) {
    assert.ifError(err);
    assert.strictEqual(resp.payload.type, 'COMPRESSABLE');
    assert.strictEqual(resp.payload.body.length, 314159);
    if (done) {
      done();
    }
  });
}

/**
 * Run the client_streaming test
 * @param {Client} client The client to test against
 * @param {function} done Callback to call when the test is completed. Included
 *     primarily for use with mocha
 */
function clientStreaming(client, done) {
  var call = client.streamingInputCall(function(err, resp) {
    assert.ifError(err);
    assert.strictEqual(resp.aggregated_payload_size, 74922);
    if (done) {
      done();
    }
  });
  var payload_sizes = [27182, 8, 1828, 45904];
  for (var i = 0; i < payload_sizes.length; i++) {
    call.write({payload: {body: zeroBuffer(payload_sizes[i])}});
  }
  call.end();
}

/**
 * Run the server_streaming test
 * @param {Client} client The client to test against
 * @param {function} done Callback to call when the test is completed. Included
 *     primarily for use with mocha
 */
function serverStreaming(client, done) {
  var arg = {
    response_type: 'COMPRESSABLE',
    response_parameters: [
      {size: 31415},
      {size: 9},
      {size: 2653},
      {size: 58979}
    ]
  };
  var call = client.streamingOutputCall(arg);
  var resp_index = 0;
  call.on('data', function(value) {
    assert(resp_index < 4);
    assert.strictEqual(value.payload.type, 'COMPRESSABLE');
    assert.strictEqual(value.payload.body.length,
                       arg.response_parameters[resp_index].size);
    resp_index += 1;
  });
  call.on('end', function() {
    assert.strictEqual(resp_index, 4);
    if (done) {
      done();
    }
  });
  call.on('status', function(status) {
    assert.strictEqual(status.code, grpc.status.OK);
  });
}

/**
 * Run the ping_pong test
 * @param {Client} client The client to test against
 * @param {function} done Callback to call when the test is completed. Included
 *     primarily for use with mocha
 */
function pingPong(client, done) {
  var payload_sizes = [27182, 8, 1828, 45904];
  var response_sizes = [31415, 9, 2653, 58979];
  var call = client.fullDuplexCall();
  call.on('status', function(status) {
    assert.strictEqual(status.code, grpc.status.OK);
    if (done) {
      done();
    }
  });
  var index = 0;
  call.write({
      response_type: 'COMPRESSABLE',
      response_parameters: [
        {size: response_sizes[index]}
      ],
      payload: {body: zeroBuffer(payload_sizes[index])}
  });
  call.on('data', function(response) {
    assert.strictEqual(response.payload.type, 'COMPRESSABLE');
    assert.equal(response.payload.body.length, response_sizes[index]);
    index += 1;
    if (index === 4) {
      call.end();
    } else {
      call.write({
        response_type: 'COMPRESSABLE',
        response_parameters: [
          {size: response_sizes[index]}
        ],
        payload: {body: zeroBuffer(payload_sizes[index])}
      });
    }
  });
}

/**
 * Run the empty_stream test.
 * @param {Client} client The client to test against
 * @param {function} done Callback to call when the test is completed. Included
 *     primarily for use with mocha
 */
function emptyStream(client, done) {
  var call = client.fullDuplexCall();
  call.on('status', function(status) {
    assert.strictEqual(status.code, grpc.status.OK);
    if (done) {
      done();
    }
  });
  call.on('data', function(value) {
    assert.fail(value, null, 'No data should have been received', '!==');
  });
  call.end();
}

/**
 * Run the cancel_after_begin test.
 * @param {Client} client The client to test against
 * @param {function} done Callback to call when the test is completed. Included
 *     primarily for use with mocha
 */
function cancelAfterBegin(client, done) {
  var call = client.streamingInputCall(function(err, resp) {
    assert.strictEqual(err.code, grpc.status.CANCELLED);
    done();
  });
  call.cancel();
}

/**
 * Run the cancel_after_first_response test.
 * @param {Client} client The client to test against
 * @param {function} done Callback to call when the test is completed. Included
 *     primarily for use with mocha
 */
function cancelAfterFirstResponse(client, done) {
  var call = client.fullDuplexCall();
  call.write({
      response_type: 'COMPRESSABLE',
      response_parameters: [
        {size: 31415}
      ],
      payload: {body: zeroBuffer(27182)}
  });
  call.on('data', function(data) {
    call.cancel();
  });
  call.on('error', function(error) {
    assert.strictEqual(error.code, grpc.status.CANCELLED);
    done();
  });
}

function timeoutOnSleepingServer(client, done) {
  var deadline = new Date();
  deadline.setMilliseconds(deadline.getMilliseconds() + 1);
  var call = client.fullDuplexCall(null, {deadline: deadline});
  call.write({
    payload: {body: zeroBuffer(27182)}
  });
  call.on('error', function(error) {

    assert(error.code === grpc.status.DEADLINE_EXCEEDED ||
        error.code === grpc.status.INTERNAL);
    done();
  });
}

function customMetadata(client, done) {
  done = multiDone(done, 5);
  var metadata = new grpc.Metadata();
  metadata.set(ECHO_INITIAL_KEY, 'test_initial_metadata_value');
  metadata.set(ECHO_TRAILING_KEY, new Buffer('ababab', 'hex'));
  var arg = {
    response_type: 'COMPRESSABLE',
    response_size: 314159,
    payload: {
      body: zeroBuffer(271828)
    }
  };
  var streaming_arg = {
    payload: {
      body: zeroBuffer(271828)
    }
  };
  var unary = client.unaryCall(arg, function(err, resp) {
    assert.ifError(err);
    done();
  }, metadata);
  unary.on('metadata', function(metadata) {
    assert.deepEqual(metadata.get(ECHO_INITIAL_KEY),
                     ['test_initial_metadata_value']);
    done();
  });
  unary.on('status', function(status) {
    var echo_trailer = status.metadata.get(ECHO_TRAILING_KEY);
    assert(echo_trailer.length > 0);
    assert.strictEqual(echo_trailer[0].toString('hex'), 'ababab');
    done();
  });
  var stream = client.fullDuplexCall(metadata);
  stream.on('metadata', function(metadata) {
    assert.deepEqual(metadata.get(ECHO_INITIAL_KEY),
                     ['test_initial_metadata_value']);
    done();
  });
  stream.on('status', function(status) {
    var echo_trailer = status.metadata.get(ECHO_TRAILING_KEY);
    assert(echo_trailer.length > 0);
    assert.strictEqual(echo_trailer[0].toString('hex'), 'ababab');
    done();
  });
  stream.write(streaming_arg);
  stream.end();
}

/**
 * Run one of the authentication tests.
 * @param {string} expected_user The expected username in the response
 * @param {Client} client The client to test against
 * @param {?string} scope The scope to apply to the credentials
 * @param {function} done Callback to call when the test is completed. Included
 *     primarily for use with mocha
 */
function authTest(expected_user, scope, client, done) {
  var arg = {
    response_type: 'COMPRESSABLE',
    response_size: 314159,
    payload: {
      body: zeroBuffer(271828)
    },
    fill_username: true,
    fill_oauth_scope: true
  };
  client.unaryCall(arg, function(err, resp) {
    assert.ifError(err);
    assert.strictEqual(resp.payload.type, 'COMPRESSABLE');
    assert.strictEqual(resp.payload.body.length, 314159);
    assert.strictEqual(resp.username, expected_user);
    if (scope) {
      assert.strictEqual(resp.oauth_scope, AUTH_SCOPE_RESPONSE);
    }
    if (done) {
      done();
    }
  });
}

function oauth2Test(expected_user, scope, per_rpc, client, done) {
  (new GoogleAuth()).getApplicationDefault(function(err, credential) {
    assert.ifError(err);
    var arg = {
      fill_username: true,
      fill_oauth_scope: true
    };
    credential = credential.createScoped(scope);
    credential.getAccessToken(function(err, token) {
      assert.ifError(err);
      var updateMetadata = function(authURI, metadata, callback) {
        metadata.add('authorization', 'Bearer ' + token);
        callback(null, metadata);
      };
      var makeTestCall = function(error, client_metadata) {
        assert.ifError(error);
        client.unaryCall(arg, function(err, resp) {
          assert.ifError(err);
          assert.strictEqual(resp.username, expected_user);
          assert.strictEqual(resp.oauth_scope, AUTH_SCOPE_RESPONSE);
          if (done) {
            done();
          }
        }, client_metadata);
      };
      if (per_rpc) {
        updateMetadata('', new grpc.Metadata(), makeTestCall);
      } else {
        client.$updateMetadata = updateMetadata;
        makeTestCall(null, new grpc.Metadata());
      }
    });
  });
}

function perRpcAuthTest(expected_user, scope, per_rpc, client, done) {
  (new GoogleAuth()).getApplicationDefault(function(err, credential) {
    assert.ifError(err);
    var arg = {
      fill_username: true,
      fill_oauth_scope: true
    };
    if (credential.createScopedRequired() && scope) {
      credential = credential.createScoped(scope);
    }
    var creds = grpc.credentials.createFromGoogleCredential(credential);
    client.unaryCall(arg, function(err, resp) {
      assert.ifError(err);
      assert.strictEqual(resp.username, expected_user);
      assert.strictEqual(resp.oauth_scope, AUTH_SCOPE_RESPONSE);
      if (done) {
        done();
      }
    }, null, {credentials: creds});
  });
}

function getApplicationCreds(scope, callback) {
  (new GoogleAuth()).getApplicationDefault(function(err, credential) {
    if (err) {
      callback(err);
      return;
    }
    if (credential.createScopedRequired() && scope) {
      credential = credential.createScoped(scope);
    }
    callback(null, grpc.credentials.createFromGoogleCredential(credential));
  });
}

function getOauth2Creds(scope, callback) {
  (new GoogleAuth()).getApplicationDefault(function(err, credential) {
    if (err) {
      callback(err);
      return;
    }
    credential = credential.createScoped(scope);
    credential.getAccessToken(function(err, token) {
      if (err) {
        callback(err);
        return;
      }
      var updateMd = function(service_url, callback) {
        var metadata = new grpc.Metadata();
        metadata.add('authorization', 'Bearer ' + token);
        callback(null, metadata);
      };
      callback(null, grpc.credentials.createFromMetadataGenerator(updateMd));
    });
  });
}

/**
 * Map from test case names to test functions
 */
var test_cases = {
  empty_unary: {run: emptyUnary},
  large_unary: {run: largeUnary},
  client_streaming: {run: clientStreaming},
  server_streaming: {run: serverStreaming},
  ping_pong: {run: pingPong},
  empty_stream: {run: emptyStream},
  cancel_after_begin: {run: cancelAfterBegin},
  cancel_after_first_response: {run: cancelAfterFirstResponse},
  timeout_on_sleeping_server: {run: timeoutOnSleepingServer},
  custom_metadata: {run: customMetadata},
  compute_engine_creds: {run: _.partial(authTest, COMPUTE_ENGINE_USER, null),
                         getCreds: _.partial(getApplicationCreds, null)},
  service_account_creds: {run: _.partial(authTest, AUTH_USER, AUTH_SCOPE),
                          getCreds: _.partial(getApplicationCreds, AUTH_SCOPE)},
  jwt_token_creds: {run: _.partial(authTest, AUTH_USER, null),
                    getCreds: _.partial(getApplicationCreds, null)},
  oauth2_auth_token: {run: _.partial(oauth2Test, AUTH_USER, AUTH_SCOPE, false),
                      getCreds: _.partial(getOauth2Creds, AUTH_SCOPE)},
  per_rpc_creds: {run: _.partial(perRpcAuthTest, AUTH_USER, AUTH_SCOPE, true)}
};

/**
 * Execute a single test case.
 * @param {string} address The address of the server to connect to, in the
 *     format 'hostname:port'
 * @param {string} host_overrirde The hostname of the server to use as an SSL
 *     override
 * @param {string} test_case The name of the test case to run
 * @param {bool} tls Indicates that a secure channel should be used
 * @param {function} done Callback to call when the test is completed. Included
 *     primarily for use with mocha
 */
function runTest(address, host_override, test_case, tls, test_ca, done) {
  // TODO(mlumish): enable TLS functionality
  var options = {};
  var creds;
  if (tls) {
    var ca_path;
    if (test_ca) {
      ca_path = path.join(__dirname, '../test/data/ca.pem');
    } else {
      ca_path = process.env.SSL_CERT_FILE;
    }
    var ca_data = fs.readFileSync(ca_path);
    creds = grpc.credentials.createSsl(ca_data);
    if (host_override) {
      options['grpc.ssl_target_name_override'] = host_override;
      options['grpc.default_authority'] = host_override;
    }
  } else {
    creds = grpc.credentials.createInsecure();
  }
  var test = test_cases[test_case];

  var execute = function(err, creds) {
    assert.ifError(err);
    var client = new testProto.TestService(address, creds, options);
    test.run(client, done);
  };

  if (test.getCreds) {
    test.getCreds(function(err, new_creds) {
      execute(err, grpc.credentials.combineChannelCredentials(
          creds, new_creds));
    });
  } else {
    execute(null, creds);
  }
}

if (require.main === module) {
  var parseArgs = require('minimist');
  var argv = parseArgs(process.argv, {
    string: ['server_host', 'server_host_override', 'server_port', 'test_case',
             'use_tls', 'use_test_ca']
  });
  runTest(argv.server_host + ':' + argv.server_port, argv.server_host_override,
          argv.test_case, argv.use_tls === 'true', argv.use_test_ca === 'true',
          function () {
            console.log('OK:', argv.test_case);
          });
}

/**
 * See docs for runTest
 */
exports.runTest = runTest;
