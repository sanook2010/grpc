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

#include <vector>

#include "grpc/support/log.h"

#include <node.h>
#include <nan.h>
#include "grpc/grpc.h"
#include "grpc/grpc_security.h"
#include "call.h"
#include "channel.h"
#include "completion_queue_async_worker.h"
#include "channel_credentials.h"
#include "timeval.h"

namespace grpc {
namespace node {

using Nan::Callback;
using Nan::EscapableHandleScope;
using Nan::HandleScope;
using Nan::Maybe;
using Nan::MaybeLocal;
using Nan::ObjectWrap;
using Nan::Persistent;
using Nan::Utf8String;

using v8::Array;
using v8::Exception;
using v8::Function;
using v8::FunctionTemplate;
using v8::Integer;
using v8::Local;
using v8::Number;
using v8::Object;
using v8::String;
using v8::Value;

Callback *Channel::constructor;
Persistent<FunctionTemplate> Channel::fun_tpl;

Channel::Channel(grpc_channel *channel) : wrapped_channel(channel) {}

Channel::~Channel() {
  if (wrapped_channel != NULL) {
    grpc_channel_destroy(wrapped_channel);
  }
}

void Channel::Init(Local<Object> exports) {
  Nan::HandleScope scope;
  Local<FunctionTemplate> tpl = Nan::New<FunctionTemplate>(New);
  tpl->SetClassName(Nan::New("Channel").ToLocalChecked());
  tpl->InstanceTemplate()->SetInternalFieldCount(1);
  Nan::SetPrototypeMethod(tpl, "close", Close);
  Nan::SetPrototypeMethod(tpl, "getTarget", GetTarget);
  Nan::SetPrototypeMethod(tpl, "getConnectivityState", GetConnectivityState);
  Nan::SetPrototypeMethod(tpl, "watchConnectivityState",
                          WatchConnectivityState);
  fun_tpl.Reset(tpl);
  Local<Function> ctr = Nan::GetFunction(tpl).ToLocalChecked();
  Nan::Set(exports, Nan::New("Channel").ToLocalChecked(), ctr);
  constructor = new Callback(ctr);
}

bool Channel::HasInstance(Local<Value> val) {
  HandleScope scope;
  return Nan::New(fun_tpl)->HasInstance(val);
}

grpc_channel *Channel::GetWrappedChannel() { return this->wrapped_channel; }

NAN_METHOD(Channel::New) {
  if (info.IsConstructCall()) {
    if (!info[0]->IsString()) {
      return Nan::ThrowTypeError(
          "Channel expects a string, a credential and an object");
    }
    grpc_channel *wrapped_channel;
    // Owned by the Channel object
    Utf8String host(info[0]);
    grpc_credentials *creds;
    if (!ChannelCredentials::HasInstance(info[1])) {
      return Nan::ThrowTypeError(
          "Channel's second argument must be a ChannelCredentials");
    }
    ChannelCredentials *creds_object = ObjectWrap::Unwrap<ChannelCredentials>(
        Nan::To<Object>(info[1]).ToLocalChecked());
    creds = creds_object->GetWrappedCredentials();
    grpc_channel_args *channel_args_ptr;
    if (info[2]->IsUndefined()) {
      channel_args_ptr = NULL;
      wrapped_channel = grpc_insecure_channel_create(*host, NULL, NULL);
    } else if (info[2]->IsObject()) {
      Local<Object> args_hash = Nan::To<Object>(info[2]).ToLocalChecked();
      Local<Array> keys(Nan::GetOwnPropertyNames(args_hash).ToLocalChecked());
      grpc_channel_args channel_args;
      channel_args.num_args = keys->Length();
      channel_args.args = reinterpret_cast<grpc_arg *>(
          calloc(channel_args.num_args, sizeof(grpc_arg)));
      /* These are used to keep all strings until then end of the block, then
         destroy them */
      std::vector<Nan::Utf8String *> key_strings(keys->Length());
      std::vector<Nan::Utf8String *> value_strings(keys->Length());
      for (unsigned int i = 0; i < channel_args.num_args; i++) {
        MaybeLocal<String> maybe_key = Nan::To<String>(
            Nan::Get(keys, i).ToLocalChecked());
        if (maybe_key.IsEmpty()) {
          free(channel_args.args);
          return Nan::ThrowTypeError("Arg keys must be strings");
        }
        Local<String> current_key = maybe_key.ToLocalChecked();
        Local<Value> current_value = Nan::Get(args_hash,
                                               current_key).ToLocalChecked();
        key_strings[i] = new Nan::Utf8String(current_key);
        channel_args.args[i].key = **key_strings[i];
        if (current_value->IsInt32()) {
          channel_args.args[i].type = GRPC_ARG_INTEGER;
          channel_args.args[i].value.integer = Nan::To<int32_t>(
              current_value).FromJust();
        } else if (current_value->IsString()) {
          channel_args.args[i].type = GRPC_ARG_STRING;
          value_strings[i] = new Nan::Utf8String(current_value);
          channel_args.args[i].value.string = **value_strings[i];
        } else {
          free(channel_args.args);
          return Nan::ThrowTypeError("Arg values must be strings");
        }
      }
      channel_args_ptr = &channel_args;
    } else {
      return Nan::ThrowTypeError("Channel expects a string and an object");
    }
    if (creds == NULL) {
      wrapped_channel = grpc_insecure_channel_create(*host, channel_args_ptr,
                                                     NULL);
    } else {
      wrapped_channel =
          grpc_secure_channel_create(creds, *host, channel_args_ptr, NULL);
    }
    if (channel_args_ptr != NULL) {
      free(channel_args_ptr->args);
    }
    Channel *channel = new Channel(wrapped_channel);
    channel->Wrap(info.This());
    info.GetReturnValue().Set(info.This());
    return;
  } else {
    const int argc = 3;
    Local<Value> argv[argc] = {info[0], info[1], info[2]};
    MaybeLocal<Object> maybe_instance = constructor->GetFunction()->NewInstance(
        argc, argv);
    if (maybe_instance.IsEmpty()) {
      // There's probably a pending exception
      return;
    } else {
      info.GetReturnValue().Set(maybe_instance.ToLocalChecked());
    }
  }
}

NAN_METHOD(Channel::Close) {
  if (!HasInstance(info.This())) {
    return Nan::ThrowTypeError("close can only be called on Channel objects");
  }
  Channel *channel = ObjectWrap::Unwrap<Channel>(info.This());
  if (channel->wrapped_channel != NULL) {
    grpc_channel_destroy(channel->wrapped_channel);
    channel->wrapped_channel = NULL;
  }
}

NAN_METHOD(Channel::GetTarget) {
  if (!HasInstance(info.This())) {
    return Nan::ThrowTypeError("getTarget can only be called on Channel objects");
  }
  Channel *channel = ObjectWrap::Unwrap<Channel>(info.This());
  info.GetReturnValue().Set(Nan::New(
      grpc_channel_get_target(channel->wrapped_channel)).ToLocalChecked());
}

NAN_METHOD(Channel::GetConnectivityState) {
  if (!HasInstance(info.This())) {
    return Nan::ThrowTypeError(
        "getConnectivityState can only be called on Channel objects");
  }
  Channel *channel = ObjectWrap::Unwrap<Channel>(info.This());
  int try_to_connect = (int)info[0]->Equals(Nan::True());
  info.GetReturnValue().Set(
      grpc_channel_check_connectivity_state(channel->wrapped_channel,
                                            try_to_connect));
}

NAN_METHOD(Channel::WatchConnectivityState) {
  if (!HasInstance(info.This())) {
    return Nan::ThrowTypeError(
        "watchConnectivityState can only be called on Channel objects");
  }
  if (!info[0]->IsUint32()) {
    return Nan::ThrowTypeError(
        "watchConnectivityState's first argument must be a channel state");
  }
  if (!(info[1]->IsNumber() || info[1]->IsDate())) {
    return Nan::ThrowTypeError(
        "watchConnectivityState's second argument must be a date or a number");
  }
  if (!info[2]->IsFunction()) {
    return Nan::ThrowTypeError(
        "watchConnectivityState's third argument must be a callback");
  }
  grpc_connectivity_state last_state =
      static_cast<grpc_connectivity_state>(
          Nan::To<uint32_t>(info[0]).FromJust());
  double deadline = Nan::To<double>(info[1]).FromJust();
  Local<Function> callback_func = info[2].As<Function>();
  Nan::Callback *callback = new Callback(callback_func);
  Channel *channel = ObjectWrap::Unwrap<Channel>(info.This());
  unique_ptr<OpVec> ops(new OpVec());
  grpc_channel_watch_connectivity_state(
      channel->wrapped_channel, last_state, MillisecondsToTimespec(deadline),
      CompletionQueueAsyncWorker::GetQueue(),
      new struct tag(callback,
                     ops.release(),
                     shared_ptr<Resources>(nullptr)));
  CompletionQueueAsyncWorker::Next();
}

}  // namespace node
}  // namespace grpc
