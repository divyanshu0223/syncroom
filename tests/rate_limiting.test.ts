import test from 'node:test';
import assert from 'node:assert/strict';
import { RateLimiter, createApiRateLimiter } from '../server/utils/rateLimiter';

test('RATE LIMIT 1: Sliding Window Rate Limiting Enforcement', () => {
  const limiter = new RateLimiter();
  const testKey = 'test_ip_192_168_1_10';
  const limit = 5;
  const windowMs = 1000;

  // First 5 requests must succeed
  for (let i = 0; i < limit; i++) {
    assert.equal(limiter.checkLimit(testKey, limit, windowMs), true, `Request ${i + 1} should be permitted`);
  }

  // 6th request must be rejected
  assert.equal(limiter.checkLimit(testKey, limit, windowMs), false, '6th request must exceed limit');

  // Independent key must still be permitted (fairness / isolation)
  const anotherKey = 'test_ip_10_0_0_1';
  assert.equal(limiter.checkLimit(anotherKey, limit, windowMs), true, 'Independent IP should not be blocked');

  limiter.destroy();
});

test('RATE LIMIT 2: Temporary Rate Limit Expiration (Does Not Permanently Block)', async () => {
  const limiter = new RateLimiter();
  const testKey = 'test_ip_temporary';
  const limit = 2;
  const windowMs = 100; // 100ms short window for test

  assert.equal(limiter.checkLimit(testKey, limit, windowMs), true);
  assert.equal(limiter.checkLimit(testKey, limit, windowMs), true);
  assert.equal(limiter.checkLimit(testKey, limit, windowMs), false, 'Should be limited immediately');

  // Wait for window to pass
  await new Promise((resolve) => setTimeout(resolve, 150));

  // Should be allowed again after window expires
  assert.equal(limiter.checkLimit(testKey, limit, windowMs), true, 'Request after window expiration must succeed');

  limiter.destroy();
});

test('RATE LIMIT 3: Express Rate Limit Middleware Behavior & Headers', () => {
  const limiter = new RateLimiter();
  const middleware = createApiRateLimiter({
    max: 3,
    windowMs: 1000,
    prefix: 'api_test',
  });

  const mockReq = {
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' },
  } as any;

  let statusCode = 200;
  let responseBody: any = null;
  const headers: Record<string, string> = {};

  const mockRes = {
    setHeader: (name: string, value: any) => {
      headers[name] = String(value);
    },
    status: (code: number) => {
      statusCode = code;
      return {
        json: (data: any) => {
          responseBody = data;
        },
      };
    },
  } as any;

  let nextCalled = false;
  const next = () => { nextCalled = true; };

  // Calls 1, 2, 3 succeed
  for (let i = 0; i < 3; i++) {
    nextCalled = false;
    middleware(mockReq, mockRes, next);
    assert.equal(nextCalled, true, `Call ${i + 1} should call next()`);
  }

  // Call 4 should trigger 429
  nextCalled = false;
  middleware(mockReq, mockRes, next);
  assert.equal(nextCalled, false, 'Call 4 must NOT call next()');
  assert.equal(statusCode, 429, 'Rate-limited request must return status 429');
  assert.ok(responseBody?.error, 'Response must include error message');
  assert.equal(headers['Retry-After'], '1', 'Must send Retry-After header');

  limiter.destroy();
});
