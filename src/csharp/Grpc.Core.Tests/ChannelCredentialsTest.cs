#region Copyright notice and license

// Copyright 2015, Google Inc.
// All rights reserved.
//
// Redistribution and use in source and binary forms, with or without
// modification, are permitted provided that the following conditions are
// met:
//
//     * Redistributions of source code must retain the above copyright
// notice, this list of conditions and the following disclaimer.
//     * Redistributions in binary form must reproduce the above
// copyright notice, this list of conditions and the following disclaimer
// in the documentation and/or other materials provided with the
// distribution.
//     * Neither the name of Google Inc. nor the names of its
// contributors may be used to endorse or promote products derived from
// this software without specific prior written permission.
//
// THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
// "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
// LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
// A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
// OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
// SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
// LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
// DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
// THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
// (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
// OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

#endregion

using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using Grpc.Core;
using Grpc.Core.Internal;
using Grpc.Core.Utils;
using NUnit.Framework;

namespace Grpc.Core.Tests
{
    public class ChannelCredentialsTest
    {
        [Test]
        public void InsecureCredentials_IsNonComposable()
        {
            Assert.IsFalse(ChannelCredentials.Insecure.IsComposable);
        }

        [Test]
        public void ChannelCredentials_CreateComposite()
        {
            var composite = ChannelCredentials.Create(new FakeChannelCredentials(true), new FakeCallCredentials());
            Assert.IsFalse(composite.IsComposable);

            Assert.Throws(typeof(ArgumentNullException), () => ChannelCredentials.Create(null, new FakeCallCredentials()));
            Assert.Throws(typeof(ArgumentNullException), () => ChannelCredentials.Create(new FakeChannelCredentials(true), null));
            
            // forbid composing non-composable
            Assert.Throws(typeof(ArgumentException), () => ChannelCredentials.Create(new FakeChannelCredentials(false), new FakeCallCredentials()));
        }

        [Test]
        public void ChannelCredentials_CreateWrapped()
        {
            ChannelCredentials.Create(new FakeCallCredentials());
        }
    }
}
