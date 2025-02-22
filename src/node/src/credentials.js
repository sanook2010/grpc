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
 * Credentials module
 *
 * This module contains factory methods for two different credential types:
 * CallCredentials and ChannelCredentials. ChannelCredentials are things like
 * SSL credentials that can be used to secure a connection, and are used to
 * construct a Client object. CallCredentials genrally modify metadata, so they
 * can be attached to an individual method call.
 *
 * CallCredentials can be composed with other CallCredentials to create
 * CallCredentials. ChannelCredentials can be composed with CallCredentials
 * to create ChannelCredentials. No combined credential can have more than
 * one ChannelCredentials.
 *
 * For example, to create a client secured with SSL that uses Google
 * default application credentials to authenticate:
 *
 * var channel_creds = credentials.createSsl(root_certs);
 * (new GoogleAuth()).getApplicationDefault(function(err, credential) {
 *   var call_creds = credentials.createFromGoogleCredential(credential);
 *   var combined_creds = credentials.combineChannelCredentials(
 *       channel_creds, call_creds);
 *   var client = new Client(address, combined_creds);
 * });
 *
 * @module
 */

'use strict';

var grpc = require('bindings')('grpc_node.node');

var CallCredentials = grpc.CallCredentials;

var ChannelCredentials = grpc.ChannelCredentials;

var Metadata = require('./metadata.js');

/**
 * Create an SSL Credentials object. If using a client-side certificate, both
 * the second and third arguments must be passed.
 * @param {Buffer} root_certs The root certificate data
 * @param {Buffer=} private_key The client certificate private key, if
 *     applicable
 * @param {Buffer=} cert_chain The client certificate cert chain, if applicable
 * @return {ChannelCredentials} The SSL Credentials object
 */
exports.createSsl = ChannelCredentials.createSsl;

/**
 * Create a gRPC credentials object from a metadata generation function. This
 * function gets the service URL and a callback as parameters. The error
 * passed to the callback can optionally have a 'code' value attached to it,
 * which corresponds to a status code that this library uses.
 * @param {function(String, function(Error, Metadata))} metadata_generator The
 *     function that generates metadata
 * @return {CallCredentials} The credentials object
 */
exports.createFromMetadataGenerator = function(metadata_generator) {
  return CallCredentials.createFromPlugin(function(service_url, callback) {
    metadata_generator(service_url, function(error, metadata) {
      var code = grpc.status.OK;
      var message = '';
      if (error) {
        message = error.message;
        if (error.hasOwnProperty('code')) {
          code = error.code;
        }
      }
      callback(code, message, metadata._getCoreRepresentation());
    });
  });
};

/**
 * Create a gRPC credential from a Google credential object.
 * @param {Object} google_credential The Google credential object to use
 * @return {CallCredentials} The resulting credentials object
 */
exports.createFromGoogleCredential = function(google_credential) {
  return exports.createFromMetadataGenerator(function(service_url, callback) {
    google_credential.getRequestMetadata(service_url, function(err, header) {
      if (err) {
        callback(err);
        return;
      }
      var metadata = new Metadata();
      metadata.add('authorization', header.Authorization);
      callback(null, metadata);
    });
  });
};

/**
 * Combine a ChannelCredentials with any number of CallCredentials into a single
 * ChannelCredentials object.
 * @param {ChannelCredentials} channel_credential The ChannelCredentials to
 *     start with
 * @param {...CallCredentials} credentials The CallCredentials to compose
 * @return ChannelCredentials A credentials object that combines all of the
 *     input credentials
 */
exports.combineChannelCredentials = function(channel_credential) {
  var current = channel_credential;
  for (var i = 1; i < arguments.length; i++) {
    current = current.compose(arguments[i]);
  }
  return current;
};

/**
 * Combine any number of CallCredentials into a single CallCredentials object
 * @param {...CallCredentials} credentials the CallCredentials to compose
 * @return CallCredentials A credentials object that combines all of the input
 *     credentials
 */
exports.combineCallCredentials = function() {
  var current = arguments[0];
  for (var i = 1; i < arguments.length; i++) {
    current = current.compose(arguments[i]);
  }
  return current;
}

/**
 * Create an insecure credentials object. This is used to create a channel that
 * does not use SSL. This cannot be composed with anything.
 * @return {ChannelCredentials} The insecure credentials object
 */
exports.createInsecure = ChannelCredentials.createInsecure;
