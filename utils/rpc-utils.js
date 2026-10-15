/**
 * 
 * RPC retry utility functions.
 * For any suggestions please contact me at andrei.dimitrief.jianu(at)gmail.com
 * 
 * The MIT License (MIT)
 * 
 * Copyright (c) 2019 Andrei Dimitrief-Jianu
 * 
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * 
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 * 
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 * 
 */

const DEFAULT_OPTIONS =
{
    attempts: 5,
    baseDelay: 1000,
    maxDelay: 16000,
    sleep: function(ms) { return new Promise(resolve => setTimeout(resolve, ms)); },
    log: function(message) { console.error(message); }
};

var rpcUtils = 
{
    // ethers v4 reports transport failures as e.g. "invalid response - 0" and
    // keeps the underlying reason (ECONNREFUSED, a 429 body, ...) in
    // responseText; include its first line so the user can see what happened.
    describeError: function(error)
    {
        let text = error.message;
        if (typeof error.responseText === 'string' && error.responseText.length > 0)
        {
            text += ' (' + error.responseText.split('\n')[0] + ')';
        }
        return text;
    },

    // Call fn() and retry it with exponential backoff when it rejects.
    // Every error is treated as retryable; after the last attempt the
    // error is rethrown wrapped with the description and attempt count,
    // with the original error available as `cause`.
    withRetry: async function(description, fn, options)
    {
        let settings = Object.assign({}, DEFAULT_OPTIONS, options);

        let lastError = null;
        for (let attempt = 1; attempt <= settings.attempts; attempt++)
        {
            try
            {
                return await fn();
            }
            catch (error)
            {
                lastError = error;
                if (attempt == settings.attempts)
                {
                    break;
                }

                let delay = Math.min(settings.baseDelay * Math.pow(2, attempt - 1), settings.maxDelay);
                settings.log('rpc ' + description + ' failed (attempt ' + attempt + '/' + settings.attempts + '): ' + rpcUtils.describeError(error) + '; retrying in ' + delay + ' ms');
                await settings.sleep(delay);
            }
        }

        let wrappedError = new Error(description + ' failed after ' + settings.attempts + ' attempts: ' + rpcUtils.describeError(lastError));
        wrappedError.cause = lastError;
        throw wrappedError;
    }
}

module.exports = rpcUtils;
